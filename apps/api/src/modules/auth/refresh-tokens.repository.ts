// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Refresh tokens repository — manages the `refresh_tokens` collection.
 *
 * Refresh tokens are opaque 256-bit random values. We store only the
 * SHA-256 hash in the database — the raw token is returned to the client
 * once and never stored. If the DB is compromised, raw tokens cannot be
 * derived from the hashes.
 *
 * Rotation strategy: each `rotate()` call creates a NEW token and marks
 * the old one as replaced. Both the old and new records stay in the DB for
 * an audit trail. Clients must send the latest token; sending a replaced
 * token indicates a replay attack and should trigger revocation of the
 * entire family (future enhancement — K18).
 *
 * Indexes (created at startup via `ensureIndexes()`):
 *   - { tokenHash: 1 } unique  — primary lookup key
 *   - { userId: 1, revokedAt: 1 } — list active tokens per user
 *   - { expiresAt: 1 } TTL 0  — automatic cleanup of expired tokens
 */

import { createHash, randomBytes } from 'node:crypto';

import type { Collection, Db, ObjectId } from 'mongodb';

// ---------------------------------------------------------------------------
// Document shape (internal to the auth module — not in shared-types)
// ---------------------------------------------------------------------------

export interface RefreshTokenDoc {
  _id: ObjectId;
  /** Inventario user _id (string form for consistency with other collections). */
  userId: string;
  /** SHA-256 hash of the raw 256-bit token (hex, 64 chars). */
  tokenHash: string;
  /** Absolute expiry. Token is rejected after this timestamp. */
  expiresAt: Date;
  createdAt: Date;
  /** Set when the token is explicitly revoked or rotated. */
  revokedAt: Date | null;
  /** Hash of the token that replaced this one (rotation chain). */
  replacedByHash: string | null;
  /** Optional: browser/client UA for session display. */
  userAgent: string | null;
  /** Optional: client IP for anomaly display. */
  ipAddress: string | null;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class RefreshTokensRepository {
  private readonly col: Collection<Omit<RefreshTokenDoc, '_id'>>;

  constructor(db: Db) {
    this.col = db.collection<Omit<RefreshTokenDoc, '_id'>>('refresh_tokens');
  }

  // -------------------------------------------------------------------------
  // Indexes — call once at startup
  // -------------------------------------------------------------------------

  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ tokenHash: 1 }, { unique: true, name: 'refresh_token_hash_uq' });
    await this.col.createIndex({ userId: 1, revokedAt: 1 }, { name: 'refresh_token_user_active' });
    // TTL index — MongoDB auto-deletes expired documents.
    // expireAfterSeconds: 0 means "delete when expiresAt is reached".
    await this.col.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'refresh_token_ttl' },
    );
  }

  // -------------------------------------------------------------------------
  // Write: create
  // -------------------------------------------------------------------------

  /**
   * Issue a new refresh token for a user.
   *
   * Returns the **raw** token (64 hex chars). The caller sets this as an
   * httpOnly cookie. Only the SHA-256 hash is persisted.
   */
  async create(params: {
    userId: string;
    ttlDays: number;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<string> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + params.ttlDays * 24 * 60 * 60 * 1000);

    await this.col.insertOne({
      userId: params.userId,
      tokenHash,
      expiresAt,
      createdAt: now,
      revokedAt: null,
      replacedByHash: null,
      userAgent: params.userAgent ?? null,
      ipAddress: params.ipAddress ?? null,
    });

    return rawToken;
  }

  // -------------------------------------------------------------------------
  // Read: find by raw token
  // -------------------------------------------------------------------------

  async findByRawToken(rawToken: string): Promise<(RefreshTokenDoc & { _id: ObjectId }) | null> {
    const tokenHash = hashToken(rawToken);
    return this.col.findOne({ tokenHash }) as Promise<(RefreshTokenDoc & { _id: ObjectId }) | null>;
  }

  // -------------------------------------------------------------------------
  // Write: rotate
  // -------------------------------------------------------------------------

  /**
   * Rotate a refresh token: mark the old one replaced and issue a new one.
   *
   * The caller must have already validated the old token (not expired,
   * not revoked) before calling this. Returns the new raw token.
   */
  async rotate(params: {
    oldRawToken: string;
    userId: string;
    ttlDays: number;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<string> {
    const oldHash = hashToken(params.oldRawToken);
    const newRawToken = randomBytes(32).toString('hex');
    const newHash = hashToken(newRawToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + params.ttlDays * 24 * 60 * 60 * 1000);

    await this.col.updateOne(
      { tokenHash: oldHash },
      { $set: { revokedAt: now, replacedByHash: newHash } },
    );

    await this.col.insertOne({
      userId: params.userId,
      tokenHash: newHash,
      expiresAt,
      createdAt: now,
      revokedAt: null,
      replacedByHash: null,
      userAgent: params.userAgent ?? null,
      ipAddress: params.ipAddress ?? null,
    });

    return newRawToken;
  }

  // -------------------------------------------------------------------------
  // Write: revoke
  // -------------------------------------------------------------------------

  /** Revoke a single token (explicit logout). */
  async revoke(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    await this.col.updateOne({ tokenHash }, { $set: { revokedAt: new Date() } });
  }

  /** Revoke ALL active tokens for a user (password change, security event). */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.col.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    return result.modifiedCount;
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

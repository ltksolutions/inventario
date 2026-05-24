// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * PasskeysRepository — CRUD pre WebAuthn/FIDO2 credentials.
 *
 * Passkeys sú GLOBÁLNE (per-user, nie per-tenant). Žiadne organisationId
 * scoping. Index na credentialId je globally unique (WebAuthn spec).
 */

import { ObjectId } from 'mongodb';

import type { Db, WithId } from 'mongodb';

// PasskeyCredential type — imported from shared-types once dist is rebuilt.
// Until then, use a local minimal type to avoid stale .d.ts errors.
type PasskeyCredential = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Public projection — vrátené klientom (nikdy publicKey, counter raw)
// ---------------------------------------------------------------------------

const PUBLIC_PROJECTION = {
  _id: 1,
  userId: 1,
  credentialId: 1,
  deviceName: 1,
  transports: 1,
  backedUp: 1,
  authenticatorAttachment: 1,
  createdAt: 1,
  lastUsedAt: 1,
  deletedAt: 1,
} as const;

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class PasskeysRepository {
  private readonly col;

  constructor(db: Db) {
    this.col = db.collection<PasskeyCredential>('passkeys');
  }

  // -------------------------------------------------------------------------
  // Index initialization (called once at startup / migration)
  // -------------------------------------------------------------------------

  async initIndexes(): Promise<void> {
    // Global unique index on credentialId (WebAuthn spec requirement)
    await this.col.createIndex({ credentialId: 1 }, { unique: true, background: true });
    // Fast lookup of user's active passkeys
    await this.col.createIndex({ userId: 1, deletedAt: 1 }, { background: true });
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** Find by WebAuthn credentialId (globally unique). Returns full doc for verification. */
  async findByCredentialId(credentialId: string): Promise<WithId<PasskeyCredential> | null> {
    return this.col.findOne({
      credentialId,
      deletedAt: null,
    } as never) as Promise<WithId<PasskeyCredential> | null>;
  }

  /** List all active passkeys for a user (public projection). */
  async findByUserId(userId: string): Promise<WithId<PasskeyCredential>[]> {
    return this.col
      .find({ userId, deletedAt: null } as never, { projection: PUBLIC_PROJECTION })
      .sort({ createdAt: 1 })
      .toArray() as unknown as WithId<PasskeyCredential>[];
  }

  /** Count active passkeys for a user. Used for passkeyEnabled flag management. */
  async countActiveByUserId(userId: string): Promise<number> {
    return this.col.countDocuments({ userId, deletedAt: null } as never);
  }

  /** Get full passkey doc (including publicKey + counter) for verification. */
  async findFullById(id: string): Promise<WithId<PasskeyCredential> | null> {
    if (!ObjectId.isValid(id)) return null;
    return this.col.findOne({
      _id: new ObjectId(id),
      deletedAt: null,
    } as never) as Promise<WithId<PasskeyCredential> | null>;
  }

  /** Find by _id + userId (ownership check). Public projection. */
  async findByIdAndUser(id: string, userId: string): Promise<WithId<PasskeyCredential> | null> {
    if (!ObjectId.isValid(id)) return null;
    return this.col.findOne({ _id: new ObjectId(id), userId, deletedAt: null } as never, {
      projection: PUBLIC_PROJECTION,
    }) as Promise<WithId<PasskeyCredential> | null>;
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  /** Insert new passkey credential. Returns inserted _id. */
  async insert(doc: Omit<PasskeyCredential, '_id'>): Promise<string> {
    const result = await this.col.insertOne(doc as never);
    return String(result.insertedId);
  }

  /** Update counter + lastUsedAt after successful authentication. */
  async updateAfterAuth(credentialId: string, newCounter: number, now: string): Promise<void> {
    await this.col.updateOne({ credentialId, deletedAt: null } as never, {
      $set: { counter: newCounter, lastUsedAt: now, updatedAt: now },
    });
  }

  /** Rename deviceName. */
  async rename(id: string, userId: string, deviceName: string, now: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const result = await this.col.updateOne(
      { _id: new ObjectId(id), userId, deletedAt: null } as never,
      { $set: { deviceName, updatedAt: now } },
    );
    return result.modifiedCount > 0;
  }

  /** Soft-delete by _id + userId (ownership check). */
  async softDelete(id: string, userId: string, deletedBy: string, now: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const result = await this.col.updateOne(
      { _id: new ObjectId(id), userId, deletedAt: null } as never,
      { $set: { deletedAt: now, deletedBy, updatedAt: now } },
    );
    return result.modifiedCount > 0;
  }
}

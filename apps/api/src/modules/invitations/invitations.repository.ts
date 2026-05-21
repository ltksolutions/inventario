// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Invitations repository — thin MongoDB access layer for the invite flow.
 *
 * Pending invitations are stored as User documents with:
 *   - passwordHash: null
 *   - emailVerified: false
 *   - emailVerificationToken: <invite token>
 *   - emailVerificationExpiresAt: now + 7 days
 *
 * This avoids a separate `invitations` collection and reuses the existing
 * email-uniqueness constraint on the users collection. See design doc:
 * docs/sessions/2026-05-20-slice-6c-k18-design.md — Data model section.
 */

import { ObjectId, type Collection, type Db, type Filter, type WithId } from 'mongodb';

import type { User } from '@inventario/shared-types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Shape returned by list + post endpoints (no passwordHash / sensitive fields). */
export interface PendingInvitation {
  _id: string;
  email: string;
  roles: User['roles'];
  firstName: string | null;
  lastName: string | null;
  invitedBy: string;
  invitedAt: string;
  expiresAt: string;
}

export interface ListInvitationsParams {
  organisationId: string;
  limit?: number;
  skip?: number;
  q?: string;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class InvitationsRepository {
  private readonly users: Collection<User>;

  constructor(db: Db) {
    this.users = db.collection<User>('users');
  }

  /** Pending invitation filter — no password, not verified, not soft-deleted, tenant-scoped. */
  private pendingFilter(organisationId: string, extra: Filter<User> = {}): Filter<User> {
    return {
      organisationId,
      passwordHash: null,
      emailVerified: false,
      deletedAt: null,
      ...extra,
    } as Filter<User>;
  }

  /** Find pending invite by its MongoDB _id. Returns null if not found. */
  async findById(organisationId: string, id: string): Promise<WithId<User> | null> {
    if (!ObjectId.isValid(id)) return null;
    return this.users.findOne(
      this.pendingFilter(organisationId, {
        _id: new ObjectId(id) as unknown as User['_id'],
      }),
    );
  }

  /** Find pending invite by invite token across all tenants (for accept flows). */
  async findByToken(token: string): Promise<WithId<User> | null> {
    return this.users.findOne({
      emailVerificationToken: token,
      passwordHash: null,
      emailVerified: false,
      deletedAt: null,
    } as Filter<User>);
  }

  /** Check if an email already exists anywhere in the users collection (any state, any tenant). */
  async emailExists(email: string): Promise<boolean> {
    const count = await this.users.countDocuments({
      email,
      deletedAt: null,
    } as Filter<User>);
    return count > 0;
  }

  /** List pending invitations for a tenant with optional free-text search on email. */
  async list({
    organisationId,
    limit = 50,
    skip = 0,
    q,
  }: ListInvitationsParams): Promise<{ items: WithId<User>[]; total: number }> {
    const filter = this.pendingFilter(organisationId, {
      ...(q ? { email: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {}),
    } as Filter<User>);

    const [items, total] = await Promise.all([
      this.users
        .find(filter, {
          limit,
          skip,
          sort: { invitationSentAt: -1 },
          projection: { passwordHash: 0, mfaSecret: 0, mfaRecoveryCodes: 0 },
        })
        .toArray(),
      this.users.countDocuments(filter),
    ]);

    return { items, total };
  }

  /** Insert a new pending invite User document. Returns the inserted _id as string. */
  async insertInvite(doc: Omit<User, '_id'>): Promise<string> {
    // entraOid must be ABSENT (not null) from invite documents.
    // The sparse unique index on entraOid indexes null values, so two
    // invite docs with entraOid:null would cause an E11000 duplicate key.
    // Omitting the field entirely keeps invites outside the index.
    const { entraOid: _omit, ...insertDoc } = doc;
    const { insertedId } = await this.users.insertOne(insertDoc as unknown as User);
    return insertedId.toString();
  }

  /** Soft-delete a pending invite (revoke). Returns true if found and deleted. */
  async revoke(organisationId: string, id: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const now = new Date().toISOString();
    const result = await this.users.updateOne(
      this.pendingFilter(organisationId, {
        _id: new ObjectId(id) as unknown as User['_id'],
      }),
      { $set: { deletedAt: now, deletedBy: 'system-revoked' } },
    );
    return result.modifiedCount === 1;
  }

  /** Convert a WithId<User> to the public PendingInvitation shape. */
  toPublic(user: WithId<User>): PendingInvitation {
    return {
      _id: user._id.toString(),
      email: user.email,
      roles: user.roles,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      invitedBy: user.createdBy,
      invitedAt: user.invitationSentAt ?? user.createdAt,
      expiresAt: user.emailVerificationExpiresAt ?? '',
    };
  }
}

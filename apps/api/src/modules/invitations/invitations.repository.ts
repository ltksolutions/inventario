// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Invitations repository — MongoDB CRUD pre kolekciu `invitations` (ADR-0015).
 *
 * Nahradenie ghost-user patternu: pending pozvánky sa už neukladajú ako
 * User dokumenty, ale do samostatnej kolekcie `invitations`.
 *
 * Kľúčové operácie:
 *   - findByToken(token)     → accept flow (GET /v1/auth/invitations/:token)
 *   - findById(id, orgId)    → tenant-scoped read
 *   - listByOrganisation()   → admin list
 *   - create()               → POST /v1/invitations (K10)
 *   - accept()               → POST /v1/auth/accept-invitation (K12)
 *   - revoke()               → DELETE /v1/invitations/:id
 *   - expireOldInvitations() → cleanup job
 *
 * Backward-compat @deprecated metódy (pre invitations.routes.ts počas K1-K9):
 *   - emailExists()   → nahradí emailMatchLogic v K10
 *   - insertInvite()  → nahradí create() v K10
 *   - toPublic()      → nahradí vlastnú serialization v K10
 *   Tieto metódy stále pracujú s `users` kolekciou (ghost-user pattern)
 *   a budú odstránené v K10 keď sa routes prepíšu na novú `invitations` kolekciu.
 *
 * Indexy sú vytvorené v migration runneri. ensureIndexes() je záchrana pre testy.
 */

import { ObjectId, type ClientSession, type Collection, type Db, type WithId } from 'mongodb';

import type { Invitation, User } from '@inventario/shared-types';

// ---------------------------------------------------------------------------
// Projection — token NEVER returned except via the preview endpoint
// ---------------------------------------------------------------------------

const SAFE_PROJECTION = { token: 0 } as const;

// ---------------------------------------------------------------------------
// Public types (backward compat)
// ---------------------------------------------------------------------------

/** @deprecated Replaced by Invitation type in K10. */
export interface PendingInvitation {
  _id: string;
  email: string;
  roles: string[];
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
  private readonly col: Collection<Invitation>;
  /** @deprecated Ghost-user compat — used by legacy routes until K10. */
  private readonly users: Collection<User>;

  constructor(db: Db) {
    this.col = db.collection<Invitation>('invitations');
    this.users = db.collection<User>('users');
  }

  /** Creates indexes if they do not exist. Idempotent. */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.col.createIndex(
        { token: 1 },
        {
          unique: true,
          partialFilterExpression: { token: { $type: 'string' } },
          name: 'invitations_token_unique_partial',
        },
      ),
      this.col.createIndex(
        { organisationId: 1, status: 1, deletedAt: 1 },
        { name: 'invitations_organisationId_status_deletedAt' },
      ),
      this.col.createIndex(
        { email: 1, organisationId: 1, status: 1 },
        { name: 'invitations_email_organisationId_status' },
      ),
      this.col.createIndex({ expiresAt: 1 }, { name: 'invitations_expiresAt' }),
    ]);
  }

  // -------------------------------------------------------------------------
  // Read paths (new invitations collection)
  // -------------------------------------------------------------------------

  /**
   * Find a pending invitation by its token (accept flow).
   * Returns the FULL document (including token) — caller must not leak token.
   * Searches both the new `invitations` collection AND the legacy `users`
   * collection (ghost-user) for backward compat during K1-K9 transition.
   */
  async findByToken(token: string): Promise<WithId<Invitation> | null> {
    const inv = await this.col.findOne({ token, deletedAt: null } as never);
    if (inv) return inv;

    // @deprecated legacy ghost-user fallback — remove after K10
    const ghostUser = await this.users.findOne({
      emailVerificationToken: token,
      passwordHash: null,
      emailVerified: false,
      deletedAt: null,
    } as never);
    if (ghostUser) {
      // Shape the ghost user as a minimal Invitation for route compat
      return this.ghostUserToInvitation(ghostUser);
    }
    return null;
  }

  /**
   * Find an invitation by its _id, scoped to a tenant.
   * Searches new invitations collection; falls back to ghost-user in users.
   * Returns without token (safe for API responses).
   */
  async findById(organisationId: string, id: string): Promise<WithId<Invitation> | null> {
    if (!ObjectId.isValid(id)) return null;

    const inv = await this.col.findOne(
      {
        _id: new ObjectId(id) as unknown as Invitation['_id'],
        organisationId,
        deletedAt: null,
      } as never,
      { projection: SAFE_PROJECTION },
    );
    if (inv) return inv;

    // @deprecated legacy ghost-user fallback — remove after K10
    const ghost = await this.users.findOne({
      _id: new ObjectId(id) as never,
      organisationId,
      passwordHash: null,
      emailVerified: false,
      deletedAt: null,
    });
    return ghost ? this.ghostUserToInvitation(ghost) : null;
  }

  /**
   * Check if there's already an active (PENDING) invitation for this
   * email + tenant combination. Used to prevent duplicate invites.
   */
  async findActiveDuplicate(
    email: string,
    organisationId: string,
  ): Promise<WithId<Invitation> | null> {
    return this.col.findOne({
      email,
      organisationId,
      status: 'PENDING',
      deletedAt: null,
    } as never);
  }

  /**
   * List pending invitations for a tenant with optional email search.
   * Searches the new `invitations` collection. Falls back to ghost-user
   * if no results found (transition period during K1-K9).
   */
  async list({
    organisationId,
    limit = 50,
    skip = 0,
    q,
  }: ListInvitationsParams): Promise<{ items: WithId<Invitation>[]; total: number }> {
    const filter: Record<string, unknown> = {
      organisationId,
      status: 'PENDING',
      deletedAt: null,
    };
    if (q) {
      filter['email'] = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    const [items, total] = await Promise.all([
      this.col
        .find(filter as never, {
          limit,
          skip,
          sort: { createdAt: -1 },
          projection: SAFE_PROJECTION,
        })
        .toArray(),
      this.col.countDocuments(filter as never),
    ]);

    // @deprecated ghost-user fallback if new collection empty — remove after K10
    if (total === 0) {
      return this.listGhostUsers({
        organisationId,
        limit,
        skip,
        ...(q !== undefined ? { q } : {}),
      });
    }

    return { items, total };
  }

  // -------------------------------------------------------------------------
  // Write paths (new invitations collection)
  // -------------------------------------------------------------------------

  /**
   * Insert a new invitation into the `invitations` collection.
   * Returns the _id as string.
   */
  async create(doc: Omit<Invitation, '_id'>, session?: ClientSession): Promise<string> {
    const { insertedId } = await this.col.insertOne(
      doc as unknown as Invitation,
      session ? { session } : undefined,
    );
    return insertedId.toString();
  }

  /**
   * Transition an invitation to ACCEPTED.
   */
  async accept(
    id: string,
    patch: { acceptedAt: string; membershipId: string; updatedAt: string; updatedBy: string },
    session?: ClientSession,
  ): Promise<WithId<Invitation> | null> {
    if (!ObjectId.isValid(id)) return null;

    const result = await this.col.findOneAndUpdate(
      {
        _id: new ObjectId(id) as unknown as Invitation['_id'],
        status: 'PENDING',
        deletedAt: null,
      } as never,
      {
        $set: {
          status: 'ACCEPTED',
          acceptedAt: patch.acceptedAt,
          membershipId: patch.membershipId,
          updatedAt: patch.updatedAt,
          updatedBy: patch.updatedBy,
        },
      },
      {
        returnDocument: 'after',
        projection: SAFE_PROJECTION,
        ...(session ? { session } : {}),
      },
    );
    return result ?? null;
  }

  /**
   * Revoke a PENDING invitation (soft-delete).
   *
   * Supports both:
   *   - 2-arg call: revoke(orgId, id) — legacy routes (K1-K9), builds patch internally
   *   - 3-arg call: revoke(orgId, id, patch) — new routes (K10+)
   */
  async revoke(
    organisationId: string,
    id: string,
    patch?: { deletedAt: string; deletedBy: string; updatedAt: string; updatedBy: string },
  ): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const now = new Date().toISOString();
    const effectivePatch = patch ?? {
      deletedAt: now,
      deletedBy: 'system-revoked',
      updatedAt: now,
      updatedBy: 'system-revoked',
    };

    // Try new invitations collection first
    const result = await this.col.updateOne(
      {
        _id: new ObjectId(id) as unknown as Invitation['_id'],
        organisationId,
        status: 'PENDING',
        deletedAt: null,
      } as never,
      { $set: { ...effectivePatch, status: 'REVOKED' } },
    );
    if (result.modifiedCount === 1) return true;

    // @deprecated ghost-user fallback — remove after K10
    const ghostResult = await this.users.updateOne(
      {
        _id: new ObjectId(id) as never,
        organisationId,
        passwordHash: null,
        emailVerified: false,
        deletedAt: null,
      },
      { $set: { deletedAt: effectivePatch.deletedAt, deletedBy: effectivePatch.deletedBy } },
    );
    return ghostResult.modifiedCount === 1;
  }

  /**
   * Mark expired PENDING invitations as EXPIRED.
   */
  async expireOldInvitations(now: string): Promise<number> {
    const result = await this.col.updateMany(
      {
        status: 'PENDING',
        expiresAt: { $lt: now },
        deletedAt: null,
      } as never,
      { $set: { status: 'EXPIRED', updatedAt: now, updatedBy: 'SYSTEM' } },
    );
    return result.modifiedCount;
  }

  // -------------------------------------------------------------------------
  // @deprecated backward-compat methods — ghost-user pattern (remove in K10)
  // -------------------------------------------------------------------------

  /**
   * @deprecated Check if email exists in users collection (ghost-user pattern).
   * Replace with cross-tenant email match logic in K10.
   */
  async emailExists(email: string): Promise<boolean> {
    const count = await this.users.countDocuments({
      email,
      deletedAt: null,
    } as never);
    return count > 0;
  }

  /**
   * @deprecated Insert a ghost-user pending invite into `users` collection.
   * Replace with InvitationsRepository.create() in K10.
   */
  async insertInvite(doc: Omit<User, '_id'>): Promise<string> {
    const { entraOid: _omit, ...insertDoc } = doc;
    const { insertedId } = await this.users.insertOne(insertDoc as unknown as User);
    return insertedId.toString();
  }

  /**
   * @deprecated Serialize invitation/ghost-user to public shape.
   * Accepts WithId<Invitation> (new) OR WithId<User> (legacy ghost-user).
   * Replace with direct Invitation serialization in K10.
   */
  toPublic(doc: WithId<Invitation> | WithId<User>): PendingInvitation {
    // Distinguish by presence of `expiresAt` (Invitation) vs `emailVerificationExpiresAt` (User)
    const isInvitation = 'expiresAt' in doc && !('displayName' in doc);
    if (isInvitation) {
      const inv = doc as WithId<Invitation>;
      return {
        _id: inv._id.toString(),
        email: inv.email,
        roles: inv.roles as string[],
        firstName: inv.firstName ?? null,
        lastName: inv.lastName ?? null,
        invitedBy: inv.invitedBy,
        invitedAt: inv.createdAt,
        expiresAt: inv.expiresAt ?? '',
      };
    }
    const user = doc as WithId<User>;
    return {
      _id: user._id.toString(),
      email: user.email,
      roles: (user.roles ?? []) as string[],
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      invitedBy: user.createdBy,
      invitedAt: (user.invitationSentAt ?? user.createdAt) as string,
      expiresAt: (user.emailVerificationExpiresAt ?? '') as string,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Shape a ghost User document as a minimal Invitation for route compat.
   * @deprecated — remove after K10 migration.
   */
  private ghostUserToInvitation(ghost: WithId<User>): WithId<Invitation> {
    return {
      _id: ghost._id,
      email: ghost.email,
      organisationId: ghost.organisationId ?? '',
      roles: (ghost.roles ?? ['EMPLOYEE']) as Invitation['roles'],
      firstName: ghost.firstName ?? null,
      lastName: ghost.lastName ?? null,
      invitedUserId: null,
      token: (ghost.emailVerificationToken ?? '') as string,
      expiresAt: (ghost.emailVerificationExpiresAt ?? '') as string,
      invitedBy: ghost.createdBy,
      status: 'PENDING',
      acceptedAt: null,
      membershipId: null,
      createdAt: ghost.createdAt,
      updatedAt: ghost.updatedAt,
      createdBy: ghost.createdBy,
      updatedBy: ghost.updatedBy,
      deletedAt: ghost.deletedAt ?? null,
      deletedBy: ghost.deletedBy ?? null,
    } as unknown as WithId<Invitation>;
  }

  /**
   * @deprecated Ghost-user list fallback — remove after K10.
   */
  private async listGhostUsers({
    organisationId,
    limit = 50,
    skip = 0,
    q,
  }: ListInvitationsParams): Promise<{ items: WithId<Invitation>[]; total: number }> {
    const filter: Record<string, unknown> = {
      organisationId,
      passwordHash: null,
      emailVerified: false,
      deletedAt: null,
    };
    if (q) {
      filter['email'] = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    const [rawItems, total] = await Promise.all([
      this.users
        .find(filter as never, {
          limit,
          skip,
          sort: { invitationSentAt: -1 },
          projection: { passwordHash: 0, mfaSecret: 0, mfaRecoveryCodes: 0 },
        })
        .toArray(),
      this.users.countDocuments(filter as never),
    ]);

    const items = rawItems.map((u) => this.ghostUserToInvitation(u));
    return { items, total };
  }
}

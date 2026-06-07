// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * MembershipsRepository — MongoDB CRUD pre kolekciu `memberships` (ADR-0015).
 *
 * Kľúčové operácie:
 *   - findActive({ userId, organisationId })  → používa sa v auth middleware (K6)
 *   - countActiveAdmins(organisationId)       → LAST_ADMIN_PROTECTION (K16)
 *   - findByUser(userId)                      → list tenantov pre tenant switcher
 *   - create, update, softDelete
 *
 * Indexy sú vytvorené v migration runneri (2026-05-23-memberships).
 * `ensureIndexes()` tu je idempotentná záchrana pre test prostredie.
 *
 * Všetky `userId` a `organisationId` sa ukladajú ako string (24 hex),
 * konzistentné s ObjectIdSchema v shared-types.
 */

import { ObjectId, type ClientSession, type Collection, type Db, type WithId } from 'mongodb';

import type { Membership, UpdateMembershipInput, UserRole } from '@inventario/shared-types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FindActiveParams {
  userId: string;
  organisationId: string;
}

export interface ListByUserResult {
  membership: WithId<Membership>;
  organisationId: string;
}

export type MembershipUpdatePatch = UpdateMembershipInput & {
  updatedAt: string;
  updatedBy: string;
  lastAccessedAt?: string | null;
};

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class MembershipsRepository {
  private readonly col: Collection<Membership>;

  constructor(db: Db) {
    this.col = db.collection<Membership>('memberships');
  }

  /**
   * Creates indexes if they do not exist. Idempotent.
   * Primary index creation is done by the migration runner;
   * this method is a safety net for test environments.
   *
   * NOTE: The userId+organisationId unique index uses a partialFilterExpression
   * so that soft-deleted docs (deletedAt != null) are excluded. This allows a
   * user to leave and rejoin an org — the old soft-deleted membership is kept
   * as a historical record and does not block the new active one.
   * Migration: 2026-06-07-memberships-partial-index.
   */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.col.createIndex(
        { userId: 1, organisationId: 1 },
        {
          unique: true,
          partialFilterExpression: { deletedAt: null },
          name: 'memberships_userId_organisationId_unique',
        },
      ),
      this.col.createIndex(
        { userId: 1, isDefault: 1 },
        {
          unique: true,
          partialFilterExpression: { isDefault: true, deletedAt: null },
          name: 'memberships_userId_isDefault_partial_unique',
        },
      ),
      this.col.createIndex(
        { organisationId: 1, status: 1, deletedAt: 1 },
        { name: 'memberships_organisationId_status_deletedAt' },
      ),
      this.col.createIndex({ userId: 1, deletedAt: 1 }, { name: 'memberships_userId_deletedAt' }),
    ]);
  }

  // -------------------------------------------------------------------------
  // Read paths
  // -------------------------------------------------------------------------

  /**
   * Find the active (non-suspended, non-deleted) membership for a specific
   * user + tenant pair. Used by the auth middleware on every request.
   *
   * Returns null if:
   *   - No membership exists
   *   - Membership is soft-deleted (user left / was removed)
   *   - Status is SUSPENDED (tenant admin suspended the member)
   */
  async findActive(
    params: FindActiveParams,
    session?: ClientSession,
  ): Promise<WithId<Membership> | null> {
    return this.col.findOne(
      {
        userId: params.userId,
        organisationId: params.organisationId,
        status: 'ACTIVE',
        deletedAt: null,
      } as never,
      session ? { session } : undefined,
    );
  }

  /**
   * Find a membership by its _id. No tenant scoping — callers must
   * verify tenant after loading if needed (e.g. PATCH /v1/memberships/:id
   * must ensure the actor is in the same tenant).
   */
  async findById(id: string, session?: ClientSession): Promise<WithId<Membership> | null> {
    if (!ObjectId.isValid(id)) return null;
    return this.col.findOne(
      { _id: new ObjectId(id) as unknown as Membership['_id'] },
      session ? { session } : undefined,
    );
  }

  /**
   * List all non-deleted memberships for a user across all tenants.
   * Used by GET /v1/auth/me (availableOrganisations) and tenant switcher.
   */
  async findByUser(userId: string): Promise<WithId<Membership>[]> {
    return this.col
      .find({ userId, deletedAt: null } as never)
      .sort({ isDefault: -1, lastAccessedAt: -1 })
      .toArray();
  }

  /**
   * List active (non-suspended, non-deleted) memberships for a tenant.
   * Used by GET /v1/memberships?organisationId= (admin member list).
   */
  async listByOrganisation(
    organisationId: string,
    options: { limit?: number; skip?: number } = {},
  ): Promise<{ items: WithId<Membership>[]; total: number }> {
    const filter = { organisationId, status: 'ACTIVE', deletedAt: null } as never;
    const limit = options.limit ?? 50;
    const skip = options.skip ?? 0;

    const [items, total] = await Promise.all([
      this.col.find(filter, { limit, skip, sort: { createdAt: 1 } }).toArray(),
      this.col.countDocuments(filter),
    ]);

    return { items, total };
  }

  /**
   * Count active ADMIN memberships in a tenant, optionally excluding
   * one userId. Used by LAST_ADMIN_PROTECTION in K16.
   *
   * "Active ADMIN" = status ACTIVE, deletedAt null, role is ADMIN.
   */
  async countActiveAdmins(
    organisationId: string,
    excludeUserId?: string,
    session?: ClientSession,
  ): Promise<number> {
    const filter: Record<string, unknown> = {
      organisationId,
      role: 'ADMIN',
      status: 'ACTIVE',
      deletedAt: null,
    };
    if (excludeUserId) {
      filter['userId'] = { $ne: excludeUserId };
    }
    return this.col.countDocuments(filter as never, session ? { session } : undefined);
  }

  // -------------------------------------------------------------------------
  // Write paths
  // -------------------------------------------------------------------------

  /**
   * Reactivate a soft-deleted membership for a user returning to an org
   * (rejoin / cross-tenant re-invite path).
   *
   * Finds the most-recently soft-deleted membership for {userId, organisationId}
   * and restores it: clears deletedAt/deletedBy, sets status ACTIVE, updates
   * role, acceptedAt, and audit fields. Returns the updated document, or null
   * if no soft-deleted membership exists (caller should fall through to create).
   *
   * This is the correct operation for the rejoin path — avoids E11000 on the
   * unique index {userId, organisationId} which covers all documents regardless
   * of deletedAt value.
   */
  async reactivate(
    params: {
      userId: string;
      organisationId: string;
      role: UserRole;
      acceptedAt: string;
      invitedBy: string;
      invitedAt: string;
      updatedAt: string;
      updatedBy: string;
    },
    session?: ClientSession,
  ): Promise<WithId<Membership> | null> {
    const result = await this.col.findOneAndUpdate(
      {
        userId: params.userId,
        organisationId: params.organisationId,
        deletedAt: { $ne: null },
      } as never,
      {
        $set: {
          status: 'ACTIVE',
          role: params.role,
          acceptedAt: params.acceptedAt,
          invitedBy: params.invitedBy,
          invitedAt: params.invitedAt,
          deletedAt: null,
          deletedBy: null,
          updatedAt: params.updatedAt,
          updatedBy: params.updatedBy,
        },
      },
      {
        sort: { deletedAt: -1 },
        returnDocument: 'after',
        ...(session ? { session } : {}),
      },
    );
    return result ?? null;
  }

  /**
   * Return the list of userId strings for all ACTIVE, non-deleted members
   * of a tenant. Used by UsersService.list() to resolve the member set
   * before fetching User documents — cross-tenant users have no
   * organisationId on the User document, so a direct users.find() by
   * organisationId would miss them.
   *
   * @param role — optional: restrict to members with this exact Membership.role.
   *   This is the authoritative role (ADR-0029); do not filter by User.roles[].
   */
  async findUserIdsByOrganisation(organisationId: string, role?: string): Promise<string[]> {
    const filter: Record<string, unknown> = { organisationId, status: 'ACTIVE', deletedAt: null };
    if (role !== undefined) {
      filter['role'] = role;
    }
    const docs = await this.col.find(filter as never, { projection: { userId: 1 } }).toArray();
    return docs.map((d) => (d as unknown as { userId: string }).userId);
  }

  /**
   * Insert a new membership. The unique index on {userId, organisationId}
   * prevents duplicates (callers catch E11000 and surface as 409).
   */
  async create(doc: Omit<Membership, '_id'>, session?: ClientSession): Promise<WithId<Membership>> {
    const { insertedId } = await this.col.insertOne(
      doc as unknown as Membership,
      session ? { session } : undefined,
    );
    return { ...doc, _id: insertedId } as unknown as WithId<Membership>;
  }

  /**
   * Apply a partial update to a membership. Returns updated doc or null
   * if not found. Caller sets updatedAt/updatedBy in the patch.
   */
  async update(
    id: string,
    patch: MembershipUpdatePatch,
    session?: ClientSession,
  ): Promise<WithId<Membership> | null> {
    if (!ObjectId.isValid(id)) return null;

    const result = await this.col.findOneAndUpdate(
      { _id: new ObjectId(id) as unknown as Membership['_id'], deletedAt: null },
      { $set: patch as never },
      {
        returnDocument: 'after',
        ...(session ? { session } : {}),
      },
    );
    return result ?? null;
  }

  /**
   * Soft-delete a membership (member leaves or is removed from tenant).
   * Sets deletedAt + deletedBy. Returns true if found and deleted.
   */
  async softDelete(
    id: string,
    patch: { deletedAt: string; deletedBy: string; updatedAt: string; updatedBy: string },
    session?: ClientSession,
  ): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;

    const result = await this.col.updateOne(
      { _id: new ObjectId(id) as unknown as Membership['_id'], deletedAt: null },
      { $set: patch },
      session ? { session } : undefined,
    );
    return result.modifiedCount === 1;
  }

  /**
   * Mark a membership as default, clearing isDefault on all other
   * memberships for the same userId. Runs in a transaction to ensure
   * the partial unique index invariant (max 1 isDefault=true per userId).
   *
   * Callers must pass an active ClientSession.
   */
  async setDefault(
    membershipId: string,
    userId: string,
    now: string,
    session: ClientSession,
  ): Promise<boolean> {
    if (!ObjectId.isValid(membershipId)) return false;

    // 1. Clear isDefault on all other memberships for this user
    await this.col.updateMany(
      {
        userId,
        _id: { $ne: new ObjectId(membershipId) as unknown as Membership['_id'] },
        isDefault: true,
        deletedAt: null,
      } as never,
      { $set: { isDefault: false, updatedAt: now, updatedBy: userId } },
      { session },
    );

    // 2. Set isDefault on target membership
    const result = await this.col.updateOne(
      { _id: new ObjectId(membershipId) as unknown as Membership['_id'], deletedAt: null } as never,
      { $set: { isDefault: true, updatedAt: now, updatedBy: userId } },
      { session },
    );
    return result.modifiedCount === 1;
  }

  /**
   * Soft-delete ALL memberships for a userId. Used by GDPR right-to-erasure
   * (DELETE /v1/auth/me) in K17.
   */
  async softDeleteAllForUser(
    userId: string,
    patch: { deletedAt: string; deletedBy: string; updatedAt: string; updatedBy: string },
    session?: ClientSession,
  ): Promise<number> {
    const result = await this.col.updateMany(
      { userId, deletedAt: null } as never,
      { $set: patch },
      session ? { session } : undefined,
    );
    return result.modifiedCount;
  }
}

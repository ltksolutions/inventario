/**
 * Users repository — MongoDB CRUD for the `users` collection.
 *
 * The collection stores both Entra ID (SSO) and LOCAL accounts. For now,
 * only the Entra path is exercised — JIT provisioning happens on first
 * authenticated request.
 *
 * Phase C Blok 3 (tenant-scoped):
 *   Every read and write takes `organisationId` as the first parameter
 *   and the repository enforces tenant scoping via the shared
 *   `tenantFilter` / `requireTenantId` utilities. Two exceptions exist
 *   for the JIT-provisioning flow that runs BEFORE tenant resolution:
 *
 *   - `findByEntraOid(entraOid)` — looks up across all tenants by the
 *     globally-unique Entra Object ID. Used by the auth middleware to
 *     find an already-provisioned user before resolving their tenant.
 *
 *   - `insertNew(user)` — inserts a new user without enforcing a
 *     pre-existing tenant filter. The document being inserted already
 *     carries `organisationId` (the service has resolved the tenant
 *     before calling), so the row is correctly tagged. We do NOT use
 *     the tenant scope here because there is no caller tenant context
 *     yet — we ARE the call that creates that context.
 *
 *   Both exceptions are clearly marked and not exposed to general
 *   business code; only the auth flow and the admin endpoints use them.
 *
 * Indexes:
 *   - `entraOid` unique, sparse  → cross-tenant SSO lookup
 *   - `organisationId + email` unique → one email per tenant (email is
 *     not globally unique because two tenants can each have a user
 *     `admin@company.sk`)
 *   - `organisationId + isActive + deletedAt` → admin list filters
 *
 * We project out `passwordHash` on every read so secrets cannot
 * accidentally end up in API responses.
 */

import { UserRole, type User } from '@inventario/shared-types';
import {
  ObjectId,
  type ClientSession,
  type Collection,
  type Db,
  type Filter,
  type FindOptions,
  type WithId,
} from 'mongodb';

import { requireTenantId, tenantFilter } from '../../lib/organisation-scoping.js';

// ---------------------------------------------------------------------------
// Projection — fields never returned to callers of the public methods.
// ---------------------------------------------------------------------------

const PUBLIC_PROJECTION = { passwordHash: 0, mfaSecret: 0, mfaRecoveryCodes: 0 } as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ListUsersParams {
  /** Tenant scope. Required. */
  organisationId: string;
  limit?: number;
  skip?: number;
  filter?: Filter<User>;
  sort?: FindOptions<User>['sort'];
}

export interface ListUsersResult {
  items: WithId<User>[];
  total: number;
}

/**
 * Patch shape for `update`. All fields optional; repository writes only
 * what's provided. Caller (service) adds `updatedAt`/`updatedBy`.
 *
 * Intentionally narrower than `Partial<User>`: identity / audit / security
 * columns the admin endpoint must NEVER change are excluded at the type
 * level so we cannot accidentally PATCH them even if a future route forgets
 * to filter them out.
 *
 * `organisationId` is excluded because tenant scope is immutable post
 * creation — moving a user between tenants requires an explicit data
 * migration, not a PATCH.
 */
export type UserUpdatePatch = Partial<
  Pick<
    User,
    | 'roles'
    | 'isActive'
    | 'firstName'
    | 'lastName'
    | 'displayName'
    | 'organizationalUnit'
    | 'teams'
    | 'mustChangePassword'
    | 'preferences'
    | 'updatedAt'
    | 'updatedBy'
  >
>;

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class UsersRepository {
  private readonly collection: Collection<User>;

  constructor(db: Db) {
    this.collection = db.collection<User>('users');
  }

  /**
   * Creates indexes if they do not already exist. Idempotent.
   *
   * Index rationale (composite leading with `organisationId` where
   * applicable):
   *   - `entraOid_unique` — cross-tenant unique on Entra Object ID,
   *     sparse so LOCAL accounts (null entraOid) don't collide.
   *     This is the ONE index that intentionally crosses tenants:
   *     a single Entra user logging in from multiple tenants is not
   *     a supported scenario (one oid = one user globally).
   *   - `organisationId_email_unique` — emails are unique per tenant.
   *     Two tenants can each have an `admin@x.sk` user.
   *   - `organisationId_isActive_deletedAt` — admin list filters
   *     by activeness, scoped to a tenant, with soft-delete exclusion.
   */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex(
        { entraOid: 1 },
        { unique: true, sparse: true, name: 'entraOid_unique' },
      ),
      this.collection.createIndex(
        { organisationId: 1, email: 1 },
        { unique: true, name: 'organisationId_email_unique' },
      ),
      this.collection.createIndex(
        { organisationId: 1, isActive: 1, deletedAt: 1 },
        { name: 'organisationId_isActive_deletedAt' },
      ),
    ]);
  }

  // -------------------------------------------------------------------------
  // Cross-tenant methods (auth middleware path only)
  // -------------------------------------------------------------------------

  /**
   * Find a user by their Entra ID Object ID (`oid` claim).
   *
   * **This method intentionally crosses tenant boundaries** — it is the
   * one query in the codebase that does. The Entra `oid` claim is
   * globally unique per Entra account, so we use it as the primary
   * cross-tenant identity. Same oid across tenants would be a bug.
   *
   * Used by the auth middleware on every authenticated request to find
   * an already-provisioned user before deciding whether to JIT-provision.
   * The tenant scope is then derived from the user's `organisationId`
   * (or, for first-time logins, from the JWT `tid` claim → Organisation
   * lookup).
   *
   * Returns `null` if no match. Soft-deleted users are EXCLUDED — we
   * treat them as non-existent for auth purposes.
   */
  async findByEntraOid(entraOid: string): Promise<WithId<User> | null> {
    return this.collection.findOne(
      { entraOid, deletedAt: null },
      { projection: PUBLIC_PROJECTION },
    );
  }

  /**
   * Insert a new user without prior tenant scoping enforcement.
   *
   * **This is the JIT-provisioning path** — it runs DURING auth
   * middleware, before tenant scope is fully set up for the request.
   * The document being inserted already carries `organisationId` (the
   * service has resolved the tenant from the JWT `tid` claim before
   * calling), so the row is correctly tagged.
   *
   * Returns the inserted document with `_id` populated.
   *
   * Caller passes the document WITHOUT `_id` — MongoDB generates one.
   * Caller is responsible for providing all audit fields and the
   * resolved `organisationId`.
   */
  async insertNew(user: Omit<User, '_id'>): Promise<WithId<User>> {
    const { insertedId } = await this.collection.insertOne(user as unknown as User);

    // Return the document we just inserted with the assigned _id.
    // Avoids Atlas Flex read-after-write latency (findOne after insertOne
    // can return null on shared clusters due to replication lag).
    // passwordHash + MFA secrets excluded via destructuring — same intent
    // as PUBLIC_PROJECTION.

    const {
      passwordHash: _pw,
      mfaSecret: _mfaSecret,
      mfaRecoveryCodes: _mfaCodes,
      ...userWithoutSecrets
    } = user as User;
    return { ...userWithoutSecrets, _id: insertedId } as unknown as WithId<User>;
  }

  /**
   * Update `lastLoginAt` to the current time. Best-effort — failures
   * here should NOT block authentication, only be logged.
   *
   * Cross-tenant by Entra oid for the same reason as `findByEntraOid`:
   * this runs during auth before tenant scope is finalised. The Entra
   * oid is globally unique so the update targets exactly one row.
   */
  async touchLastLogin(entraOid: string): Promise<void> {
    const now = new Date().toISOString();
    await this.collection.updateOne({ entraOid }, { $set: { lastLoginAt: now, updatedAt: now } });
  }

  // -------------------------------------------------------------------------
  // Tenant-scoped methods (admin and business code path)
  // -------------------------------------------------------------------------

  /**
   * Find a user by their MongoDB `_id` within the tenant. Soft-deleted
   * users are EXCLUDED.
   *
   * Returns `null` if the id is malformed (not 24-hex), no match, or
   * the user belongs to a different tenant. Project out passwordHash
   * as everywhere else.
   */
  async findById(
    organisationId: string,
    id: string,
    session?: ClientSession,
  ): Promise<WithId<User> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    return this.collection.findOne(
      tenantFilter<User>(tenantId, {
        _id: new ObjectId(id) as unknown as User['_id'],
      } as Filter<User>),
      {
        projection: PUBLIC_PROJECTION,
        ...(session ? { session } : {}),
      },
    );
  }

  /**
   * List users matching the filter within the tenant, with pagination.
   * Soft-deleted are excluded by default. Sort defaults to
   * `displayName` ascending so the admin UI gets a stable alphabetical
   * ordering.
   *
   * Caller supplies the filter — `q` (free-text search) and role /
   * active filters are composed in the service layer so the repository
   * stays generic.
   */
  async list({
    organisationId,
    limit = 50,
    skip = 0,
    filter = {},
    sort = { displayName: 1 },
  }: ListUsersParams): Promise<ListUsersResult> {
    const tenantId = requireTenantId(organisationId);
    const effectiveFilter = tenantFilter<User>(tenantId, filter);

    const [items, total] = await Promise.all([
      this.collection
        .find(effectiveFilter, { limit, skip, sort, projection: PUBLIC_PROJECTION })
        .toArray(),
      this.collection.countDocuments(effectiveFilter),
    ]);

    return { items, total };
  }

  /**
   * Apply a partial update within the tenant. Returns updated doc or
   * null if not found, soft-deleted, or in a different tenant. Caller
   * is responsible for setting `updatedAt`/`updatedBy` in the patch.
   *
   * passwordHash is projected out of the returned document for
   * consistency with the rest of the repository's public methods.
   */
  async update(
    organisationId: string,
    id: string,
    patch: UserUpdatePatch,
    session?: ClientSession,
  ): Promise<WithId<User> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    const result = await this.collection.findOneAndUpdate(
      tenantFilter<User>(tenantId, {
        _id: new ObjectId(id) as unknown as User['_id'],
      } as Filter<User>),
      { $set: patch },
      {
        returnDocument: 'after',
        projection: PUBLIC_PROJECTION,
        ...(session ? { session } : {}),
      },
    );

    return result ?? null;
  }

  /**
   * Clear all MFA fields for a user (admin reset path).
   *
   * Sets mfaEnabled=false, mfaSecret=null, mfaRecoveryCodes=[],
   * mfaEnabledAt=null. The user must re-enroll on next login
   * (or immediately if org policy requireMfa is true).
   *
   * Tenant-scoped: admin in tenant A cannot reset a user in tenant B.
   * Caller must also set updatedAt/updatedBy.
   */
  async clearMfa(
    organisationId: string,
    id: string,
    patch: { updatedAt: string; updatedBy: string },
    session?: ClientSession,
  ): Promise<WithId<User> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    const result = await this.collection.findOneAndUpdate(
      tenantFilter<User>(tenantId, {
        _id: new ObjectId(id) as unknown as User['_id'],
      } as Filter<User>),
      {
        $set: {
          mfaEnabled: false,
          mfaSecret: null,
          mfaRecoveryCodes: [],
          mfaEnabledAt: null,
          updatedAt: patch.updatedAt,
          updatedBy: patch.updatedBy,
        },
      },
      {
        returnDocument: 'after',
        projection: PUBLIC_PROJECTION,
        ...(session ? { session } : {}),
      },
    );

    return result ?? null;
  }

  /**
   * Count users who are active AND have the ADMIN role within the
   * tenant, excluding the given userId
   *
   * Used by the last-admin guardrail in `UsersService.update` to
   * refuse patches that would leave a tenant with zero ADMINs. Runs
   * inside the same transaction as the patch to avoid a race with
   * another admin being deactivated in parallel.
   *
   * The "last admin" check is per-tenant: tenant A having ADMINs does
   * not protect tenant B from having its last admin demoted. Each
   * tenant manages its own admin set.
   */
  async countActiveAdminsExcluding(
    organisationId: string,
    userId: string,
    session?: ClientSession,
  ): Promise<number> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(userId)) {
      // Defensive: an invalid id means we can't exclude anything, so
      // this would return the full active-admin count for the tenant.
      // The route layer already validates the id format, but mirror
      // the guard from findById.
      return this.collection.countDocuments(
        tenantFilter<User>(tenantId, {
          roles: UserRole.ADMIN,
          isActive: true,
        } as Filter<User>),
        session ? { session } : undefined,
      );
    }

    return this.collection.countDocuments(
      tenantFilter<User>(tenantId, {
        _id: { $ne: new ObjectId(userId) as unknown as User['_id'] },
        roles: UserRole.ADMIN,
        isActive: true,
      } as Filter<User>),
      session ? { session } : undefined,
    );
  }
}

/**
 * Organisations repository — MongoDB CRUD for the `organisations` collection.
 *
 * **The Organisation collection is the root of the tenant tree** — it is
 * intentionally NOT tenant-scoped itself. Every other collection
 * (assets, categories, locations, users, audit_logs) carries an
 * `organisationId` field referencing exactly one row from this table,
 * but the table itself sits above the tenancy boundary.
 *
 * That means:
 *   - No `requireTenantId` / `tenantFilter` calls here.
 *   - Lookup by `_id`, `slug`, or `entraTenantId` is direct.
 *   - The repository is reachable only by privileged code paths (the
 *     auth middleware during tenant resolution, and admin endpoints
 *     gated by an ADMIN role check).
 *
 * Indexes (created lazily via `ensureIndexes`):
 *   - `slug` unique         → tenant URL routing and `data-tenant` lookup
 *   - `entraTenantId` unique, sparse → JWT `tid` claim resolution
 *   - `customDomain` unique, sparse  → custom-domain tenant routing
 *   - `status` + `deletedAt`         → admin list filters
 *
 * Soft-deleted organisations are NEVER returned by `findById`,
 * `findBySlug`, or `findByEntraTenantId`. The admin list endpoint can
 * opt in via the `includeDeleted` flag for audit / restore flows.
 */

import { ObjectId } from 'mongodb';

import type { Organisation } from '@inventario/shared-types';
import type { ClientSession, Collection, Db, Filter, FindOptions, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ListOrganisationsParams {
  limit?: number;
  skip?: number;
  filter?: Filter<Organisation>;
  sort?: FindOptions<Organisation>['sort'];
  /**
   * Include soft-deleted organisations in the result. Default false.
   * Used by admin restore flows and forensic queries.
   */
  includeDeleted?: boolean;
}

export interface ListOrganisationsResult {
  items: WithId<Organisation>[];
  total: number;
}

/**
 * Patch shape for `update`. All fields optional; repository writes only
 * what's provided. Caller (service) adds `updatedAt`/`updatedBy`.
 *
 * `slug` and `entraTenantId` are excluded because they are stable
 * identifiers used by JWT resolution and URL routing — renaming them
 * means migrating data and is intentionally a hard operation.
 */
export type OrganisationUpdatePatch = Partial<
  Omit<Organisation, '_id' | 'slug' | 'entraTenantId' | 'createdAt' | 'createdBy'>
>;

/**
 * Extended patch for tenant self-service (PATCH /current).
 * Adds entraTenantId to allow tenant ADMINs to configure their own
 * Entra domain restriction (ADR-0030 D3).
 */
export type OrganisationSelfServicePatch = OrganisationUpdatePatch & {
  entraTenantId?: string | null;
};

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class OrganisationsRepository {
  private readonly collection: Collection<Organisation>;

  constructor(db: Db) {
    this.collection = db.collection<Organisation>('organisations');
  }

  /**
   * Creates indexes if they don't exist. Idempotent.
   *
   * Index rationale:
   *   - `slug_unique` — globally unique tenant identifier used in URLs
   *     and `data-tenant` runtime brand switching. Cannot collide
   *     across the platform.
   *   - `entraTenantId_unique_partial` — JWT `tid` claim lookup. The
   *     partial filter restricts the index to rows where
   *     `entraTenantId` is a string, so LOCAL-account tenants (with
   *     `entraTenantId: null`) do NOT participate in uniqueness. We
   *     use a partial filter rather than a sparse index because Mongo
   *     sparse indexes still index rows with explicit `null` values
   *     (only missing fields are skipped), which would collide for
   *     two LOCAL tenants both storing `entraTenantId: null` from
   *     the Zod schema default.
   *   - `customDomain_unique_partial` — DNS-style routing for Pro and
   *     Enterprise plans. Same partial-filter rationale as above.
   *   - `status_deletedAt` — admin list filters by status, the
   *     deletedAt component supports efficient soft-delete exclusion.
   */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ slug: 1 }, { unique: true, name: 'slug_unique' }),
      this.collection.createIndex(
        { entraTenantId: 1 },
        {
          unique: true,
          partialFilterExpression: { entraTenantId: { $type: 'string' } },
          name: 'entraTenantId_unique_partial',
        },
      ),
      this.collection.createIndex(
        { customDomain: 1 },
        {
          unique: true,
          partialFilterExpression: { customDomain: { $type: 'string' } },
          name: 'customDomain_unique_partial',
        },
      ),
      this.collection.createIndex({ status: 1, deletedAt: 1 }, { name: 'status_deletedAt' }),
    ]);
  }

  /**
   * Find an organisation by its `_id`. Returns null if not found or
   * soft-deleted.
   *
   * Throws nothing on invalid id format — caller validates at the
   * route layer (Zod 24-hex regex).
   */
  async findById(id: string, session?: ClientSession): Promise<WithId<Organisation> | null> {
    if (!ObjectId.isValid(id)) return null;

    return this.collection.findOne(
      {
        _id: new ObjectId(id) as unknown as Organisation['_id'],
        deletedAt: null,
      } as Filter<Organisation>,
      session ? { session } : undefined,
    );
  }

  /**
   * Find an organisation by its slug. Returns null if not found or
   * soft-deleted. Used for URL routing and `data-tenant` resolution.
   */
  async findBySlug(slug: string, session?: ClientSession): Promise<WithId<Organisation> | null> {
    return this.collection.findOne(
      { slug, deletedAt: null } as Filter<Organisation>,
      session ? { session } : undefined,
    );
  }

  /**
   * Find an organisation by its Entra tenant id (the JWT `tid` claim).
   * Returns null if not found or soft-deleted.
   *
   * Used by the auth middleware on every authenticated request to
   * resolve the actor's tenant. Indexed for fast lookup.
   */
  async findByEntraTenantId(
    entraTenantId: string,
    session?: ClientSession,
  ): Promise<WithId<Organisation> | null> {
    return this.collection.findOne(
      { entraTenantId, deletedAt: null } as Filter<Organisation>,
      session ? { session } : undefined,
    );
  }

  /**
   * Find an organisation by its custom domain. Returns null if not
   * found or soft-deleted. Used for DNS-style multi-tenant routing
   * on Pro/Enterprise plans.
   */
  async findByCustomDomain(
    customDomain: string,
    session?: ClientSession,
  ): Promise<WithId<Organisation> | null> {
    return this.collection.findOne(
      { customDomain, deletedAt: null } as Filter<Organisation>,
      session ? { session } : undefined,
    );
  }

  /**
   * List organisations matching the filter, with pagination. Soft-
   * deleted are excluded by default; pass `includeDeleted: true` to
   * see all rows.
   */
  async list({
    limit = 50,
    skip = 0,
    filter = {},
    sort = { displayName: 1 },
    includeDeleted = false,
  }: ListOrganisationsParams): Promise<ListOrganisationsResult> {
    const effectiveFilter: Filter<Organisation> = {
      ...filter,
      ...(includeDeleted || filter.deletedAt !== undefined ? {} : { deletedAt: null }),
    };

    const [items, total] = await Promise.all([
      this.collection.find(effectiveFilter, { limit, skip, sort }).toArray(),
      this.collection.countDocuments(effectiveFilter),
    ]);

    return { items, total };
  }

  /**
   * Insert a new organisation. Returns the inserted document.
   *
   * Caller is responsible for setting all required fields including
   * `slug`, audit fields, and ensuring schema compliance.
   */
  async insert(
    organisation: Omit<Organisation, '_id'>,
    session?: ClientSession,
  ): Promise<WithId<Organisation>> {
    const result = await this.collection.insertOne(
      organisation as unknown as Organisation,
      session ? { session } : undefined,
    );

    // Return the document we just inserted with the assigned _id.
    // Avoids Atlas Flex read-after-write latency issues on shared clusters.
    return { ...organisation, _id: result.insertedId } as unknown as WithId<Organisation>;
  }

  /**
   * Apply a partial update. Returns updated doc or null if not found
   * or soft-deleted. Caller is responsible for setting `updatedAt` /
   * `updatedBy` in the patch.
   *
   * `slug` and `entraTenantId` cannot be updated through this method
   * (they are excluded from `OrganisationUpdatePatch` at the type
   * level). Renaming a tenant requires a data migration.
   */
  async update(
    id: string,
    patch: OrganisationUpdatePatch,
    session?: ClientSession,
  ): Promise<WithId<Organisation> | null> {
    if (!ObjectId.isValid(id)) return null;

    const result = await this.collection.findOneAndUpdate(
      {
        _id: new ObjectId(id) as unknown as Organisation['_id'],
        deletedAt: null,
      } as Filter<Organisation>,
      { $set: patch },
      {
        returnDocument: 'after',
        ...(session ? { session } : {}),
      },
    );

    return result ?? null;
  }

  /**
   * Apply a partial update for tenant self-service (PATCH /current).
   * Unlike `update`, this also allows setting `entraTenantId` (ADR-0030 D3).
   */
  async updateSelf(
    id: string,
    patch: OrganisationSelfServicePatch,
    session?: ClientSession,
  ): Promise<WithId<Organisation> | null> {
    if (!ObjectId.isValid(id)) return null;

    const result = await this.collection.findOneAndUpdate(
      {
        _id: new ObjectId(id) as unknown as Organisation['_id'],
        deletedAt: null,
      } as Filter<Organisation>,
      { $set: patch as Partial<Organisation> },
      {
        returnDocument: 'after',
        ...(session ? { session } : {}),
      },
    );

    return result ?? null;
  }

  /**
   * Soft-delete an organisation. Returns the document with deletedAt
   * populated, or null if not found / already deleted.
   *
   * Soft-deletion freezes the tenant — JIT user provisioning into a
   * deleted tenant fails, and all scoped queries continue to return
   * data (the tenant id is still stamped on every row), but no new
   * users can log in. The migration script in Phase C Blok 4 will
   * never resurrect a deleted tenant.
   */
  async softDelete(
    id: string,
    deletedBy: string,
    session?: ClientSession,
  ): Promise<WithId<Organisation> | null> {
    if (!ObjectId.isValid(id)) return null;

    const now = new Date().toISOString();

    const result = await this.collection.findOneAndUpdate(
      {
        _id: new ObjectId(id) as unknown as Organisation['_id'],
        deletedAt: null,
      } as Filter<Organisation>,
      {
        $set: {
          deletedAt: now,
          deletedBy,
          updatedAt: now,
          updatedBy: deletedBy,
        },
      },
      {
        returnDocument: 'after',
        ...(session ? { session } : {}),
      },
    );

    return result ?? null;
  }
}

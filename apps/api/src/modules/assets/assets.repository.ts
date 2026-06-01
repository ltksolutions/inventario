/**
 * Assets repository — thin wrapper around MongoDB collection.
 *
 * Convention:
 *   - Repository methods return raw documents (with _id as ObjectId).
 *   - Service layer is responsible for converting to API response shape.
 *   - No business logic here — just Mongo primitives.
 *
 * Slice #2b additions:
 *   - `insert`, `update`, `softDelete` accept an optional `ClientSession`
 *     for transactional use (asset write + audit log in one atomic step).
 *   - `findHighestInventorySequence` powers server-side inventoryNumber
 *     auto-increment, called inside the same transaction as the insert.
 *
 * Phase C Blok 2 additions (multi-tenant scoping):
 *   - Every read/write method takes `organisationId` as a required first
 *     parameter. The repository validates the id via `requireTenantId`
 *     and composes it into every filter via `tenantFilter`, so no query
 *     can accidentally span tenants.
 *   - `inventoryNumber` uniqueness becomes per-tenant (composite index
 *     `{organisationId: 1, inventoryNumber: 1}`). Two tenants can now
 *     have an asset with the same inventoryNumber without collision.
 *   - The unchanged primary keys (`_id` lookups) still get a tenant
 *     filter on top, so even a leaked id cannot read a different
 *     tenant's document.
 *
 * ADR-0021 additions:
 *   - `publicToken` unique index (partial, excludes null — pre-migration assets).
 *   - `findByPublicToken` — cross-tenant lookup for verejný /public/scan endpoint.
 *   - `findHighestInventorySequence` refactored: `yearOrNull` parameter
 *     supports resetYearly=false (global sequence across all years).
 */

import { ObjectId } from 'mongodb';

import { requireTenantId, tenantFilter } from '../../lib/organisation-scoping.js';

import type { Asset } from '@inventario/shared-types';
import type { ClientSession, Collection, Db, Filter, FindOptions, WithId } from 'mongodb';

export interface ListAssetsParams {
  /** Tenant scope. Required. */
  organisationId: string;
  limit?: number;
  skip?: number;
  filter?: Filter<Asset>;
  sort?: FindOptions<Asset>['sort'];
}

export interface ListAssetsResult {
  items: WithId<Asset>[];
  total: number;
}

/**
 * Patch shape for `update`. All fields optional; repository only writes
 * what's provided. Caller (service) is responsible for adding
 * `updatedAt`/`updatedBy` to the patch.
 *
 * `organisationId` is excluded because tenant scope is immutable post
 * creation — moving an asset between tenants requires an explicit data
 * migration, not a PATCH.
 */
export type AssetUpdatePatch = Partial<
  Omit<Asset, '_id' | 'organisationId' | 'inventoryNumber' | 'createdAt' | 'createdBy'>
>;

export class AssetsRepository {
  private readonly collection: Collection<Asset>;

  constructor(db: Db) {
    this.collection = db.collection<Asset>('assets');
  }

  /**
   * Creates indexes if they do not already exist. Idempotent.
   *
   * Called once at server startup from the assets routes plugin.
   *
   * Index rationale:
   *   - `organisationId_inventoryNumber_unique` — schema-level dedup;
   *     uniqueness is per-tenant (composite key) so two tenants can
   *     each have e.g. "LT-2026-001" without colliding.
   *   - `publicToken_unique_partial` — globálne unikátny token pre QR/scan
   *     (ADR-0021). Partial filter vylúči null (assety pred migráciou) —
   *     sparse by indexoval explicit null a zkolizoval by.
   *   - `organisationId_categoryId`, `organisationId_locationId`,
   *     `organisationId_status` — composite filters pre list queries.
   *   - `organisationId_createdAt_desc` — default sort pre list endpoint.
   *   - `deletedAt` — soft-delete filter na každom list query.
   */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex(
        { organisationId: 1, inventoryNumber: 1 },
        { unique: true, name: 'organisationId_inventoryNumber_unique' },
      ),
      this.collection.createIndex(
        { publicToken: 1 },
        {
          unique: true,
          partialFilterExpression: { publicToken: { $type: 'string' } },
          name: 'publicToken_unique_partial',
        },
      ),
      this.collection.createIndex(
        { organisationId: 1, categoryId: 1 },
        { name: 'organisationId_categoryId' },
      ),
      this.collection.createIndex(
        { organisationId: 1, locationId: 1 },
        { name: 'organisationId_locationId' },
      ),
      this.collection.createIndex(
        { organisationId: 1, status: 1 },
        { name: 'organisationId_status' },
      ),
      this.collection.createIndex(
        { organisationId: 1, createdAt: -1 },
        { name: 'organisationId_createdAt_desc' },
      ),
      this.collection.createIndex({ deletedAt: 1 }, { name: 'deletedAt' }),
    ]);
  }

  /**
   * List assets matching the given filter, with pagination. Tenant-scoped.
   */
  async list({
    organisationId,
    limit = 20,
    skip = 0,
    filter = {},
    sort = { createdAt: -1 },
  }: ListAssetsParams): Promise<ListAssetsResult> {
    const tenantId = requireTenantId(organisationId);
    const effectiveFilter = tenantFilter<Asset>(tenantId, filter);

    const [items, total] = await Promise.all([
      this.collection.find(effectiveFilter, { limit, skip, sort }).toArray(),
      this.collection.countDocuments(effectiveFilter),
    ]);

    return { items, total };
  }

  /**
   * Find a single asset by its MongoDB `_id`. Returns null if not found,
   * soft-deleted, or in a different tenant.
   */
  async findById(
    organisationId: string,
    id: string,
    session?: ClientSession,
  ): Promise<WithId<Asset> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    return this.collection.findOne(
      tenantFilter<Asset>(tenantId, {
        _id: new ObjectId(id) as unknown as Asset['_id'],
      } as Filter<Asset>),
      session ? { session } : undefined,
    );
  }

  /**
   * Find an asset by its public token. Cross-tenant lookup — token je
   * globálne unikátny (CSPRNG), nie tenant-scoped. Vráti null ak
   * neexistuje alebo je soft-deleted. Používa ho verejný
   * GET /public/scan/:token endpoint (ADR-0021).
   */
  async findByPublicToken(
    publicToken: string,
    session?: ClientSession,
  ): Promise<WithId<Asset> | null> {
    return this.collection.findOne(
      { publicToken, deletedAt: null } as Filter<Asset>,
      session ? { session } : undefined,
    );
  }

  /**
   * Find the highest existing inventory sequence number for a
   * (tenant, prefix, year?) tuple. Returns 0 if no asset matches yet.
   *
   * ADR-0021 refactor: parameter `yearOrNull` nahrádza pôvodný `year`:
   *   - yearOrNull = number  → includeYear=true: hľadá "PREFIX-YYYY-NNN"
   *   - yearOrNull = null    → includeYear=false: hľadá "PREFIX-NNN" (globálna sekvencia)
   *
   * Prehľadáva aj soft-deleted assety — zmazané číslo sa nesmie znova použiť.
   */
  async findHighestInventorySequence(
    organisationId: string,
    prefix: string,
    yearOrNull: number | null,
    session?: ClientSession,
  ): Promise<number> {
    const tenantId = requireTenantId(organisationId);

    const seqGroup = String.raw`\d{3,8}`;
    const pattern =
      yearOrNull !== null
        ? new RegExp(`^${prefix}-${yearOrNull}-(${seqGroup})$`)
        : new RegExp(`^${prefix}-(${seqGroup})$`);

    const doc = await this.collection.findOne(
      tenantFilter<Asset>(tenantId, { inventoryNumber: { $regex: pattern } } as Filter<Asset>, {
        includeDeleted: true,
      }),
      {
        sort: { inventoryNumber: -1 },
        projection: { inventoryNumber: 1 },
        ...(session ? { session } : {}),
      },
    );

    if (!doc) return 0;

    const match = pattern.exec(doc.inventoryNumber);
    if (!match || !match[1]) return 0;

    return parseInt(match[1], 10);
  }

  /**
   * Insert a new asset. Returns the inserted document.
   */
  async insert(asset: Omit<Asset, '_id'>, session?: ClientSession): Promise<WithId<Asset>> {
    const result = await this.collection.insertOne(
      asset as unknown as Asset,
      session ? { session } : undefined,
    );

    const inserted = await this.collection.findOne(
      { _id: result.insertedId } as Filter<Asset>,
      session ? { session } : undefined,
    );

    if (!inserted) {
      throw new Error(
        `Asset insert succeeded but read-back failed for _id=${String(result.insertedId)}`,
      );
    }

    return inserted;
  }

  /**
   * Apply a partial update to an asset. Returns the updated document,
   * or null if not found, soft-deleted, or in a different tenant.
   */
  async update(
    organisationId: string,
    id: string,
    patch: AssetUpdatePatch,
    session?: ClientSession,
  ): Promise<WithId<Asset> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    const result = await this.collection.findOneAndUpdate(
      tenantFilter<Asset>(tenantId, {
        _id: new ObjectId(id) as unknown as Asset['_id'],
      } as Filter<Asset>),
      { $set: patch },
      {
        returnDocument: 'after',
        ...(session ? { session } : {}),
      },
    );

    return result ?? null;
  }

  /**
   * Soft-delete an asset by setting `deletedAt` and `deletedBy`.
   * Returns the document at delete time, or null if not found / already deleted.
   */
  async softDelete(
    organisationId: string,
    id: string,
    deletedBy: string,
    session?: ClientSession,
  ): Promise<WithId<Asset> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    const now = new Date().toISOString();

    const result = await this.collection.findOneAndUpdate(
      tenantFilter<Asset>(tenantId, {
        _id: new ObjectId(id) as unknown as Asset['_id'],
      } as Filter<Asset>),
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

  /**
   * Count non-deleted assets referencing a category. Used by FK protection.
   */
  async countByCategory(
    organisationId: string,
    categoryId: string,
    session?: ClientSession,
  ): Promise<number> {
    const tenantId = requireTenantId(organisationId);
    return this.collection.countDocuments(
      tenantFilter<Asset>(tenantId, { categoryId } as Filter<Asset>),
      session ? { session } : undefined,
    );
  }

  /**
   * Count non-deleted assets referencing a location. Used by FK protection.
   */
  async countByLocation(
    organisationId: string,
    locationId: string,
    session?: ClientSession,
  ): Promise<number> {
    const tenantId = requireTenantId(organisationId);
    return this.collection.countDocuments(
      tenantFilter<Asset>(tenantId, { locationId } as Filter<Asset>),
      session ? { session } : undefined,
    );
  }
}

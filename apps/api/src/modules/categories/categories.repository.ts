// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Categories repository — thin wrapper around MongoDB `categories`
 * collection.
 *
 * Mirrors `AssetsRepository` patterns:
 *   - Repository returns raw docs (with _id as ObjectId)
 *   - Service is responsible for API response shape conversion
 *   - All write methods accept optional ClientSession for transactional
 *     use
 *   - Every read/write takes `organisationId` as the first parameter
 *     and the repository enforces tenant scoping via the shared
 *     `tenantFilter` / `requireTenantId` utilities
 *
 * Categories form a hierarchy via `parentId` (nullable) within a
 * single tenant. The repository does NOT enforce hierarchy invariants
 * — that's the service's job (cycle detection, max depth). The
 * repository's responsibility is mechanical CRUD + a few index-
 * supported queries.
 */

import { ObjectId } from 'mongodb';

import { requireTenantId, tenantFilter } from '../../lib/organisation-scoping.js';

import type { Category } from '@inventario/shared-types';
import type { ClientSession, Collection, Db, Filter, FindOptions, WithId } from 'mongodb';

export interface ListCategoriesParams {
  /** Tenant scope. Required. */
  organisationId: string;
  limit?: number;
  skip?: number;
  filter?: Filter<Category>;
  sort?: FindOptions<Category>['sort'];
}

export interface ListCategoriesResult {
  items: WithId<Category>[];
  total: number;
}

/**
 * Patch shape for `update`. All fields optional; repository writes
 * only what's provided. Caller (service) adds `updatedAt`/`updatedBy`.
 *
 * `slug` is mutable because rename of a category may need to
 * regenerate the slug; service is responsible for collision check.
 *
 * `organisationId` is excluded because tenant scope is immutable post
 * creation.
 */
export type CategoryUpdatePatch = Partial<
  Omit<Category, '_id' | 'organisationId' | 'createdAt' | 'createdBy'>
>;

export class CategoriesRepository {
  private readonly collection: Collection<Category>;

  constructor(db: Db) {
    this.collection = db.collection<Category>('categories');
  }

  /**
   * Creates indexes if they don't exist. Idempotent.
   *
   * Index rationale (all composite with organisationId leading):
   *   - `organisationId_slug_unique` — slugs are unique per tenant
   *     (URL routing scopes to tenant). Two tenants can each have a
   *     "it-vybavenie" slug without colliding.
   *   - `organisationId_parentId` — "list children of X within tenant"
   *   - `organisationId_isActive` — common filter for active-only
   *     pickers within tenant
   *   - `deletedAt` — soft-delete filter applied to every list query
   */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex(
        { organisationId: 1, slug: 1 },
        { unique: true, name: 'organisationId_slug_unique' },
      ),
      this.collection.createIndex(
        { organisationId: 1, parentId: 1 },
        { name: 'organisationId_parentId' },
      ),
      this.collection.createIndex(
        { organisationId: 1, isActive: 1 },
        { name: 'organisationId_isActive' },
      ),
      this.collection.createIndex({ deletedAt: 1 }, { name: 'deletedAt' }),
      // Tenant-scoped count of live rows ({organisationId, deletedAt:null}) —
      // the dashboard summary stat card.
      this.collection.createIndex(
        { organisationId: 1, deletedAt: 1 },
        { name: 'organisationId_deletedAt' },
      ),
    ]);
  }

  /**
   * List categories matching the given filter, with pagination.
   * Tenant-scoped. Soft-deleted are excluded by default.
   */
  async list({
    organisationId,
    limit = 50,
    skip = 0,
    filter = {},
    sort = { sortOrder: 1, name: 1 },
  }: ListCategoriesParams): Promise<ListCategoriesResult> {
    const tenantId = requireTenantId(organisationId);
    const effectiveFilter = tenantFilter<Category>(tenantId, filter);

    const [items, total] = await Promise.all([
      this.collection.find(effectiveFilter, { limit, skip, sort }).toArray(),
      this.collection.countDocuments(effectiveFilter),
    ]);

    return { items, total };
  }

  /**
   * Find a category by its `_id`. Returns null if not found, soft-
   * deleted, or in a different tenant.
   */
  async findById(
    organisationId: string,
    id: string,
    session?: ClientSession,
  ): Promise<WithId<Category> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    return this.collection.findOne(
      tenantFilter<Category>(tenantId, {
        _id: new ObjectId(id) as unknown as Category['_id'],
      } as Filter<Category>),
      session ? { session } : undefined,
    );
  }

  /**
   * Find a category by its slug within the tenant. Returns null if
   * not found or soft-deleted. Used for slug-uniqueness check and
   * slug-based routing.
   */
  async findBySlug(
    organisationId: string,
    slug: string,
    session?: ClientSession,
  ): Promise<WithId<Category> | null> {
    const tenantId = requireTenantId(organisationId);
    return this.collection.findOne(
      tenantFilter<Category>(tenantId, { slug } as Filter<Category>),
      session ? { session } : undefined,
    );
  }

  /**
   * Insert a new category. Returns the inserted document.
   *
   * Caller is responsible for setting all required fields including
   * `organisationId`, slug, audit fields, and ensuring schema
   * compliance. The service sets `organisationId` from the actor's
   * tenant before calling.
   */
  async insert(
    category: Omit<Category, '_id'>,
    session?: ClientSession,
  ): Promise<WithId<Category>> {
    const result = await this.collection.insertOne(
      category as unknown as Category,
      session ? { session } : undefined,
    );

    const inserted = await this.collection.findOne(
      { _id: result.insertedId } as Filter<Category>,
      session ? { session } : undefined,
    );

    if (!inserted) {
      throw new Error(
        `Category insert succeeded but read-back failed for _id=${String(result.insertedId)}`,
      );
    }

    return inserted;
  }

  /**
   * Apply a partial update. Returns updated doc or null if not found,
   * soft-deleted, or in a different tenant. Caller is responsible for
   * setting `updatedAt`/`updatedBy` in the patch.
   */
  async update(
    organisationId: string,
    id: string,
    patch: CategoryUpdatePatch,
    session?: ClientSession,
  ): Promise<WithId<Category> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    const result = await this.collection.findOneAndUpdate(
      tenantFilter<Category>(tenantId, {
        _id: new ObjectId(id) as unknown as Category['_id'],
      } as Filter<Category>),
      { $set: patch },
      {
        returnDocument: 'after',
        ...(session ? { session } : {}),
      },
    );

    return result ?? null;
  }

  /**
   * Soft-delete a category. Returns the document with deletedAt
   * populated, or null if not found, already deleted, or in a
   * different tenant.
   */
  async softDelete(
    organisationId: string,
    id: string,
    deletedBy: string,
    session?: ClientSession,
  ): Promise<WithId<Category> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    const now = new Date().toISOString();

    const result = await this.collection.findOneAndUpdate(
      tenantFilter<Category>(tenantId, {
        _id: new ObjectId(id) as unknown as Category['_id'],
      } as Filter<Category>),
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
   * Count direct children (categories with parentId = this id) within
   * the tenant. Used by delete to prevent removing a category that
   * has descendants.
   *
   * NOTE: parentId is stored as a 24-hex string (per ObjectIdSchema),
   * not as a BSON ObjectId. This matches the convention used for
   * asset.categoryId, asset.locationId, etc. The composite-index
   * lookup is still fast on string.
   */
  async countChildren(
    organisationId: string,
    parentId: string,
    session?: ClientSession,
  ): Promise<number> {
    const tenantId = requireTenantId(organisationId);
    return this.collection.countDocuments(
      tenantFilter<Category>(tenantId, { parentId } as Filter<Category>),
      session ? { session } : undefined,
    );
  }
}

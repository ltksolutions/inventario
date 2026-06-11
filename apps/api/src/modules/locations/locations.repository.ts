// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Locations repository — thin wrapper around MongoDB `locations` collection.
 *
 * Mirrors the categories repository in structure and contract — both
 * resources have the same shape (slug + hierarchy + soft-delete + audit
 * fields + tenant scope) so the patterns are identical. Only the type
 * parameter and a couple of index choices differ.
 *
 * Phase C Blok 2:
 *   - Every read/write method takes `organisationId` as the first
 *     parameter. The repository validates the id via `requireTenantId`
 *     and composes it into every filter via `tenantFilter`, so no query
 *     can accidentally span tenants.
 *   - Slug uniqueness becomes per-tenant (composite index
 *     `{organisationId: 1, slug: 1}`). Two tenants can each have a
 *     "main-warehouse" slug without collision.
 *
 * Locations form a hierarchy via `parentId` (nullable) within a single
 * tenant. The repository does NOT enforce hierarchy invariants — that's
 * the service's job (cycle detection, max depth). Repository
 * responsibility is mechanical CRUD + a few index-supported queries.
 */

import { ObjectId } from 'mongodb';

import { requireTenantId, tenantFilter } from '../../lib/organisation-scoping.js';

import type { Location } from '@inventario/shared-types';
import type { ClientSession, Collection, Db, Filter, FindOptions, WithId } from 'mongodb';

export interface ListLocationsParams {
  /** Tenant scope. Required. */
  organisationId: string;
  limit?: number;
  skip?: number;
  filter?: Filter<Location>;
  sort?: FindOptions<Location>['sort'];
}

export interface ListLocationsResult {
  items: WithId<Location>[];
  total: number;
}

/**
 * Patch shape for `update`. All fields optional; repository writes only
 * what's provided. Caller (service) adds `updatedAt`/`updatedBy`.
 *
 * `slug` is mutable but the service uses URL-stability rules: rename
 * via `name` does NOT regenerate slug, only an explicit slug patch does.
 *
 * `organisationId` is excluded because tenant scope is immutable post
 * creation — moving a location between tenants requires an explicit
 * data migration, not a PATCH.
 */
export type LocationUpdatePatch = Partial<
  Omit<Location, '_id' | 'organisationId' | 'createdAt' | 'createdBy'>
>;

export class LocationsRepository {
  private readonly collection: Collection<Location>;

  constructor(db: Db) {
    this.collection = db.collection<Location>('locations');
  }

  /**
   * Creates indexes if they don't exist. Idempotent.
   *
   * Index rationale (all composite with organisationId leading):
   *   - `organisationId_slug_unique` — slugs are unique per tenant.
   *     Two tenants can each have a "main-warehouse" slug.
   *   - `organisationId_parentId` — "list children of X within tenant"
   *   - `organisationId_type` — filter by location type
   *     (WAREHOUSE/OFFICE/STADIUM/etc) within tenant
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
      this.collection.createIndex({ organisationId: 1, type: 1 }, { name: 'organisationId_type' }),
      this.collection.createIndex(
        { organisationId: 1, isActive: 1 },
        { name: 'organisationId_isActive' },
      ),
      this.collection.createIndex({ deletedAt: 1 }, { name: 'deletedAt' }),
    ]);
  }

  /**
   * List locations matching the given filter, with pagination.
   * Tenant-scoped. Soft-deleted are excluded by default.
   */
  async list({
    organisationId,
    limit = 50,
    skip = 0,
    filter = {},
    sort = { name: 1 },
  }: ListLocationsParams): Promise<ListLocationsResult> {
    const tenantId = requireTenantId(organisationId);
    const effectiveFilter = tenantFilter<Location>(tenantId, filter);

    const [items, total] = await Promise.all([
      this.collection.find(effectiveFilter, { limit, skip, sort }).toArray(),
      this.collection.countDocuments(effectiveFilter),
    ]);

    return { items, total };
  }

  /**
   * Find a location by its `_id`. Returns null if not found, soft-
   * deleted, or in a different tenant.
   */
  async findById(
    organisationId: string,
    id: string,
    session?: ClientSession,
  ): Promise<WithId<Location> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    return this.collection.findOne(
      tenantFilter<Location>(tenantId, {
        _id: new ObjectId(id) as unknown as Location['_id'],
      } as Filter<Location>),
      session ? { session } : undefined,
    );
  }

  /**
   * Find a location by its slug within the tenant. Returns null if not
   * found or soft-deleted. Used for slug-uniqueness check and slug-
   * based routing.
   */
  async findBySlug(
    organisationId: string,
    slug: string,
    session?: ClientSession,
  ): Promise<WithId<Location> | null> {
    const tenantId = requireTenantId(organisationId);
    return this.collection.findOne(
      tenantFilter<Location>(tenantId, { slug } as Filter<Location>),
      session ? { session } : undefined,
    );
  }

  /**
   * Insert a new location. Returns the inserted document.
   *
   * Caller is responsible for setting all required fields including
   * `organisationId`, slug, audit fields, and ensuring schema
   * compliance. The service sets `organisationId` from the actor's
   * tenant before calling.
   */
  async insert(
    location: Omit<Location, '_id'>,
    session?: ClientSession,
  ): Promise<WithId<Location>> {
    const result = await this.collection.insertOne(
      location as unknown as Location,
      session ? { session } : undefined,
    );

    const inserted = await this.collection.findOne(
      { _id: result.insertedId } as Filter<Location>,
      session ? { session } : undefined,
    );

    if (!inserted) {
      throw new Error(
        `Location insert succeeded but read-back failed for _id=${String(result.insertedId)}`,
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
    patch: LocationUpdatePatch,
    session?: ClientSession,
  ): Promise<WithId<Location> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    const result = await this.collection.findOneAndUpdate(
      tenantFilter<Location>(tenantId, {
        _id: new ObjectId(id) as unknown as Location['_id'],
      } as Filter<Location>),
      { $set: patch },
      {
        returnDocument: 'after',
        ...(session ? { session } : {}),
      },
    );

    return result ?? null;
  }

  /**
   * Soft-delete a location. Returns the document with deletedAt
   * populated, or null if not found, already deleted, or in a
   * different tenant.
   */
  async softDelete(
    organisationId: string,
    id: string,
    deletedBy: string,
    session?: ClientSession,
  ): Promise<WithId<Location> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    const now = new Date().toISOString();

    const result = await this.collection.findOneAndUpdate(
      tenantFilter<Location>(tenantId, {
        _id: new ObjectId(id) as unknown as Location['_id'],
      } as Filter<Location>),
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
   * Count direct children (locations with parentId = this id) within
   * the tenant. Used by delete to prevent removing a location that has
   * descendants.
   *
   * NOTE: parentId is stored as a 24-hex string (per ObjectIdSchema),
   * not as a BSON ObjectId. Matches the convention used for
   * asset.locationId and category.parentId.
   */
  async countChildren(
    organisationId: string,
    parentId: string,
    session?: ClientSession,
  ): Promise<number> {
    const tenantId = requireTenantId(organisationId);
    return this.collection.countDocuments(
      tenantFilter<Location>(tenantId, { parentId } as Filter<Location>),
      session ? { session } : undefined,
    );
  }
}

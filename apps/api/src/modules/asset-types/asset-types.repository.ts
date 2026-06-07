// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * AssetTypesRepository — thin wrapper around MongoDB `asset_types` collection.
 * Mirrors CategoriesRepository patterns exactly.
 */

import { ObjectId } from 'mongodb';

import { requireTenantId, tenantFilter } from '../../lib/organisation-scoping.js';

import type { AssetTypeEntry } from '@inventario/shared-types';
import type { ClientSession, Collection, Db, Filter, FindOptions, WithId } from 'mongodb';

export interface ListAssetTypesParams {
  organisationId: string;
  limit?: number;
  skip?: number;
  filter?: Filter<AssetTypeEntry>;
  sort?: FindOptions<AssetTypeEntry>['sort'];
}

export interface ListAssetTypesResult {
  items: WithId<AssetTypeEntry>[];
  total: number;
}

export type AssetTypeUpdatePatch = Partial<
  Omit<AssetTypeEntry, '_id' | 'organisationId' | 'createdAt' | 'createdBy'>
>;

export class AssetTypesRepository {
  private readonly collection: Collection<AssetTypeEntry>;

  constructor(db: Db) {
    this.collection = db.collection<AssetTypeEntry>('asset_types');
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex(
        { organisationId: 1, slug: 1 },
        { unique: true, name: 'asset_types_organisationId_slug_unique' },
      ),
      this.collection.createIndex(
        { organisationId: 1, isActive: 1 },
        { name: 'asset_types_organisationId_isActive' },
      ),
      this.collection.createIndex({ deletedAt: 1 }, { name: 'asset_types_deletedAt' }),
    ]);
  }

  async list({
    organisationId,
    limit = 200,
    skip = 0,
    filter = {},
    sort = { sortOrder: 1, name: 1 },
  }: ListAssetTypesParams): Promise<ListAssetTypesResult> {
    const tenantId = requireTenantId(organisationId);
    const effectiveFilter = tenantFilter<AssetTypeEntry>(tenantId, filter);

    const [items, total] = await Promise.all([
      this.collection.find(effectiveFilter, { limit, skip, sort }).toArray(),
      this.collection.countDocuments(effectiveFilter),
    ]);

    return { items, total };
  }

  async findById(
    organisationId: string,
    id: string,
    session?: ClientSession,
  ): Promise<WithId<AssetTypeEntry> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    return this.collection.findOne(
      tenantFilter<AssetTypeEntry>(tenantId, {
        _id: new ObjectId(id) as unknown as AssetTypeEntry['_id'],
      } as Filter<AssetTypeEntry>),
      session ? { session } : undefined,
    );
  }

  async findBySlug(
    organisationId: string,
    slug: string,
    session?: ClientSession,
  ): Promise<WithId<AssetTypeEntry> | null> {
    const tenantId = requireTenantId(organisationId);
    return this.collection.findOne(
      tenantFilter<AssetTypeEntry>(tenantId, { slug } as Filter<AssetTypeEntry>),
      session ? { session } : undefined,
    );
  }

  async insert(
    doc: Omit<AssetTypeEntry, '_id'>,
    session?: ClientSession,
  ): Promise<WithId<AssetTypeEntry>> {
    const result = await this.collection.insertOne(
      doc as unknown as AssetTypeEntry,
      session ? { session } : undefined,
    );

    const inserted = await this.collection.findOne(
      { _id: result.insertedId } as Filter<AssetTypeEntry>,
      session ? { session } : undefined,
    );

    if (!inserted) {
      throw new Error(
        `AssetTypeEntry insert succeeded but read-back failed for _id=${String(result.insertedId)}`,
      );
    }

    return inserted;
  }

  async update(
    organisationId: string,
    id: string,
    patch: AssetTypeUpdatePatch,
    session?: ClientSession,
  ): Promise<WithId<AssetTypeEntry> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    const result = await this.collection.findOneAndUpdate(
      tenantFilter<AssetTypeEntry>(tenantId, {
        _id: new ObjectId(id) as unknown as AssetTypeEntry['_id'],
      } as Filter<AssetTypeEntry>),
      { $set: patch },
      { returnDocument: 'after', ...(session ? { session } : {}) },
    );

    return result ?? null;
  }

  async softDelete(
    organisationId: string,
    id: string,
    deletedBy: string,
    session?: ClientSession,
  ): Promise<WithId<AssetTypeEntry> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    const now = new Date().toISOString();

    const result = await this.collection.findOneAndUpdate(
      tenantFilter<AssetTypeEntry>(tenantId, {
        _id: new ObjectId(id) as unknown as AssetTypeEntry['_id'],
      } as Filter<AssetTypeEntry>),
      { $set: { deletedAt: now, deletedBy, updatedAt: now, updatedBy: deletedBy } },
      { returnDocument: 'after', ...(session ? { session } : {}) },
    );

    return result ?? null;
  }

  /**
   * Count non-deleted assets referencing this type slug (FK protection).
   * After K3 migration, assets store `type` as a slug string.
   */
  async countAssetsByTypeSlug(
    organisationId: string,
    typeSlug: string,
    session?: ClientSession,
  ): Promise<number> {
    const tenantId = requireTenantId(organisationId);
    return this.collection.db
      .collection('assets')
      .countDocuments(
        { organisationId: tenantId, type: typeSlug, deletedAt: null },
        session ? { session } : undefined,
      );
  }

  /**
   * Count non-deleted categories referencing this type slug (FK
   * protection). Categories store `assetTypeSlug` referencing
   * asset_types.slug within the same tenant.
   */
  async countCategoriesByTypeSlug(
    organisationId: string,
    typeSlug: string,
    session?: ClientSession,
  ): Promise<number> {
    const tenantId = requireTenantId(organisationId);
    return this.collection.db
      .collection('categories')
      .countDocuments(
        { organisationId: tenantId, assetTypeSlug: typeSlug, deletedAt: null },
        session ? { session } : undefined,
      );
  }

  /**
   * Cascade a type slug rename to all referencing documents within the
   * tenant: categories (`assetTypeSlug`) and assets (`type`). Runs
   * inside the caller's transaction so references never dangle.
   */
  async cascadeSlugRename(
    organisationId: string,
    oldSlug: string,
    newSlug: string,
    stamp: { updatedAt: string; updatedBy: string },
    session?: ClientSession,
  ): Promise<{ categoriesUpdated: number; assetsUpdated: number }> {
    const tenantId = requireTenantId(organisationId);
    const opts = session ? { session } : undefined;

    const [categoriesResult, assetsResult] = await Promise.all([
      this.collection.db
        .collection('categories')
        .updateMany(
          { organisationId: tenantId, assetTypeSlug: oldSlug },
          { $set: { assetTypeSlug: newSlug, ...stamp } },
          opts,
        ),
      this.collection.db
        .collection('assets')
        .updateMany(
          { organisationId: tenantId, type: oldSlug },
          { $set: { type: newSlug, ...stamp } },
          opts,
        ),
    ]);

    return {
      categoriesUpdated: categoriesResult.modifiedCount,
      assetsUpdated: assetsResult.modifiedCount,
    };
  }
}

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { ObjectId } from 'mongodb';

import { requireTenantId, tenantFilter } from '../../lib/organisation-scoping.js';

import type { AssetConditionEntry } from '@inventario/shared-types';
import type { ClientSession, Collection, Db, Filter, FindOptions, WithId } from 'mongodb';

export interface ListAssetConditionsParams {
  organisationId: string;
  limit?: number;
  skip?: number;
  filter?: Filter<AssetConditionEntry>;
  sort?: FindOptions<AssetConditionEntry>['sort'];
}

export interface ListAssetConditionsResult {
  items: WithId<AssetConditionEntry>[];
  total: number;
}

export type AssetConditionUpdatePatch = Partial<
  Omit<AssetConditionEntry, '_id' | 'organisationId' | 'createdAt' | 'createdBy'>
>;

export class AssetConditionsRepository {
  private readonly collection: Collection<AssetConditionEntry>;

  constructor(db: Db) {
    this.collection = db.collection<AssetConditionEntry>('asset_conditions');
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex(
        { organisationId: 1, slug: 1 },
        { unique: true, name: 'asset_conditions_organisationId_slug_unique' },
      ),
      this.collection.createIndex(
        { organisationId: 1, isActive: 1 },
        { name: 'asset_conditions_organisationId_isActive' },
      ),
      this.collection.createIndex({ deletedAt: 1 }, { name: 'asset_conditions_deletedAt' }),
    ]);
  }

  async list({
    organisationId,
    limit = 200,
    skip = 0,
    filter = {},
    sort = { sortOrder: 1, name: 1 },
  }: ListAssetConditionsParams): Promise<ListAssetConditionsResult> {
    const tenantId = requireTenantId(organisationId);
    const effectiveFilter = tenantFilter<AssetConditionEntry>(tenantId, filter);

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
  ): Promise<WithId<AssetConditionEntry> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    return this.collection.findOne(
      tenantFilter<AssetConditionEntry>(tenantId, {
        _id: new ObjectId(id) as unknown as AssetConditionEntry['_id'],
      } as Filter<AssetConditionEntry>),
      session ? { session } : undefined,
    );
  }

  async findBySlug(
    organisationId: string,
    slug: string,
    session?: ClientSession,
  ): Promise<WithId<AssetConditionEntry> | null> {
    const tenantId = requireTenantId(organisationId);
    return this.collection.findOne(
      tenantFilter<AssetConditionEntry>(tenantId, { slug } as Filter<AssetConditionEntry>),
      session ? { session } : undefined,
    );
  }

  async insert(
    doc: Omit<AssetConditionEntry, '_id'>,
    session?: ClientSession,
  ): Promise<WithId<AssetConditionEntry>> {
    const result = await this.collection.insertOne(
      doc as unknown as AssetConditionEntry,
      session ? { session } : undefined,
    );

    const inserted = await this.collection.findOne(
      { _id: result.insertedId } as Filter<AssetConditionEntry>,
      session ? { session } : undefined,
    );

    if (!inserted) {
      throw new Error(
        `AssetConditionEntry insert succeeded but read-back failed for _id=${String(result.insertedId)}`,
      );
    }

    return inserted;
  }

  async update(
    organisationId: string,
    id: string,
    patch: AssetConditionUpdatePatch,
    session?: ClientSession,
  ): Promise<WithId<AssetConditionEntry> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    const result = await this.collection.findOneAndUpdate(
      tenantFilter<AssetConditionEntry>(tenantId, {
        _id: new ObjectId(id) as unknown as AssetConditionEntry['_id'],
      } as Filter<AssetConditionEntry>),
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
  ): Promise<WithId<AssetConditionEntry> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    const now = new Date().toISOString();

    const result = await this.collection.findOneAndUpdate(
      tenantFilter<AssetConditionEntry>(tenantId, {
        _id: new ObjectId(id) as unknown as AssetConditionEntry['_id'],
      } as Filter<AssetConditionEntry>),
      { $set: { deletedAt: now, deletedBy, updatedAt: now, updatedBy: deletedBy } },
      { returnDocument: 'after', ...(session ? { session } : {}) },
    );

    return result ?? null;
  }

  async countAssetsByConditionSlug(
    organisationId: string,
    conditionSlug: string,
    session?: ClientSession,
  ): Promise<number> {
    const tenantId = requireTenantId(organisationId);
    return this.collection.db
      .collection('assets')
      .countDocuments(
        { organisationId: tenantId, condition: conditionSlug, deletedAt: null },
        session ? { session } : undefined,
      );
  }
}

/**
 * StockMovementsRepository — append-only ledger pre skladové pohyby.
 *
 * Vzory sú rovnaké ako AssetsRepository / CategoriesRepository, ale
 * s dvoma kľúčovými rozdielmi:
 *
 *   1. **Append-only.** Pohyby sa nikdy nemenia ani nemažú — žiadne
 *      `update`, `softDelete`, ani `SoftDelete` polia na dokumente.
 *      Zodpovedá to účtovnému ledgeru: raz zaúčtovaný pohyb je trvalý.
 *      Korekcia ide ako nový ADJUSTMENT pohyb.
 *
 *   2. **Bez tenantFilter pre deletedAt.** Keďže StockMovement nemá
 *      pole `deletedAt` (žiadny SoftDelete mixin), nepoužívam helper
 *      `tenantFilter` (ten by pridal `deletedAt: null` do každého
 *      filtra). Namiesto toho pridám `organisationId` priamo — rovnaký
 *      efekt, bez zavádzajúceho `deletedAt` v query.
 *
 * Transakčné použitie:
 *   `insert` prijíma voliteľný `ClientSession`. Vždy ho volaj v rámci
 *   transakcie spolu s `$inc` na `asset.quantityOnHand` a s audit log
 *   insertom — inak môže ledger a cache divergovať.
 */

import { ObjectId } from 'mongodb';

import { requireTenantId } from '../../lib/organisation-scoping.js';

import type { StockMovement } from '@inventario/shared-types';
import type { ClientSession, Collection, Db, ObjectId as ObjectIdType, WithId } from 'mongodb';

export interface ListMovementsParams {
  limit?: number;
  skip?: number;
  /** Ak je zadané, filtruje pohyby len daného typu. */
  type?: StockMovement['type'];
}

export interface ListMovementsResult {
  items: WithId<StockMovement>[];
  total: number;
}

export class StockMovementsRepository {
  private readonly collection: Collection<StockMovement>;
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
    this.collection = db.collection<StockMovement>('stock_movements');
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex(
        { organisationId: 1, itemId: 1, createdAt: -1 },
        { name: 'organisationId_itemId_createdAt_desc' },
      ),
      this.collection.createIndex(
        { organisationId: 1, itemId: 1, type: 1 },
        { name: 'organisationId_itemId_type' },
      ),
      this.collection.createIndex(
        { organisationId: 1, loanId: 1 },
        { name: 'organisationId_loanId', sparse: true },
      ),
      this.collection.createIndex(
        { organisationId: 1, createdAt: -1 },
        { name: 'organisationId_createdAt_desc' },
      ),
    ]);
  }

  async insert(
    movement: Omit<StockMovement, '_id'>,
    session?: ClientSession,
  ): Promise<WithId<StockMovement>> {
    const result = await this.collection.insertOne(
      movement as unknown as StockMovement,
      session ? { session } : undefined,
    );

    const inserted = await this.collection.findOne(
      { _id: result.insertedId } as unknown as Partial<StockMovement>,
      session ? { session } : undefined,
    );

    if (!inserted) {
      throw new Error(
        `StockMovement insert succeeded but read-back failed for _id=${String(result.insertedId)}`,
      );
    }

    return inserted;
  }

  async findById(
    organisationId: string,
    id: string,
    session?: ClientSession,
  ): Promise<WithId<StockMovement> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    return this.collection.findOne(
      {
        _id: new ObjectId(id) as unknown as StockMovement['_id'],
        organisationId: tenantId,
      },
      session ? { session } : undefined,
    );
  }

  async listByItem(
    organisationId: string,
    itemId: string,
    { limit = 50, skip = 0, type }: ListMovementsParams = {},
    session?: ClientSession,
  ): Promise<ListMovementsResult> {
    const tenantId = requireTenantId(organisationId);

    const filter: Record<string, unknown> = {
      organisationId: tenantId,
      itemId,
    };

    if (type !== undefined) {
      filter['type'] = type;
    }

    const [items, total] = await Promise.all([
      this.collection
        .find(filter as Parameters<typeof this.collection.find>[0], {
          limit,
          skip,
          sort: { createdAt: -1 },
          ...(session ? { session } : {}),
        })
        .toArray(),
      this.collection.countDocuments(
        filter as Parameters<typeof this.collection.countDocuments>[0],
        session ? { session } : undefined,
      ),
    ]);

    return { items, total };
  }

  async sumQuantityByItem(
    organisationId: string,
    itemId: string,
    session?: ClientSession,
  ): Promise<number> {
    const tenantId = requireTenantId(organisationId);

    const pipeline = [
      { $match: { organisationId: tenantId, itemId } },
      { $group: { _id: null, total: { $sum: '$quantity' } } },
    ];

    const [result] = await this.collection
      .aggregate<{ _id: null; total: number }>(pipeline, session ? { session } : undefined)
      .toArray();

    return result?.total ?? 0;
  }

  /**
   * Zoznam všetkých BULK položiek tenanta s ich aktuálnym zostatkom
   * a množstvom posledného príjmu (RECEIPT) — pre skladový prehľad.
   */
  async listBulkItemsWithLastReceipt(organisationId: string): Promise<BulkItemOverview[]> {
    const tenantId = requireTenantId(organisationId);

    const pipeline = [
      // Krok 1: len BULK položky tohto tenanta
      {
        $match: {
          organisationId: tenantId,
          trackingMode: 'BULK',
          deletedAt: null,
        },
      },
      // Krok 2: join na posledný RECEIPT pohyb
      // Poznámka: premenné z `let` sa referencujú ako $$itemId / $$orgId
      {
        $lookup: {
          from: 'stock_movements',
          let: { itemId: { $toString: '$_id' }, orgId: '$organisationId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$itemId', '$$itemId'] },
                    { $eq: ['$organisationId', '$$orgId'] },
                    { $eq: ['$type', 'RECEIPT'] },
                  ],
                },
              },
            },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
          ],
          as: 'lastReceipts',
        },
      },
      // Krok 3: projektácia
      {
        $project: {
          _id: 1,
          inventoryNumber: 1,
          name: 1,
          quantityOnHand: 1,
          categoryId: 1,
          locationId: 1,
          lastReceiptQuantity: {
            $ifNull: [{ $first: '$lastReceipts.quantity' }, null],
          },
        },
      },
      // Krok 4: zoradiť podľa inventárneho čísla
      { $sort: { inventoryNumber: 1 } },
    ];

    // Aggregácia beží nad assets kolekciou
    const assetsCollection = this.db.collection('assets');
    return assetsCollection.aggregate<BulkItemOverview>(pipeline).toArray();
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BulkItemOverview {
  _id: ObjectIdType;
  inventoryNumber: string;
  name: string;
  quantityOnHand: number | null;
  categoryId: string;
  locationId: string;
  /** Množstvo posledného príjmu. Null ak žiadny RECEIPT ešte nebol. */
  lastReceiptQuantity: number | null;
}

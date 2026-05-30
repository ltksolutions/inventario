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
import type { ClientSession, Collection, Db, WithId } from 'mongodb';

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

  constructor(db: Db) {
    this.collection = db.collection<StockMovement>('stock_movements');
  }

  /**
   * Vytvorí indexy ak ešte neexistujú. Idempotentné.
   *
   * Indexy:
   *   - `organisationId_itemId_createdAt` — hlavný index pre
   *     `listByItem` (filtruje na tenant + položku, radí podľa dátumu).
   *   - `organisationId_itemId_type` — filter pohybov podľa typu
   *     (napr. len LOAN_OUT pre danú položku).
   *   - `organisationId_loanId` — lookup pohybov viazaných na zápožičku
   *     (neskôr pri loans, keď budeme reconcilovat quantity po vrátení).
   *   - `organisationId_createdAt` — globálny časový filter pre
   *     reporting (napr. všetky pohyby tenanta za posledný mesiac).
   */
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

  /**
   * Vloží nový pohyb do ledgera. Vracia vložený dokument.
   *
   * Volaj vždy v rámci transakcie (spolu s `$inc` na
   * `asset.quantityOnHand` a audit log insertom) — inak môžu ledger
   * a cache divergovať. Volateľ nastaví všetky polia vrátane
   * `organisationId` a `balanceAfter` pred volaním (service ich
   * vypočíta v rámci transakcie).
   */
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

  /**
   * Nájde pohyb podľa `_id`. Vráti `null` ak neexistuje alebo patrí
   * inému tenantovi.
   */
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

  /**
   * Zoznam pohybov pre konkrétnu BULK položku, zoradených od
   * najnovšieho. Tenant-scoped.
   *
   * `total` je celkový počet pohybov pre položku (pre paginovanie).
   */
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

  /**
   * Vypočíta skutočný zostatok položky ako `sum(quantity)` cez celý
   * ledger. Vracia 0 ak žiadne pohyby neexistujú.
   *
   * Účel: **reconciliation** — overenie / rekonštrukcia konzistencie
   * medzi ledgerom (zdrojom pravdy) a `asset.quantityOnHand` (cache).
   * Nevolaj na každý request; použi pre diagnostiku alebo po obnove
   * zo zálohy.
   */
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
}

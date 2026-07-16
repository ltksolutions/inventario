// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * StockService — business logika pre skladové pohyby BULK položiek.
 *
 * Zodpovednosti:
 *   - Overenie že cieľová položka má `trackingMode === 'BULK'`
 *   - Výpočet `balanceAfter` pred zápisom (guard záporného stavu)
 *   - Transakčný zápis: StockMovement insert + `$set quantityOnHand`
 *     na asset + audit log — všetko atomicky
 *   - Reconciliation helper (diagnostika konzistencie cache vs ledger)
 *
 * Každá state-changing operácia je obalená v Mongo transakcii (rovnaký
 * vzor ako AssetsService). Ledger ostáva zdrojom pravdy; cache
 * `asset.quantityOnHand` sa aktualizuje v tej istej transakcii cez
 * `$set`. Ak transakcia padne, obe zmeny sa rollback-ujú.
 */

import { StockMovementType } from '@inventario/shared-types';

import { BadRequestError, NotFoundError } from '../../plugins/error-handler.js';

import type {
  StockMovementsRepository,
  ListMovementsParams,
  ListMovementsResult,
} from './stock-movements.repository.js';
import type { AssetsRepository } from '../assets/assets.repository.js';
import type { AuditLogService } from '../audit/audit.service.js';
import type { Asset, StockMovement, User } from '@inventario/shared-types';
import type { FastifyRequest } from 'fastify';
import type { ClientSession, MongoClient, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface ReceiveStockInput {
  /** Množstvo kusov na príjem. Musí byť kladné. */
  quantity: number;
  /** Lokalita/sklad kde sa príjem uskutoční. */
  locationId: string;
  /** Voliteľný dôvod/poznámka. */
  reason?: string | null;
  note?: string | null;
}

export interface AdjustStockInput {
  /**
   * Znamienkové množstvo (kladné = pribudne, záporné = ubudne).
   * Nesmie byť 0 (kontroluje Zod schéma).
   */
  quantity: number;
  locationId: string;
  /** Povinný dôvod korekcie. */
  reason: string;
  note?: string | null;
}

export interface ReconcileResult {
  itemId: string;
  ledgerBalance: number;
  cacheWas: number | null;
  wasConsistent: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class StockService {
  constructor(
    private readonly stockRepo: StockMovementsRepository,
    private readonly assetsRepo: AssetsRepository,
    private readonly auditLog: AuditLogService,
    private readonly mongoClient: MongoClient,
  ) {}

  // -------------------------------------------------------------------------
  // Read paths
  // -------------------------------------------------------------------------

  async listMovements(
    itemId: string,
    params: ListMovementsParams,
    actor: WithId<User>,
  ): Promise<ListMovementsResult & { data: Record<string, unknown>[] }> {
    const tenantId = String(actor.organisationId);

    // Verify item exists and belongs to tenant
    const asset = await this.assetsRepo.findById(tenantId, itemId);
    if (!asset) throw new NotFoundError('Asset', itemId);
    this.assertBulk(asset);

    const { items, total } = await this.stockRepo.listByItem(tenantId, itemId, params);

    return {
      data: items.map(toApiShape),
      items,
      total,
    };
  }

  // -------------------------------------------------------------------------
  // Write paths (transactional)
  // -------------------------------------------------------------------------

  /**
   * Príjem na sklad (RECEIPT). Množstvo musí byť kladné.
   * Pre počiatočný stav BULK položky (prvý príjem = inicializácia).
   */
  async receive(
    itemId: string,
    input: ReceiveStockInput,
    user: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    if (input.quantity <= 0) {
      throw new BadRequestError('Príjem musí mať kladné množstvo (quantity > 0).');
    }

    return this.recordMovement(
      itemId,
      {
        type: StockMovementType.RECEIPT,
        quantity: input.quantity,
        locationId: input.locationId,
        reason: input.reason ?? null,
        note: input.note ?? null,
        loanId: null,
      },
      {
        auditAction: 'STOCK_RECEIVED',
        descriptionFn: (inv, qty, bal) =>
          `Príjem ${qty} ks na sklad — ${inv}. Nový zostatok: ${bal}`,
      },
      user,
      request,
    );
  }

  /**
   * Ručná korekcia inventúry (ADJUSTMENT). Môže byť kladná aj záporná.
   * Dôvod je povinný (musí byť neprázdny string).
   */
  async adjust(
    itemId: string,
    input: AdjustStockInput,
    user: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    if (!input.reason || input.reason.trim().length < 3) {
      throw new BadRequestError('Korekcia vyžaduje dôvod (reason) s aspoň 3 znakmi.');
    }

    return this.recordMovement(
      itemId,
      {
        type: StockMovementType.ADJUSTMENT,
        quantity: input.quantity,
        locationId: input.locationId,
        reason: input.reason,
        note: input.note ?? null,
        loanId: null,
      },
      {
        auditAction: 'STOCK_ADJUSTED',
        descriptionFn: (inv, qty, bal) =>
          `Korekcia ${qty > 0 ? '+' : ''}${qty} ks — ${inv}. Dôvod: ${input.reason}. Nový zostatok: ${bal}`,
      },
      user,
      request,
    );
  }

  /**
   * Výdaj na zápožičku (LOAN_OUT, 2026-07-16 — ADR-0020 wiring do Loans).
   * Volá sa z `LoansService.fulfilLoanRequest` PO vytvorení Loanu (loanId
   * už existuje). `quantity` je KLADNé (počet vydaných kusov) — sign (-1)
   * pre `LOAN_OUT` sa aplikuje tu, volajúci nemusí riešiť znamienko.
   *
   * `session` je VOLITEľné, ale v praxi voláteľ (LoansService) vždy poskytne
   * svoju existujúcu transakciu — vydanie Loanu + pohyb skladu musí byť
   * atomické (buď oboje, alebo nič). Bez `session` (nepriamy použiteľ mimo
   * Loans, dnes nikto) by sa spustila vlastná transakcia.
   */
  async recordLoanOut(
    itemId: string,
    quantity: number,
    loanId: string,
    user: WithId<User>,
    request: FastifyRequest,
    session?: ClientSession,
  ): Promise<Record<string, unknown>> {
    if (quantity <= 0) {
      throw new BadRequestError('Výdaj musí mať kladné množstvo (quantity > 0).');
    }

    return this.recordMovement(
      itemId,
      {
        type: StockMovementType.LOAN_OUT,
        quantity: -quantity,
        locationId: null,
        reason: null,
        note: null,
        loanId,
      },
      {
        auditAction: 'STOCK_ISSUED',
        descriptionFn: (inv, qty, bal) =>
          `Výdaj ${Math.abs(qty)} ks na zápožičku ${loanId} — ${inv}. Nový zostatok: ${bal}`,
      },
      user,
      request,
      session,
    );
  }

  /**
   * Vrátenie zo zápožičky (LOAN_RETURN, 2026-07-16). Volá sa z
   * `LoansService.returnLoan` — `quantity` je hodnota uložená na
   * `LoanItem.quantity` pri vydaní (2026-07-16 ADR-0020 wiring).
   */
  async recordLoanReturn(
    itemId: string,
    quantity: number,
    loanId: string,
    user: WithId<User>,
    request: FastifyRequest,
    session?: ClientSession,
  ): Promise<Record<string, unknown>> {
    if (quantity <= 0) {
      throw new BadRequestError('Vrátenie musí mať kladné množstvo (quantity > 0).');
    }

    return this.recordMovement(
      itemId,
      {
        type: StockMovementType.LOAN_RETURN,
        quantity,
        locationId: null,
        reason: null,
        note: null,
        loanId,
      },
      {
        auditAction: 'STOCK_RETURNED',
        descriptionFn: (inv, qty, bal) =>
          `Vrátenie ${qty} ks zo zápožičky ${loanId} — ${inv}. Nový zostatok: ${bal}`,
      },
      user,
      request,
      session,
    );
  }

  /**
   * Reconciliation — overí konzistenciu `asset.quantityOnHand`
   * (cache) voči `sum(stock_movements.quantity)` (zdroj pravdy).
   * Ak nie sú konzistentné, opraví cache.
   *
   * Táto operácia je **diagnostická** a spúšťa sa len na požiadanie
   * ADMINom. Nie je súčasťou bežného toku — bežné operácie držia
   * konzistenciu cez transakcie. Reconciliation slúži na obnovu po
   * výpadku alebo manuálnej DB oprave.
   */
  async reconcile(
    itemId: string,
    user: WithId<User>,
    request: FastifyRequest,
  ): Promise<ReconcileResult> {
    const tenantId = String(user.organisationId);
    const userId = String(user._id);

    const asset = await this.assetsRepo.findById(tenantId, itemId);
    if (!asset) throw new NotFoundError('Asset', itemId);
    this.assertBulk(asset);

    const ledgerBalance = await this.stockRepo.sumQuantityByItem(tenantId, itemId);
    const cacheWas = asset.quantityOnHand;
    const wasConsistent = cacheWas === ledgerBalance;

    if (!wasConsistent) {
      const now = new Date().toISOString();
      await this.assetsRepo.update(tenantId, itemId, {
        quantityOnHand: ledgerBalance,
        updatedAt: now,
        updatedBy: userId,
      });

      await this.auditLog.record(user, request, {
        action: 'STOCK_ADJUSTED',
        target: {
          entityType: 'Asset',
          entityId: String(asset._id),
          snapshot: { inventoryNumber: asset.inventoryNumber, name: asset.name },
        },
        description:
          `Reconciliation: quantityOnHand opravená z ${cacheWas ?? 'null'} na ${ledgerBalance} ` +
          `pre ${asset.inventoryNumber}.`,
        severity: 'WARNING',
      });
    }

    return { itemId, ledgerBalance, cacheWas, wasConsistent };
  }

  // -------------------------------------------------------------------------
  // Shared transakčný zápis pohybu
  // -------------------------------------------------------------------------

  /**
   * Jadro každého pohybu. Obalené v transakcii:
   *   1. Načíta asset + overí trackingMode + vypočíta balanceAfter
   *   2. Guard záporného stavu
   *   3. Insert StockMovement
   *   4. $set quantityOnHand na asset
   *   5. Insert audit log
   */
  private async recordMovement(
    itemId: string,
    movementData: Omit<
      StockMovement,
      | '_id'
      | 'organisationId'
      | 'itemId'
      | 'balanceAfter'
      | 'createdAt'
      | 'updatedAt'
      | 'createdBy'
      | 'updatedBy'
      | 'locationId'
    > & {
      /**
       * `null` pre LOAN_OUT/LOAN_RETURN (2026-07-16) — zápožička nemá
       * vlastnú lokalitu, dopočíta sa z `asset.locationId` nižšie (Step 3).
       * RECEIPT a ADJUSTMENT locationId vždy poskytujú explicitne (povinné
       * pole v ich vstupných schémach).
       */
      locationId: string | null;
    },
    audit: {
      auditAction: 'STOCK_RECEIVED' | 'STOCK_ISSUED' | 'STOCK_RETURNED' | 'STOCK_ADJUSTED';
      descriptionFn: (inventoryNumber: string, qty: number, balanceAfter: number) => string;
    },
    user: WithId<User>,
    request: FastifyRequest,
    externalSession?: ClientSession,
  ): Promise<Record<string, unknown>> {
    const tenantId = String(user.organisationId);
    const userId = String(user._id);

    const work = async (session: ClientSession): Promise<WithId<StockMovement>> => {
      // ----- Step 1: načítaj asset + overenia -----
      const asset = await this.assetsRepo.findById(tenantId, itemId, session);
      if (!asset) throw new NotFoundError('Asset', itemId);
      this.assertBulk(asset);

      // ----- Step 2: vypočítaj nový zostatok -----
      const currentBalance = asset.quantityOnHand ?? 0;
      const balanceAfter = currentBalance + movementData.quantity;

      if (balanceAfter < 0) {
        throw new BadRequestError(
          `Pohyb by stiahol zostatok pod nulu. ` +
            `Aktuálny zostatok: ${currentBalance}, zmena: ${movementData.quantity}, výsledok: ${balanceAfter}.`,
        );
      }

      // ----- Step 3: insert pohybu -----
      const now = new Date().toISOString();
      const movement: Omit<StockMovement, '_id'> = {
        ...movementData,
        // LOAN_OUT/LOAN_RETURN neposielajú locationId (žiadosti/zápožičky
        // s lokalitou nepracujú) — doplníme lokalitu z assetu, aby každý
        // uložený StockMovement má platné (nenull) locationId, presne podľa
        // schémy (2026-07-16, ADR-0020 wiring).
        locationId: movementData.locationId ?? asset.locationId,
        organisationId: tenantId,
        itemId,
        balanceAfter,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
      };

      const insertedMovement = await this.stockRepo.insert(movement, session);

      // ----- Step 4: $set quantityOnHand cache na asset -----
      await this.assetsRepo.update(
        tenantId,
        itemId,
        { quantityOnHand: balanceAfter, updatedAt: now, updatedBy: userId },
        session,
      );

      // ----- Step 5: audit log -----
      await this.auditLog.record(
        user,
        request,
        {
          action: audit.auditAction,
          target: {
            entityType: 'StockMovement',
            entityId: String(insertedMovement._id),
            snapshot: {
              itemId,
              inventoryNumber: asset.inventoryNumber,
              type: movementData.type,
              quantity: movementData.quantity,
              balanceAfter,
            },
          },
          description: audit.descriptionFn(
            asset.inventoryNumber,
            movementData.quantity,
            balanceAfter,
          ),
        },
        session,
      );

      return insertedMovement;
    };

    // Ak voláteľ (napr. LoansService) už beží vo vlastnej transakcii,
    // participujeme na nej priamo — nezakladáme druhú, nezávislú transakciu
    // (Mongo transakcie sa nedajú vnárať). Inak (samostatné vyvolanie, napr.
    // z /stock routes) založíme vlastnú transakciu ako doteraz.
    const inserted = externalSession
      ? await work(externalSession)
      : await this.runInTransaction(work);

    return toApiShape(inserted);
  }

  // -------------------------------------------------------------------------
  // Guard helpers
  // -------------------------------------------------------------------------

  private assertBulk(asset: WithId<Asset>): void {
    if (asset.trackingMode !== 'BULK') {
      throw new BadRequestError(
        `Položka ${asset.inventoryNumber} nie je BULK. ` +
          `Skladové pohyby sú dostupné len pre položky s trackingMode === 'BULK'.`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Transakčný helper (rovnaký vzor ako AssetsService)
  // -------------------------------------------------------------------------

  private async runInTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.mongoClient.startSession();
    try {
      let result: T | undefined;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result as T;
    } finally {
      await session.endSession();
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toApiShape(doc: WithId<StockMovement>): Record<string, unknown> {
  return {
    ...doc,
    _id: String(doc._id),
  };
}

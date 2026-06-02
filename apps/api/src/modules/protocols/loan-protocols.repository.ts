// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * LoanProtocolsRepository — thin wrapper around `loan_protocols` collection.
 *
 * Konvencie (rovnaké ako LoansRepository / AssetsRepository):
 *   - Metódy vracajú surové `WithId<LoanProtocol>` dokumenty.
 *   - Žiadna business logika — len Mongo primitívy.
 *   - Každá read/write metóda berie `organisationId` ako prvý parameter.
 *   - `ClientSession?` optional parameter na writes pre transakčné použitie.
 *
 * K4 scope: insert + findById + findByLoanId.
 * Routes (K5) pridajú list a ďalšie read metódy.
 *
 * Unique index: `(organisationId, protocolNumber)` — posledná línia obrany
 * pri race na generátor čísla (ADR-0022).
 */

import { ObjectId } from 'mongodb';

import { requireTenantId, tenantFilter } from '../../lib/organisation-scoping.js';

import { ensureCounterIndex } from './protocol-number.js';

import type { LoanProtocol } from '@inventario/shared-types';
import type { ClientSession, Collection, Db, Filter, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class LoanProtocolsRepository {
  private readonly collection: Collection<LoanProtocol>;
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
    this.collection = db.collection<LoanProtocol>('loan_protocols');
  }

  /**
   * Vytvorí indexy. Idempotentné — bezpečné volať pri každom štarte.
   *
   * Index rationale:
   *   - `organisationId_protocolNumber_unique` — unique constraint, race guard
   *     pri súbežných fulfil volaniach (ADR-0022).
   *   - `organisationId_loanId` — fast lookup pre GET /v1/loans/:id/protocols (K5).
   *   - `organisationId_status` — filter podľa stavu (K5 list).
   */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex(
        { organisationId: 1, protocolNumber: 1 },
        { unique: true, name: 'organisationId_protocolNumber_unique' },
      ),
      this.collection.createIndex(
        { organisationId: 1, loanId: 1 },
        { name: 'organisationId_loanId' },
      ),
      this.collection.createIndex(
        { organisationId: 1, status: 1 },
        { name: 'organisationId_status' },
      ),
    ]);
    // Counter collection index (pre generateProtocolNumber)
    await ensureCounterIndex(this.db);
  }

  /**
   * Vloží nový LoanProtocol dokument. Vráti vložený dokument.
   *
   * Volajúci je zodpovedný za:
   *   - `organisationId` z autentifikovaného aktéra.
   *   - Všetky audit fields (createdAt, createdBy, ...).
   *   - `protocolNumber` vygenerovaný cez `generateProtocolNumber()`.
   *   - `status: 'DRAFT'`.
   *
   * VŽDY odovzdaj `session` — insert protokolu je vždy vnútri transakcie
   * (atomický s Loan insertom a asset state zmenou).
   */
  async insert(
    protocol: Omit<LoanProtocol, '_id'>,
    session?: ClientSession,
  ): Promise<WithId<LoanProtocol>> {
    const result = await this.collection.insertOne(
      protocol as unknown as LoanProtocol,
      session ? { session } : undefined,
    );

    const inserted = await this.collection.findOne(
      { _id: result.insertedId } as Filter<LoanProtocol>,
      session ? { session } : undefined,
    );

    if (!inserted) {
      throw new Error(
        `LoanProtocol insert succeeded but read-back failed for _id=${String(result.insertedId)}`,
      );
    }

    return inserted;
  }

  /**
   * Nájde jeden protokol podľa `_id`. Tenant-scoped.
   * Vráti null ak neexistuje alebo patrí inému tenantovi.
   */
  async findById(
    organisationId: string,
    id: string,
    session?: ClientSession,
  ): Promise<WithId<LoanProtocol> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    return this.collection.findOne(
      tenantFilter<LoanProtocol>(tenantId, {
        _id: new ObjectId(id) as unknown as LoanProtocol['_id'],
      } as Filter<LoanProtocol>),
      session ? { session } : undefined,
    );
  }

  /**
   * Nájde všetky protokoly pre danú výpožičku. Tenant-scoped.
   * Používa ho GET /v1/loans/:id/protocols (K5).
   */
  async findByLoanId(
    organisationId: string,
    loanId: string,
    session?: ClientSession,
  ): Promise<WithId<LoanProtocol>[]> {
    const tenantId = requireTenantId(organisationId);

    return this.collection
      .find(
        tenantFilter<LoanProtocol>(tenantId, {
          loanId,
        } as Filter<LoanProtocol>),
        session ? { session } : undefined,
      )
      .sort({ issuedAt: 1 })
      .toArray();
  }

  /**
   * Čiastočná aktualizácia protokolu (pre K6 — podpis + pdfSha256).
   * Vráti aktualizovaný dokument alebo null ak neexistuje.
   */
  async update(
    organisationId: string,
    id: string,
    patch: Partial<
      Pick<LoanProtocol, 'signatures' | 'status' | 'pdfSha256' | 'updatedAt' | 'updatedBy'>
    >,
    session?: ClientSession,
  ): Promise<WithId<LoanProtocol> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    const result = await this.collection.findOneAndUpdate(
      tenantFilter<LoanProtocol>(tenantId, {
        _id: new ObjectId(id) as unknown as LoanProtocol['_id'],
      } as Filter<LoanProtocol>),
      { $set: patch },
      {
        returnDocument: 'after',
        ...(session ? { session } : {}),
      },
    );

    return result ?? null;
  }
}

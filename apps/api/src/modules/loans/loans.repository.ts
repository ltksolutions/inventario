// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * LoansRepository — thin wrapper around the `loans` collection.
 *
 * Convention (same as AssetsRepository / LoanRequestsRepository):
 *   - Methods return raw WithId<Loan> documents.
 *   - No business logic — only Mongo primitives.
 *   - Every read/write method takes `organisationId` as first param.
 *   - `ClientSession?` optional param on writes for transactional use.
 *
 * Note on OVERDUE:
 *   `OVERDUE` is NOT a persistent status in this collection — it is a
 *   computed field (`isOverdue: now() > dueAt && status === 'ACTIVE'`)
 *   added by the service layer on every GET response. The DB status
 *   field only ever holds: ACTIVE | RETURNED | DAMAGED | LOST.
 *   See ADR-0012 for the rationale.
 *
 * Slice #5 K2 — initial implementation.
 */

import { ObjectId } from 'mongodb';

import { requireTenantId, tenantFilter } from '../../lib/organisation-scoping.js';

import type { Loan, LoanStatus } from '@inventario/shared-types';
import type { ClientSession, Collection, Db, Filter, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Param / result types
// ---------------------------------------------------------------------------

export interface ListLoansParams {
  organisationId: string;
  /** Filter by DB status. Note: 'OVERDUE' is not a valid DB status — use isOverdue computed field. */
  status?: Exclude<LoanStatus, 'OVERDUE'>;
  /** Filter by borrower. */
  borrowerId?: string;
  /** Filter by asset id — find loans that contain a given asset in their items. */
  assetId?: string;
  limit?: number;
  skip?: number;
}

export interface ListLoansResult {
  items: WithId<Loan>[];
  total: number;
}

/**
 * Patch shape for `update`.
 *
 * `organisationId`, `requestId`, `borrowerId`, `items` identities are
 * immutable post-creation. `items` condition fields (atReturn) are updated
 * via `itemsConditionPatch` in the return flow, not this generic patch.
 */
export type LoanPatch = Partial<
  Pick<
    Loan,
    | 'status'
    | 'returnedAt'
    | 'returnedTo'
    | 'items'
    | 'notes'
    | 'handoverProtocolId'
    | 'returnProtocolId'
    | 'updatedAt'
    | 'updatedBy'
  >
>;

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class LoansRepository {
  private readonly collection: Collection<Loan>;

  constructor(db: Db) {
    this.collection = db.collection<Loan>('loans');
  }

  /**
   * Create indexes. Idempotent — safe to call at every server startup.
   *
   * Index rationale per ADR-0012:
   *   - `organisationId_status_borrowerId_dueAt` — primary list query:
   *     scoped to tenant + filter by status and/or borrower + dueAt sort for
   *     overdue detection ordering.
   *   - `organisationId_items_assetId_status` — fast lookup: "is this asset
   *     currently on an ACTIVE loan?" — used by the service layer before
   *     allowing asset state transitions.
   */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex(
        { organisationId: 1, status: 1, borrowerId: 1, dueAt: 1 },
        { name: 'organisationId_status_borrowerId_dueAt' },
      ),
      this.collection.createIndex(
        { organisationId: 1, 'items.assetId': 1, status: 1 },
        { name: 'organisationId_items_assetId_status' },
      ),
    ]);
  }

  /**
   * List loans with optional filters and pagination.
   * Soft-deleted loans are excluded by default.
   */
  async list({
    organisationId,
    status,
    borrowerId,
    assetId,
    limit = 20,
    skip = 0,
  }: ListLoansParams): Promise<ListLoansResult> {
    const tenantId = requireTenantId(organisationId);

    // Build filter — dotted-notation fields ('items.assetId') are valid
    // MongoDB queries but not part of the TypeScript Filter<Loan> type,
    // so we build via Record and cast at the tenantFilter boundary.
    const callerFilter: Record<string, unknown> = {};
    if (status !== undefined) callerFilter['status'] = status;
    if (borrowerId !== undefined) callerFilter['borrowerId'] = borrowerId;
    if (assetId !== undefined) callerFilter['items.assetId'] = assetId;

    const effectiveFilter = tenantFilter<Loan>(tenantId, callerFilter as Filter<Loan>);

    const [items, total] = await Promise.all([
      this.collection.find(effectiveFilter, { limit, skip, sort: { createdAt: -1 } }).toArray(),
      this.collection.countDocuments(effectiveFilter),
    ]);

    return { items, total };
  }

  /**
   * Find a single loan by MongoDB `_id`.
   * Returns null if not found, soft-deleted, or in a different tenant.
   */
  async findById(
    organisationId: string,
    id: string,
    session?: ClientSession,
  ): Promise<WithId<Loan> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    return this.collection.findOne(
      tenantFilter<Loan>(tenantId, {
        _id: new ObjectId(id) as unknown as Loan['_id'],
      } as Filter<Loan>),
      session ? { session } : undefined,
    );
  }

  /**
   * Find the ACTIVE loan that currently holds a given asset.
   * Used by the service layer to verify an asset is genuinely BORROWED
   * before processing a return, and to surface "currently on loan" info.
   *
   * Returns null if no active loan contains this asset.
   * Pass `session` when called inside a transaction.
   */
  async findActiveByAssetId(
    organisationId: string,
    assetId: string,
    session?: ClientSession,
  ): Promise<WithId<Loan> | null> {
    const tenantId = requireTenantId(organisationId);

    return this.collection.findOne(
      tenantFilter<Loan>(tenantId, {
        status: 'ACTIVE' as Loan['status'],
        'items.assetId': assetId as unknown as Loan['items'][number]['assetId'],
      } as Filter<Loan>),
      session ? { session } : undefined,
    );
  }

  /**
   * Insert a new loan document. Returns the inserted document.
   *
   * Caller is responsible for:
   *   - Setting `organisationId` from the authenticated actor's tenant.
   *   - Setting all audit fields.
   *   - Status must be ACTIVE at creation.
   *
   * Always pass `session` — loan creation is always inside a transaction
   * (atomic with request approval + asset status update).
   */
  async insert(loan: Omit<Loan, '_id'>, session?: ClientSession): Promise<WithId<Loan>> {
    const result = await this.collection.insertOne(
      loan as unknown as Loan,
      session ? { session } : undefined,
    );

    const inserted = await this.collection.findOne(
      { _id: result.insertedId } as Filter<Loan>,
      session ? { session } : undefined,
    );

    if (!inserted) {
      throw new Error(
        `Loan insert succeeded but read-back failed for _id=${String(result.insertedId)}`,
      );
    }

    return inserted;
  }

  /**
   * Apply a partial update to a loan. Returns the updated document,
   * or null if not found / soft-deleted / in a different tenant.
   *
   * Caller must include `updatedAt` and `updatedBy` in the patch.
   * Pass `session` to make this part of a transaction.
   */
  async update(
    organisationId: string,
    id: string,
    patch: LoanPatch,
    session?: ClientSession,
  ): Promise<WithId<Loan> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    const result = await this.collection.findOneAndUpdate(
      tenantFilter<Loan>(tenantId, {
        _id: new ObjectId(id) as unknown as Loan['_id'],
      } as Filter<Loan>),
      { $set: patch },
      {
        returnDocument: 'after',
        ...(session ? { session } : {}),
      },
    );

    return result ?? null;
  }
}

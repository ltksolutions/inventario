// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * LoanRequestsRepository — thin wrapper around the `loan_requests` collection.
 *
 * ADR-0026: Katalógové žiadosti (kategória + množstvo) + oddelené vydávanie.
 *
 * Convention:
 *   - Methods return raw WithId<LoanRequest> documents.
 *   - No business logic — only Mongo primitives.
 *   - Every read/write method takes `organisationId` as first param and
 *     enforces tenant scoping via `requireTenantId` + `tenantFilter`.
 *   - `ClientSession?` optional param on writes for transactional use.
 */

import { ObjectId } from 'mongodb';

import { requireTenantId, tenantFilter } from '../../lib/organisation-scoping.js';

import type { LoanRequest, LoanRequestStatus } from '@inventario/shared-types';
import type { ClientSession, Collection, Db, Filter, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Param / result types
// ---------------------------------------------------------------------------

export interface ListLoanRequestsParams {
  organisationId: string;
  status?: LoanRequestStatus;
  /** Filter by requester — EMPLOYEE sees only own requests, managers see all. */
  requesterId?: string;
  /**
   * Filter by beneficiary — when set together with requesterId for EMPLOYEE,
   * the repository uses $or so they see requests where they are requester OR beneficiary.
   */
  beneficiaryId?: string;
  limit?: number;
  skip?: number;
}

export interface ListLoanRequestsResult {
  items: WithId<LoanRequest>[];
  total: number;
}

/**
 * Patch shape for `update`. Only fields that the service layer legitimately
 * changes post-creation are included.
 *
 * `organisationId` / `requesterId` / `items` / `plannedFrom` / `plannedTo`
 * are immutable after creation — not patchable.
 */
export type LoanRequestPatch = Partial<
  Pick<
    LoanRequest,
    'status' | 'approvers' | 'resultingLoanIds' | 'rejectionReason' | 'updatedAt' | 'updatedBy'
  >
> & {
  /**
   * Atomic increment for a specific item's quantityFulfilled.
   * Handled via $inc in update — not a simple $set patch.
   * Pass separately to `incrementItemFulfilled` instead of `update`.
   */
  _itemFulfilledIncrement?: never;
};

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class LoanRequestsRepository {
  private readonly collection: Collection<LoanRequest>;

  constructor(db: Db) {
    this.collection = db.collection<LoanRequest>('loan_requests');
  }

  /**
   * Create indexes. Idempotent — safe to call at every server startup.
   *
   * Index rationale per ADR-0026:
   *   - `organisationId_status_requesterId_createdAt` — primary list query.
   *   - `organisationId_items_categoryId` — find requests by category
   *     (replaces old items.assetId index from ADR-0012).
   */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex(
        { organisationId: 1, status: 1, requesterId: 1, createdAt: -1 },
        { name: 'organisationId_status_requesterId_createdAt' },
      ),
      this.collection.createIndex(
        { organisationId: 1, 'items.categoryId': 1 },
        { name: 'organisationId_items_categoryId' },
      ),
    ]);
  }

  /**
   * List loan requests with optional filters and pagination.
   */
  async list({
    organisationId,
    status,
    requesterId,
    beneficiaryId,
    limit = 20,
    skip = 0,
  }: ListLoanRequestsParams): Promise<ListLoanRequestsResult> {
    const tenantId = requireTenantId(organisationId);

    const callerFilter: Record<string, unknown> = {};
    if (status !== undefined) callerFilter['status'] = status;

    // ADR-0023: EMPLOYEE filter — sees requests where they are requester OR beneficiary
    if (requesterId !== undefined && beneficiaryId !== undefined && requesterId === beneficiaryId) {
      callerFilter['$or'] = [{ requesterId }, { beneficiaryId }];
    } else if (requesterId !== undefined) {
      callerFilter['requesterId'] = requesterId;
    } else if (beneficiaryId !== undefined) {
      callerFilter['beneficiaryId'] = beneficiaryId;
    }

    const effectiveFilter = tenantFilter<LoanRequest>(
      tenantId,
      callerFilter as Filter<LoanRequest>,
    );

    const [items, total] = await Promise.all([
      this.collection.find(effectiveFilter, { limit, skip, sort: { createdAt: -1 } }).toArray(),
      this.collection.countDocuments(effectiveFilter),
    ]);

    return { items, total };
  }

  /**
   * Find a single loan request by MongoDB `_id`.
   */
  async findById(
    organisationId: string,
    id: string,
    session?: ClientSession,
  ): Promise<WithId<LoanRequest> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    return this.collection.findOne(
      tenantFilter<LoanRequest>(tenantId, {
        _id: new ObjectId(id) as unknown as LoanRequest['_id'],
      } as Filter<LoanRequest>),
      session ? { session } : undefined,
    );
  }

  /**
   * Insert a new loan request document.
   */
  async insert(
    loanRequest: Omit<LoanRequest, '_id'>,
    session?: ClientSession,
  ): Promise<WithId<LoanRequest>> {
    const result = await this.collection.insertOne(
      loanRequest as unknown as LoanRequest,
      session ? { session } : undefined,
    );

    const inserted = await this.collection.findOne(
      { _id: result.insertedId } as Filter<LoanRequest>,
      session ? { session } : undefined,
    );

    if (!inserted) {
      throw new Error(
        `LoanRequest insert succeeded but read-back failed for _id=${String(result.insertedId)}`,
      );
    }

    return inserted;
  }

  /**
   * Apply a partial update to a loan request.
   */
  async update(
    organisationId: string,
    id: string,
    patch: LoanRequestPatch,
    session?: ClientSession,
  ): Promise<WithId<LoanRequest> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    const result = await this.collection.findOneAndUpdate(
      tenantFilter<LoanRequest>(tenantId, {
        _id: new ObjectId(id) as unknown as LoanRequest['_id'],
      } as Filter<LoanRequest>),
      { $set: patch },
      {
        returnDocument: 'after',
        ...(session ? { session } : {}),
      },
    );

    return result ?? null;
  }

  /**
   * Atomically increment quantityFulfilled on a specific item (by array index)
   * and push a new loanId to resultingLoanIds.
   *
   * Used by the fulfil flow — each partial fulfilment adds to the running total.
   * The $inc ensures concurrent fulfilments don't overwrite each other.
   */
  async incrementItemFulfilled(
    organisationId: string,
    id: string,
    itemIndex: number,
    quantityDelta: number,
    loanId: string,
    updatedAt: string,
    updatedBy: string,
    session?: ClientSession,
  ): Promise<WithId<LoanRequest> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;

    const result = await this.collection.findOneAndUpdate(
      tenantFilter<LoanRequest>(tenantId, {
        _id: new ObjectId(id) as unknown as LoanRequest['_id'],
      } as Filter<LoanRequest>),
      {
        $inc: { [`items.${itemIndex}.quantityFulfilled`]: quantityDelta },
        $push: { resultingLoanIds: loanId as unknown as LoanRequest['resultingLoanIds'][number] },
        $set: { updatedAt, updatedBy },
      },
      {
        returnDocument: 'after',
        ...(session ? { session } : {}),
      },
    );

    return result ?? null;
  }
}

/**
 * LoanRequestsRepository — thin wrapper around the `loan_requests` collection.
 *
 * Convention (same as AssetsRepository):
 *   - Methods return raw WithId<LoanRequest> documents.
 *   - No business logic — only Mongo primitives.
 *   - Every read/write method takes `organisationId` as first param and
 *     enforces tenant scoping via `requireTenantId` + `tenantFilter`.
 *   - `ClientSession?` optional param on writes for transactional use.
 *
 * Slice #5 K2 — initial implementation.
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
 * `organisationId` is immutable — not patchable.
 * `requesterId` / `items` / `plannedFrom` / `plannedTo` are not patchable
 * after creation in MVP (user must cancel and re-submit).
 */
export type LoanRequestPatch = Partial<
  Pick<
    LoanRequest,
    'status' | 'approvers' | 'resultingLoanId' | 'rejectionReason' | 'updatedAt' | 'updatedBy'
  >
>;

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
   * Index rationale per ADR-0012:
   *   - `organisationId_status_requesterId_createdAt` — primary list query:
   *     scoped to tenant + filter by status and/or requester + default sort.
   *   - `organisationId_items_assetId` — detect whether a given asset already
   *     has a PENDING request (reservation conflict check in service layer).
   */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex(
        { organisationId: 1, status: 1, requesterId: 1, createdAt: -1 },
        { name: 'organisationId_status_requesterId_createdAt' },
      ),
      this.collection.createIndex(
        { organisationId: 1, 'items.assetId': 1 },
        { name: 'organisationId_items_assetId' },
      ),
    ]);
  }

  /**
   * List loan requests with optional filters and pagination.
   * Soft-deleted requests are excluded by default (via tenantFilter).
   */
  async list({
    organisationId,
    status,
    requesterId,
    limit = 20,
    skip = 0,
  }: ListLoanRequestsParams): Promise<ListLoanRequestsResult> {
    const tenantId = requireTenantId(organisationId);

    const callerFilter: Record<string, unknown> = {};
    if (status !== undefined) callerFilter['status'] = status;
    if (requesterId !== undefined) callerFilter['requesterId'] = requesterId;

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
   * Returns null if not found, soft-deleted, or in a different tenant.
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
   * Find an existing PENDING request that contains a given asset id in its
   * items array. Used by the service layer to detect reservation conflicts:
   * if a PENDING request exists for this asset, the asset is already RESERVED
   * and a new request must be rejected.
   *
   * Returns the conflicting request, or null if none exists.
   *
   * Pass `session` when called inside a transaction (asset reservation flow).
   */
  async findPendingByAssetId(
    organisationId: string,
    assetId: string,
    session?: ClientSession,
  ): Promise<WithId<LoanRequest> | null> {
    const tenantId = requireTenantId(organisationId);

    return this.collection.findOne(
      tenantFilter<LoanRequest>(tenantId, {
        status: 'PENDING' as LoanRequest['status'],
        'items.assetId': assetId as unknown as LoanRequest['items'][number]['assetId'],
      } as Filter<LoanRequest>),
      session ? { session } : undefined,
    );
  }

  /**
   * Insert a new loan request document. Returns the inserted document.
   *
   * Caller is responsible for:
   *   - Setting `organisationId` from the authenticated actor's tenant.
   *   - Setting all audit fields (createdAt, updatedAt, createdBy, updatedBy).
   *   - Validating against CreateLoanRequestSchema from shared-types.
   *
   * Pass `session` to make this part of a transaction (always recommended:
   * insert + asset reservation should be atomic).
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
   * Apply a partial update to a loan request. Returns the updated document,
   * or null if not found / soft-deleted / in a different tenant.
   *
   * Caller must include `updatedAt` and `updatedBy` in the patch.
   * Pass `session` to make this part of a transaction.
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
}

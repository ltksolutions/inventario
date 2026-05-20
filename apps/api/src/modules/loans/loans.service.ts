/**
 * LoansService — business logic for the loan request + loan lifecycle.
 *
 * State machine summary (per ADR-0012):
 *
 *   LoanRequest: PENDING → APPROVED | REJECTED | CANCELLED
 *   Loan:        ACTIVE  → RETURNED | DAMAGED  | LOST
 *
 * Asset states driven by this service:
 *   createLoanRequest  → AVAILABLE → RESERVED   (atomic with request creation)
 *   approveLoanRequest → RESERVED  → BORROWED   (atomic with Loan creation)
 *   rejectLoanRequest  → RESERVED  → AVAILABLE  (atomic with request rejection)
 *   cancelLoanRequest  → RESERVED  → AVAILABLE  (atomic with request cancellation)
 *   returnLoan         → BORROWED  → AVAILABLE | IN_SERVICE (per item.requiresService)
 *   markLoanLost       → BORROWED  → LOST
 *
 * OVERDUE is NOT a persistent DB status — it is a computed field
 * (`isOverdue: now() > dueAt && status === 'ACTIVE'`) added by `toApiShape`.
 *
 * RBAC in this service vs. routes:
 *   Coarse-grained role guards (EMPLOYEE+ / ASSET_MANAGER+ADMIN) are
 *   enforced in the routes layer via `fastify.requireRole()`. Fine-
 *   grained ownership checks (e.g. "only the requester or an ADMIN can
 *   cancel") live in this service because they require loading the
 *   document first.
 *
 * Slice #5 K3 — initial implementation.
 */

import { BadRequestError, ForbiddenError, NotFoundError } from '../../plugins/error-handler.js';

import type { LoanRequestsRepository } from './loan-requests.repository.js';
import type { LoansRepository, LoanPatch } from './loans.repository.js';
import type { AssetsRepository } from '../assets/assets.repository.js';
import type { AuditLogService } from '../audit/audit.service.js';
import type {
  AssetStatus,
  CreateLoanRequestInput,
  Loan,
  LoanItem,
  LoanRequest,
  LoanRequestStatus,
  LoanStatus,
  ReturnLoanInput,
  User,
} from '@inventario/shared-types';
import type { FastifyRequest } from 'fastify';
import type { ClientSession, MongoClient, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface ListLoanRequestsServiceParams {
  status?: LoanRequestStatus;
  /** Explicit requester filter — managers may pass any userId; employees pass own id. */
  requesterId?: string;
  limit?: number;
  skip?: number;
}

export interface ListLoansServiceParams {
  status?: Exclude<LoanStatus, 'OVERDUE'>;
  borrowerId?: string;
  assetId?: string;
  limit?: number;
  skip?: number;
}

export interface LoanRequestApiShape extends Record<string, unknown> {
  isOverdue?: never; // LoanRequest has no overdue concept
}

export interface LoanApiShape extends Record<string, unknown> {
  isOverdue: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    skip: number;
    hasMore: boolean;
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class LoansService {
  constructor(
    private readonly loanRequestsRepo: LoanRequestsRepository,
    private readonly loansRepo: LoansRepository,
    private readonly assetsRepo: AssetsRepository,
    private readonly auditLog: AuditLogService,
    private readonly mongoClient: MongoClient,
  ) {}

  // -------------------------------------------------------------------------
  // Read paths
  // -------------------------------------------------------------------------

  /**
   * List loan requests.
   * - EMPLOYEE: can only list own requests (requesterId filter forced to self).
   * - ASSET_MANAGER / ADMIN: can list all, or filter by requesterId.
   */
  async listLoanRequests(
    params: ListLoanRequestsServiceParams,
    actor: WithId<User>,
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    const tenantId = String(actor.organisationId);
    const isManager = hasManagerRole(actor);
    const limit = params.limit ?? 20;
    const skip = params.skip ?? 0;

    // Employees can only see their own requests.
    const requesterId = isManager ? params.requesterId : String(actor._id);

    const { items, total } = await this.loanRequestsRepo.list({
      organisationId: tenantId,
      ...(params.status !== undefined && { status: params.status }),
      ...(requesterId !== undefined && { requesterId }),
      limit,
      skip,
    });

    return paginatedResponse(items.map(loanRequestToApiShape), total, limit, skip);
  }

  /**
   * Get a single loan request by id.
   * Accessible to the requester themselves or any ASSET_MANAGER / ADMIN.
   */
  async getLoanRequestById(id: string, actor: WithId<User>): Promise<Record<string, unknown>> {
    const tenantId = String(actor.organisationId);
    const doc = await this.loanRequestsRepo.findById(tenantId, id);
    if (!doc) throw new NotFoundError('LoanRequest', id);

    assertCanReadLoanRequest(doc, actor);
    return loanRequestToApiShape(doc);
  }

  /**
   * List loans.
   * - EMPLOYEE: forced filter to own loans (borrowerId = self).
   * - ASSET_MANAGER / ADMIN: can filter freely.
   */
  async listLoans(
    params: ListLoansServiceParams,
    actor: WithId<User>,
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    const tenantId = String(actor.organisationId);
    const isManager = hasManagerRole(actor);
    const limit = params.limit ?? 20;
    const skip = params.skip ?? 0;

    const borrowerId = isManager ? params.borrowerId : String(actor._id);

    const { items, total } = await this.loansRepo.list({
      organisationId: tenantId,
      ...(params.status !== undefined && { status: params.status }),
      ...(borrowerId !== undefined && { borrowerId }),
      ...(params.assetId !== undefined && { assetId: params.assetId }),
      limit,
      skip,
    });

    return paginatedResponse(items.map(loanToApiShape), total, limit, skip);
  }

  /**
   * List loans for the current user (/my-loans shortcut).
   * Always forces borrowerId = self.
   */
  async listMyLoans(
    params: Omit<ListLoansServiceParams, 'borrowerId' | 'assetId'>,
    actor: WithId<User>,
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    return this.listLoans({ ...params, borrowerId: String(actor._id) }, actor);
  }

  /**
   * Get a single loan by id.
   * Accessible to the borrower or any ASSET_MANAGER / ADMIN.
   */
  async getLoanById(id: string, actor: WithId<User>): Promise<Record<string, unknown>> {
    const tenantId = String(actor.organisationId);
    const doc = await this.loansRepo.findById(tenantId, id);
    if (!doc) throw new NotFoundError('Loan', id);

    assertCanReadLoan(doc, actor);
    return loanToApiShape(doc);
  }

  // -------------------------------------------------------------------------
  // Write paths — all transactional
  // -------------------------------------------------------------------------

  /**
   * Create a loan request.
   *
   * Validates that every requested asset:
   *   - Exists in this tenant
   *   - Is AVAILABLE (not RESERVED / BORROWED / etc.)
   *   - Is loanable (`isLoanable: true`)
   *   - Is not soft-deleted
   *
   * On success, all assets are atomically moved AVAILABLE → RESERVED
   * and the LoanRequest document is created with status PENDING.
   *
   * If any asset fails validation, the transaction aborts (no partial
   * reservations).
   */
  async createLoanRequest(
    input: CreateLoanRequestInput,
    actor: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    const tenantId = String(actor.organisationId);
    const actorId = String(actor._id);
    const now = new Date().toISOString();

    const created = await this.runInTransaction(async (session) => {
      // ----- Step 1: validate and snapshot every requested asset -----
      const validatedItems: LoanRequest['items'] = [];

      for (const item of input.items) {
        const asset = await this.assetsRepo.findById(tenantId, item.assetId, session);

        if (!asset) {
          throw new BadRequestError(`Asset ${item.assetId} does not exist or is not accessible.`);
        }
        if (!asset.isLoanable) {
          throw new BadRequestError(
            `Asset ${asset.inventoryNumber} (${asset.name}) is not loanable.`,
          );
        }
        if (asset.status !== 'AVAILABLE') {
          throw new BadRequestError(
            `Asset ${asset.inventoryNumber} (${asset.name}) is not available (current status: ${asset.status}).`,
          );
        }

        validatedItems.push({
          assetId: item.assetId,
          snapshot: {
            inventoryNumber: asset.inventoryNumber,
            name: asset.name,
          },
          status: 'PENDING',
          substitutedWithAssetId: null,
          approverNote: null,
        });
      }

      // ----- Step 2: reserve all assets atomically -----
      for (const item of validatedItems) {
        const updated = await this.assetsRepo.update(
          tenantId,
          item.assetId,
          { status: 'RESERVED' as AssetStatus, updatedAt: now, updatedBy: actorId },
          session,
        );
        if (!updated) {
          // Race: asset was modified/deleted between our findById and update.
          throw new BadRequestError(
            `Asset ${item.assetId} could not be reserved — it may have just been modified. Please try again.`,
          );
        }
      }

      // ----- Step 3: create the LoanRequest document -----
      const loanRequestDoc: Omit<LoanRequest, '_id'> = {
        organisationId: tenantId,
        requesterId: actorId,
        purpose: input.purpose,
        plannedFrom: input.plannedFrom,
        plannedTo: input.plannedTo,
        items: validatedItems,
        status: 'PENDING' as LoanRequest['status'],
        approvers: [],
        resultingLoanId: null,
        rejectionReason: null,
        teamId: null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
        deletedAt: null,
        deletedBy: null,
      };

      const inserted = await this.loanRequestsRepo.insert(loanRequestDoc, session);

      // ----- Step 4: audit log -----
      await this.auditLog.record(
        actor,
        request,
        {
          action: 'LOAN_REQUEST_CREATED',
          target: {
            entityType: 'LoanRequest',
            entityId: String(inserted._id),
            snapshot: {
              purpose: inserted.purpose,
              plannedFrom: inserted.plannedFrom,
              plannedTo: inserted.plannedTo,
              itemCount: inserted.items.length,
            },
          },
          description: `Loan request created for ${inserted.items.length} asset(s), planned ${inserted.plannedFrom} – ${inserted.plannedTo}.`,
        },
        session,
      );

      return inserted;
    });

    return loanRequestToApiShape(created);
  }

  /**
   * Approve a loan request.
   *
   * Caller must be ASSET_MANAGER or ADMIN (enforced in routes).
   *
   * In MVP, approval = immediate pickup:
   *   - All reserved assets → BORROWED (currentLoanId set)
   *   - Loan document created with status ACTIVE
   *   - LoanRequest → APPROVED (resultingLoanId set)
   *
   * All three writes are atomic.
   */
  async approveLoanRequest(
    id: string,
    actor: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    const tenantId = String(actor.organisationId);
    const actorId = String(actor._id);
    const now = new Date().toISOString();

    const loan = await this.runInTransaction(async (session) => {
      // ----- Step 1: load and validate request -----
      const loanRequest = await this.loanRequestsRepo.findById(tenantId, id, session);
      if (!loanRequest) throw new NotFoundError('LoanRequest', id);
      if (loanRequest.status !== 'PENDING') {
        throw new BadRequestError(
          `Cannot approve a loan request with status ${loanRequest.status}. Only PENDING requests can be approved.`,
        );
      }

      // ----- Step 2: sanity check — all assets still RESERVED -----
      for (const item of loanRequest.items) {
        const asset = await this.assetsRepo.findById(tenantId, item.assetId, session);
        if (!asset || asset.status !== 'RESERVED') {
          throw new BadRequestError(
            `Asset ${item.assetId} is no longer in RESERVED state (current: ${asset?.status ?? 'not found'}). ` +
              `The request cannot be approved. Please reject it and ask the requester to submit a new one.`,
          );
        }
      }

      // ----- Step 3: build Loan items (with pickup condition snapshot) -----
      const loanItems: LoanItem[] = loanRequest.items.map((item) => ({
        assetId: item.assetId,
        snapshot: item.snapshot,
        condition: {
          atPickup: {
            condition: 'GOOD' as const, // MVP: no condition form at pickup; default to GOOD
            note: null,
            photoIds: [],
          },
          atReturn: null,
        },
      }));

      // ----- Step 4: create Loan document -----
      const loanDoc: Omit<Loan, '_id'> = {
        organisationId: tenantId,
        requestId: id,
        borrowerId: String(loanRequest.requesterId),
        purpose: loanRequest.purpose,
        pickedUpAt: now,
        handedOverBy: actorId,
        dueAt: loanRequest.plannedTo,
        returnedAt: null,
        returnedTo: null,
        items: loanItems,
        status: 'ACTIVE' as LoanStatus,
        extensionCount: 0,
        handoverProtocolId: null,
        returnProtocolId: null,
        notes: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
        deletedAt: null,
        deletedBy: null,
      };

      const insertedLoan = await this.loansRepo.insert(loanDoc, session);
      const loanId = String(insertedLoan._id);

      // ----- Step 5: assets RESERVED → BORROWED -----
      for (const item of loanRequest.items) {
        await this.assetsRepo.update(
          tenantId,
          item.assetId,
          {
            status: 'BORROWED' as AssetStatus,
            currentLoanId: loanId,
            updatedAt: now,
            updatedBy: actorId,
          },
          session,
        );
      }

      // ----- Step 6: LoanRequest → APPROVED -----
      await this.loanRequestsRepo.update(
        tenantId,
        id,
        {
          status: 'APPROVED' as LoanRequestStatus,
          resultingLoanId: loanId,
          updatedAt: now,
          updatedBy: actorId,
        },
        session,
      );

      // ----- Step 7: audit log -----
      await this.auditLog.record(
        actor,
        request,
        {
          action: 'LOAN_REQUEST_APPROVED',
          target: {
            entityType: 'LoanRequest',
            entityId: id,
            snapshot: { resultingLoanId: loanId, itemCount: loanRequest.items.length },
          },
          description: `Loan request approved. Loan ${loanId} created, ${loanRequest.items.length} asset(s) handed over.`,
        },
        session,
      );

      await this.auditLog.record(
        actor,
        request,
        {
          action: 'LOAN_PICKED_UP',
          target: {
            entityType: 'Loan',
            entityId: loanId,
            snapshot: {
              borrowerId: loanDoc.borrowerId,
              dueAt: loanDoc.dueAt,
              itemCount: loanItems.length,
            },
          },
          description: `Loan ${loanId} created — ${loanItems.length} asset(s) picked up, due ${loanDoc.dueAt}.`,
        },
        session,
      );

      return insertedLoan;
    });

    return loanToApiShape(loan);
  }

  /**
   * Reject a loan request.
   *
   * Caller must be ASSET_MANAGER or ADMIN (enforced in routes).
   * All reserved assets are released back to AVAILABLE atomically.
   */
  async rejectLoanRequest(
    id: string,
    reason: string,
    actor: WithId<User>,
    request: FastifyRequest,
  ): Promise<void> {
    const tenantId = String(actor.organisationId);
    const actorId = String(actor._id);
    const now = new Date().toISOString();

    await this.runInTransaction(async (session) => {
      const loanRequest = await this.loanRequestsRepo.findById(tenantId, id, session);
      if (!loanRequest) throw new NotFoundError('LoanRequest', id);
      if (loanRequest.status !== 'PENDING') {
        throw new BadRequestError(
          `Cannot reject a loan request with status ${loanRequest.status}.`,
        );
      }

      // Release reservations.
      await this.releaseReservations(tenantId, loanRequest.items, actorId, now, session);

      await this.loanRequestsRepo.update(
        tenantId,
        id,
        {
          status: 'REJECTED' as LoanRequestStatus,
          rejectionReason: reason,
          updatedAt: now,
          updatedBy: actorId,
        },
        session,
      );

      await this.auditLog.record(
        actor,
        request,
        {
          action: 'LOAN_REQUEST_REJECTED',
          target: {
            entityType: 'LoanRequest',
            entityId: id,
            snapshot: { reason, itemCount: loanRequest.items.length },
          },
          description: `Loan request rejected. Reason: ${reason}`,
        },
        session,
      );
    });
  }

  /**
   * Cancel a loan request.
   *
   * Only the original requester or an ADMIN can cancel.
   * All reserved assets are released back to AVAILABLE atomically.
   */
  async cancelLoanRequest(id: string, actor: WithId<User>, request: FastifyRequest): Promise<void> {
    const tenantId = String(actor.organisationId);
    const actorId = String(actor._id);
    const now = new Date().toISOString();

    await this.runInTransaction(async (session) => {
      const loanRequest = await this.loanRequestsRepo.findById(tenantId, id, session);
      if (!loanRequest) throw new NotFoundError('LoanRequest', id);
      if (loanRequest.status !== 'PENDING') {
        throw new BadRequestError(
          `Cannot cancel a loan request with status ${loanRequest.status}.`,
        );
      }

      // Only requester or ADMIN can cancel.
      const isOwner = String(loanRequest.requesterId) === actorId;
      const isAdmin = actor.roles.includes('ADMIN');
      if (!isOwner && !isAdmin) {
        throw new ForbiddenError(
          'Only the original requester or an ADMIN can cancel this loan request.',
        );
      }

      await this.releaseReservations(tenantId, loanRequest.items, actorId, now, session);

      await this.loanRequestsRepo.update(
        tenantId,
        id,
        {
          status: 'CANCELLED' as LoanRequestStatus,
          updatedAt: now,
          updatedBy: actorId,
        },
        session,
      );

      await this.auditLog.record(
        actor,
        request,
        {
          action: 'LOAN_REQUEST_CANCELLED',
          target: {
            entityType: 'LoanRequest',
            entityId: id,
            snapshot: { cancelledBy: actorId, itemCount: loanRequest.items.length },
          },
          description: `Loan request cancelled by ${actor.displayName}.`,
        },
        session,
      );
    });
  }

  /**
   * Return a loan.
   *
   * Caller must be ASSET_MANAGER or ADMIN (enforced in routes).
   *
   * For each item:
   *   - requiresService === true  → asset BORROWED → IN_SERVICE
   *   - requiresService === false → asset BORROWED → AVAILABLE
   *
   * Loan terminal status:
   *   - Any item with requiresService → DAMAGED
   *   - All items fine              → RETURNED
   */
  async returnLoan(
    id: string,
    returnInput: ReturnLoanInput,
    actor: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    const tenantId = String(actor.organisationId);
    const actorId = String(actor._id);
    const now = new Date().toISOString();

    const updated = await this.runInTransaction(async (session) => {
      const loan = await this.loansRepo.findById(tenantId, id, session);
      if (!loan) throw new NotFoundError('Loan', id);
      if (loan.status !== 'ACTIVE') {
        throw new BadRequestError(
          `Cannot return a loan with status ${loan.status}. Only ACTIVE loans can be returned.`,
        );
      }

      // Validate that returnInput.items covers all loan items.
      const returnItemMap = new Map(returnInput.items.map((i) => [i.assetId, i]));
      for (const loanItem of loan.items) {
        if (!returnItemMap.has(loanItem.assetId)) {
          throw new BadRequestError(
            `Return input is missing item for asset ${loanItem.assetId} (${loanItem.snapshot.inventoryNumber}).`,
          );
        }
      }

      let anyRequiresService = false;

      // Update assets and build updated loan items.
      const updatedItems: LoanItem[] = [];
      for (const loanItem of loan.items) {
        const returnItemData = returnItemMap.get(loanItem.assetId)!;
        const requiresService = returnItemData.requiresService ?? false;

        if (requiresService) anyRequiresService = true;

        const newAssetStatus: AssetStatus = requiresService ? 'IN_SERVICE' : 'AVAILABLE';
        await this.assetsRepo.update(
          tenantId,
          loanItem.assetId,
          {
            status: newAssetStatus,
            currentLoanId: null,
            updatedAt: now,
            updatedBy: actorId,
          },
          session,
        );

        updatedItems.push({
          ...loanItem,
          condition: {
            ...loanItem.condition,
            atReturn: {
              condition: returnItemData.condition,
              note: returnItemData.note ?? null,
              photoIds: [],
              requiresService,
            },
          },
        });
      }

      const terminalStatus: LoanStatus = anyRequiresService ? 'DAMAGED' : 'RETURNED';

      const loanPatch: LoanPatch = {
        status: terminalStatus,
        returnedAt: now,
        returnedTo: returnInput.returnedTo,
        items: updatedItems,
        notes: returnInput.notes ?? null,
        updatedAt: now,
        updatedBy: actorId,
      };

      const updatedLoan = await this.loansRepo.update(tenantId, id, loanPatch, session);
      if (!updatedLoan) throw new NotFoundError('Loan', id);

      await this.auditLog.record(
        actor,
        request,
        {
          action: 'LOAN_RETURNED',
          target: {
            entityType: 'Loan',
            entityId: id,
            snapshot: {
              terminalStatus,
              returnedAt: now,
              itemsRequiringService: updatedItems.filter(
                (i) => i.condition.atReturn?.requiresService,
              ).length,
            },
          },
          description:
            terminalStatus === 'DAMAGED'
              ? `Loan returned with damage — ${updatedItems.filter((i) => i.condition.atReturn?.requiresService).length} asset(s) require service.`
              : `Loan returned successfully — all ${loan.items.length} asset(s) in order.`,
          severity: anyRequiresService ? 'WARNING' : 'INFO',
        },
        session,
      );

      return updatedLoan;
    });

    return loanToApiShape(updated);
  }

  /**
   * Mark a loan as lost.
   *
   * Caller must be ASSET_MANAGER or ADMIN (enforced in routes).
   * All borrowed assets → LOST, currentLoanId cleared.
   */
  async markLoanLost(
    id: string,
    reason: string,
    actor: WithId<User>,
    request: FastifyRequest,
  ): Promise<void> {
    const tenantId = String(actor.organisationId);
    const actorId = String(actor._id);
    const now = new Date().toISOString();

    await this.runInTransaction(async (session) => {
      const loan = await this.loansRepo.findById(tenantId, id, session);
      if (!loan) throw new NotFoundError('Loan', id);
      if (loan.status !== 'ACTIVE') {
        throw new BadRequestError(
          `Cannot mark a loan as lost if its status is ${loan.status}. Only ACTIVE loans can be lost.`,
        );
      }

      for (const item of loan.items) {
        await this.assetsRepo.update(
          tenantId,
          item.assetId,
          {
            status: 'LOST' as AssetStatus,
            currentLoanId: null,
            updatedAt: now,
            updatedBy: actorId,
          },
          session,
        );
      }

      await this.loansRepo.update(
        tenantId,
        id,
        {
          status: 'LOST' as LoanStatus,
          updatedAt: now,
          updatedBy: actorId,
        },
        session,
      );

      await this.auditLog.record(
        actor,
        request,
        {
          action: 'LOAN_MARKED_LOST',
          target: {
            entityType: 'Loan',
            entityId: id,
            snapshot: { reason, lostItemCount: loan.items.length },
          },
          description: `Loan marked as lost (${loan.items.length} asset(s)). Reason: ${reason}`,
          severity: 'WARNING',
        },
        session,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Release all RESERVED assets back to AVAILABLE.
   * Used by both `rejectLoanRequest` and `cancelLoanRequest`.
   */
  private async releaseReservations(
    tenantId: string,
    items: LoanRequest['items'],
    actorId: string,
    now: string,
    session: ClientSession,
  ): Promise<void> {
    for (const item of items) {
      await this.assetsRepo.update(
        tenantId,
        item.assetId,
        { status: 'AVAILABLE' as AssetStatus, updatedAt: now, updatedBy: actorId },
        session,
      );
    }
  }

  /**
   * Run `work` inside a Mongo transaction. Commits on success, aborts on throw.
   * Same pattern as AssetsService.runInTransaction.
   */
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
// RBAC helpers
// ---------------------------------------------------------------------------

function hasManagerRole(actor: WithId<User>): boolean {
  return actor.roles.includes('ASSET_MANAGER') || actor.roles.includes('ADMIN');
}

function assertCanReadLoanRequest(doc: WithId<LoanRequest>, actor: WithId<User>): void {
  const isOwner = String(doc.requesterId) === String(actor._id);
  if (!isOwner && !hasManagerRole(actor)) {
    throw new ForbiddenError('You do not have permission to view this loan request.');
  }
}

function assertCanReadLoan(doc: WithId<Loan>, actor: WithId<User>): void {
  const isOwner = String(doc.borrowerId) === String(actor._id);
  if (!isOwner && !hasManagerRole(actor)) {
    throw new ForbiddenError('You do not have permission to view this loan.');
  }
}

// ---------------------------------------------------------------------------
// API shape helpers
// ---------------------------------------------------------------------------

/**
 * Convert `_id` ObjectId to string and stringify nested ObjectId refs.
 */
function loanRequestToApiShape(doc: WithId<LoanRequest>): Record<string, unknown> {
  return {
    ...doc,
    _id: String(doc._id),
  };
}

/**
 * Convert Loan document to API shape + add computed `isOverdue` field.
 * OVERDUE is never persisted to DB — always computed on read.
 */
function loanToApiShape(doc: WithId<Loan>): Record<string, unknown> {
  const isOverdue = doc.status === 'ACTIVE' && new Date().toISOString() > doc.dueAt;
  return {
    ...doc,
    _id: String(doc._id),
    isOverdue,
  };
}

function paginatedResponse<T>(
  data: T[],
  total: number,
  limit: number,
  skip: number,
): PaginatedResponse<T> {
  return {
    data,
    pagination: { total, limit, skip, hasMore: skip + data.length < total },
  };
}

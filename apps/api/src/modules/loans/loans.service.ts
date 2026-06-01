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

import { ObjectId } from 'mongodb';

import { BadRequestError, ForbiddenError, NotFoundError } from '../../plugins/error-handler.js';

import type { LoanRequestsRepository } from './loan-requests.repository.js';
import type { LoansRepository, LoanPatch } from './loans.repository.js';
import type { EmailService } from '../../plugins/email.js';
import type { AssetsRepository } from '../assets/assets.repository.js';
import type { AuditLogService } from '../audit/audit.service.js';
import type {
  AssetStatus,
  CreateDirectLoanInput,
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
import type { Db, ClientSession, MongoClient, WithId } from 'mongodb';

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
    private readonly emailService: EmailService | null = null,
    private readonly frontendUrl: string = 'https://app.inventario.estate',
    /**
     * Tenant database handle. MUST be the same Db the repositories use
     * (fastify.mongo.db). Do NOT fall back to `mongoClient.db()` without
     * a name — that returns the URI default DB, which differs from the
     * test DB and breaks cross-collection lookups (users, memberships).
     */
    private readonly db: Db | null = null,
  ) {}

  /** Resolve the tenant Db handle, preferring the injected one. */
  private getDb(): Db {
    return this.db ?? (this.mongoClient.db() as Db);
  }

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

    // Employees see requests where they are requester OR beneficiary (ADR-0023).
    const actorId = String(actor._id);

    const { items, total } = await this.loanRequestsRepo.list({
      organisationId: tenantId,
      ...(params.status !== undefined && { status: params.status }),
      // ADR-0023: EMPLOYEE sees requests where requesterId === self OR beneficiaryId === self
      ...(isManager
        ? params.requesterId !== undefined && { requesterId: params.requesterId }
        : { requesterId: actorId, beneficiaryId: actorId }),
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
      // beneficiaryId: ak niet v inpute, default = requesterId (žiadosť pre seba)
      const beneficiaryId = input.beneficiaryId ?? actorId;

      // Validácia beneficiára: musí byť aktívny používateľ v tom istom tenante
      if (beneficiaryId !== actorId) {
        const usersCol = this.getDb().collection('users');
        const beneficiary = await usersCol.findOne(
          { _id: new ObjectId(beneficiaryId) as never, deletedAt: null, isActive: true },
          { session },
        );
        if (!beneficiary) {
          throw new BadRequestError(
            `Beneficiary user '${beneficiaryId}' does not exist or is not active.`,
          );
        }
        // Cross-tenant check: membership alebo user.organisationId musí byť v tomto tenante
        const membershipsCol = this.getDb().collection('memberships');
        const membership = await membershipsCol.findOne(
          { userId: beneficiaryId, organisationId: tenantId, status: 'ACTIVE', deletedAt: null },
          { session },
        );
        const legacyOrgMatch = String(beneficiary['organisationId']) === tenantId;
        if (!membership && !legacyOrgMatch) {
          throw new BadRequestError(
            `Beneficiary user '${beneficiaryId}' is not a member of this organisation.`,
          );
        }
      }

      const loanRequestDoc: Omit<LoanRequest, '_id'> = {
        organisationId: tenantId,
        requesterId: actorId,
        beneficiaryId,
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

    // Fire-and-forget email to managers (after transaction)
    void this.notifyManagersNewRequest(
      tenantId,
      String(created._id),
      actor.displayName,
      created.purpose,
      created.items.length,
      created.plannedFrom,
      created.plannedTo,
      request.log,
    );

    return loanRequestToApiShape(created);
  }

  // Fire-and-forget email to managers — after transaction commits
  private async notifyManagersNewRequest(
    tenantId: string,
    requestId: string,
    requesterName: string,
    purpose: string,
    itemCount: number,
    plannedFrom: string,
    plannedTo: string | null,
    logger: { warn: (msg: object, txt: string) => void },
  ): Promise<void> {
    if (!this.emailService?.isConfigured) return;
    try {
      // Find all ASSET_MANAGER + ADMIN users in this tenant
      const membershipsCol = this.getDb().collection('memberships');
      const managers = await membershipsCol
        .find({
          organisationId: tenantId,
          status: 'ACTIVE',
          deletedAt: null,
          roles: { $in: ['ASSET_MANAGER', 'ADMIN'] },
        })
        .toArray();

      const usersCol = this.getDb().collection('users');
      for (const m of managers) {
        const user = await usersCol.findOne({ _id: m['userId'] as never, deletedAt: null });
        if (user?.['email']) {
          await this.emailService.sendLoanRequestPendingEmail(user['email'] as string, {
            requesterName,
            purpose,
            itemCount,
            plannedFrom,
            plannedTo,
            requestId,
            frontendUrl: this.frontendUrl,
          });
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to send loan request pending email to managers');
    }
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
      // borrowerId = beneficiaryId (ADR-0023): kto si požičiava, nie kto žiadal
      const loanDoc: Omit<Loan, '_id'> = {
        organisationId: tenantId,
        requestId: id,
        borrowerId: String(loanRequest.beneficiaryId ?? loanRequest.requesterId),
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

    // Fire-and-forget: notify requester of approval
    void this.notifyRequesterApproved(
      String(loan.borrowerId),
      loan.purpose,
      loan.items.length,
      loan.dueAt,
      request.log,
    );

    return loanToApiShape(loan);
  }

  // Helper: notify requester of approval
  private async notifyRequesterApproved(
    requesterId: string,
    purpose: string,
    itemCount: number,
    dueAt: string | null,
    logger: { warn: (msg: object, txt: string) => void },
  ): Promise<void> {
    if (!this.emailService?.isConfigured) return;
    try {
      const usersCol = this.getDb().collection('users');
      const user = await usersCol.findOne({ _id: requesterId as never, deletedAt: null });
      if (user?.['email']) {
        await this.emailService.sendLoanApprovedEmail(user['email'] as string, {
          requesterName: (user['displayName'] as string) || (user['email'] as string),
          purpose,
          itemCount,
          dueAt,
          frontendUrl: this.frontendUrl,
        });
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to send loan approved email');
    }
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

    // Fire-and-forget: notify requester of rejection
    if (this.emailService?.isConfigured) {
      void (async () => {
        try {
          const usersCol = this.getDb().collection('users');
          const lr = await this.loanRequestsRepo.findById(tenantId, id);
          if (lr) {
            const u = await usersCol.findOne({ _id: lr.requesterId as never, deletedAt: null });
            if (u?.['email'] && this.emailService) {
              await this.emailService.sendLoanRejectedEmail(u['email'] as string, {
                requesterName: (u['displayName'] as string) || (u['email'] as string),
                purpose: lr.purpose,
                reason,
                frontendUrl: this.frontendUrl,
              });
            }
          }
        } catch (err) {
          request.log.warn({ err }, 'Failed to send loan rejected email');
        }
      })();
    }
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
   * Create a direct loan without a prior request (ADR-0023 — quick loan, US-017).
   *
   * ASSET_MANAGER or ADMIN only (enforced in routes).
   * Asset goes directly AVAILABLE → BORROWED without RESERVED intermediate.
   * requestId = null on the resulting Loan.
   */
  async createDirectLoan(
    input: CreateDirectLoanInput,
    actor: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    const tenantId = String(actor.organisationId);
    const actorId = String(actor._id);
    const now = new Date().toISOString();

    const loan = await this.runInTransaction(async (session) => {
      // ----- Step 1: validate borrower — must be active member of this tenant -----
      const borrowerId = input.borrowerId;
      const usersCol = this.getDb().collection('users');
      const borrowerDoc = await usersCol.findOne(
        { _id: new ObjectId(borrowerId) as never, deletedAt: null, isActive: true },
        { session },
      );
      if (!borrowerDoc) {
        throw new BadRequestError(`Borrower user '${borrowerId}' does not exist or is not active.`);
      }
      const membershipsCol = this.getDb().collection('memberships');
      const membership = await membershipsCol.findOne(
        { userId: borrowerId, organisationId: tenantId, status: 'ACTIVE', deletedAt: null },
        { session },
      );
      const legacyOrgMatch = String(borrowerDoc['organisationId']) === tenantId;
      if (!membership && !legacyOrgMatch) {
        throw new BadRequestError(
          `Borrower user '${borrowerId}' is not a member of this organisation.`,
        );
      }

      // ----- Step 2: validate and snapshot every asset -----
      const loanItems: LoanItem[] = [];

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
        loanItems.push({
          assetId: item.assetId,
          snapshot: { inventoryNumber: asset.inventoryNumber, name: asset.name },
          condition: {
            atPickup: { condition: 'GOOD' as const, note: null, photoIds: [] },
            atReturn: null,
          },
        });
      }

      // ----- Step 3: create Loan document (requestId = null) -----
      const loanDoc: Omit<Loan, '_id'> = {
        organisationId: tenantId,
        requestId: null,
        borrowerId,
        purpose: input.purpose,
        pickedUpAt: now,
        handedOverBy: actorId,
        dueAt: input.dueAt,
        returnedAt: null,
        returnedTo: null,
        items: loanItems,
        status: 'ACTIVE' as LoanStatus,
        extensionCount: 0,
        handoverProtocolId: null,
        returnProtocolId: null,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
        deletedAt: null,
        deletedBy: null,
      };

      const insertedLoan = await this.loansRepo.insert(loanDoc, session);
      const loanId = String(insertedLoan._id);

      // ----- Step 4: assets AVAILABLE → BORROWED (no RESERVED step) -----
      for (const item of loanItems) {
        const updated = await this.assetsRepo.update(
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
        if (!updated) {
          throw new BadRequestError(
            `Asset ${item.assetId} could not be borrowed — it may have just been modified. Please try again.`,
          );
        }
      }

      // ----- Step 5: audit log -----
      await this.auditLog.record(
        actor,
        request,
        {
          action: 'LOAN_CREATED_DIRECT',
          target: {
            entityType: 'Loan',
            entityId: loanId,
            snapshot: { borrowerId, dueAt: input.dueAt, itemCount: loanItems.length },
          },
          description: `Direct loan created for ${loanItems.length} asset(s), due ${input.dueAt}. Handed over by ${actor.displayName}.`,
        },
        session,
      );

      return insertedLoan;
    });

    return loanToApiShape(loan);
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
  const actorId = String(actor._id);
  const isRequester = String(doc.requesterId) === actorId;
  // ADR-0023: beneficiary can also read the request (someone applied on their behalf)
  const isBeneficiary = doc.beneficiaryId != null && String(doc.beneficiaryId) === actorId;
  if (!isRequester && !isBeneficiary && !hasManagerRole(actor)) {
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
  // ADR-0025: open-ended výpožička (dueAt === null) nikdy nie je OVERDUE
  const isOverdue =
    doc.status === 'ACTIVE' && doc.dueAt != null && new Date().toISOString() > doc.dueAt;
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

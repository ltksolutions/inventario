// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * LoansService — business logic for the loan request + loan lifecycle.
 *
 * State machine summary (ADR-0026):
 *
 *   LoanRequest: PENDING → APPROVED → PARTIALLY_FULFILLED → FULFILLED / CLOSED
 *                PENDING → REJECTED
 *                PENDING → CANCELLED
 *
 *   Loan (created by fulfil, not approve):
 *     ACTIVE → RETURNED | DAMAGED | LOST
 *
 * Key ADR-0026 changes vs ADR-0012:
 *   - createLoanRequest   — NO reservation (katalógová žiadosť, nedrží zásobu)
 *   - approveLoanRequest  — ONLY status change PENDING → APPROVED, NO Loan created
 *   - fulfilLoanRequest   — NEW: maps category+quantity → assets, creates Loan,
 *                           increments quantityFulfilled, recomputes request status
 *   - reject / cancel     — NO reservation release (nič nebolo rezervované)
 *
 * OVERDUE is NOT a persistent DB status — computed field on GET.
 *
 * K4 (ADR-0022): protokoly vznikajú v transakciách fulfil/createDirectLoan/return.
 *   `protocolsRepo` je optional — ak nie je nakonfigurovaný, protokoly sa preskočia
 *   (spätná kompatibilita so starými testami). Routes (K5) ho vždy poskytnú.
 */

import { roleSatisfies } from '@inventario/shared-types';
import { ObjectId } from 'mongodb';

import { BadRequestError, ForbiddenError, NotFoundError } from '../../plugins/error-handler.js';
import { generateProtocolNumber } from '../protocols/protocol-number.js';

import type { LoanRequestsRepository } from './loan-requests.repository.js';
import type { LoansRepository, LoanPatch } from './loans.repository.js';
import type { EmailService } from '../../plugins/email.js';
import type { AssetsRepository } from '../assets/assets.repository.js';
import type { AuditLogService } from '../audit/audit.service.js';
import type { LoanProtocolsRepository } from '../protocols/loan-protocols.repository.js';
import type {
  AssetStatus,
  CreateDirectLoanInput,
  FulfilLoanRequestInput,
  Loan,
  LoanItem,
  LoanProtocol,
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

export interface CreateCatalogLoanRequestInput {
  purpose: string;
  plannedFrom: string;
  plannedTo?: string | null | undefined;
  items: Array<{
    categoryId: string;
    quantityRequested: number;
    note?: string | null | undefined;
  }>;
  idempotencyKey?: string | null | undefined;
  beneficiaryId?: string | undefined;
}

export interface ListLoanRequestsServiceParams {
  status?: LoanRequestStatus;
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
    /**
     * K4 (ADR-0022): optional — ak nie je, protokoly sa preskočia.
     * Routes (K5) vždy poskytnú inštanciu.
     */
    private protocolsRepo: LoanProtocolsRepository | null = null,
  ) {}

  /**
   * Umožňuje protokolom plugin-u injektnúť repo po vytvorení service.
   * Volá `protocols-routes` plugin (K5) — service je dekorovaný pred protokolmi.
   */
  setProtocolsRepo(repo: LoanProtocolsRepository): void {
    this.protocolsRepo = repo;
  }

  private getDb(): Db {
    return this.db ?? (this.mongoClient.db() as Db);
  }

  // -------------------------------------------------------------------------
  // Read paths
  // -------------------------------------------------------------------------

  async listLoanRequests(
    params: ListLoanRequestsServiceParams,
    actor: WithId<User>,
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    const tenantId = String(actor.organisationId);
    const isManager = hasManagerRole(actor);
    const limit = params.limit ?? 20;
    const skip = params.skip ?? 0;
    const actorId = String(actor._id);

    const { items, total } = await this.loanRequestsRepo.list({
      organisationId: tenantId,
      ...(params.status !== undefined && { status: params.status }),
      ...(isManager
        ? params.requesterId !== undefined && { requesterId: params.requesterId }
        : { requesterId: actorId, beneficiaryId: actorId }),
      limit,
      skip,
    });

    return paginatedResponse(items.map(loanRequestToApiShape), total, limit, skip);
  }

  async getLoanRequestById(id: string, actor: WithId<User>): Promise<Record<string, unknown>> {
    const tenantId = String(actor.organisationId);
    const doc = await this.loanRequestsRepo.findById(tenantId, id);
    if (!doc) throw new NotFoundError('LoanRequest', id);
    assertCanReadLoanRequest(doc, actor);
    return loanRequestToApiShape(doc);
  }

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

    const nameMap = await this.buildBorrowerNameMap(items.map((l) => String(l.borrowerId)));
    return paginatedResponse(
      items.map((l) => loanToApiShape(l, nameMap.get(String(l.borrowerId)))),
      total,
      limit,
      skip,
    );
  }

  async listMyLoans(
    params: Omit<ListLoansServiceParams, 'borrowerId' | 'assetId'>,
    actor: WithId<User>,
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    return this.listLoans({ ...params, borrowerId: String(actor._id) }, actor);
  }

  async getLoanById(id: string, actor: WithId<User>): Promise<Record<string, unknown>> {
    const tenantId = String(actor.organisationId);
    const doc = await this.loansRepo.findById(tenantId, id);
    if (!doc) throw new NotFoundError('Loan', id);
    assertCanReadLoan(doc, actor);
    const nameMap = await this.buildBorrowerNameMap([String(doc.borrowerId)]);
    return loanToApiShape(doc, nameMap.get(String(doc.borrowerId)));
  }

  // -------------------------------------------------------------------------
  // Write paths
  // -------------------------------------------------------------------------

  /**
   * Create a katalógová žiadosť (ADR-0026).
   * NO asset reservation — žiadosť nedrží zásobu.
   */
  async createLoanRequest(
    input: CreateCatalogLoanRequestInput,
    actor: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    const tenantId = String(actor.organisationId);
    const actorId = String(actor._id);
    const now = new Date().toISOString();

    const beneficiaryId = input.beneficiaryId ?? actorId;
    if (beneficiaryId !== actorId) {
      await this.assertBeneficiaryIsActiveMember(tenantId, beneficiaryId);
    }

    const categoriesCol = this.getDb().collection('categories');
    const resolvedItems: LoanRequest['items'] = [];

    for (const item of input.items) {
      if (!ObjectId.isValid(item.categoryId)) {
        throw new BadRequestError(`Neplatný formát categoryId: ${item.categoryId}`);
      }
      const category = await categoriesCol.findOne({
        _id: new ObjectId(item.categoryId) as never,
        organisationId: tenantId,
        deletedAt: null,
        isActive: true,
      });
      if (!category) {
        throw new BadRequestError(
          `Kategória '${item.categoryId}' neexistuje alebo nie je aktívna.`,
        );
      }
      resolvedItems.push({
        categoryId: item.categoryId,
        categorySnapshot: {
          name: category['name'] as string,
          slug: category['slug'] as string,
        },
        quantityRequested: item.quantityRequested,
        quantityFulfilled: 0,
        note: item.note ?? null,
      });
    }

    const loanRequestDoc: Omit<LoanRequest, '_id'> = {
      organisationId: tenantId,
      requesterId: actorId,
      beneficiaryId,
      purpose: input.purpose,
      plannedFrom: input.plannedFrom,
      plannedTo: input.plannedTo ?? null,
      items: resolvedItems,
      status: 'PENDING' as LoanRequest['status'],
      approvers: [],
      resultingLoanIds: [],
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

    const created = await this.runInTransaction(async (session) => {
      const inserted = await this.loanRequestsRepo.insert(loanRequestDoc, session);

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
          description: `Katalógová žiadosť vytvorená pre ${inserted.items.length} kategóriu/í.`,
        },
        session,
      );

      return inserted;
    });

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

  /**
   * Approve a loan request (ADR-0026).
   * ONLY changes status PENDING → APPROVED. Does NOT create a Loan.
   */
  async approveLoanRequest(
    id: string,
    actor: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    const tenantId = String(actor.organisationId);
    const actorId = String(actor._id);
    const now = new Date().toISOString();

    const updated = await this.runInTransaction(async (session) => {
      const loanRequest = await this.loanRequestsRepo.findById(tenantId, id, session);
      if (!loanRequest) throw new NotFoundError('LoanRequest', id);
      if (loanRequest.status !== 'PENDING') {
        throw new BadRequestError(
          `Žiadosť nemožno schváliť — aktuálny stav je ${loanRequest.status}. Schváliť možno len PENDING žiadosti.`,
        );
      }

      const result = await this.loanRequestsRepo.update(
        tenantId,
        id,
        { status: 'APPROVED' as LoanRequestStatus, updatedAt: now, updatedBy: actorId },
        session,
      );
      if (!result) throw new NotFoundError('LoanRequest', id);

      await this.auditLog.record(
        actor,
        request,
        {
          action: 'LOAN_REQUEST_APPROVED',
          target: {
            entityType: 'LoanRequest',
            entityId: id,
            snapshot: { approvedBy: actorId, itemCount: loanRequest.items.length },
          },
          description: `Žiadosť schválená správcom ${actor.displayName} — čaká na vydanie.`,
        },
        session,
      );

      return result;
    });

    return loanRequestToApiShape(updated);
  }

  /**
   * Fulfil a loan request — the actual handout (ADR-0026).
   * K4: HANDOVER protokol vzniká v tej istej transakcii (ADR-0022).
   */
  async fulfilLoanRequest(
    id: string,
    input: FulfilLoanRequestInput,
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

      if (loanRequest.status !== 'APPROVED' && loanRequest.status !== 'PARTIALLY_FULFILLED') {
        throw new BadRequestError(
          `Vydanie nie je možné — žiadosť je v stave ${loanRequest.status}. ` +
            `Vydávať možno len APPROVED alebo PARTIALLY_FULFILLED žiadosti.`,
        );
      }

      // ----- Step 2: build Loan items + validate assets -----
      const loanItems: LoanItem[] = [];
      const itemIncrements: Array<{ index: number; delta: number }> = [];

      for (const fulfilItem of input.items) {
        const reqItem = loanRequest.items[fulfilItem.requestItemIndex];
        if (!reqItem) {
          throw new BadRequestError(
            `requestItemIndex ${fulfilItem.requestItemIndex} neexistuje v tejto žiadosti.`,
          );
        }

        const remaining = reqItem.quantityRequested - reqItem.quantityFulfilled;
        const issuingQty =
          fulfilItem.type === 'SERIALIZED' ? fulfilItem.assetIds.length : fulfilItem.quantity;

        if (issuingQty > remaining) {
          throw new BadRequestError(
            `Položka ${fulfilItem.requestItemIndex}: vydávate ${issuingQty}, ale zostatok je len ${remaining}.`,
          );
        }

        if (fulfilItem.type === 'SERIALIZED') {
          for (const assetId of fulfilItem.assetIds) {
            const asset = await this.assetsRepo.findById(tenantId, assetId, session);
            if (!asset) {
              throw new BadRequestError(`Asset '${assetId}' neexistuje alebo nie je dostupný.`);
            }
            if (!asset.isLoanable) {
              throw new BadRequestError(
                `Asset ${asset.inventoryNumber} (${asset.name}) nie je požičiavateľný.`,
              );
            }
            if (asset.status !== 'AVAILABLE') {
              throw new BadRequestError(
                `Asset ${asset.inventoryNumber} (${asset.name}) nie je dostupný (stav: ${asset.status}).`,
              );
            }
            loanItems.push({
              assetId,
              snapshot: { inventoryNumber: asset.inventoryNumber, name: asset.name },
              condition: {
                atPickup: { condition: 'GOOD' as const, note: null, photoIds: [] },
                atReturn: null,
              },
            });
          }
        } else {
          loanItems.push({
            assetId: fulfilItem.bulkItemId,
            snapshot: { inventoryNumber: '', name: reqItem.categorySnapshot.name },
            condition: {
              atPickup: { condition: 'GOOD' as const, note: null, photoIds: [] },
              atReturn: null,
            },
          });
        }

        itemIncrements.push({ index: fulfilItem.requestItemIndex, delta: issuingQty });
      }

      // ----- Step 3: create Loan -----
      const borrowerId = String(loanRequest.beneficiaryId ?? loanRequest.requesterId);
      const loanDoc: Omit<Loan, '_id'> = {
        organisationId: tenantId,
        requestId: id,
        borrowerId,
        purpose: loanRequest.purpose,
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

      // ----- Step 4: asset state changes -----
      for (const fulfilItem of input.items) {
        if (fulfilItem.type === 'SERIALIZED') {
          for (const assetId of fulfilItem.assetIds) {
            await this.assetsRepo.update(
              tenantId,
              assetId,
              {
                status: 'BORROWED' as AssetStatus,
                currentLoanId: loanId,
                updatedAt: now,
                updatedBy: actorId,
              },
              session,
            );
          }
        }
      }

      // ----- Step 4b: HANDOVER protokol (ADR-0022 K4) -----
      const handoverProtocolId = await this.insertDraftProtocol(
        'HANDOVER',
        loanId,
        tenantId,
        actorId,
        now,
        loanItems,
        actorId,
        { displayName: actor.displayName, email: actor.email ?? '', organizationalUnit: null },
        borrowerId,
        { displayName: '', email: '', organizationalUnit: null },
        'A4',
        session,
      );

      if (handoverProtocolId) {
        await this.loansRepo.update(
          tenantId,
          loanId,
          { handoverProtocolId, updatedAt: now, updatedBy: actorId },
          session,
        );
      }

      // ----- Step 5: increment quantityFulfilled + push loanId -----
      let updatedRequest: WithId<LoanRequest> | null = null;
      for (const inc of itemIncrements) {
        updatedRequest = await this.loanRequestsRepo.incrementItemFulfilled(
          tenantId,
          id,
          inc.index,
          inc.delta,
          loanId,
          now,
          actorId,
          session,
        );
      }

      // ----- Step 6: recompute request status -----
      const freshRequest =
        updatedRequest ?? (await this.loanRequestsRepo.findById(tenantId, id, session));
      if (!freshRequest) throw new NotFoundError('LoanRequest', id);

      const allFulfilled = freshRequest.items.every(
        (i) => i.quantityFulfilled >= i.quantityRequested,
      );

      let newStatus: LoanRequestStatus;
      if (allFulfilled) {
        newStatus = 'FULFILLED' as LoanRequestStatus;
      } else if (input.closeRemainder) {
        newStatus = 'CLOSED' as LoanRequestStatus;
      } else {
        newStatus = 'PARTIALLY_FULFILLED' as LoanRequestStatus;
      }

      await this.loanRequestsRepo.update(
        tenantId,
        id,
        { status: newStatus, updatedAt: now, updatedBy: actorId },
        session,
      );

      // ----- Step 7: audit log -----
      await this.auditLog.record(
        actor,
        request,
        {
          action: 'LOAN_REQUEST_FULFILLED',
          target: {
            entityType: 'LoanRequest',
            entityId: id,
            snapshot: { loanId, newRequestStatus: newStatus, issuedItemCount: loanItems.length },
          },
          description: `Vydanie z žiadosti — Loan ${loanId} vytvorený, stav žiadosti: ${newStatus}.`,
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
            snapshot: { borrowerId, dueAt: loanDoc.dueAt, itemCount: loanItems.length },
          },
          description: `Loan ${loanId} vytvorený — ${loanItems.length} kus/ov odovzdaných, splatnosť ${loanDoc.dueAt ?? 'do odvolania'}.`,
        },
        session,
      );

      return insertedLoan;
    });

    this.notifyProtocolToSign('HANDOVER', String(loan._id), String(loan.borrowerId), request);

    return loanToApiShape(loan);
  }

  /**
   * Reject a loan request. Only from PENDING.
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
          `Žiadosť nemožno zamietnuť — aktuálny stav je ${loanRequest.status}.`,
        );
      }

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
          target: { entityType: 'LoanRequest', entityId: id, snapshot: { reason } },
          description: `Žiadosť zamietnutá. Dôvod: ${reason}`,
        },
        session,
      );
    });

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
   * Cancel a loan request. Only requester or ADMIN. Only from PENDING.
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
          `Žiadosť nemožno zrušiť — aktuálny stav je ${loanRequest.status}.`,
        );
      }

      const isOwner = String(loanRequest.requesterId) === actorId;
      const isAdmin = (actor as { role?: string }).role === 'ADMIN';
      if (!isOwner && !isAdmin) {
        throw new ForbiddenError('Žiadosť môže zrušiť len jej autor alebo ADMIN.');
      }

      await this.loanRequestsRepo.update(
        tenantId,
        id,
        { status: 'CANCELLED' as LoanRequestStatus, updatedAt: now, updatedBy: actorId },
        session,
      );

      await this.auditLog.record(
        actor,
        request,
        {
          action: 'LOAN_REQUEST_CANCELLED',
          target: { entityType: 'LoanRequest', entityId: id, snapshot: { cancelledBy: actorId } },
          description: `Žiadosť zrušená používateľom ${actor.displayName}.`,
        },
        session,
      );
    });
  }

  /**
   * Create a direct loan without a prior request (ADR-0023).
   * K4: HANDOVER protokol vzniká v tej istej transakcii (ADR-0022).
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
      await this.assertBeneficiaryIsActiveMember(tenantId, input.borrowerId, session);

      const loanItems: LoanItem[] = [];

      for (const item of input.items) {
        const asset = await this.assetsRepo.findById(tenantId, item.assetId, session);
        if (!asset) {
          throw new BadRequestError(`Asset '${item.assetId}' neexistuje alebo nie je dostupný.`);
        }
        if (!asset.isLoanable) {
          throw new BadRequestError(
            `Asset ${asset.inventoryNumber} (${asset.name}) nie je požičiavateľný.`,
          );
        }
        if (asset.status !== 'AVAILABLE') {
          throw new BadRequestError(
            `Asset ${asset.inventoryNumber} (${asset.name}) nie je dostupný (stav: ${asset.status}).`,
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

      const loanDoc: Omit<Loan, '_id'> = {
        organisationId: tenantId,
        requestId: null,
        borrowerId: input.borrowerId,
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
            `Asset '${item.assetId}' sa nepodarilo rezervovať — bol práve zmenený. Skús znova.`,
          );
        }
      }

      // HANDOVER protokol (ADR-0022 K4)
      const handoverProtocolId = await this.insertDraftProtocol(
        'HANDOVER',
        loanId,
        tenantId,
        actorId,
        now,
        loanItems,
        actorId,
        { displayName: actor.displayName, email: actor.email ?? '', organizationalUnit: null },
        input.borrowerId,
        { displayName: '', email: '', organizationalUnit: null },
        'A4',
        session,
      );

      if (handoverProtocolId) {
        await this.loansRepo.update(
          tenantId,
          loanId,
          { handoverProtocolId, updatedAt: now, updatedBy: actorId },
          session,
        );
      }

      await this.auditLog.record(
        actor,
        request,
        {
          action: 'LOAN_CREATED_DIRECT',
          target: {
            entityType: 'Loan',
            entityId: loanId,
            snapshot: {
              borrowerId: input.borrowerId,
              dueAt: input.dueAt,
              itemCount: loanItems.length,
            },
          },
          description: `Priama výpožička vytvorená pre ${loanItems.length} kus/ov, splatnosť ${input.dueAt ?? 'do odvolania'}.`,
        },
        session,
      );

      return insertedLoan;
    });

    this.notifyProtocolToSign('HANDOVER', String(loan._id), String(loan.borrowerId), request);
    void this.notifyDirectLoanCreated(loan, request);

    return loanToApiShape(loan);
  }

  /**
   * Return a loan. ASSET_MANAGER or ADMIN only.
   * K4: RETURN protokol vzniká v tej istej transakcii (ADR-0022).
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
        throw new BadRequestError(`Loan nemožno vrátiť — aktuálny stav je ${loan.status}.`);
      }

      const returnItemMap = new Map(returnInput.items.map((i) => [i.assetId, i]));
      for (const loanItem of loan.items) {
        if (!returnItemMap.has(loanItem.assetId)) {
          throw new BadRequestError(
            `Chýba vrátenie pre asset ${loanItem.assetId} (${loanItem.snapshot.inventoryNumber}).`,
          );
        }
      }

      let anyRequiresService = false;
      const updatedItems: LoanItem[] = [];

      for (const loanItem of loan.items) {
        const returnItemData = returnItemMap.get(loanItem.assetId)!;
        const requiresService = returnItemData.requiresService ?? false;
        if (requiresService) anyRequiresService = true;

        const newAssetStatus: AssetStatus = requiresService ? 'IN_SERVICE' : 'AVAILABLE';
        await this.assetsRepo.update(
          tenantId,
          loanItem.assetId,
          { status: newAssetStatus, currentLoanId: null, updatedAt: now, updatedBy: actorId },
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

      // RETURN protokol (ADR-0022 K4)
      const returnProtocolId = await this.insertDraftProtocol(
        'RETURN',
        id,
        tenantId,
        actorId,
        now,
        loan.items,
        loan.borrowerId, // pri vrátení: odovzdávajúci = borrower
        { displayName: '', email: '', organizationalUnit: null },
        actorId, // preberajúci = správca (actor)
        { displayName: actor.displayName, email: actor.email ?? '', organizationalUnit: null },
        'A4',
        session,
      );

      if (returnProtocolId) {
        await this.loansRepo.update(
          tenantId,
          id,
          { returnProtocolId, updatedAt: now, updatedBy: actorId },
          session,
        );
      }

      await this.auditLog.record(
        actor,
        request,
        {
          action: 'LOAN_RETURNED',
          target: {
            entityType: 'Loan',
            entityId: id,
            snapshot: { terminalStatus, returnedAt: now },
          },
          description:
            terminalStatus === 'DAMAGED'
              ? `Loan vrátený s poškodením — ${updatedItems.filter((i) => i.condition.atReturn?.requiresService).length} kus/ov vyžaduje servis.`
              : `Loan vrátený v poriadku — ${loan.items.length} kus/ov.`,
          severity: anyRequiresService ? 'WARNING' : 'INFO',
        },
        session,
      );

      return updatedLoan;
    });

    this.notifyProtocolToSign('RETURN', id, String(updated.borrowerId), request);

    return loanToApiShape(updated);
  }

  /**
   * Mark a loan as lost. ASSET_MANAGER or ADMIN only.
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
        throw new BadRequestError(`Loan nie je aktívny (stav: ${loan.status}).`);
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
        { status: 'LOST' as LoanStatus, updatedAt: now, updatedBy: actorId },
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
          description: `Loan označený ako stratený (${loan.items.length} kus/ov). Dôvod: ${reason}`,
          severity: 'WARNING',
        },
        session,
      );
    });
  }

  /**
   * Dodatočné vytvorenie protokolu pre existujúcu výpožičku (backfill).
   *
   * Použitie: staršie výpožičky vznikli pred ADR-0022 K4 a nemajú
   * HANDOVER/RETURN protokol. ASSET_MANAGER/ADMIN ho môže vytvoriť
   * dodatočne — protokol vznikne v stave DRAFT a prejde štandardným
   * CLICK_TO_SIGN flow.
   *
   * Pravidlá:
   *   - HANDOVER: len ak `loan.handoverProtocolId` je null.
   *   - RETURN:   len ak `loan.returnProtocolId` je null a loan je už vrátený.
   *
   * Na rozdiel od K4 (fulfil tx) tu máme čas na user lookupy — snapshoty
   * strán sa naplnia reálnymi menami hneď pri vzniku.
   */
  async createProtocolForLoan(
    loanId: string,
    type: 'HANDOVER' | 'RETURN',
    actor: WithId<User>,
    request: FastifyRequest,
  ): Promise<string> {
    const tenantId = String(actor.organisationId);
    const actorId = String(actor._id);
    const now = new Date().toISOString();

    if (!this.protocolsRepo) {
      throw new BadRequestError('Protokoly nie sú na tomto serveri nakonfigurované.');
    }

    return this.runInTransaction(async (session) => {
      const loan = await this.loansRepo.findById(tenantId, loanId, session);
      if (!loan) throw new NotFoundError('Loan', loanId);

      if (type === 'HANDOVER' && loan.handoverProtocolId) {
        throw new BadRequestError('Výpožička už má preberací protokol.');
      }
      if (type === 'RETURN') {
        if (loan.returnProtocolId) {
          throw new BadRequestError('Výpožička už má protokol o vrátení.');
        }
        if (loan.returnedAt == null) {
          throw new BadRequestError('Protokol o vrátení možno vytvoriť až po vrátení výpožičky.');
        }
      }

      const borrowerSnapshot = await this.loadPartySnapshot(loan.borrowerId, session);

      let handoverUserId: string;
      let handoverSnapshot: LoanProtocol['parties']['handover']['snapshot'];
      let receiveUserId: string;
      let receiveSnapshot: LoanProtocol['parties']['receive']['snapshot'];

      if (type === 'HANDOVER') {
        handoverUserId = String(loan.handedOverBy);
        handoverSnapshot = await this.loadPartySnapshot(handoverUserId, session);
        receiveUserId = String(loan.borrowerId);
        receiveSnapshot = borrowerSnapshot;
      } else {
        handoverUserId = String(loan.borrowerId);
        handoverSnapshot = borrowerSnapshot;
        receiveUserId = String(loan.returnedTo ?? actorId);
        receiveSnapshot = await this.loadPartySnapshot(receiveUserId, session);
      }

      const newProtocolId = await this.insertDraftProtocol(
        type,
        loanId,
        tenantId,
        actorId,
        now,
        loan.items,
        handoverUserId,
        handoverSnapshot,
        receiveUserId,
        receiveSnapshot,
        'A4',
        session,
      );
      if (!newProtocolId) {
        throw new BadRequestError('Protokol sa nepodarilo vytvoriť.');
      }

      await this.loansRepo.update(
        tenantId,
        loanId,
        type === 'HANDOVER'
          ? { handoverProtocolId: newProtocolId, updatedAt: now, updatedBy: actorId }
          : { returnProtocolId: newProtocolId, updatedAt: now, updatedBy: actorId },
        session,
      );

      await this.auditLog.record(
        actor,
        request,
        {
          action: 'LOAN_PROTOCOL_CREATED',
          target: {
            entityType: 'Loan',
            entityId: loanId,
            snapshot: { protocolId: newProtocolId, protocolType: type },
          },
          description:
            type === 'HANDOVER'
              ? 'Dodatočne vytvorený preberací protokol k výpožičke.'
              : 'Dodatočne vytvorený protokol o vrátení k výpožičke.',
        },
        session,
      );

      return newProtocolId;
    });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Načíta snapshot strany protokolu z users collection.
   * Chýbajúci/neplatný user → prázdny snapshot (rovnaký fallback ako K4).
   */
  private async loadPartySnapshot(
    userId: string,
    session?: ClientSession,
  ): Promise<LoanProtocol['parties']['handover']['snapshot']> {
    const empty = { displayName: '', email: '', organizationalUnit: null };
    if (!ObjectId.isValid(userId)) return empty;

    const doc = await this.getDb()
      .collection('users')
      .findOne({ _id: new ObjectId(userId) as never }, session ? { session } : undefined);
    if (!doc) return empty;

    return {
      displayName: (doc['displayName'] as string | undefined) ?? '',
      email: (doc['email'] as string | undefined) ?? '',
      organizationalUnit: null,
    };
  }

  /**
   * Fire-and-forget: pošle e-mail borrowerovi o protokole na podpis.
   * Zlyhanie sa len zaloguje — neovplyvní hlavnú operáciu.
   */
  private notifyProtocolToSign(
    protocolType: 'HANDOVER' | 'RETURN',
    loanId: string,
    borrowerId: string,
    request: FastifyRequest,
  ): void {
    if (!this.emailService?.isConfigured) return;
    void (async () => {
      try {
        const usersCol = this.getDb().collection('users');
        const borrower = await usersCol.findOne({
          _id: ObjectId.isValid(borrowerId)
            ? (new ObjectId(borrowerId) as never)
            : (borrowerId as never),
          deletedAt: null,
        });
        if (borrower?.['email']) {
          await this.emailService!.sendProtocolToSignEmail(borrower['email'] as string, {
            recipientName: (borrower['displayName'] as string) || (borrower['email'] as string),
            protocolType,
            loanId,
            frontendUrl: this.frontendUrl,
          });
        }
      } catch (err) {
        request.log.warn({ err }, 'Failed to send protocol-to-sign email');
      }
    })();
  }

  /**
   * Fire-and-forget: pošle e-mail borrowerovi o novej priamej výpožičke.
   * Zlyhanie sa len zaloguje — neovplyvní hlavnú operáciu.
   */
  private notifyDirectLoanCreated(loan: WithId<Loan>, request: FastifyRequest): void {
    if (!this.emailService?.isConfigured) return;
    void (async () => {
      try {
        const usersCol = this.getDb().collection('users');
        const borrowerId = String(loan.borrowerId);
        const borrower = await usersCol.findOne({
          _id: ObjectId.isValid(borrowerId)
            ? (new ObjectId(borrowerId) as never)
            : (borrowerId as never),
          deletedAt: null,
        });
        if (borrower?.['email']) {
          await this.emailService!.sendDirectLoanCreatedEmail(borrower['email'] as string, {
            borrowerName: (borrower['displayName'] as string) || (borrower['email'] as string),
            purpose: loan.purpose,
            itemCount: loan.items.length,
            dueAt: loan.dueAt,
            loanId: String(loan._id),
            frontendUrl: this.frontendUrl,
          });
        }
      } catch (err) {
        request.log.warn({ err }, 'Failed to send direct-loan-created email');
      }
    })();
  }

  /**
   * Vloží DRAFT LoanProtocol do transakcie (ADR-0022 K4).
   * Ak `protocolsRepo` nie je nastavený, ticho vráti null.
   */
  private async insertDraftProtocol(
    type: LoanProtocol['type'],
    loanId: string,
    tenantId: string,
    actorId: string,
    now: string,
    loanItems: LoanItem[],
    handoverUserId: string,
    handoverSnapshot: LoanProtocol['parties']['handover']['snapshot'],
    receiveUserId: string,
    receiveSnapshot: LoanProtocol['parties']['receive']['snapshot'],
    paperSize: LoanProtocol['paperSize'],
    session: ClientSession,
  ): Promise<string | null> {
    if (!this.protocolsRepo) return null;

    const db = this.getDb();
    const year = new Date(now).getUTCFullYear();

    // Načítame per-tenant formát čísla protokolu z org dokumentu (read v transakcii je OK).
    const orgDoc = await db
      .collection<{
        protocolSettings?: {
          numberFormat?: { prefix: string; padding: number; initialSeq: number } | null;
        } | null;
      }>('organisations')
      .findOne(
        {
          _id: ObjectId.isValid(tenantId) ? (new ObjectId(tenantId) as never) : (tenantId as never),
        },
        { projection: { protocolSettings: 1 }, session },
      );
    const numberFormat = orgDoc?.protocolSettings?.numberFormat ?? null;

    const protocolNumber = await generateProtocolNumber(db, tenantId, session, year, numberFormat);

    const protocolItems: LoanProtocol['items'] = loanItems.map((item) => ({
      assetId: item.assetId,
      snapshot: {
        inventoryNumber: item.snapshot.inventoryNumber,
        name: item.snapshot.name,
        serialNumber: null,
        category: '',
      },
      condition: 'GOOD' as const,
      conditionNote: null,
      photoIds: [],
    }));

    const protocolDoc: Omit<LoanProtocol, '_id'> = {
      organisationId: tenantId,
      type,
      loanId,
      originalProtocolId: null,
      protocolNumber,
      issuedAt: now,
      paperSize,
      parties: {
        handover: { userId: handoverUserId, snapshot: handoverSnapshot },
        receive: { userId: receiveUserId, snapshot: receiveSnapshot },
      },
      items: protocolItems,
      notes: null,
      signatures: { handover: null, receive: null },
      pdfSha256: null,
      status: 'DRAFT',
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
      updatedBy: actorId,
    };

    const inserted = await this.protocolsRepo.insert(protocolDoc, session);
    return String(inserted._id);
  }

  /**
   * Batch-resolve borrower display names from the users collection.
   * Returns a Map<userId, displayName> for all found users.
   * Missing users (deleted, not found) are silently omitted.
   */
  private async buildBorrowerNameMap(borrowerIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(borrowerIds.filter(Boolean))];
    if (uniqueIds.length === 0) return new Map();
    const validObjectIds = uniqueIds
      .filter((id) => ObjectId.isValid(id) && String(new ObjectId(id)) === id)
      .map((id) => new ObjectId(id) as never);
    if (validObjectIds.length === 0) return new Map();
    const usersCol = this.getDb().collection('users');
    const docs = await usersCol.find({ _id: { $in: validObjectIds }, deletedAt: null }).toArray();
    const map = new Map<string, string>();
    for (const doc of docs) {
      const displayName =
        (doc['displayName'] as string | undefined) ?? (doc['email'] as string | undefined) ?? '';
      if (displayName) map.set(String(doc['_id']), displayName);
    }
    return map;
  }

  private async assertBeneficiaryIsActiveMember(
    tenantId: string,
    userId: string,
    session?: ClientSession,
  ): Promise<void> {
    const usersCol = this.getDb().collection('users');
    const userDoc = await usersCol.findOne(
      { _id: new ObjectId(userId) as never, deletedAt: null, isActive: true },
      session ? { session } : undefined,
    );
    if (!userDoc) {
      throw new BadRequestError(`Používateľ '${userId}' neexistuje alebo nie je aktívny.`);
    }
    const membershipsCol = this.getDb().collection('memberships');
    const membership = await membershipsCol.findOne(
      { userId, organisationId: tenantId, status: 'ACTIVE', deletedAt: null },
      session ? { session } : undefined,
    );
    const legacyOrgMatch = String(userDoc['organisationId']) === tenantId;
    if (!membership && !legacyOrgMatch) {
      throw new BadRequestError(`Používateľ '${userId}' nie je členom tejto organizácie.`);
    }
  }

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
      const membershipsCol = this.getDb().collection('memberships');
      const managers = await membershipsCol
        .find({
          organisationId: tenantId,
          status: 'ACTIVE',
          deletedAt: null,
          role: { $in: ['ASSET_MANAGER', 'ADMIN'] },
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
      logger.warn({ err }, 'Failed to send loan request pending email');
    }
  }

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

function hasManagerRole(actor: WithId<User> & { role?: string }): boolean {
  // ADR-0029: single role on actor (backfilled from membership). ASSET_MANAGER
  // and above (i.e. ADMIN too) satisfy the manager check via hierarchy.
  return roleSatisfies((actor.role ?? 'EMPLOYEE') as never, 'ASSET_MANAGER' as never);
}

function assertCanReadLoanRequest(doc: WithId<LoanRequest>, actor: WithId<User>): void {
  const actorId = String(actor._id);
  const isRequester = String(doc.requesterId) === actorId;
  const isBeneficiary = doc.beneficiaryId != null && String(doc.beneficiaryId) === actorId;
  if (!isRequester && !isBeneficiary && !hasManagerRole(actor)) {
    throw new ForbiddenError('Nemáš oprávnenie zobraziť túto žiadosť.');
  }
}

function assertCanReadLoan(doc: WithId<Loan>, actor: WithId<User>): void {
  const isOwner = String(doc.borrowerId) === String(actor._id);
  if (!isOwner && !hasManagerRole(actor)) {
    throw new ForbiddenError('Nemáš oprávnenie zobraziť túto výpožičku.');
  }
}

// ---------------------------------------------------------------------------
// API shape helpers
// ---------------------------------------------------------------------------

function loanRequestToApiShape(doc: WithId<LoanRequest>): Record<string, unknown> {
  return { ...doc, _id: String(doc._id) };
}

function loanToApiShape(doc: WithId<Loan>, borrowerDisplayName?: string): Record<string, unknown> {
  const isOverdue =
    doc.status === 'ACTIVE' && doc.dueAt != null && new Date().toISOString() > doc.dueAt;
  return {
    ...doc,
    _id: String(doc._id),
    isOverdue,
    borrowerDisplayName: borrowerDisplayName ?? null,
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

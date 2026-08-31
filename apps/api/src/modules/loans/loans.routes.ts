// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Loans routes — HTTP endpoints for active loan management.
 *
 * RBAC matrix:
 *   - GET  /v1/loans        EMPLOYEE+ (service limits EMPLOYEE to own loans)
 *   - GET  /v1/loans/my     EMPLOYEE+ (always self)
 *   - GET  /v1/loans/:id    EMPLOYEE+ (service checks ownership for EMPLOYEE)
 *   - POST /v1/loans/:id/return  ASSET_MANAGER, ADMIN
 *   - POST /v1/loans/:id/lost    ASSET_MANAGER, ADMIN
 *   - GET  /v1/users/:id/borrowed-items   ASSET_MANAGER, ADMIN (ADR-0036)
 *   - POST /v1/users/:id/return-items     ASSET_MANAGER, ADMIN (ADR-0036)
 *
 * IMPORTANT: /v1/loans/my must be registered BEFORE /v1/loans/:id to
 * prevent Fastify from matching the literal "my" as the :id parameter.
 *
 * Reuses `loansService` decorated onto the Fastify instance by
 * loan-requests.routes.ts (registered first in server.ts).
 *
 * Slice #5 K4.
 */

import {
  LoanStatus,
  ReturnLoanSchema,
  CreateDirectLoanSchema,
  ReturnItemsForBorrowerSchema,
} from '@inventario/shared-types';
import fp from 'fastify-plugin';
import { z } from 'zod';

import { ensureIndexesOnBoot } from '../../lib/ensure-indexes.js';

import { LoansRepository } from './loans.repository.js';

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const IdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát ID.'),
});

const PaginatedResponseSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  pagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    skip: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});

const SingleResponseSchema = z.record(z.string(), z.unknown());

/**
 * DB-persisted loan statuses only — OVERDUE is computed, not stored.
 * We accept OVERDUE as a query param but map it to an `isOverdue` filter
 * in the future (Slice #5b). For now, we exclude it from the enum.
 */
const LoanStatusQueryValues = Object.values(LoanStatus).filter((s) => s !== 'OVERDUE') as [
  string,
  ...string[],
];

const ListLoansQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(20),
  skip: z.coerce.number().int().min(0).default(0),
  status: z
    .enum(LoanStatusQueryValues)
    .optional()
    .transform(
      (v) => v as Exclude<(typeof LoanStatus)[keyof typeof LoanStatus], 'OVERDUE'> | undefined,
    ),
  /** Filter by borrower — ignored for EMPLOYEE (service forces self). */
  borrowerId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .optional(),
  /** Filter by asset — find all loans that include this asset. */
  assetId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .optional(),
});

const ListMyLoansQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(20),
  skip: z.coerce.number().int().min(0).default(0),
  status: z
    .enum(LoanStatusQueryValues)
    .optional()
    .transform(
      (v) => v as Exclude<(typeof LoanStatus)[keyof typeof LoanStatus], 'OVERDUE'> | undefined,
    ),
});

const LostBodySchema = z.object({
  reason: z.string().min(5, 'Dôvod musí mať aspoň 5 znakov.').max(1000),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const loansRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const loansRepo = new LoansRepository(fastify.mongo.db);
  await ensureIndexesOnBoot(fastify, 'loans', loansRepo);

  // Service is decorated by loan-requests.routes.ts which is registered first.
  const service = fastify.loansService;

  const canRead = fastify.requireMinRole('EMPLOYEE');
  const canWrite = fastify.requireMinRole('ASSET_MANAGER');

  // --- GET /v1/loans/my ----------------------------------------------------
  // IMPORTANT: registered before /v1/loans/:id to avoid "my" being matched as :id
  app.get(
    '/v1/loans/my',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Loans'],
        summary: 'List my active and historical loans',
        description:
          'Returns a paginated list of loans for the currently authenticated user. ' +
          'Includes `isOverdue: boolean` computed field on each loan. ' +
          'Available to any authenticated user.',
        security: [{ bearerAuth: [] }],
        querystring: ListMyLoansQuerySchema,
        response: { 200: PaginatedResponseSchema },
      },
    },
    async (request) => {
      const { limit, skip, status } = request.query;
      return service.listMyLoans({ limit, skip, ...(status && { status }) }, request.currentUser);
    },
  );

  // --- GET /v1/loans -------------------------------------------------------
  app.get(
    '/v1/loans',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Loans'],
        summary: 'List loans',
        description:
          'Returns a paginated list of loans. ' +
          'EMPLOYEE sees only their own loans. ' +
          'ASSET_MANAGER and ADMIN see all loans in the tenant, ' +
          'optionally filtered by `status`, `borrowerId`, or `assetId`. ' +
          'Each loan includes `isOverdue: boolean` computed field.',
        security: [{ bearerAuth: [] }],
        querystring: ListLoansQuerySchema,
        response: { 200: PaginatedResponseSchema },
      },
    },
    async (request) => {
      const { limit, skip, status, borrowerId, assetId } = request.query;
      return service.listLoans(
        {
          limit,
          skip,
          ...(status && { status }),
          ...(borrowerId && { borrowerId }),
          ...(assetId && { assetId }),
        },
        request.currentUser,
      );
    },
  );

  // --- GET /v1/loans/:id ---------------------------------------------------
  app.get(
    '/v1/loans/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Loans'],
        summary: 'Get a loan by ID',
        description:
          'Returns a single loan with `isOverdue: boolean` computed field. ' +
          'Accessible to the borrower or any ASSET_MANAGER / ADMIN.',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        response: { 200: SingleResponseSchema },
      },
    },
    async (request) => {
      return service.getLoanById(request.params.id, request.currentUser);
    },
  );

  // --- POST /v1/loans (direct loan without request) ------------------------
  app.post(
    '/v1/loans',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Loans'],
        summary: 'Create a direct loan (without a prior request)',
        description:
          'Creates a loan immediately, without requiring a LoanRequest. ' +
          'Asset goes directly AVAILABLE → BORROWED. ' +
          'Use for walk-in handover when the borrower is physically present. ' +
          '`requestId` is null on the resulting Loan. ' +
          'Requires ASSET_MANAGER or ADMIN role.',
        security: [{ bearerAuth: [] }],
        body: CreateDirectLoanSchema,
        response: { 201: SingleResponseSchema },
      },
    },
    async (request, reply) => {
      const loan = await service.createDirectLoan(request.body, request.currentUser, request);
      return reply.status(201).send(loan);
    },
  );

  // --- POST /v1/loans/:id/return -------------------------------------------
  app.post(
    '/v1/loans/:id/return',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Loans'],
        summary: 'Return a loan',
        description:
          'Processes the return of an ACTIVE loan. ' +
          'For each item, `requiresService: true` moves the asset to IN_SERVICE; ' +
          'otherwise AVAILABLE. ' +
          'Loan transitions to RETURNED (all ok) or DAMAGED (any requiresService). ' +
          'Requires ASSET_MANAGER or ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        body: ReturnLoanSchema,
        response: { 200: SingleResponseSchema },
      },
    },
    async (request) => {
      return service.returnLoan(request.params.id, request.body, request.currentUser, request);
    },
  );

  // --- POST /v1/loans/:id/lost ---------------------------------------------
  app.post(
    '/v1/loans/:id/lost',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Loans'],
        summary: 'Mark a loan as lost',
        description:
          'Marks an ACTIVE loan as LOST. All borrowed assets move to LOST status. ' +
          'This action is irreversible — create a new asset record if the item is ' +
          'eventually found and returned to service. ' +
          'Requires ASSET_MANAGER or ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        body: LostBodySchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await service.markLoanLost(
        request.params.id,
        request.body.reason,
        request.currentUser,
        request,
      );
      return reply.status(204).send(null);
    },
  );

  // --- GET /v1/users/:id/borrowed-items ------------------------------------
  // ADR-0036 — "Vrátiť od osoby": flatten zoznam všetkého, čo daná osoba
  // aktuálne má požičané cez VŠETKY svoje Loan-y (nezávisle od pôvodnej
  // žiadosti). Podklad pre výber kusov pred POST .../return-items.
  app.get(
    '/v1/users/:id/borrowed-items',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Loans'],
        summary: 'Zoznam požičaného majetku osoby cez všetky jej výpožičky (ADR-0036)',
        description:
          'Vráti flatten zoznam kusov, ktoré má daná osoba aktuálne požičané ' +
          '(ACTIVE alebo PARTIALLY_RETURNED Loan-y), s referenciou na loanId ' +
          'pre každý kus. Requires ASSET_MANAGER or ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        response: { 200: z.array(z.record(z.string(), z.unknown())) },
      },
    },
    async (request) => {
      return service.listBorrowedItemsForBorrower(request.params.id, request.currentUser);
    },
  );

  // --- POST /v1/users/:id/return-items -------------------------------------
  // ADR-0036 — vrátenie ľubovoľnej podmnožiny kusov, prípadne cez viacero
  // Loan-ov naraz, jeden konsolidovaný RETURN protokol. Doplnková cesta k
  // POST /v1/loans/:id/return, ktorý ostáva nezmenený.
  app.post(
    '/v1/users/:id/return-items',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Loans'],
        summary: 'Vrátenie vybraných kusov osoby cez viac výpožičiek naraz (ADR-0036)',
        description:
          'Vráti vybranú podmnožinu kusov danej osoby — každá položka nesie ' +
          'vlastné loanId, môžu patriť rôznym Loan-om. Loan, ktorému nebola ' +
          'vrátená úplne všetka jeho zásoba, prejde do PARTIALLY_RETURNED ' +
          '(nie terminálny stav). Vytvorí jeden RETURN protokol pokrývajúci ' +
          'všetky vrátené kusy. Requires ASSET_MANAGER or ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        body: ReturnItemsForBorrowerSchema,
        response: { 200: SingleResponseSchema },
      },
    },
    async (request) => {
      return service.returnItemsForBorrower(
        request.params.id,
        request.body,
        request.currentUser,
        request,
      );
    },
  );
};

export default fp(loansRoutes, {
  name: 'loans-routes',
  dependencies: ['mongo', 'audit', 'auth', 'loan-requests-routes'],
});

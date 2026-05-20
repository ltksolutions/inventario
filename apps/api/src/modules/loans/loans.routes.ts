/**
 * Loans routes — HTTP endpoints for active loan management.
 *
 * RBAC matrix:
 *   - GET  /v1/loans        EMPLOYEE+ (service limits EMPLOYEE to own loans)
 *   - GET  /v1/loans/my     EMPLOYEE+ (always self)
 *   - GET  /v1/loans/:id    EMPLOYEE+ (service checks ownership for EMPLOYEE)
 *   - POST /v1/loans/:id/return  ASSET_MANAGER, ADMIN
 *   - POST /v1/loans/:id/lost    ASSET_MANAGER, ADMIN
 *
 * IMPORTANT: /v1/loans/my must be registered BEFORE /v1/loans/:id to
 * prevent Fastify from matching the literal "my" as the :id parameter.
 *
 * Reuses `loansService` decorated onto the Fastify instance by
 * loan-requests.routes.ts (registered first in server.ts).
 *
 * Slice #5 K4.
 */

import { LoanStatus, ReturnLoanSchema } from '@inventario/shared-types';
import fp from 'fastify-plugin';
import { z } from 'zod';

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
  limit: z.coerce.number().int().min(1).max(100).default(20),
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
  limit: z.coerce.number().int().min(1).max(100).default(20),
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
  await loansRepo.ensureIndexes();

  // Service is decorated by loan-requests.routes.ts which is registered first.
  const service = fastify.loansService;

  const canRead = fastify.requireRole([
    'EMPLOYEE',
    'TEAM_MANAGER',
    'ASSET_MANAGER',
    'ADMIN',
    'EXTERNAL',
  ]);
  const canWrite = fastify.requireRole(['ASSET_MANAGER', 'ADMIN']);

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
};

export default fp(loansRoutes, {
  name: 'loans-routes',
  dependencies: ['mongo', 'audit', 'auth', 'loan-requests-routes'],
});

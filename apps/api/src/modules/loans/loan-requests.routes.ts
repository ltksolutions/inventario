/**
 * Loan Requests routes — HTTP endpoints for loan request management.
 *
 * RBAC matrix:
 *   - GET    /v1/loan-requests        EMPLOYEE+ (service limits EMPLOYEE to own requests)
 *   - GET    /v1/loan-requests/:id    EMPLOYEE+ (service checks ownership for EMPLOYEE)
 *   - POST   /v1/loan-requests        EMPLOYEE+
 *   - POST   /v1/loan-requests/:id/approve  ASSET_MANAGER, ADMIN
 *   - POST   /v1/loan-requests/:id/reject   ASSET_MANAGER, ADMIN
 *   - DELETE /v1/loan-requests/:id    EMPLOYEE+ (service checks ownership — only requester or ADMIN)
 *
 * Slice #5 K4.
 */

import { LoanRequestStatus } from '@inventario/shared-types';
import fp from 'fastify-plugin';
import { z } from 'zod';

import { AssetsRepository } from '../assets/assets.repository.js';

import { LoanRequestsRepository } from './loan-requests.repository.js';
import { LoansRepository } from './loans.repository.js';
import { LoansService } from './loans.service.js';

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ---------------------------------------------------------------------------
// Shared schemas
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

// ---------------------------------------------------------------------------
// Request-specific schemas
// ---------------------------------------------------------------------------

const ListLoanRequestsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
  status: z
    .enum(Object.values(LoanRequestStatus) as [string, ...string[]])
    .optional()
    .transform((v) => v as LoanRequestStatus | undefined),
  /** Filter by requesterId — ignored for EMPLOYEE (service always forces self). */
  requesterId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .optional(),
});

/**
 * POST /v1/loan-requests body.
 *
 * Note: `organisationId`, `status`, `approvers`, and audit fields are
 * server-provided. Only the user-supplied intent fields are in the body.
 */
const CreateLoanRequestBodySchema = z.object({
  purpose: z.string().min(3, 'Účel je povinný (min 3 znaky).').max(500),
  plannedFrom: z.string().datetime({ offset: true }),
  plannedTo: z.string().datetime({ offset: true }),
  items: z
    .array(
      z.object({
        assetId: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát assetId.'),
      }),
    )
    .min(1, 'Žiadosť musí obsahovať aspoň jednu položku.')
    .max(50, 'Žiadosť môže obsahovať najviac 50 položiek.'),
  idempotencyKey: z.string().max(100).optional(),
  /**
   * Voliteľný beneficiár — pre koho je výpožička určená (ADR-0023).
   * Ak chýba, server nastaví na requesterId (žiadosť pre seba).
   */
  beneficiaryId: z
    .string()
    .regex(/^[a-f\d]{24}$/i, 'Neplatný formát beneficiaryId.')
    .optional(),
});

const RejectBodySchema = z.object({
  reason: z.string().min(5, 'Dôvod zamietnutia musí mať aspoň 5 znakov.').max(1000),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const loanRequestsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const loanRequestsRepo = new LoanRequestsRepository(fastify.mongo.db);
  const loansRepo = new LoansRepository(fastify.mongo.db);
  const assetsRepo = new AssetsRepository(fastify.mongo.db);

  const service = new LoansService(
    loanRequestsRepo,
    loansRepo,
    assetsRepo,
    fastify.auditLog,
    fastify.mongo.client,
    fastify.emailService,
    fastify.config.FRONTEND_BASE_URL ?? 'https://app.inventario.estate',
    fastify.mongo.db,
  );

  await loanRequestsRepo.ensureIndexes();

  // Expose service on fastify instance so loans.routes.ts can reuse it.
  fastify.decorate('loansService', service);

  const canRead = fastify.requireRole(['EMPLOYEE', 'ASSET_MANAGER', 'ADMIN', 'EXTERNAL']);
  const canWrite = fastify.requireRole(['ASSET_MANAGER', 'ADMIN']);

  // --- GET /v1/loan-requests -----------------------------------------------
  app.get(
    '/v1/loan-requests',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Loan Requests'],
        summary: 'List loan requests',
        description:
          'Returns a paginated list of loan requests. ' +
          'EMPLOYEE sees only their own requests. ' +
          'ASSET_MANAGER and ADMIN see all requests in the tenant, ' +
          'optionally filtered by `status` or `requesterId`.',
        security: [{ bearerAuth: [] }],
        querystring: ListLoanRequestsQuerySchema,
        response: { 200: PaginatedResponseSchema },
      },
    },
    async (request) => {
      const { limit, skip, status, requesterId } = request.query;
      return service.listLoanRequests(
        { limit, skip, ...(status && { status }), ...(requesterId && { requesterId }) },
        request.currentUser,
      );
    },
  );

  // --- GET /v1/loan-requests/:id -------------------------------------------
  app.get(
    '/v1/loan-requests/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Loan Requests'],
        summary: 'Get a loan request by ID',
        description:
          'Returns a single loan request. ' +
          'Accessible to the original requester or any ASSET_MANAGER / ADMIN.',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        response: { 200: SingleResponseSchema },
      },
    },
    async (request) => {
      return service.getLoanRequestById(request.params.id, request.currentUser);
    },
  );

  // --- POST /v1/loan-requests ----------------------------------------------
  app.post(
    '/v1/loan-requests',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Loan Requests'],
        summary: 'Create a loan request',
        description:
          'Creates a new loan request. All requested assets must be AVAILABLE. ' +
          'Assets are atomically moved to RESERVED status. ' +
          'Any EMPLOYEE can submit a request.',
        security: [{ bearerAuth: [] }],
        body: CreateLoanRequestBodySchema,
        response: { 201: SingleResponseSchema },
      },
    },
    async (request, reply) => {
      const created = await service.createLoanRequest(
        request.body as Parameters<typeof service.createLoanRequest>[0],
        request.currentUser,
        request,
      );
      return reply.status(201).send(created);
    },
  );

  // --- POST /v1/loan-requests/:id/approve ----------------------------------
  app.post(
    '/v1/loan-requests/:id/approve',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Loan Requests'],
        summary: 'Approve a loan request',
        description:
          'Approves a PENDING loan request. ' +
          'In MVP, approval = immediate pickup: all assets move RESERVED → BORROWED ' +
          'and a Loan document is created with status ACTIVE. ' +
          'Requires ASSET_MANAGER or ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        response: { 200: SingleResponseSchema },
      },
    },
    async (request) => {
      return service.approveLoanRequest(request.params.id, request.currentUser, request);
    },
  );

  // --- POST /v1/loan-requests/:id/reject -----------------------------------
  app.post(
    '/v1/loan-requests/:id/reject',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Loan Requests'],
        summary: 'Reject a loan request',
        description:
          'Rejects a PENDING loan request. All reserved assets are released back ' +
          'to AVAILABLE. The `reason` field is required. ' +
          'Requires ASSET_MANAGER or ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        body: RejectBodySchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await service.rejectLoanRequest(
        request.params.id,
        request.body.reason,
        request.currentUser,
        request,
      );
      return reply.status(204).send(null);
    },
  );

  // --- DELETE /v1/loan-requests/:id ----------------------------------------
  app.delete(
    '/v1/loan-requests/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Loan Requests'],
        summary: 'Cancel a loan request',
        description:
          'Cancels a PENDING loan request. All reserved assets are released back ' +
          'to AVAILABLE. Only the original requester or an ADMIN can cancel.',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await service.cancelLoanRequest(request.params.id, request.currentUser, request);
      return reply.status(204).send(null);
    },
  );
};

// ---------------------------------------------------------------------------
// Fastify decoration
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyInstance {
    loansService: LoansService;
  }
}

export default fp(loanRequestsRoutes, {
  name: 'loan-requests-routes',
  dependencies: ['mongo', 'audit', 'auth'],
});

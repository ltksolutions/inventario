// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Loan Requests routes — HTTP endpoints for loan request management.
 *
 * ADR-0026: Katalógové žiadosti (kategória + množstvo) + oddelené vydávanie.
 *
 * RBAC matrix:
 *   GET    /v1/loan-requests               EMPLOYEE+
 *   GET    /v1/loan-requests/:id           EMPLOYEE+ (service checks ownership)
 *   POST   /v1/loan-requests               EMPLOYEE+
 *   POST   /v1/loan-requests/:id/approve   ASSET_MANAGER, ADMIN
 *   POST   /v1/loan-requests/:id/fulfil    ASSET_MANAGER, ADMIN  ← NEW (ADR-0026)
 *   POST   /v1/loan-requests/:id/reject    ASSET_MANAGER, ADMIN
 *   DELETE /v1/loan-requests/:id           EMPLOYEE+ (service checks ownership)
 */

import { freeText, LoanRequestStatus } from '@inventario/shared-types';
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
  requesterId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .optional(),
  /**
   * Filter by beneficiary (ADR-0023). Used by the "Osoby" person card to
   * fetch all pending requests where a given person is involved, either
   * as requester or beneficiary — pass the same id as requesterId to get
   * that union (see LoansService.listLoanRequests()).
   */
  beneficiaryId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .optional(),
});

/**
 * POST /v1/loan-requests — katalógová žiadosť (ADR-0026).
 * Žiadateľ zadáva kategóriu + množstvo, NIE konkrétne assetId.
 */
const CreateLoanRequestBodySchema = z
  .object({
    purpose: freeText(500, { min: 3, minMessage: 'Účel je povinný (min 3 znaky).' }),
    plannedFrom: z.string().datetime({ offset: true }),
    /** Null / chýbajúci = výpožička bez termínu ("do odvolania", ADR-0025). */
    plannedTo: z.string().datetime({ offset: true }).nullable().optional(),
    /** Katalógové položky — kategória + množstvo. */
    items: z
      .array(
        z.object({
          categoryId: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát categoryId.'),
          quantityRequested: z.number().int().min(1, 'Množstvo musí byť aspoň 1.'),
          note: freeText(1000).nullable().optional(),
        }),
      )
      .min(1, 'Žiadosť musí obsahovať aspoň jednu položku.')
      .max(50, 'Žiadosť môže obsahovať najviac 50 položiek.'),
    idempotencyKey: z.string().max(100).optional(),
    /** Voliteľný beneficiár (ADR-0023). Ak chýba, server nastaví na requesterId. */
    beneficiaryId: z
      .string()
      .regex(/^[a-f\d]{24}$/i, 'Neplatný formát beneficiaryId.')
      .optional(),
  })
  .refine((d) => d.plannedTo == null || d.plannedFrom <= d.plannedTo, {
    message: 'Dátum „od" musí byť pred dátumom „do".',
    path: ['plannedTo'],
  });

/**
 * POST /v1/loan-requests/:id/fulfil — vydanie z katalógovej žiadosti (ADR-0026).
 * Správca mapuje položky žiadosti na konkrétny majetok (SERIALIZED) alebo BULK množstvo.
 */
const FulfilLoanRequestBodySchema = z.object({
  items: z
    .array(
      z.union([
        z.object({
          requestItemIndex: z.number().int().nonnegative(),
          type: z.literal('SERIALIZED'),
          assetIds: z.array(z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát assetId.')).min(1),
        }),
        z.object({
          requestItemIndex: z.number().int().nonnegative(),
          type: z.literal('BULK'),
          bulkItemId: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát bulkItemId.'),
          quantity: z.number().int().min(1),
        }),
      ]),
    )
    .min(1, 'Vydanie musí obsahovať aspoň jednu položku.'),
  /** Záväzný termín vrátenia pre vzniknutý Loan (null = do odvolania, ADR-0025). */
  dueAt: z.string().datetime({ offset: true }).nullable().default(null),
  /** Ak true, žiadosť sa uzavrie aj keď nebolo vydané celé množstvo. */
  closeRemainder: z.boolean().default(false),
  notes: freeText(2000).nullable().default(null),
});

const RejectBodySchema = z.object({
  reason: freeText(1000, { min: 5, minMessage: 'Dôvod zamietnutia musí mať aspoň 5 znakov.' }),
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

  fastify.decorate('loansService', service);

  const canRead = fastify.requireMinRole('EMPLOYEE');
  const canWrite = fastify.requireMinRole('ASSET_MANAGER');

  // --- GET /v1/loan-requests -----------------------------------------------
  app.get(
    '/v1/loan-requests',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Loan Requests'],
        summary: 'List loan requests',
        description:
          'Vráti stránkovaný zoznam žiadostí. EMPLOYEE vidí len vlastné. ' +
          'ASSET_MANAGER a ADMIN vidia všetky v rámci tenanta.',
        security: [{ bearerAuth: [] }],
        querystring: ListLoanRequestsQuerySchema,
        response: { 200: PaginatedResponseSchema },
      },
    },
    async (request) => {
      const { limit, skip, status, requesterId, beneficiaryId } = request.query;
      return service.listLoanRequests(
        {
          limit,
          skip,
          ...(status && { status }),
          ...(requesterId && { requesterId }),
          ...(beneficiaryId && { beneficiaryId }),
        },
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
        summary: 'Create a loan request (katalógová žiadosť, ADR-0026)',
        description:
          'Vytvorí novú katalógovú žiadosť (kategória + množstvo). ' +
          'Žiadosť nerezervuje majetok — správca vydá pri fulfil. ' +
          'Každý EMPLOYEE môže podať žiadosť.',
        security: [{ bearerAuth: [] }],
        body: CreateLoanRequestBodySchema,
        response: { 201: SingleResponseSchema },
      },
    },
    async (request, reply) => {
      const created = await service.createLoanRequest(request.body, request.currentUser, request);
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
          'Schváli PENDING žiadosť (stav → APPROVED). ' +
          'ADR-0026: schválenie UŽ NEVYTVÁRA Loan — to sa deje pri fulfil. ' +
          'Vyžaduje ASSET_MANAGER alebo ADMIN.',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        response: { 200: SingleResponseSchema },
      },
    },
    async (request) => {
      return service.approveLoanRequest(request.params.id, request.currentUser, request);
    },
  );

  // --- POST /v1/loan-requests/:id/fulfil -----------------------------------
  app.post(
    '/v1/loan-requests/:id/fulfil',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Loan Requests'],
        summary: 'Fulfil a loan request (vydanie, ADR-0026)',
        description:
          'Vydá majetok z APPROVED / PARTIALLY_FULFILLED žiadosti. ' +
          'Správca mapuje položky žiadosti na konkrétne kusy (SERIALIZED) alebo BULK množstvo. ' +
          'Vznikne nový Loan. Žiadosť prejde do PARTIALLY_FULFILLED / FULFILLED / CLOSED. ' +
          'Vyžaduje ASSET_MANAGER alebo ADMIN.',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        body: FulfilLoanRequestBodySchema,
        response: { 201: SingleResponseSchema },
      },
    },
    async (request, reply) => {
      const loan = await service.fulfilLoanRequest(
        request.params.id,
        request.body,
        request.currentUser,
        request,
      );
      return reply.status(201).send(loan);
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
          'Zamietne PENDING žiadosť. ADR-0026: žiadna rezervácia — nič sa neuvoľňuje. ' +
          'Vyžaduje ASSET_MANAGER alebo ADMIN.',
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
          'Zruší PENDING žiadosť. ADR-0026: nič sa neuvoľňuje (nebola rezervácia). ' +
          'Môže len autor žiadosti alebo ADMIN.',
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

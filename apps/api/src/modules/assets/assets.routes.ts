// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Assets routes — HTTP endpoints for asset management.
 *
 * RBAC matrix:
 *   - GET    /v1/assets       EMPLOYEE+
 *   - GET    /v1/assets/:id   EMPLOYEE+
 *   - POST   /v1/assets       ASSET_MANAGER + ADMIN
 *   - PATCH  /v1/assets/:id   ASSET_MANAGER + ADMIN
 *   - DELETE /v1/assets/:id   ADMIN only
 *
 * ADR-0021 (K2): `inventoryNumberPrefix` bol ODSTRÁNENÝ z POST body.
 * Server číta prefix (a celý formát) z `Organisation.inventoryNumberFormat`.
 * Ak tenant nemá formát nastavený, POST vráti 400 s jasnou správou.
 */

import { UpdateAssetSchema } from '@inventario/shared-types';
import { z } from 'zod';

import { CategoriesRepository } from '../categories/categories.repository.js';
import { LocationsRepository } from '../locations/locations.repository.js';
import { OrganisationsRepository } from '../organisations/organisations.repository.js';

import { AssetsRepository } from './assets.repository.js';
import { AssetsService } from './assets.service.js';

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ---------------------------------------------------------------------------
// Request / response schemas
// ---------------------------------------------------------------------------

const ListAssetsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

const AssetIdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát ID (očakáva sa 24 hex znakov).'),
});

/**
 * Body schema pre POST /v1/assets (ADR-0021 K2).
 *
 * `inventoryNumberPrefix` bol ODSTRÁNENÝ — server číta prefix z
 * `Organisation.inventoryNumberFormat`. Klient neposiela prefix.
 * `inventoryNumber` sa generuje serverom (nie je v body).
 */
const ApiCreateAssetBodySchema = z
  .object({
    serialNumber: z.string().max(200).nullable().default(null),
    name: z.string().min(1).max(300).trim(),
    description: z.string().max(2000).nullable().default(null),
    type: z.string(),
    categoryId: z.string().regex(/^[a-f\d]{24}$/i),
    condition: z.string(),
    locationId: z.string().regex(/^[a-f\d]{24}$/i),
    manufacturer: z.string().max(200).nullable().default(null),
    model: z.string().max(200).nullable().default(null),
    acquiredAt: z.string().datetime({ offset: true }),
    acquisitionCost: z.number().nonnegative().max(1000000).nullable().default(null),
    warrantyUntil: z.string().datetime({ offset: true }).nullable().default(null),
    specs: z.record(z.string(), z.unknown()).default({}),
    tags: z.array(z.string().min(1).max(50)).default([]),
    imageIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).default([]),
    internalNotes: z.string().max(5000).nullable().default(null),
    isLoanable: z.boolean().default(true),
    requiresApproval: z.boolean().default(true),
  })
  .describe('Telo pre vytvorenie assetu; inventoryNumber a publicToken generuje server');

const AssetResponseSchema = z.record(z.string(), z.unknown());

const ListAssetsResponseSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  pagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    skip: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const assetsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const repo = new AssetsRepository(fastify.mongo.db);
  const categoriesRepo = new CategoriesRepository(fastify.mongo.db);
  const locationsRepo = new LocationsRepository(fastify.mongo.db);
  const orgsRepo = new OrganisationsRepository(fastify.mongo.db);
  const service = new AssetsService(
    repo,
    fastify.auditLog,
    fastify.mongo.client,
    categoriesRepo,
    locationsRepo,
    orgsRepo,
  );

  await repo.ensureIndexes();

  const canRead = fastify.requireRole(['EMPLOYEE', 'ASSET_MANAGER', 'ADMIN', 'EXTERNAL']);
  const canWrite = fastify.requireRole(['ASSET_MANAGER', 'ADMIN']);
  const canDelete = fastify.requireRole(['ADMIN']);

  // --- GET /v1/assets ------------------------------------------------------
  app.get(
    '/v1/assets',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Assets'],
        summary: 'List assets',
        description: 'Paginated list of assets (newest first). Soft-deleted excluded.',
        security: [{ bearerAuth: [] }],
        querystring: ListAssetsQuerySchema,
        response: { 200: ListAssetsResponseSchema },
      },
    },
    async (request) => {
      const { limit, skip } = request.query;
      return service.list({ limit, skip }, request.currentUser);
    },
  );

  // --- GET /v1/assets/:id --------------------------------------------------
  app.get(
    '/v1/assets/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Assets'],
        summary: 'Get a single asset by ID',
        description: '404 if not found or soft-deleted.',
        security: [{ bearerAuth: [] }],
        params: AssetIdParamsSchema,
        response: { 200: AssetResponseSchema },
      },
    },
    async (request) => {
      return service.getById(request.params.id, request.currentUser);
    },
  );

  // --- POST /v1/assets -----------------------------------------------------
  app.post(
    '/v1/assets',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Assets'],
        summary: 'Create a new asset',
        description:
          'Server generuje `inventoryNumber` z `Organisation.inventoryNumberFormat` (prefix, ' +
          'padding, includeYear, resetYearly) a `publicToken` cez CSPRNG. ' +
          'Tenant musí mať nastavený `inventoryNumberFormat` — inak 400. ' +
          'Vyžaduje ASSET_MANAGER alebo ADMIN.',
        security: [{ bearerAuth: [] }],
        body: ApiCreateAssetBodySchema,
        response: { 201: AssetResponseSchema },
      },
    },
    async (request, reply) => {
      const created = await service.create(
        {
          ...request.body,
          status: 'AVAILABLE',
        } as unknown as Parameters<typeof service.create>[0],
        request.currentUser,
        request,
      );
      return reply.status(201).send(created);
    },
  );

  // --- PATCH /v1/assets/:id ------------------------------------------------
  app.patch(
    '/v1/assets/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Assets'],
        summary: 'Update an existing asset',
        description: 'Partial update. `inventoryNumber` a `publicToken` sú nemenné.',
        security: [{ bearerAuth: [] }],
        params: AssetIdParamsSchema,
        body: UpdateAssetSchema,
        response: { 200: AssetResponseSchema },
      },
    },
    async (request) => {
      return service.update(request.params.id, request.body, request.currentUser, request);
    },
  );

  // --- DELETE /v1/assets/:id -----------------------------------------------
  app.delete(
    '/v1/assets/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canDelete],
      schema: {
        tags: ['Assets'],
        summary: 'Soft-delete an asset',
        description: 'Nastaví deletedAt/deletedBy. Vyžaduje ADMIN.',
        security: [{ bearerAuth: [] }],
        params: AssetIdParamsSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await service.delete(request.params.id, request.currentUser, request);
      return reply.status(204).send(null);
    },
  );
};

export default assetsRoutes;

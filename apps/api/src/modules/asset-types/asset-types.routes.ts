// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Asset Types routes — CRUD pre asset_types kolekciu.
 *
 * RBAC:
 *   GET    /v1/asset-types       EMPLOYEE+
 *   GET    /v1/asset-types/:id   EMPLOYEE+
 *   POST   /v1/asset-types       ASSET_MANAGER | ADMIN
 *   PATCH  /v1/asset-types/:id   ASSET_MANAGER | ADMIN
 *   DELETE /v1/asset-types/:id   ADMIN only (FK protection)
 */

import { z } from 'zod';

import { AssetTypesRepository } from './asset-types.repository.js';
import { AssetTypesService, type UpdateAssetTypeServiceInput } from './asset-types.service.js';

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

const IdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát ID.'),
});

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  skip: z.coerce.number().int().min(0).default(0),
});

const CreateBodySchema = z.object({
  name: z.string().min(1).max(200).trim(),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(200)
    .optional(),
  icon: z.string().max(50).nullable().default(null),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const UpdateBodySchema = CreateBodySchema.partial();

const ItemResponseSchema = z.record(z.string(), z.unknown());
const ListResponseSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  pagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    skip: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});

const assetTypesRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const repo = new AssetTypesRepository(fastify.mongo.db);
  const service = new AssetTypesService(repo, fastify.auditLog, fastify.mongo.client);

  await repo.ensureIndexes();

  const canRead = fastify.requireRole([
    'EMPLOYEE',
    'TEAM_MANAGER',
    'ASSET_MANAGER',
    'ADMIN',
    'EXTERNAL',
  ]);
  const canWrite = fastify.requireRole(['ASSET_MANAGER', 'ADMIN']);
  const canDelete = fastify.requireRole(['ADMIN']);

  app.get(
    '/v1/asset-types',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['AssetTypes'],
        summary: 'List asset types',
        security: [{ bearerAuth: [] }],
        querystring: ListQuerySchema,
        response: { 200: ListResponseSchema },
      },
    },
    async (request) => {
      return service.list(request.query, request.currentUser);
    },
  );

  app.get(
    '/v1/asset-types/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['AssetTypes'],
        summary: 'Get asset type by ID',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        response: { 200: ItemResponseSchema },
      },
    },
    async (request) => {
      return service.getById(request.params.id, request.currentUser);
    },
  );

  app.post(
    '/v1/asset-types',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['AssetTypes'],
        summary: 'Create asset type',
        security: [{ bearerAuth: [] }],
        body: CreateBodySchema,
        response: { 201: ItemResponseSchema },
      },
    },
    async (request, reply) => {
      const created = await service.create(request.body, request.currentUser, request);
      return reply.status(201).send(created);
    },
  );

  app.patch(
    '/v1/asset-types/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['AssetTypes'],
        summary: 'Update asset type',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        body: UpdateBodySchema,
        response: { 200: ItemResponseSchema },
      },
    },
    async (request) => {
      return service.update(
        request.params.id,
        request.body as UpdateAssetTypeServiceInput,
        request.currentUser,
        request,
      );
    },
  );

  app.delete(
    '/v1/asset-types/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canDelete],
      schema: {
        tags: ['AssetTypes'],
        summary: 'Delete asset type (ADMIN only, FK protected)',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await service.delete(request.params.id, request.currentUser, request);
      return reply.status(204).send(null);
    },
  );
};

export default assetTypesRoutes;

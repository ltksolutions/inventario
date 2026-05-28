// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Asset Conditions routes — CRUD pre asset_conditions kolekciu.
 *
 * RBAC:
 *   GET    /v1/asset-conditions       EMPLOYEE+
 *   GET    /v1/asset-conditions/:id   EMPLOYEE+
 *   POST   /v1/asset-conditions       ASSET_MANAGER | ADMIN
 *   PATCH  /v1/asset-conditions/:id   ASSET_MANAGER | ADMIN
 *   DELETE /v1/asset-conditions/:id   ADMIN only (FK protected)
 */

import { z } from 'zod';

import { AssetConditionsRepository } from './asset-conditions.repository.js';
import {
  AssetConditionsService,
  type UpdateAssetConditionServiceInput,
} from './asset-conditions.service.js';

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

const assetConditionsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const repo = new AssetConditionsRepository(fastify.mongo.db);
  const service = new AssetConditionsService(repo, fastify.auditLog, fastify.mongo.client);

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
    '/v1/asset-conditions',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['AssetConditions'],
        summary: 'List asset conditions',
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
    '/v1/asset-conditions/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['AssetConditions'],
        summary: 'Get asset condition by ID',
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
    '/v1/asset-conditions',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['AssetConditions'],
        summary: 'Create asset condition',
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
    '/v1/asset-conditions/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['AssetConditions'],
        summary: 'Update asset condition',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        body: UpdateBodySchema,
        response: { 200: ItemResponseSchema },
      },
    },
    async (request) => {
      return service.update(
        request.params.id,
        request.body as UpdateAssetConditionServiceInput,
        request.currentUser,
        request,
      );
    },
  );

  app.delete(
    '/v1/asset-conditions/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canDelete],
      schema: {
        tags: ['AssetConditions'],
        summary: 'Delete asset condition (ADMIN only, FK protected)',
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

export default assetConditionsRoutes;

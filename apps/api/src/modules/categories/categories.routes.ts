/**
 * Categories routes — HTTP endpoints for category management.
 *
 * Slice #3 K1: full CRUD with RBAC + audit logging + transactions.
 *
 * RBAC matrix (mirrors assets):
 *   - GET    /v1/categories       any authenticated user
 *   - GET    /v1/categories/:id   any authenticated user
 *   - POST   /v1/categories       ASSET_MANAGER + ADMIN
 *   - PATCH  /v1/categories/:id   ASSET_MANAGER + ADMIN
 *   - DELETE /v1/categories/:id   ADMIN only
 *
 * Body schemas:
 *   - POST uses a local `ApiCreateCategoryBodySchema` that mirrors
 *     `CreateCategorySchema` from shared-types except `slug` is OPTIONAL.
 *     When omitted, the service derives it from `name` (K3 slug auto-gen).
 *   - PATCH uses `UpdateCategorySchema` from shared-types (partial of
 *     writable category fields, audit + identity columns excluded).
 *
 * Future K4 hook:
 *   When cycle detection lands, the PATCH service-level parentId check
 *   will gain a tree traversal up to a max-depth limit.
 */

import { ASSET_TYPE_VALUES, UpdateCategorySchema, type AssetType } from '@inventario/shared-types';
import { z } from 'zod';

import { AssetsRepository } from '../assets/assets.repository.js';

import { CategoriesRepository } from './categories.repository.js';
import { CategoriesService } from './categories.service.js';

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * Permissive boolean coercion for query strings. `z.coerce.boolean()` does
 * `Boolean(value)`, which means the string `"false"` becomes `true` (any
 * non-empty string is truthy). Accept the four canonical spellings and
 * map them explicitly.
 */
const BooleanQueryParam = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

// ---------------------------------------------------------------------------
// Request / response schemas
// ---------------------------------------------------------------------------

const ListCategoriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  /** Filter to only categories under a specific parent. Use `null` literal string for root. */
  parentId: z
    .string()
    .regex(/^([a-f\d]{24}|null)$/i, 'parentId musí byť 24 hex znakov alebo "null".')
    .optional(),
  /** Filter by assetType (IT, SPORT, OFFICE...). */
  assetType: z.string().optional(),
  /** Filter to active categories only. */
  isActive: BooleanQueryParam.optional(),
});

const CategoryIdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát ID (očakáva sa 24 hex znakov).'),
});

/**
 * POST body schema. Mirrors `CreateCategorySchema` from shared-types but
 * makes `slug` optional — the service derives it from `name` if absent.
 *
 * All other fields keep their canonical validation (regex on color, hex on
 * ObjectId-like fields, enum membership for assetType, etc.) so that
 * malformed payloads still surface at the Zod layer rather than the service.
 */
const ApiCreateCategoryBodySchema = z
  .object({
    name: z.string().min(1).max(200).trim(),
    /**
     * Optional slug. Lowercase letters, digits, hyphens. If omitted, the
     * server derives one from `name` and resolves collisions silently with
     * numeric suffixes.
     */
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug musí byť lowercase s pomlckami.')
      .max(200)
      .optional(),
    parentId: z
      .string()
      .regex(/^[a-f\d]{24}$/i, 'parentId musí byť 24 hex znakov.')
      .nullable()
      .default(null),
    assetType: z.enum(
      ASSET_TYPE_VALUES as unknown as [string, ...string[]],
    ) as z.ZodType<AssetType>,
    description: z.string().max(1000).nullable().default(null),
    icon: z.string().max(50).nullable().default(null),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Farba musí byť hex (napr. #1450df).')
      .nullable()
      .default(null),
    approverIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).default([]),
    requiresApprovalByDefault: z.boolean().default(true),
    maxLoanDays: z.number().int().positive().max(3650).nullable().default(null),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
  })
  .describe('Telo pre vytvorenie kategórie; slug je voliteľný (server odvodí z name).');

/**
 * PATCH body schema. Re-exports `UpdateCategorySchema` from shared-types
 * with a localized description for Swagger.
 */
const UpdateCategoryBodySchema = UpdateCategorySchema.describe(
  'Čiastočná aktualizácia kategórie; všetky polia voliteľné.',
);

const CategoryResponseSchema = z.record(z.string(), z.unknown());

const ListCategoriesResponseSchema = z.object({
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

const categoriesRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const repo = new CategoriesRepository(fastify.mongo.db);
  // Asset repo handle so the service can count assets referencing a
  // category before allowing delete (slice #3 K9 FK protection).
  const assetsRepo = new AssetsRepository(fastify.mongo.db);
  const service = new CategoriesService(repo, fastify.auditLog, fastify.mongo.client, assetsRepo);

  await repo.ensureIndexes();

  // Same RBAC pattern as assets.
  const canRead = fastify.requireRole(['EMPLOYEE', 'ASSET_MANAGER', 'ADMIN', 'EXTERNAL']);
  const canWrite = fastify.requireRole(['ASSET_MANAGER', 'ADMIN']);
  const canDelete = fastify.requireRole(['ADMIN']);

  // --- GET /v1/categories --------------------------------------------------
  app.get(
    '/v1/categories',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Categories'],
        summary: 'List categories',
        description:
          'Returns a paginated list of categories, sorted by sortOrder then name. ' +
          'Soft-deleted categories are excluded. Optional filters: parentId, ' +
          'assetType, isActive.',
        security: [{ bearerAuth: [] }],
        querystring: ListCategoriesQuerySchema,
        response: {
          200: ListCategoriesResponseSchema,
        },
      },
    },
    async (request) => {
      const { limit, skip, parentId, assetType, isActive } = request.query;

      // Build filter from query params
      const filter: Record<string, unknown> = {};
      if (parentId !== undefined) {
        filter['parentId'] = parentId === 'null' ? null : parentId;
      }
      if (assetType !== undefined) {
        filter['assetType'] = assetType;
      }
      if (isActive !== undefined) {
        filter['isActive'] = isActive;
      }

      return service.list({ limit, skip, filter }, request.currentUser);
    },
  );

  // --- GET /v1/categories/:id ----------------------------------------------
  app.get(
    '/v1/categories/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Categories'],
        summary: 'Get a single category by ID',
        description: 'Returns one category by its _id. 404 if not found or soft-deleted.',
        security: [{ bearerAuth: [] }],
        params: CategoryIdParamsSchema,
        response: {
          200: CategoryResponseSchema,
        },
      },
    },
    async (request) => {
      return service.getById(request.params.id, request.currentUser);
    },
  );

  // --- POST /v1/categories -------------------------------------------------
  app.post(
    '/v1/categories',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Categories'],
        summary: 'Create a new category',
        description:
          'Creates a new category. Slug must be unique. If parentId is supplied, ' +
          'the parent must exist. Requires ASSET_MANAGER or ADMIN role.',
        security: [{ bearerAuth: [] }],
        body: ApiCreateCategoryBodySchema,
        response: {
          201: CategoryResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // request.body matches `ApiCreateCategoryBodySchema` (slug optional plus
      // defaults for parentId, description, icon, color, approverIds,
      // requiresApprovalByDefault, maxLoanDays, isActive, sortOrder). The cast
      // to `CreateCategoryServiceInput` is sound because that type only
      // differs from this in making `slug` optional — same shape otherwise.
      const created = await service.create(
        request.body as Parameters<typeof service.create>[0],
        request.currentUser,
        request,
      );
      return reply.status(201).send(created);
    },
  );

  // --- PATCH /v1/categories/:id --------------------------------------------
  app.patch(
    '/v1/categories/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Categories'],
        summary: 'Update an existing category',
        description:
          'Partial update — only provided fields are changed. Slug uniqueness ' +
          'and parent existence are revalidated on change. Records an audit ' +
          'event with a per-field diff. Requires ASSET_MANAGER or ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: CategoryIdParamsSchema,
        body: UpdateCategoryBodySchema,
        response: {
          200: CategoryResponseSchema,
        },
      },
    },
    async (request) => {
      return service.update(request.params.id, request.body, request.currentUser, request);
    },
  );

  // --- DELETE /v1/categories/:id -------------------------------------------
  app.delete(
    '/v1/categories/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canDelete],
      schema: {
        tags: ['Categories'],
        summary: 'Soft-delete a category',
        description:
          'Marks a category as deleted. Refuses deletion if the category has ' +
          'any non-deleted child categories (would orphan them), or if any ' +
          'non-deleted assets reference it. Requires ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: CategoryIdParamsSchema,
        response: {
          204: z.null(),
        },
      },
    },
    async (request, reply) => {
      await service.delete(request.params.id, request.currentUser, request);
      return reply.status(204).send(null);
    },
  );
};

export default categoriesRoutes;

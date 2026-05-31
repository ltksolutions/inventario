/**
 * Assets routes — HTTP endpoints for asset management.
 *
 * Slice #1: `GET /v1/assets` (public).
 * Slice #2: `GET /v1/assets` (authenticated).
 * Slice #2b: full CRUD with RBAC + audit logging + transactions.
 *
 * RBAC matrix:
 *   - GET    /v1/assets       any authenticated user
 *   - GET    /v1/assets/:id   any authenticated user
 *   - POST   /v1/assets       ASSET_MANAGER + ADMIN
 *   - PATCH  /v1/assets/:id   ASSET_MANAGER + ADMIN
 *   - DELETE /v1/assets/:id   ADMIN only
 *
 * Note on body schemas:
 *   The HTTP body for POST does NOT include `inventoryNumber` — the server
 *   generates it from `inventoryNumberPrefix` + current year + auto-increment
 *   sequence. The shared-types `CreateAssetSchema` requires the full
 *   `inventoryNumber`, so we define an API-level body schema here that
 *   transforms input → service input.
 */

import { UpdateAssetSchema } from '@inventario/shared-types';
import { z } from 'zod';

import { CategoriesRepository } from '../categories/categories.repository.js';
import { LocationsRepository } from '../locations/locations.repository.js';

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

/**
 * Path parameter for routes that take an asset ID.
 * Format: 24-char hex (MongoDB ObjectId).
 */
const AssetIdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát ID (očakáva sa 24 hex znakov).'),
});

/**
 * Body schema for POST /v1/assets.
 *
 * Differs from `CreateAssetSchema` (shared-types) in two ways:
 *   1. `inventoryNumber` is omitted — server generates it.
 *   2. `inventoryNumberPrefix` is added — 1-5 uppercase letters, the
 *      prefix portion of the generated number (e.g. "LT" → "LT-2026-001").
 *
 * The schema matches the regex used by `Asset.inventoryNumber` for the
 * prefix portion, ensuring we never generate an inventoryNumber that
 * would fail schema validation on read.
 */
const ApiCreateAssetBodySchema = z
  .object({
    inventoryNumberPrefix: z
      .string()
      .regex(/^[A-Z]{1,5}$/, 'Prefix musí byť 1-5 veľkých písmen (napr. "LT").')
      .describe('Prefix inventárneho čísla; server pripojí rok a poradie'),
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
  .describe('Telo pre vytvorenie assetu; inventoryNumber sa generuje serverom');

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

  // Wire up dependencies.
  const repo = new AssetsRepository(fastify.mongo.db);
  // FK validation in the service needs to look up categories + locations,
  // so we instantiate read-only repository handles here. These repos are
  // also constructed independently inside categories.routes.ts and
  // locations.routes.ts — each module manages its own indexes — so
  // having an extra constructor call here just for cross-module reads is
  // a deliberate lightweight choice over a shared singleton.
  const categoriesRepo = new CategoriesRepository(fastify.mongo.db);
  const locationsRepo = new LocationsRepository(fastify.mongo.db);
  const service = new AssetsService(
    repo,
    fastify.auditLog,
    fastify.mongo.client,
    categoriesRepo,
    locationsRepo,
  );

  // Ensure indexes exist at startup. Idempotent.
  await repo.ensureIndexes();

  // RBAC role lists — defined once for readability and easy auditing.
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
        description:
          'Returns a paginated list of assets, sorted by creation date (newest first). ' +
          'Soft-deleted assets are excluded. Requires authentication.',
        security: [{ bearerAuth: [] }],
        querystring: ListAssetsQuerySchema,
        response: {
          200: ListAssetsResponseSchema,
        },
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
        description: 'Returns one asset by its MongoDB `_id`. 404 if not found or soft-deleted.',
        security: [{ bearerAuth: [] }],
        params: AssetIdParamsSchema,
        response: {
          200: AssetResponseSchema,
        },
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
          'Creates a new asset. The server generates `inventoryNumber` from ' +
          '`inventoryNumberPrefix` + current year + auto-increment sequence ' +
          '(e.g. prefix "LT" → "LT-2026-001"). Requires ASSET_MANAGER or ADMIN role.',
        security: [{ bearerAuth: [] }],
        body: ApiCreateAssetBodySchema,
        response: {
          201: AssetResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // The body has already been validated by Zod via the schema above.
      // The cast to `CreateAssetServiceInput` is safe because the body
      // schema is a superset of the service input shape (minus status,
      // which defaults inside the service when constructing the document).
      const body = request.body;
      const created = await service.create(
        {
          ...body,
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
        description:
          'Partial update — only provided fields are changed. Cannot modify ' +
          '`inventoryNumber` (immutable post-creation). Records an audit event ' +
          'with a per-field diff. Requires ASSET_MANAGER or ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: AssetIdParamsSchema,
        body: UpdateAssetSchema,
        response: {
          200: AssetResponseSchema,
        },
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
        description:
          'Marks an asset as deleted (sets `deletedAt`/`deletedBy`). The record ' +
          'remains in the database for audit/recovery. Cannot delete an asset ' +
          'currently on loan — return the loan first. Requires ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: AssetIdParamsSchema,
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

export default assetsRoutes;

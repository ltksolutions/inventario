// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Locations routes — HTTP endpoints for location management.
 *
 * Slice #3 K5: full CRUD with RBAC + audit logging + transactions.
 *
 * Mirrors `categories.routes.ts` precisely. The two resources share
 * the same contract (slug + hierarchy + soft-delete + audit) and the
 * frontend can treat them uniformly.
 *
 * RBAC matrix (mirrors categories):
 *   - GET    /v1/locations       any authenticated user
 *   - GET    /v1/locations/:id   any authenticated user
 *   - POST   /v1/locations       ASSET_MANAGER + ADMIN
 *   - PATCH  /v1/locations/:id   ASSET_MANAGER + ADMIN
 *   - DELETE /v1/locations/:id   ADMIN only
 *
 * Body schemas:
 *   - POST uses a local `ApiCreateLocationBodySchema` that mirrors
 *     `CreateLocationSchema` from shared-types except `slug` is OPTIONAL.
 *     The service derives it from `name` if absent.
 *   - PATCH uses `UpdateLocationSchema` from shared-types (partial of
 *     writable location fields, audit + identity columns excluded).
 */

import { freeText, LOCATION_TYPE_VALUES, UpdateLocationSchema } from '@inventario/shared-types';
import { z } from 'zod';

import { ensureIndexesOnBoot } from '../../lib/ensure-indexes.js';
import { AssetsRepository } from '../assets/assets.repository.js';

import { LocationsRepository } from './locations.repository.js';
import { LocationsService } from './locations.service.js';

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
// Shared sub-schemas (address + coordinates)
// ---------------------------------------------------------------------------

const AddressSchema = z.object({
  street: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().length(2).default('SK'),
});

const CoordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

// ---------------------------------------------------------------------------
// Request / response schemas
// ---------------------------------------------------------------------------

const ListLocationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  /** Filter to only locations under a specific parent. Use `null` literal string for root. */
  parentId: z
    .string()
    .regex(/^([a-f\d]{24}|null)$/i, 'parentId musí byť 24 hex znakov alebo "null".')
    .optional(),
  /** Filter by location type (WAREHOUSE, OFFICE, STADIUM...). */
  type: z.enum(LOCATION_TYPE_VALUES as unknown as [string, ...string[]]).optional(),
  /** Filter to active locations only. */
  isActive: BooleanQueryParam.optional(),
});

const LocationIdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát ID (očakáva sa 24 hex znakov).'),
});

/**
 * POST body schema. Mirrors `CreateLocationSchema` from shared-types but
 * makes `slug` optional — the service derives it from `name` if absent.
 */
const ApiCreateLocationBodySchema = z
  .object({
    name: z.string().min(1).max(200).trim(),
    /**
     * Optional slug. Lowercase letters, digits, hyphens. If omitted, the
     * server derives one from `name` and resolves collisions silently with
     * numeric suffixes.
     */
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug musí byť lowercase s pomlčkami.')
      .max(200)
      .optional(),
    type: z.enum(LOCATION_TYPE_VALUES as unknown as [string, ...string[]]),
    address: AddressSchema.nullable().default(null),
    coordinates: CoordinatesSchema.nullable().default(null),
    parentId: z
      .string()
      .regex(/^[a-f\d]{24}$/i, 'parentId musí byť 24 hex znakov.')
      .nullable()
      .default(null),
    description: freeText(2000).nullable().default(null),
    managerId: z
      .string()
      .regex(/^[a-f\d]{24}$/i, 'managerId musí byť 24 hex znakov.')
      .nullable()
      .default(null),
    isActive: z.boolean().default(true),
  })
  .describe('Telo pre vytvorenie lokality; slug je voliteľný (server odvodí z name).');

/**
 * PATCH body schema. Re-exports `UpdateLocationSchema` from shared-types
 * with a localized description for Swagger.
 */
const UpdateLocationBodySchema = UpdateLocationSchema.describe(
  'Čiastočná aktualizácia lokality; všetky polia voliteľné.',
);

const LocationResponseSchema = z.record(z.string(), z.unknown());

const ListLocationsResponseSchema = z.object({
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

const locationsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const repo = new LocationsRepository(fastify.mongo.db);
  // Asset repo handle so the service can count assets referencing a
  // location before allowing delete (slice #3 K9 FK protection).
  const assetsRepo = new AssetsRepository(fastify.mongo.db);
  const service = new LocationsService(repo, fastify.auditLog, fastify.mongo.client, assetsRepo);

  await ensureIndexesOnBoot(fastify, 'locations', repo);

  const canRead = fastify.requireRole(['EMPLOYEE', 'ASSET_MANAGER', 'ADMIN', 'EXTERNAL']);
  const canWrite = fastify.requireRole(['ASSET_MANAGER', 'ADMIN']);
  const canDelete = fastify.requireRole(['ADMIN']);

  // --- GET /v1/locations ---------------------------------------------------
  app.get(
    '/v1/locations',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Locations'],
        summary: 'List locations',
        description:
          'Returns a paginated list of locations, sorted by name. ' +
          'Soft-deleted locations are excluded. Optional filters: parentId, ' +
          'type, isActive.',
        security: [{ bearerAuth: [] }],
        querystring: ListLocationsQuerySchema,
        response: {
          200: ListLocationsResponseSchema,
        },
      },
    },
    async (request) => {
      const { limit, skip, parentId, type, isActive } = request.query;

      const filter: Record<string, unknown> = {};
      if (parentId !== undefined) {
        filter['parentId'] = parentId === 'null' ? null : parentId;
      }
      if (type !== undefined) {
        filter['type'] = type;
      }
      if (isActive !== undefined) {
        filter['isActive'] = isActive;
      }

      return service.list({ limit, skip, filter }, request.currentUser);
    },
  );

  // --- GET /v1/locations/:id -----------------------------------------------
  app.get(
    '/v1/locations/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Locations'],
        summary: 'Get a single location by ID',
        description: 'Returns one location by its _id. 404 if not found or soft-deleted.',
        security: [{ bearerAuth: [] }],
        params: LocationIdParamsSchema,
        response: {
          200: LocationResponseSchema,
        },
      },
    },
    async (request) => {
      return service.getById(request.params.id, request.currentUser);
    },
  );

  // --- POST /v1/locations --------------------------------------------------
  app.post(
    '/v1/locations',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Locations'],
        summary: 'Create a new location',
        description:
          'Creates a new location. Slug must be unique (or derived from name ' +
          'if omitted). If parentId is supplied, the parent must exist and ' +
          'the resulting depth must not exceed the hierarchy limit. ' +
          'Requires ASSET_MANAGER or ADMIN role.',
        security: [{ bearerAuth: [] }],
        body: ApiCreateLocationBodySchema,
        response: {
          201: LocationResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const created = await service.create(
        request.body as Parameters<typeof service.create>[0],
        request.currentUser,
        request,
      );
      return reply.status(201).send(created);
    },
  );

  // --- PATCH /v1/locations/:id ---------------------------------------------
  app.patch(
    '/v1/locations/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Locations'],
        summary: 'Update an existing location',
        description:
          'Partial update — only provided fields are changed. Slug uniqueness, ' +
          'parent existence, and hierarchy invariants (cycle, depth) are ' +
          'revalidated on change. Records an audit event with a per-field ' +
          'diff. Requires ASSET_MANAGER or ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: LocationIdParamsSchema,
        body: UpdateLocationBodySchema,
        response: {
          200: LocationResponseSchema,
        },
      },
    },
    async (request) => {
      return service.update(request.params.id, request.body, request.currentUser, request);
    },
  );

  // --- DELETE /v1/locations/:id --------------------------------------------
  app.delete(
    '/v1/locations/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canDelete],
      schema: {
        tags: ['Locations'],
        summary: 'Soft-delete a location',
        description:
          'Marks a location as deleted. Refuses deletion if the location has ' +
          'any non-deleted child locations (would orphan them), or if any ' +
          'non-deleted assets reference it. Requires ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: LocationIdParamsSchema,
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

export default locationsRoutes;

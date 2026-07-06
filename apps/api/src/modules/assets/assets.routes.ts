// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Assets routes - HTTP endpoints for asset management.
 *
 * RBAC matrix:
 *   - GET    /v1/assets              EMPLOYEE+
 *   - GET    /v1/assets/:id          EMPLOYEE+
 *   - GET    /v1/assets/:id/qr       EMPLOYEE+ (ADR-0021 K3)
 *   - POST   /v1/assets              ASSET_MANAGER + ADMIN
 *   - PATCH  /v1/assets/:id          ASSET_MANAGER + ADMIN
 *   - DELETE /v1/assets/:id          ADMIN only
 *
 * ADR-0021 (K2): inventoryNumberPrefix bol odstraneny z POST body.
 * Server cita prefix (a cely format) z Organisation.inventoryNumberFormat.
 * Ak tenant nema format nastaveny, POST vrati 400 s jasnou spravou.
 *
 * ADR-0021 (K3): GET /v1/assets/:id/qr generuje QR kod on-demand.
 * URL v QR = ${organisation.appBaseUrl}/scan/${asset.publicToken}.
 * Domena VYLUCNE z appBaseUrl - NIKDY z Host hlavicky.
 */

import { TagSchema, TRACKING_MODE_VALUES, UpdateAssetSchema } from '@inventario/shared-types';
import QRCode from 'qrcode';
import { z } from 'zod';

import { resolveAppBaseUrl } from '../../lib/app-base-url.js';
import { NotFoundError } from '../../plugins/error-handler.js';
import { AuditLogRepository } from '../audit/audit.repository.js';
import { CategoriesRepository } from '../categories/categories.repository.js';
import { LocationsRepository } from '../locations/locations.repository.js';
import { OrganisationsRepository } from '../organisations/organisations.repository.js';
import { StockMovementsRepository } from '../stock/stock-movements.repository.js';

import { AssetsRepository } from './assets.repository.js';
import { AssetsService } from './assets.service.js';

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ---------------------------------------------------------------------------
// Request / response schemas
// ---------------------------------------------------------------------------

const ListAssetsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

const AssetIdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatny format ID (ocakava sa 24 hex znakov).'),
});

const QrQuerySchema = z.object({
  format: z.enum(['svg', 'png']).default('svg'),
});

const ApiCreateAssetBodySchema = z
  .object({
    serialNumber: z.string().max(200).nullable().default(null),
    name: z.string().min(1).max(300).trim(),
    description: z.string().max(2000).nullable().default(null),
    categoryId: z.string().regex(/^[a-f\d]{24}$/i),
    condition: z.string(),
    locationId: z.string().regex(/^[a-f\d]{24}$/i),
    manufacturer: z.string().max(200).nullable().default(null),
    model: z.string().max(200).nullable().default(null),
    acquiredAt: z.string().datetime({ offset: true }),
    acquisitionCost: z.number().nonnegative().max(1000000).nullable().default(null),
    warrantyUntil: z.string().datetime({ offset: true }).nullable().default(null),
    specs: z.record(z.string(), z.unknown()).default({}),
    tags: z.array(TagSchema).default([]),
    imageIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).default([]),
    internalNotes: z.string().max(5000).nullable().default(null),
    isLoanable: z.boolean().default(true),
    requiresApproval: z.boolean().default(true),
    trackingMode: z
      .enum(TRACKING_MODE_VALUES as unknown as [string, ...string[]])
      .default('SERIALIZED'),
    /**
     * Počiatočné množstvo pre BULK položky (ADR-0020) — server z neho v
     * `AssetsService.create()` vytvorí RECEIPT pohyb v tej istej transakcii.
     *
     * BUG FIX (2026-07-06): toto pole tu predtým chýbalo. Fastify/Zod
     * pri validácii `request.body` proti tejto schéme TICHO ORESKAL
     * akékoľvek nedeklarované polia (default Zod správanie) — takže
     * `initialQuantity` z frontend formulára sa nikdy nedostalo do
     * `service.create()`, hoci `CreateAssetSchema` (shared-types) aj
     * `AssetsService` ho už dávno počítali. Výsledok: BULK položky
     * vytvorené cez formulár mali natrvalo `quantityOnHand` chýbajúce
     * (0 v UI) a žiadny RECEIPT záznam, bez akejkoľvek chyby pri vytváraní.
     */
    initialQuantity: z.number().int().positive().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.trackingMode === 'BULK' && !data.initialQuantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['initialQuantity'],
        message: 'Počiatočné množstvo je povinné pre množstevné (BULK) položky a musí byť aspoň 1.',
      });
    }
  })
  .describe('Telo pre vytvorenie assetu; inventoryNumber a publicToken generuje server');

const AuditListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

const AuditListResponseSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  pagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    skip: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});

const AssetResponseSchema = z.record(z.string(), z.unknown());

const DistinctTagsResponseSchema = z.object({
  data: z.array(z.string()),
});

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
  const stockMovementsRepo = new StockMovementsRepository(fastify.mongo.db);
  const auditLogRepo = new AuditLogRepository(fastify.mongo.db);
  const service = new AssetsService(
    repo,
    fastify.auditLog,
    fastify.mongo.client,
    categoriesRepo,
    locationsRepo,
    orgsRepo,
    stockMovementsRepo,
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

  // --- GET /v1/assets/tags --------------------------------------------------
  // Unikátne existujúce tagy naprieč majetkami tenanta — zdroj návrhov pre
  // autocomplete v `TagsCombobox` (Pridanie aj Editácia majetku). Statická
  // cesta pred `/v1/assets/:id` — find-my-way router prioritizuje statické
  // segmenty pred parametrickými bez ohľadu na poradie registrácie (rovnaký
  // vzor ako `/v1/users/directory` vs `/v1/users/:id`).
  app.get(
    '/v1/assets/tags',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Assets'],
        summary: 'Unikátne existujúce tagy (pre autocomplete)',
        description:
          'Abecedne zoradený zoznam všetkých unikátnych tagov použitých na ' +
          'nezmazaných majetkoch tenanta. Zdroj návrhov pre TagsCombobox.',
        security: [{ bearerAuth: [] }],
        response: { 200: DistinctTagsResponseSchema },
      },
    },
    async (request) => {
      const tags = await repo.findDistinctTags(String(request.currentUser.organisationId));
      return { data: tags };
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

  // --- GET /v1/assets/by-token/:publicToken --------------------------------
  // Autentifikované rozlíšenie majetku z QR tokenu pre interný flow (sken
  // prihláseným členom → presmerovanie na detail). Tenant-scoped: token je
  // globálne unikátny, ale vraciame len ak patrí tenantovi aktéra (inak 404 —
  // nerevealujeme cudzie tenanty). NEzávisí od publicAssetLookup.
  app.get(
    '/v1/assets/by-token/:publicToken',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Assets'],
        summary: 'Rozlíš majetok podľa QR tokenu (interné, prihlásené)',
        description:
          'Vráti id majetku pre daný publicToken v rámci tenanta aktéra. ' +
          '404 ak token neexistuje alebo patrí inému tenantovi.',
        security: [{ bearerAuth: [] }],
        params: z.object({ publicToken: z.string().min(1).max(128) }),
        response: { 200: z.object({ id: z.string() }) },
      },
    },
    async (request) => {
      const tenantId = String(request.currentUser.organisationId);
      const asset = await repo.findByPublicToken(request.params.publicToken);
      if (!asset || String(asset.organisationId) !== tenantId) {
        throw new NotFoundError('Asset', request.params.publicToken);
      }
      return { id: String(asset._id) };
    },
  );

  // --- GET /v1/assets/:id/audit --------------------------------------------
  // História zmien majetku (GDPR čl. 30). Tenant-scoped, len pre správcov
  // a adminov (zobrazuje meno aktéra — obmedzené z dôvodu ochrany os. údajov).
  app.get(
    '/v1/assets/:id/audit',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Assets'],
        summary: 'Audit log majetku',
        description:
          'Záznamy auditu pre konkrétny majetok (najnovšie prvé), stránkované. ' +
          'Len ASSET_MANAGER/ADMIN. 404 ak majetok neexistuje v tenantovi.',
        security: [{ bearerAuth: [] }],
        params: AssetIdParamsSchema,
        querystring: AuditListQuerySchema,
        response: { 200: AuditListResponseSchema },
      },
    },
    async (request) => {
      const tenantId = String(request.currentUser.organisationId);
      const { id } = request.params;
      const { limit, skip } = request.query;

      // Overiť, že majetok existuje v tenantovi (inak by sa dal sondovať cudzí audit).
      const asset = await repo.findById(tenantId, id);
      if (!asset) {
        throw new NotFoundError('Asset', id);
      }

      const [entries, total] = await Promise.all([
        auditLogRepo.findByTarget(tenantId, 'Asset', id, { limit, skip }),
        auditLogRepo.countByTarget(tenantId, 'Asset', id),
      ]);

      return {
        data: entries.map((e) => ({
          id: String(e._id),
          at: e.at,
          actor: {
            displayName: e.actor.displayName,
            accountType: e.actor.accountType,
          },
          action: e.action,
          description: e.description,
          changes: e.changes ?? null,
          severity: e.severity,
        })),
        pagination: { total, limit, skip, hasMore: skip + entries.length < total },
      };
    },
  );

  // --- GET /v1/assets/:id/qr -----------------------------------------------
  // ADR-0021 K3: on-demand QR render. URL v QR = appBaseUrl/scan/publicToken.
  // Content-Type: image/svg+xml alebo image/png podla ?format=.
  // Cache-Control: immutable (token je nemenný, teda QR je stabilný).
  // Domena VYLUCNE z organisation.appBaseUrl - NIKDY z Host hlavicky.
  app.get(
    '/v1/assets/:id/qr',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Assets'],
        summary: 'Generuj QR kod pre asset (ADR-0021)',
        description:
          'On-demand QR render. URL zakodovana v QR: ${appBaseUrl}/scan/${publicToken}. ' +
          'Vyzaduje nastaveny appBaseUrl na Organisation - inak 409. ' +
          'format=svg (default) alebo png.',
        security: [{ bearerAuth: [] }],
        params: AssetIdParamsSchema,
        querystring: QrQuerySchema,
      },
    },
    async (request, reply) => {
      const tenantId = String(request.currentUser.organisationId);
      const { id } = request.params;
      const { format } = request.query;

      // Nacitaj asset (tenant-scoped)
      const asset = await repo.findById(tenantId, id);
      if (!asset) {
        return reply.status(404).send({ message: 'Asset not found.' });
      }

      // Základ URL pre QR: per-tenant appBaseUrl → env APP_BASE_URL → default.
      // VŽDY z konfigurácie, NIKDY z request headers (ADR-0021).
      const org = await orgsRepo.findById(tenantId);
      const url = `${resolveAppBaseUrl(org?.appBaseUrl)}/scan/${asset.publicToken}`;

      if (format === 'png') {
        const pngBuffer = await QRCode.toBuffer(url, {
          type: 'png',
          margin: 2,
          width: 300,
        });
        return reply
          .header('Content-Type', 'image/png')
          .header('Cache-Control', 'public, max-age=31536000, immutable')
          .send(pngBuffer);
      }

      // SVG default
      const svgString = await QRCode.toString(url, {
        type: 'svg',
        margin: 2,
        width: 300,
      });
      return reply
        .header('Content-Type', 'image/svg+xml')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(svgString);
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
          'Server generuje inventoryNumber z Organisation.inventoryNumberFormat a publicToken cez CSPRNG. ' +
          'Tenant musi mat nastaveny inventoryNumberFormat - inak 400. ' +
          'Vyzaduje ASSET_MANAGER alebo ADMIN.',
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
        description: 'Partial update. inventoryNumber a publicToken su nemenné.',
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
        description: 'Nastavi deletedAt/deletedBy. Vyzaduje ADMIN.',
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

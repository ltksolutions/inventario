/**
 * Stock routes — HTTP endpointy pre skladové pohyby BULK položiek.
 *
 * RBAC:
 *   GET  /v1/stock                      ASSET_MANAGER + ADMIN (prehľad skladu)
 *   GET  /v1/stock/:itemId/movements    EMPLOYEE+ (čítanie histórie)
 *   POST /v1/stock/:itemId/receive      ASSET_MANAGER + ADMIN
 *   POST /v1/stock/:itemId/adjust       ASSET_MANAGER + ADMIN
 *   POST /v1/stock/:itemId/reconcile    ADMIN only (diagnostika)
 */

import { z } from 'zod';

import { AssetsRepository } from '../assets/assets.repository.js';

import { StockMovementsRepository } from './stock-movements.repository.js';
import { StockService } from './stock.service.js';

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ItemIdParamsSchema = z.object({
  itemId: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát itemId (očakáva sa 24 hex znakov).'),
});

const ReceiveBodySchema = z.object({
  /** Počet kusov na príjem. Musí byť kladné celé číslo. */
  quantity: z
    .number()
    .int('Množstvo musí byť celé číslo.')
    .positive('Príjem musí mať kladné množstvo.'),
  locationId: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát locationId.'),
  reason: z.string().max(1000).nullable().default(null),
  note: z.string().max(1000).nullable().default(null),
});

const AdjustBodySchema = z.object({
  /**
   * Znamienkové množstvo: kladné = pribudne, záporné = ubudne.
   * Nesmie byť 0.
   */
  quantity: z
    .number()
    .int('Množstvo musí byť celé číslo.')
    .refine((n) => n !== 0, 'Množstvo korekcie nesmie byť nula.'),
  locationId: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát locationId.'),
  /** Povinný dôvod korekcie (min 3 znaky). */
  reason: z.string().min(3, 'Dôvod korekcie musí mať aspoň 3 znaky.').max(1000),
  note: z.string().max(1000).nullable().default(null),
});

const ListMovementsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  type: z.enum(['RECEIPT', 'LOAN_OUT', 'LOAN_RETURN', 'ADJUSTMENT']).optional(),
});

const MovementResponseSchema = z.record(z.string(), z.unknown());

const ListMovementsResponseSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  pagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    skip: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});

const ReconcileResponseSchema = z.object({
  itemId: z.string(),
  ledgerBalance: z.number().int(),
  cacheWas: z.number().int().nullable(),
  wasConsistent: z.boolean(),
});

const BulkItemOverviewSchema = z.object({
  _id: z.string(),
  inventoryNumber: z.string(),
  name: z.string(),
  quantityOnHand: z.number().int().nullable(),
  categoryId: z.string(),
  locationId: z.string(),
  lastReceiptQuantity: z.number().int().nullable(),
});

const StockOverviewResponseSchema = z.object({
  data: z.array(BulkItemOverviewSchema),
  total: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const stockRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const stockRepo = new StockMovementsRepository(fastify.mongo.db);
  const assetsRepo = new AssetsRepository(fastify.mongo.db);
  const service = new StockService(stockRepo, assetsRepo, fastify.auditLog, fastify.mongo.client);

  await stockRepo.ensureIndexes();

  const canRead = fastify.requireRole([
    'EMPLOYEE',
    'TEAM_MANAGER',
    'ASSET_MANAGER',
    'ADMIN',
    'EXTERNAL',
  ] as const);
  const canWrite = fastify.requireRole(['ASSET_MANAGER', 'ADMIN']);
  const canAdmin = fastify.requireRole(['ADMIN']);
  const canManage = fastify.requireRole(['ASSET_MANAGER', 'ADMIN']);

  // --- GET /v1/stock -------------------------------------------------------
  app.get(
    '/v1/stock',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canManage],
      schema: {
        tags: ['Stock'],
        summary: 'Prehľad skladu — všetky BULK položky tenanta',
        description:
          'Vráti zoznam všetkých BULK položiek tenanta s aktuálnym zostatkom ' +
          'a množstvom posledného príjmu (pre farebné indikátory). ' +
          'Vyžaduje ASSET_MANAGER alebo ADMIN rolu.',
        security: [{ bearerAuth: [] }],
        response: { 200: StockOverviewResponseSchema },
      },
    },
    async (request) => {
      const tenantId = String(request.currentUser.organisationId);
      const items = await stockRepo.listBulkItemsWithLastReceipt(tenantId);
      return {
        data: items.map((item) => ({
          ...item,
          _id: String(item._id),
        })),
        total: items.length,
      };
    },
  );

  // --- GET /v1/stock/:itemId/movements -------------------------------------
  app.get(
    '/v1/stock/:itemId/movements',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Stock'],
        summary: 'Zoznam skladových pohybov položky',
        description:
          'Vracia paginovaný zoznam pohybov pre BULK položku, zoradených od najnovšieho. ' +
          'Len pre položky s trackingMode === BULK.',
        security: [{ bearerAuth: [] }],
        params: ItemIdParamsSchema,
        querystring: ListMovementsQuerySchema,
        response: { 200: ListMovementsResponseSchema },
      },
    },
    async (request) => {
      const { itemId } = request.params;
      const { limit, skip, type } = request.query;
      const result = await service.listMovements(
        itemId,
        { limit, skip, ...(type !== undefined && { type }) },
        request.currentUser,
      );
      return {
        data: result.data,
        pagination: {
          total: result.total,
          limit,
          skip,
          hasMore: skip + result.data.length < result.total,
        },
      };
    },
  );

  // --- POST /v1/stock/:itemId/receive --------------------------------------
  app.post(
    '/v1/stock/:itemId/receive',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Stock'],
        summary: 'Príjem na sklad (RECEIPT)',
        description:
          'Zaúčtuje príjem kusov na sklad. Kladné množstvo. ' +
          'Aktualizuje `quantityOnHand` na položke a zapíše do ledgera. ' +
          'Vyžaduje ASSET_MANAGER alebo ADMIN rolu.',
        security: [{ bearerAuth: [] }],
        params: ItemIdParamsSchema,
        body: ReceiveBodySchema,
        response: { 201: MovementResponseSchema },
      },
    },
    async (request, reply) => {
      const movement = await service.receive(
        request.params.itemId,
        request.body,
        request.currentUser,
        request,
      );
      return reply.status(201).send(movement);
    },
  );

  // --- POST /v1/stock/:itemId/adjust ---------------------------------------
  app.post(
    '/v1/stock/:itemId/adjust',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Stock'],
        summary: 'Ručná korekcia inventúry (ADJUSTMENT)',
        description:
          'Zaúčtuje ručnú korekciu skladového množstva (kladnú aj zápornú). ' +
          'Dôvod je povinný. Nesmie stiahnut zostatok pod nulu. ' +
          'Vyžaduje ASSET_MANAGER alebo ADMIN rolu.',
        security: [{ bearerAuth: [] }],
        params: ItemIdParamsSchema,
        body: AdjustBodySchema,
        response: { 201: MovementResponseSchema },
      },
    },
    async (request, reply) => {
      const movement = await service.adjust(
        request.params.itemId,
        request.body,
        request.currentUser,
        request,
      );
      return reply.status(201).send(movement);
    },
  );

  // --- POST /v1/stock/:itemId/reconcile ------------------------------------
  app.post(
    '/v1/stock/:itemId/reconcile',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canAdmin],
      schema: {
        tags: ['Stock'],
        summary: 'Reconciliation — overenie konzistencie cache vs ledger',
        description:
          'Overí že `asset.quantityOnHand` (cache) súhlasí so `sum(stock_movements.quantity)` ' +
          '(zdroj pravdy). Ak nie, opraví cache. ' +
          'Diagnostická operácia — vyžaduje ADMIN rolu.',
        security: [{ bearerAuth: [] }],
        params: ItemIdParamsSchema,
        response: { 200: ReconcileResponseSchema },
      },
    },
    async (request) => {
      return service.reconcile(request.params.itemId, request.currentUser, request);
    },
  );
};

export default stockRoutes;

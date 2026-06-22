// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Dashboard routes — agregovaný súhrn pre úvodnú obrazovku.
 *
 * Cieľ: zlúčiť ~10 paralelných requestov dashboardu (counts + zoznamy žiadostí,
 * výpožičiek a protokolov) do JEDNÉHO endpointu `GET /v1/dashboard/summary`.
 *
 * RBAC:
 *   - counts (assets/categories/locations) sú tenant-totály (bez per-user scoping).
 *   - activeLoans count = vlastné aktívne výpožičky aktéra (listMyLoans).
 *   - zoznamy žiadostí / výpožičiek idú cez `loansService` (má vstavané RBAC —
 *     EMPLOYEE vidí len vlastné).
 *   - protokoly: EMPLOYEE/EXTERNAL len tie, kde je účastníkom (participantUserId).
 *
 * Dependency: registrovaný PO `loan-requests-routes` (loansService) aj
 * `protocols-routes` (poradie).
 */

import fp from 'fastify-plugin';
import { z } from 'zod';

import { AssetsRepository } from '../assets/assets.repository.js';
import { CategoriesRepository } from '../categories/categories.repository.js';
import { LocationsRepository } from '../locations/locations.repository.js';
import { LoanProtocolsRepository } from '../protocols/loan-protocols.repository.js';
import { enrichPartySnapshots, isManagerOrAdmin } from '../protocols/protocols.routes.js';

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const PaginatedShape = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  pagination: z.record(z.string(), z.unknown()),
});

const DashboardSummaryResponseSchema = z.object({
  counts: z.object({
    assets: z.number().int().nonnegative(),
    categories: z.number().int().nonnegative(),
    locations: z.number().int().nonnegative(),
    activeLoans: z.number().int().nonnegative(),
  }),
  loanRequests: z.object({
    pending: PaginatedShape,
    approved: PaginatedShape,
    partiallyFulfilled: PaginatedShape,
  }),
  protocols: z.object({
    draft: PaginatedShape,
  }),
  loans: z.object({
    active: PaginatedShape,
  }),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const assetsRepo = new AssetsRepository(fastify.mongo.db);
  const categoriesRepo = new CategoriesRepository(fastify.mongo.db);
  const locationsRepo = new LocationsRepository(fastify.mongo.db);
  const protocolsRepo = new LoanProtocolsRepository(fastify.mongo.db);

  const service = fastify.loansService;

  // ── GET /v1/dashboard/summary ──────────────────────────────────────────────
  app.get(
    '/v1/dashboard/summary',
    {
      preHandler: [
        fastify.requireAuth,
        fastify.loadCurrentUser,
        fastify.requireMinRole('EMPLOYEE'),
      ],
      schema: {
        tags: ['Dashboard'],
        summary: 'Agregovaný súhrn pre dashboard',
        description:
          'Zlúči counts (assets/categories/locations/activeLoans), zoznamy žiadostí ' +
          '(PENDING/APPROVED/PARTIALLY_FULFILLED), aktívne výpožičky a DRAFT protokoly ' +
          'do jednej odpovede. RBAC: zoznamy idú cez loansService (EMPLOYEE len vlastné), ' +
          'protokoly cez participantUserId pravidlo.',
        security: [{ bearerAuth: [] }],
        response: { 200: DashboardSummaryResponseSchema },
      },
    },
    async (request) => {
      const actor = request.currentUser;
      const tenantId = String(actor.organisationId);
      const isMgr = isManagerOrAdmin(actor);

      const [
        assetsTotal,
        categoriesTotal,
        locationsTotal,
        activeMyLoans,
        pending,
        approved,
        partiallyFulfilled,
        activeLoans,
        draftProtocolsRaw,
      ] = await Promise.all([
        assetsRepo.list({ organisationId: tenantId, limit: 1 }).then((r) => r.total),
        categoriesRepo.list({ organisationId: tenantId, limit: 1 }).then((r) => r.total),
        locationsRepo.list({ organisationId: tenantId, limit: 1 }).then((r) => r.total),
        service.listMyLoans({ limit: 1, skip: 0, status: 'ACTIVE' }, actor),
        service.listLoanRequests({ limit: 50, skip: 0, status: 'PENDING' }, actor),
        service.listLoanRequests({ limit: 50, skip: 0, status: 'APPROVED' }, actor),
        service.listLoanRequests({ limit: 50, skip: 0, status: 'PARTIALLY_FULFILLED' }, actor),
        service.listLoans({ limit: 100, skip: 0, status: 'ACTIVE' }, actor),
        protocolsRepo.list(tenantId, {
          status: 'DRAFT',
          limit: 100,
          skip: 0,
          ...(!isMgr && { participantUserId: String(actor._id) }),
        }),
      ]);

      const draftProtocols = await enrichPartySnapshots(fastify.mongo.db, draftProtocolsRaw.items);

      return {
        counts: {
          assets: assetsTotal,
          categories: categoriesTotal,
          locations: locationsTotal,
          activeLoans: activeMyLoans.pagination.total,
        },
        loanRequests: {
          pending,
          approved,
          partiallyFulfilled,
        },
        protocols: {
          draft: {
            data: draftProtocols,
            pagination: {
              total: draftProtocolsRaw.total,
              limit: 100,
              skip: 0,
              hasMore: draftProtocolsRaw.items.length < draftProtocolsRaw.total,
            },
          },
        },
        loans: {
          active: activeLoans,
        },
      };
    },
  );
};

export default fp(dashboardRoutes, {
  name: 'dashboard-routes',
  dependencies: ['mongo', 'auth', 'loan-requests-routes', 'protocols-routes'],
});

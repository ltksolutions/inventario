// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Health module — liveness and readiness probes.
 *
 *   GET /health         — basic liveness (process is running)
 *   GET /health/ready   — readiness (DB reachable)
 *
 * These endpoints are used by:
 *   - Vercel platform for deploy verification
 *   - Uptime monitors (e.g. Pingdom, BetterUptime)
 *   - Local sanity checks
 *
 * HISTORICKÁ POZNÁMKA (2026-08-30): od 2026-07-14 do 2026-08-30 na
 * /health/ready mieril Vercel Cron keep-warm ping každé 4 min
 * (apps/api/vercel.json). Zrušený — pôvodnú príčinu (jedna teplá
 * inštancia = 1 request naraz) medzitým vyriešil Fluid Compute
 * (commit b07cabc, zapnutý 2,5 h po pridaní cronu), takže ping už
 * nemal čo riešiť. Pozri docs/sessions/2026-08-30-atlas-naklady-
 * keep-warm-cron.md.
 */

import { z } from 'zod';

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  uptime: z.number().describe('Process uptime in seconds'),
  timestamp: z.string().datetime(),
});

const ReadyResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    mongo: z.enum(['ok', 'fail']),
  }),
  timestamp: z.string().datetime(),
});

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // --- GET /health ---------------------------------------------------------
  app.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'Liveness probe',
        description: 'Returns 200 if the API process is alive. Does not check dependencies.',
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async () => ({
      status: 'ok' as const,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }),
  );

  // --- GET /health/ready ---------------------------------------------------
  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['Health'],
        summary: 'Readiness probe',
        description: 'Returns 200 if the API can serve requests (DB reachable).',
        response: {
          200: ReadyResponseSchema,
          503: ReadyResponseSchema,
        },
      },
    },
    async (request, reply) => {
      let mongoStatus: 'ok' | 'fail' = 'fail';

      try {
        await fastify.mongo.db.command({ ping: 1 });
        mongoStatus = 'ok';
      } catch (err) {
        request.log.warn({ err }, 'MongoDB ping failed during readiness check');
      }

      const overallStatus = mongoStatus === 'ok' ? 'ready' : 'not_ready';
      const httpStatus = overallStatus === 'ready' ? 200 : 503;

      return reply.status(httpStatus).send({
        status: overallStatus,
        checks: { mongo: mongoStatus },
        timestamp: new Date().toISOString(),
      });
    },
  );
};

export default healthRoutes;

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
 *   - Vercel Cron keep-warm ping every 4 min (see apps/api/vercel.json) —
 *     /health/ready specifically, because it also pings MongoDB, keeping
 *     the cached connection (mongo.ts) alive between real requests and
 *     reducing the odds of a cold-start hit on the next user request.
 *     See docs/sessions/2026-07-14 for the preloader-latency investigation
 *     this addresses. No auth required — side-effect-free GET.
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

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Retention routes — system cron endpoint for GDPR data retention.
 *
 * POST /v1/system/retention/run
 *   Triggered by Vercel cron (monthly). Protected by CRON_SECRET header.
 *   Runs the full retention job: pseudonymizes expired audit logs and
 *   soft-deleted users.
 *
 * Authentication:
 *   Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` on
 *   cron-triggered invocations. We validate this token before running
 *   the job. Without it, the endpoint returns 401.
 *
 *   To trigger manually (dev / smoke test):
 *     curl -X POST https://api.inventario.estate/v1/system/retention/run \
 *       -H "Authorization: Bearer <your-CRON_SECRET>"
 *
 * Behavior:
 *   - If CRON_SECRET is not configured → 503 (endpoint disabled).
 *   - If Authorization header is missing or wrong → 401.
 *   - If job runs successfully → 200 with RetentionRunResult JSON.
 *   - The job is idempotent — running it multiple times in the same
 *     month is safe (already-pseudonymized records are skipped).
 *
 * Vercel cron config (vercel.json):
 *   { "crons": [{ "path": "/v1/system/retention/run", "schedule": "0 3 1 * *" }] }
 *   → runs at 03:00 UTC on the 1st of every month.
 */

import fp from 'fastify-plugin';

import { RetentionRepository } from '../audit/retention.repository.js';
import { RetentionService } from '../audit/retention.service.js';

import type { FastifyPluginAsync } from 'fastify';

const retentionRoutes: FastifyPluginAsync = async (fastify) => {
  const repo = new RetentionRepository(fastify.mongo.db);
  const service = new RetentionService(repo, fastify.log);

  fastify.post('/v1/system/retention/run', async (request, reply) => {
    // ---- Guard: CRON_SECRET must be configured --------------------------
    const cronSecret = fastify.config.CRON_SECRET;
    if (!cronSecret) {
      fastify.log.warn('[retention] CRON_SECRET not configured — endpoint disabled');
      return reply.code(503).send({
        error: 'RETENTION_DISABLED',
        message: 'Retention job is not configured. Set CRON_SECRET env var.',
      });
    }

    // ---- Guard: validate Authorization header ---------------------------
    // Vercel sends: `Authorization: Bearer <CRON_SECRET>`
    const authHeader = request.headers['authorization'];
    const token = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '') : '';

    if (!token || token !== cronSecret) {
      fastify.log.warn(
        { ip: request.ip, path: request.url },
        '[retention] Unauthorized cron attempt',
      );
      return reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid or missing Authorization header.',
      });
    }

    // ---- Run retention job ----------------------------------------------
    fastify.log.info({ ip: request.ip }, '[retention] Authorized cron trigger');

    try {
      const result = await service.run();
      return reply.code(200).send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fastify.log.error({ error: msg }, '[retention] Retention job failed');
      return reply.code(500).send({
        error: 'RETENTION_FAILED',
        message: msg,
      });
    }
  });
};

export default fp(retentionRoutes, {
  name: 'retention-routes',
  dependencies: ['config', 'mongo'],
});

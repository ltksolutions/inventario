// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migrations routes — deploy-time trigger for pending DB migrations.
 *
 * POST /v1/system/migrations/run
 *   Triggered by a GitHub Actions workflow (.github/workflows/
 *   migrate-on-deploy.yml) right after a successful production deploy of
 *   inventario-api. Protected by MIGRATIONS_SECRET header, following the
 *   same pattern as the retention cron endpoint.
 *
 * Why this exists:
 *   Migrations used to run on every API cold start (see migrations/
 *   runner.ts history). That added real latency per cold start as the
 *   migration count grew, since each one was a separate `findOne` check.
 *   Cold start now only runs a cheap passive check (checkPendingMigrations)
 *   that warns if something is pending but never executes anything. This
 *   endpoint is the only place migrations actually run.
 *
 * Authentication:
 *   Sent as `Authorization: Bearer <MIGRATIONS_SECRET>` by the GitHub
 *   Actions workflow. Validated before running anything.
 *
 *   To trigger manually (e.g. right after enabling this for the first
 *   time, or if the automated workflow ever needs a manual re-run):
 *     curl -X POST https://api.inventario.estate/v1/system/migrations/run \
 *       -H "Authorization: Bearer <your-MIGRATIONS_SECRET>"
 *
 * Behavior:
 *   - If MIGRATIONS_SECRET is not configured → 503 (endpoint disabled).
 *   - If Authorization header is missing or wrong → 401.
 *   - If migrations run successfully (including "nothing to do") → 200.
 *   - If a migration fails → 500 with the error message. The `migrations`
 *     collection only marks a migration completed once it succeeds, so a
 *     retry (re-running this endpoint) will resume from the failed one.
 */

import fp from 'fastify-plugin';

import { runPendingMigrations } from '../../migrations/runner.js';

import type { FastifyPluginAsync } from 'fastify';

const migrationsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/v1/system/migrations/run',
    {
      schema: {
        tags: ['System'],
        summary: 'Spustenie čakajúcich DB migrácií po deployi',
        description:
          'Volá GitHub Actions po úspešnom produkčnom deployi. Cold start migrácie nespúšťa, robí len pasívnu kontrolu. Opakované spustenie je bezpečné.',
        // Nie používateľský token — zdieľané tajomstvo, viď
        // securityScheme deploymentSecret v plugins/swagger.ts.
        security: [{ deploymentSecret: [] }],
      },
    },
    async (request, reply) => {
      // ---- Guard: MIGRATIONS_SECRET must be configured ---------------------
      const migrationsSecret = fastify.config.MIGRATIONS_SECRET;
      if (!migrationsSecret) {
        fastify.log.warn('[migrations] MIGRATIONS_SECRET not configured — endpoint disabled');
        // Pole `error` nesie HTTP reason phrase, rovnako ako zvyšok API
        // (`plugins/error-handler.ts`). Do 2026-09-02 tu boli skratky
        // v SCREAMING_SNAKE (`MIGRATIONS_DISABLED`…). Nečítal ich nikto — ani
        // `migrate-on-deploy.yml` (používa len `curl --fail`), ani web — a
        // konkrétnu príčinu aj tak nesie `message`.
        return reply.code(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'Migration endpoint is not configured. Set MIGRATIONS_SECRET env var.',
        });
      }

      // ---- Guard: validate Authorization header -----------------------------
      const authHeader = request.headers['authorization'];
      const token = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '') : '';

      if (!token || token !== migrationsSecret) {
        fastify.log.warn(
          { ip: request.ip, path: request.url },
          '[migrations] Unauthorized trigger attempt',
        );
        return reply.code(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid or missing Authorization header.',
        });
      }

      // ---- Run pending migrations --------------------------------------------
      fastify.log.info({ ip: request.ip }, '[migrations] Authorized trigger — running migrations');

      try {
        await runPendingMigrations(fastify.mongo.db, fastify.log);
        return reply.code(200).send({ status: 'ok' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error({ error: msg }, '[migrations] Migration run failed');
        return reply.code(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: msg,
        });
      }
    },
  );
};

export default fp(migrationsRoutes, {
  name: 'migrations-routes',
  dependencies: ['config', 'mongo'],
});

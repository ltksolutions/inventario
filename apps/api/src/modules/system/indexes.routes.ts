// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Indexes routes — deploy-time vytvorenie MongoDB indexov.
 *
 * POST /v1/system/indexes/ensure
 *   Rovnaký vzor a rovnaký secret ako `migrations.routes.ts`: spúšťa to
 *   GitHub Actions workflow hneď po úspešnom produkčnom deployi API.
 *
 * Prečo to existuje:
 *   Každý modul volal svoje `repo.ensureIndexes()` pri registrácii. Spolu
 *   18 sériových volaní = 18 round-tripov na Atlas pri každom studenom
 *   štarte serverless inštancie, ešte pred prvým užitočným requestom.
 *   Indexy sa pritom pri behu appky nemenia — menia sa pri deployi.
 *   Detaily: `lib/ensure-indexes.ts`, session log 2026-08-31.
 *
 * Bezpečnostná poznámka:
 *   `createIndexes` je v Mongu idempotentné — opakované volanie s rovnakou
 *   definíciou neurobí nič. Endpoint je teda bezpečné spustiť opakovane.
 */

import fp from 'fastify-plugin';

import type { FastifyPluginAsync } from 'fastify';

const indexesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/v1/system/indexes/ensure',
    {
      schema: {
        tags: ['System'],
        summary: 'Vytvorenie MongoDB indexov po deployi',
        description:
          'Volá GitHub Actions po úspešnom produkčnom deployi. V produkcii sa indexy pri boote nevytvárajú — detaily v lib/ensure-indexes.ts. Idempotentné.',
        // Nie používateľský token — zdieľané tajomstvo, viď
        // securityScheme deploymentSecret v plugins/swagger.ts.
        security: [{ deploymentSecret: [] }],
      },
    },
    async (request, reply) => {
      const secret = fastify.config.MIGRATIONS_SECRET;
      if (!secret) {
        fastify.log.warn('[indexes] MIGRATIONS_SECRET not configured — endpoint disabled');
        // Pole `error` nesie HTTP reason phrase, rovnako ako zvyšok API
        // (`plugins/error-handler.ts`). Do 2026-09-02 tu boli skratky
        // v SCREAMING_SNAKE (`INDEXES_DISABLED`…). Nečítal ich nikto — ani
        // `migrate-on-deploy.yml` (používa len `curl --fail`), ani web — a
        // konkrétnu príčinu aj tak nesie `message`.
        return reply.code(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'Index endpoint is not configured. Set MIGRATIONS_SECRET env var.',
        });
      }

      const authHeader = request.headers['authorization'];
      const token = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '') : '';

      if (!token || token !== secret) {
        fastify.log.warn(
          { ip: request.ip, path: request.url },
          '[indexes] Unauthorized trigger attempt',
        );
        return reply.code(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid or missing Authorization header.',
        });
      }

      const ensurers = fastify.indexEnsurers;
      fastify.log.info(
        { count: ensurers.length },
        '[indexes] Authorized trigger — ensuring indexes',
      );

      const failed: { name: string; error: string }[] = [];

      // Sériovo a s pokračovaním po chybe: jeden pokazený index (napr. unique
      // index, ktorý koliduje s existujúcimi dátami) nemá zabrániť vytvoreniu
      // ostatných. Zoznam zlyhaní ide do odpovede aj do logu.
      for (const ensurer of ensurers) {
        try {
          await ensurer.run();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          fastify.log.error({ name: ensurer.name, error: msg }, '[indexes] ensureIndexes failed');
          failed.push({ name: ensurer.name, error: msg });
        }
      }

      if (failed.length > 0) {
        return reply.code(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: `${String(failed.length)} of ${String(ensurers.length)} index sets failed.`,
          failed,
        });
      }

      return reply.code(200).send({ status: 'ok', ensured: ensurers.length });
    },
  );
};

export default fp(indexesRoutes, {
  name: 'indexes-routes',
  dependencies: ['config', 'mongo', 'index-registry'],
});

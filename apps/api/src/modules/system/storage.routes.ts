// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Hygiena úložiska — osirelé objekty (ADR-0039).
 *
 *   GET  /v1/system/storage/orphans        len vypíše, NEMAŽE
 *   POST /v1/system/storage/orphans/purge  zmaže tie starší než odklad
 *
 * Report je od mazania oddelený zámerne: mazacia cesta v produkte má mať
 * dopredu spôsob, ako sa pozrieť, čo by zmizlo. `GET` je preto bezpečný
 * na spustenie kedykoľvek.
 *
 * Autentifikácia: `CRON_SECRET`, rovnako ako retencia — je to cron-driven
 * hygiena, nie deploy krok (ten má `MIGRATIONS_SECRET`). Vercel cron
 * posiela `Authorization: Bearer <CRON_SECRET>` sám.
 *
 * Ručne:
 *   curl https://api.inventario.estate/v1/system/storage/orphans \
 *     -H "Authorization: Bearer <CRON_SECRET>"
 *
 * Vercel cron (vercel.json):
 *   { "path": "/v1/system/storage/orphans/purge", "schedule": "0 4 * * *" }
 *   → 04:00 UTC každý deň, teda hodinu po retenčnom okne.
 */

import fp from 'fastify-plugin';

import { purgeOrphanedObjects, scanOrphanedObjects } from './orphaned-objects.service.js';

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Spoločné brány pre oba endpointy. Vracia `null`, keď je požiadavka
 * v poriadku; inak už má odpoveď poslanú.
 */
function guard(
  fastify: Parameters<FastifyPluginAsync>[0],
  request: FastifyRequest,
  reply: FastifyReply,
): 'ok' | 'handled' {
  const cronSecret = fastify.config.CRON_SECRET;
  if (!cronSecret) {
    fastify.log.warn('[orphans] CRON_SECRET nie je nastavený — endpoint vypnutý');
    reply.code(503).send({
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Storage hygiene endpoint is not configured. Set CRON_SECRET env var.',
    });
    return 'handled';
  }

  const authHeader = request.headers['authorization'];
  const token = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '') : '';

  if (!token || token !== cronSecret) {
    fastify.log.warn({ ip: request.ip, path: request.url }, '[orphans] neautorizovaný pokus');
    reply.code(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid or missing Authorization header.',
    });
    return 'handled';
  }

  if (fastify.objectStorage.name === 'stub') {
    fastify.log.warn('[orphans] úložisko beží v stub režime — nie je čo kontrolovať');
    reply.code(503).send({
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Object storage is not configured (stub mode).',
    });
    return 'handled';
  }

  return 'ok';
}

const storageRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/v1/system/storage/orphans',
    {
      schema: {
        tags: ['System'],
        summary: 'Výpis osirelých objektov v úložisku (nemaže)',
        description:
          'Objekty pod attachments/, na ktoré neukazuje žiadna nezmazaná príloha a sú starší než 24 hodín. Iba čítanie.',
        security: [{ deploymentSecret: [] }],
      },
    },
    async (request, reply) => {
      if (guard(fastify, request, reply) === 'handled') return reply;

      const scan = await scanOrphanedObjects(fastify.mongo.db, fastify.objectStorage, fastify.log);

      return reply.code(200).send({
        scanned: scan.scanned,
        truncated: scan.truncated,
        orphanCount: scan.orphans.length,
        orphanBytes: scan.orphans.reduce((sum, object) => sum + object.sizeBytes, 0),
        orphans: scan.orphans,
      });
    },
  );

  fastify.post(
    '/v1/system/storage/orphans/purge',
    {
      schema: {
        tags: ['System'],
        summary: 'Zmazanie osirelých objektov (denný cron)',
        description:
          'Volá Vercel Cron (denne). Maže objekty bez záznamu v evidencii starší než 24 hodín. Pri neúplnom výpise storu nemaže nič.',
        security: [{ deploymentSecret: [] }],
      },
    },
    async (request, reply) => {
      if (guard(fastify, request, reply) === 'handled') return reply;

      try {
        const result = await purgeOrphanedObjects(
          fastify.mongo.db,
          fastify.objectStorage,
          fastify.log,
        );
        return reply.code(200).send({ status: 'ok', ...result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error({ error: msg }, '[orphans] čistenie zlyhalo');
        return reply.code(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: msg,
        });
      }
    },
  );
};

export default fp(storageRoutes, {
  name: 'storage-routes',
  dependencies: ['config', 'mongo', 'storage'],
});

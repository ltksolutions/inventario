// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * MongoDB plugin — connects to MongoDB Atlas and exposes the client + db.
 *
 * **Serverless-friendly pattern:**
 * The MongoClient is cached at MODULE scope (not Fastify scope). Vercel
 * warm invocations share module state for ~5-15 minutes of inactivity, so
 * subsequent requests reuse the connection instead of opening a new one
 * (which would quickly hit Atlas connection limits — Flex has 500).
 *
 * On cold start, `cachedClient` is null and we open a fresh connection.
 * On warm invocation, we reuse the existing one.
 *
 * **Nastavenia poolu (prehodnotené 2026-08-31):**
 *   - maxPoolSize: 10     → pôvodne 1, s odôvodnením „serverless má 1 invoke
 *     = 1 request, pool netreba". Od zapnutia Fluid Compute (`b07cabc`) to
 *     neplatí: Fluid posiela na jednu inštanciu viac súbežných requestov.
 *     Horšie, pool veľkosti 1 serializoval aj `Promise.all` V RÁMCI jedného
 *     requestu — `GET /v1/dashboard/summary` spúšťa 9 operácií naraz, ale
 *     cez jedno spojenie išli za sebou (namerané 2,4–2,9 s na TEPLEJ
 *     inštancii; viď docs/sessions/2026-08-31-pomale-nacitanie-dashboardu.md).
 *   - minPoolSize: 0      → don't pre-warm
 *   - maxIdleTimeMS: 60s  → pôvodne 10 s, čo znamenalo, že aj na teplej
 *     inštancii sa medzi dvoma klikmi používateľa spojenie zavrelo a ďalší
 *     request znova platil TLS handshake + SCRAM auth.
 *
 * Usage:
 *   const assets = fastify.mongo.db.collection('assets');
 *   const result = await assets.find({}).toArray();
 */

import fp from 'fastify-plugin';
import { MongoClient, type Db } from 'mongodb';

import type { FastifyPluginAsync } from 'fastify';

// ---------------------------------------------------------------------------
// Module-level cache — survives across warm Vercel invocations
// ---------------------------------------------------------------------------

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

async function getMongoConnection(
  uri: string,
  dbName: string,
  logger: { info: (obj: object, msg: string) => void },
): Promise<{ client: MongoClient; db: Db }> {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  logger.info({ dbName }, 'Opening new MongoDB connection');

  const client = new MongoClient(uri, {
    // Serverless-tuned settings — viď hlavičku súboru
    maxPoolSize: 10,
    minPoolSize: 0,
    maxIdleTimeMS: 60_000,

    // Sensible timeouts (Atlas default is 30s, too long for serverless)
    serverSelectionTimeoutMS: 5_000,
    socketTimeoutMS: 10_000,

    // Retry logic
    retryWrites: true,
    retryReads: true,

    // Read-after-write consistency on Atlas Flex (shared replica set).
    // Without majority concerns the same connection can occasionally
    // serve stale reads to operations issued immediately after a write,
    // breaking integration tests ("insert succeeded but read-back failed",
    // "GET list returns 0 after creating 1", etc.). Majority concerns add
    // ~10ms latency per round-trip — acceptable for both tests and prod.
    writeConcern: { w: 'majority', wtimeoutMS: 5_000 },
    readConcern: { level: 'majority' },
  });

  const startedAt = Date.now();
  await client.connect();
  const connectedAt = Date.now();
  const db = client.db(dbName);

  // Verify connection is actually live (ping)
  await db.command({ ping: 1 });
  const pingedAt = Date.now();

  cachedClient = client;
  cachedDb = db;

  // Rozpad je dôležitý: `connect()` je TLS handshake + SCRAM auth + SRV
  // lookup (cena cold startu), `ping` je jeden round-trip na Atlas (cena
  // sieťovej latencie). Keď sa cold start rieši, treba vedieť, ktoré z
  // toho dominuje.
  logger.info(
    {
      dbName,
      connectMs: connectedAt - startedAt,
      pingMs: pingedAt - connectedAt,
    },
    'MongoDB connected and verified',
  );

  return { client, db };
}

// ---------------------------------------------------------------------------
// Fastify decoration
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyInstance {
    mongo: {
      client: MongoClient;
      db: Db;
    };
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const mongoPlugin: FastifyPluginAsync = async (fastify) => {
  // EXPORT_ONLY mode: spin up an in-process MongoDB for schema-export scripts.
  // Routes register + Swagger collects them, but no Atlas connection needed.
  if (process.env['EXPORT_ONLY'] === 'true') {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
    await client.connect();
    const db = client.db('export_stub');
    fastify.log.info('EXPORT_ONLY=true — using in-process MongoMemoryServer');
    fastify.decorate('mongo', { client, db });
    fastify.addHook('onClose', async () => {
      await client.close();
      await mongod.stop();
    });
    return;
  }

  const { MONGO_URI, MONGO_DB_NAME } = fastify.config;

  const { client, db } = await getMongoConnection(MONGO_URI, MONGO_DB_NAME, fastify.log);

  fastify.decorate('mongo', { client, db });

  // Graceful shutdown — only meaningful in long-running mode (local dev).
  // On Vercel, the process is killed by the runtime; this hook just lets
  // pending operations finish during local Ctrl+C.
  fastify.addHook('onClose', async () => {
    if (cachedClient) {
      fastify.log.info('Closing MongoDB connection');
      await cachedClient.close();
      cachedClient = null;
      cachedDb = null;
    }
  });
};

export default fp(mongoPlugin, {
  name: 'mongo',
  dependencies: ['config'],
});

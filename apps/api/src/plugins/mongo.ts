/**
 * MongoDB plugin — connects to MongoDB Atlas and exposes the client + db.
 *
 * **Serverless-friendly pattern:**
 * The MongoClient is cached at MODULE scope (not Fastify scope). Vercel
 * warm invocations share module state for ~5-15 minutes of inactivity, so
 * subsequent requests reuse the connection instead of opening a new one
 * (which would quickly hit Atlas connection limits — M0 has only 500).
 *
 * On cold start, `cachedClient` is null and we open a fresh connection.
 * On warm invocation, we reuse the existing one.
 *
 * **Important Mongo settings for serverless:**
 *   - maxPoolSize: 1     → serverless has 1 invoke = 1 request, no pooling needed
 *   - minPoolSize: 0     → don't pre-warm
 *   - maxIdleTimeMS: 10s → close after 10s idle (helps clean shutdown)
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
    // Serverless-tuned settings
    maxPoolSize: 1,
    minPoolSize: 0,
    maxIdleTimeMS: 10_000,

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

  await client.connect();
  const db = client.db(dbName);

  // Verify connection is actually live (ping)
  await db.command({ ping: 1 });

  cachedClient = client;
  cachedDb = db;

  logger.info({ dbName }, 'MongoDB connected and verified');

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

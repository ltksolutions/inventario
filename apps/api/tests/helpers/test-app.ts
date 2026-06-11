// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Test app helper — build a Fastify instance configured for integration tests.
 *
 * Wraps `buildServer()` with three integration-test conveniences:
 *
 *   1. Forces `MONGO_DB_NAME` to the test database
 *      (`sfz_asset_management_test`), so production data is never touched.
 *
 *   2. Drops the test database in `beforeAll`-style cleanup (called via
 *      `cleanTestDatabase()`) for a tabula-rasa starting state.
 *
 *   3. Provides a `shutdown()` helper that closes the Mongo connection
 *      cleanly, so the test process exits instead of hanging on the
 *      pool waiting for idle timeout.
 *
 * Usage pattern in a test file:
 *
 *   import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
 *
 *   describe('something', () => {
 *     let app: FastifyInstance;
 *
 *     beforeAll(async () => {
 *       app = await buildTestApp();
 *       await cleanTestDatabase(app);
 *     });
 *
 *     afterAll(async () => {
 *       await app.close();
 *     });
 *
 *     it('does the thing', async () => {
 *       const res = await app.inject({ method: 'GET', url: '/health' });
 *       expect(res.statusCode).toBe(200);
 *     });
 *   });
 */

import { buildServer } from '../../src/server.js';

import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The database name used by all integration tests. Distinct from
 * `sfz_asset_management` (dev) and any prod name. Located in the
 * same Atlas Flex cluster as dev — see MONGO_URI in .env.local.
 */
export const TEST_DB_NAME = 'sfz_asset_management_test';

// ---------------------------------------------------------------------------
// buildTestApp
// ---------------------------------------------------------------------------

/**
 * Build a Fastify app configured for integration tests.
 *
 * Side effect: temporarily overrides `process.env.MONGO_DB_NAME` to the
 * test DB before calling `buildServer()`. The config plugin reads env
 * vars at registration time, so this override propagates through the
 * whole app lifecycle.
 *
 * IMPORTANT: this MUST be called AFTER `tests/setup.ts` has run, since
 * setup is what generates the test JWT keypair and exports the public
 * key into `TEST_JWT_PUBLIC_KEY`. vitest's `globalSetup` config runs
 * before any test files load, so this happens automatically.
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  // Stash the original so we can restore it if needed (defensive).
  const originalDbName = process.env['MONGO_DB_NAME'];
  process.env['MONGO_DB_NAME'] = TEST_DB_NAME;

  try {
    // 30s pluginTimeout (vs Fastify's 10s default) handles the case where
    // each test file rebuilds the app + opens a fresh Atlas connection.
    // Atlas cold TLS handshake from a residential network can spike to
    // 15-20s on the 4th or 5th rebuild; 30s is comfortable headroom.
    const app = await buildServer({ pluginTimeout: 30_000 });
    await app.ready();
    return app;
  } finally {
    // Restore — we want subsequent buildTestApp() calls to also re-set
    // this, but we don't want this env var leaking out if a test does
    // something weird with process.env. (Realistically, vitest tests
    // each run in their own process anyway, but defense in depth.)
    if (originalDbName !== undefined) {
      process.env['MONGO_DB_NAME'] = originalDbName;
    }
  }
}

// ---------------------------------------------------------------------------
// cleanTestDatabase
// ---------------------------------------------------------------------------

/**
 * Remove all documents from every collection in the test database,
 * giving the next test a clean slate. Call from `beforeAll` or
 * `afterEach` in each test file.
 *
 * Why `deleteMany({})` per collection instead of `dropDatabase()`?
 *   `dropDatabase` requires the `dropDatabase` action privilege, which
 *   the typical `readWrite@<db>` Atlas role does NOT grant for databases
 *   outside the role's scope. Our Atlas user has `readWrite` on
 *   `sfz_asset_management` only; calling `dropDatabase()` on the test
 *   DB fails with "user is not allowed to do action [dropDatabase]".
 *
 *   Per-collection `deleteMany({})` requires only the `remove` action
 *   (part of standard `readWrite`), so it works everywhere. Indexes
 *   stay in place between test runs which is fine — they were created
 *   on first insert via the repository's `ensureIndexes()` calls.
 */
export async function cleanTestDatabase(app: FastifyInstance): Promise<void> {
  // Sanity check: refuse to wipe anything that isn't the test DB.
  const dbName = app.mongo.db.databaseName;
  if (dbName !== TEST_DB_NAME) {
    throw new Error(
      `cleanTestDatabase refused: connected DB is "${dbName}", not "${TEST_DB_NAME}". ` +
        'This is a safety guard against accidentally wiping prod or dev data.',
    );
  }

  const collections = await app.mongo.db.listCollections({}, { nameOnly: true }).toArray();

  await Promise.all(collections.map(({ name }) => app.mongo.db.collection(name).deleteMany({})));
}

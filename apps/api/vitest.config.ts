// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Vitest configuration for @inventario/api.
 *
 * Test layout:
 *   tests/
 *     setup.ts           — global setup: spin up in-memory MongoDB replica
 *                          set, generate ephemeral JWT keypair, set
 *                          TEST_JWT_PUBLIC_KEY env var before any plugin
 *                          loads
 *     helpers/           — shared utilities (test-app, test-jwt, test-mongo)
 *     unit/              — pure function tests (fast, no DB)
 *     integration/       — full app tests via app.inject() against the
 *                          in-memory replica set
 *
 * Test isolation:
 *   Integration tests run against a SEPARATE database
 *   `sfz_asset_management_test` (set via TEST_MONGO_DB_NAME env var or
 *   via the test-app helper's override). Each test suite drops the
 *   database in `beforeAll` for a tabula-rasa starting state.
 *
 * Why a longer testTimeout / teardownTimeout:
 *   In-memory MongoDB replica set mode keeps background handles open
 *   (oplog tailing, heartbeat) that take a few seconds to drain after
 *   the last test finishes. Default 10s teardownTimeout produces a
 *   harmless "close timed out after 10000ms" warning even though
 *   100% of tests pass. 30s covers cold-CI worst case with headroom.
 *
 *   testTimeout/hookTimeout stay at 30s for the same reasons that
 *   applied to the old Atlas Flex setup: occasional cold-start spikes
 *   when an in-memory mongod is first contacted from a fresh pool.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run setup once for the whole test process (generates keypair, sets env)
    globalSetup: ['./tests/setup.ts'],

    // Where to find test files
    include: ['tests/**/*.test.ts'],

    // Atlas network latency makes 5s default tight; 30s covers worst-case
    // multi-CRUD tests on a contended residential link.
    testTimeout: 30_000,
    hookTimeout: 30_000, // beforeAll can take longer (DB cleanup, app boot)

    // Default 10s isn't enough for the in-memory replica set to drain
    // its background handles (oplog tailing, heartbeats) after the last
    // test finishes. Without this, every successful run ends with a
    // cosmetic "close timed out after 10000ms" warning. 30s is well
    // under any reasonable CI step timeout and covers the slowest
    // observed teardown by ~3x.
    teardownTimeout: 30_000,

    // Reporter — default is fine; verbose only on CI failures
    reporters: 'default',

    // We hit a real database, so parallel test files would race on collections.
    // Use `pool: 'forks'` + `singleFork: true` to serialize file execution.
    // (Tests within a single file still run sequentially by default.)
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    // Silence noisy Fastify dev logs during tests (we only want vitest output)
    silent: false, // toggle to true if logs get distracting
  },
});

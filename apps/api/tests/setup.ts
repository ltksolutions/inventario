/**
 * Vitest global setup — runs once before any test file loads.
 *
 * Responsibilities:
 *   1. Start an in-memory MongoDB replica set (mongodb-memory-server) and
 *      override `MONGO_URI` to point to it. Eliminates Atlas Flex
 *      consistency issues and makes tests 5x faster.
 *
 *      MUST be a replica set (not standalone) because the API uses
 *      `session.withTransaction(...)` in every write path (assets,
 *      categories, locations, users, loans). A standalone mongod
 *      throws "Transaction numbers are only allowed on a replica set
 *      member" on the first write attempt, which surfaces as 500s
 *      in every POST/PATCH/DELETE integration test.
 *   2. Generate an ephemeral RS256 keypair for signing test JWTs.
 *   3. Export the public key as `TEST_JWT_PUBLIC_KEY` env var, so the
 *      auth plugin (in src/plugins/auth.ts) knows to accept tokens
 *      signed by this key.
 *   4. Export the private key + the original audience (api://<client-id>)
 *      to a temp file that test files can import.
 *
 * Why a temp file for the private key?
 *   vitest's globalSetup runs in a separate process from test files. We
 *   cannot pass JS objects directly between them — only env vars and
 *   the filesystem. PEM strings in env vars work fine for the public
 *   key (auth plugin reads it from env), but for the private key we
 *   want a structured handoff so tests can pull both the PEM and the
 *   expected audience cleanly.
 *
 * Env var sources:
 *   - Locally: `.env.local` (Entra dev app reg)
 *   - CI: GitHub Actions repo secrets injected into process.env by the
 *     `Run tests` step in .github/workflows/ci.yml (slice #2c-beta, K9)
 *
 *   We load .env.local if present (no-op on CI). Either path must end
 *   up with `ENTRA_API_CLIENT_ID` in process.env, or setup fails with
 *   a clear error. `MONGO_URI` is no longer required — we generate it
 *   from the in-memory MongoDB instance.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { generateTestKeyPair } from './helpers/test-jwt.js';

// ESM equivalent of __dirname
const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Module-level MongoDB instance (for teardown)
// ---------------------------------------------------------------------------

/**
 * In-memory MongoDB replica set. Initialized in setup(), stopped in
 * teardown(). Held at module level so teardown() can access it.
 *
 * Replica set (not standalone) — see file header for the transaction
 * rationale.
 */
let mongoServer: MongoMemoryReplSet | null = null;

// ---------------------------------------------------------------------------
// Temp file location for handing the private key to test processes
// ---------------------------------------------------------------------------

/**
 * Path where the test private key + metadata is written. Test files
 * read this in `beforeAll` via `loadTestKeys()` (in test-jwt-loader.ts).
 *
 * Located in the OS temp dir so it doesn't pollute the repo. Cleaned
 * up by teardown (or just left to be overwritten on next run).
 */
export const TEST_KEYS_FILE = join(tmpdir(), 'sfz-test-keys.json');

// ---------------------------------------------------------------------------
// Load .env.local into process.env if present (no-op on CI)
// ---------------------------------------------------------------------------

function loadEnvLocal(): void {
  // Find .env.local relative to this file (tests/setup.ts → ../.env.local)
  const envPath = join(__dirname, '..', '.env.local');

  if (!existsSync(envPath)) {
    // Expected on CI — env vars come from GitHub Actions secrets instead.
    return;
  }

  const content = readFileSync(envPath, 'utf-8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    // Only set if not already in env (so explicit overrides win).
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Main setup function — vitest calls this exactly once
// ---------------------------------------------------------------------------

export default async function setup(): Promise<void> {
  // -- Ensure NODE_ENV is "test" so the auth plugin enables test JWT path
  process.env['NODE_ENV'] = 'test';

  // -- Load .env.local if present (no-op on CI where secrets are injected)
  loadEnvLocal();

  // -- Verify required env vars are present (either from .env.local or CI)
  const apiClientId = process.env['ENTRA_API_CLIENT_ID'];
  if (!apiClientId) {
    throw new Error(
      'tests/setup.ts: ENTRA_API_CLIENT_ID is not set. ' +
        'Locally: add it to apps/api/.env.local. ' +
        'On CI: configure ENTRA_API_CLIENT_ID_TEST as a repo secret and ' +
        'inject it via the workflow env block.',
    );
  }

  // -- Start in-memory MongoDB replica set ------------------------------
  //
  // Single-node replica set: required for multi-document transactions
  // used in every API write path. See file header for context.
  //
  // Eliminates Atlas Flex read-after-write consistency issues and makes
  // tests 5x faster. First run after a fresh install downloads the
  // mongod binary (~70 MB); subsequent runs reuse the cache.
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const mongoUri = mongoServer.getUri();
  process.env['MONGO_URI'] = mongoUri;

  console.info(`\n🗄️  In-memory MongoDB replica set started at ${mongoUri}\n`);

  // -- Generate keypair for Entra test JWT path --------------------------
  const { publicKeyPem, privateKeyPem } = await generateTestKeyPair();

  // -- Export public key via env var so config plugin picks it up --------
  process.env['TEST_JWT_PUBLIC_KEY'] = publicKeyPem;

  // -- Generate RS256 keypair for Inventario JWT (ADR-0013) ---------------
  // These are used by the inventario-jwt plugin for issuing/verifying
  // access tokens in the email/OAuth auth flows.
  const inventarioKeys = await generateTestKeyPair();
  process.env['JWT_PRIVATE_KEY'] = inventarioKeys.privateKeyPem;
  process.env['JWT_PUBLIC_KEY'] = inventarioKeys.publicKeyPem;
  // TTL defaults — short for tests to keep token-expiry assertions feasible.
  process.env['JWT_ACCESS_TOKEN_TTL_SECONDS'] ??= '900'; // 15 min
  process.env['JWT_REFRESH_TOKEN_TTL_DAYS'] ??= '7';

  // -- Write private key + metadata to temp file for test files ---------
  //
  // Auth plugin accepts tokens whose `aud` is either the raw client ID
  // GUID or `api://<client-id>`. Tests use the raw GUID for simplicity.
  const payload = {
    privateKeyPem,
    audience: apiClientId,
  };
  writeFileSync(TEST_KEYS_FILE, JSON.stringify(payload), { mode: 0o600 });

  console.info(
    `🔑 Test JWT keypair generated. Public key in TEST_JWT_PUBLIC_KEY env. Private key at ${TEST_KEYS_FILE}.\n`,
  );
}

// ---------------------------------------------------------------------------
// Teardown function — vitest calls this when all tests complete
// ---------------------------------------------------------------------------

/**
 * Stop the in-memory MongoDB replica set to allow the test process to
 * exit cleanly. Called automatically by vitest's globalSetup/
 * globalTeardown mechanism.
 */
export async function teardown(): Promise<void> {
  if (mongoServer) {
    await mongoServer.stop();
    console.info('\n🛝️  In-memory MongoDB replica set stopped.\n');
  }
}

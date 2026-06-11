// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Vitest global setup — runs once before any test file loads.
 *
 * Responsibilities:
 *   1. Start an in-memory MongoDB replica set (mongodb-memory-server) and
 *      override `MONGO_URI` to point to it. Replica set mode is required
 *      because the API uses `session.withTransaction(...)` in every write
 *      path; a standalone mongod would reject every POST/PATCH/DELETE.
 *   2. Generate an ephemeral RS256 keypair for the Inventario JWT plugin
 *      (JWT_PRIVATE_KEY / JWT_PUBLIC_KEY). Tests call
 *      `app.inventarioJwt.issueAccessToken(user, org)` directly to mint
 *      tokens; no separate test-JWT signing infrastructure is needed.
 *
 * Slice #6c K17 note:
 *   The old TEST_JWT_PUBLIC_KEY / test-keys temp file have been removed.
 *   Tokens are now issued by the real Inventario JWT plugin running against
 *   the test keypair, and passed as cookies (`cookies: { inv_access: token }`)
 *   in app.inject() calls.
 */

import { existsSync, readFileSync } from 'node:fs';
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
// Load .env.local into process.env if present (no-op on CI)
// ---------------------------------------------------------------------------

function loadEnvLocal(): void {
  const envPath = join(__dirname, '..', '.env.local');
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, 'utf-8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Main setup function — vitest calls this exactly once
// ---------------------------------------------------------------------------

export default async function setup(): Promise<void> {
  process.env['NODE_ENV'] = 'test';
  loadEnvLocal();

  // -- Start in-memory MongoDB replica set ---------------------------------
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const mongoUri = mongoServer.getUri();
  process.env['MONGO_URI'] = mongoUri;

  console.info(`\n🗄️  In-memory MongoDB replica set started at ${mongoUri}\n`);

  // -- Generate RS256 keypair for Inventario JWT ---------------------------
  //
  // Tests call `app.inventarioJwt.issueAccessToken(user, org)` directly to
  // obtain tokens; the private key never leaves the server process.
  const inventarioKeys = await generateTestKeyPair();
  process.env['JWT_PRIVATE_KEY'] = inventarioKeys.privateKeyPem;
  process.env['JWT_PUBLIC_KEY'] = inventarioKeys.publicKeyPem;
  process.env['JWT_ACCESS_TOKEN_TTL_SECONDS'] ??= '900';
  process.env['JWT_REFRESH_TOKEN_TTL_DAYS'] ??= '7';

  // -- Generate ephemeral MFA encryption key for TOTP secrets --------------
  // 32 bytes (64 hex chars). Used by AES-256-GCM to encrypt user TOTP
  // secrets at rest. Different every test run (fresh DB anyway).
  const { randomBytes } = await import('node:crypto');
  process.env['MFA_SECRET_ENCRYPTION_KEY'] ??= randomBytes(32).toString('hex');

  // -- WebAuthn test config (matches passkeys.test.ts constants) --------
  process.env['WEBAUTHN_RP_ID'] ??= 'localhost';
  process.env['WEBAUTHN_RP_NAME'] ??= 'Inventario Test';
  process.env['WEBAUTHN_EXPECTED_ORIGINS'] ??= 'http://localhost:3001';

  console.info('🔑 Inventario JWT keypair generated for test run.\n');
}

// ---------------------------------------------------------------------------
// Teardown function
// ---------------------------------------------------------------------------

export async function teardown(): Promise<void> {
  if (mongoServer) {
    await mongoServer.stop();
    console.info('\n🛝️  In-memory MongoDB replica set stopped.\n');
  }
}

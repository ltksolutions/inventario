// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Test JWT helper — generate keypair + sign tokens for integration tests.
 *
 * Why we sign our own tokens:
 *   Production code verifies JWTs against Microsoft's JWKS. Real Entra
 *   tokens require completing an OAuth device-code flow in a browser,
 *   which is impossible in automated tests. Instead we generate an
 *   ephemeral RSA keypair at the start of the test run, configure the
 *   auth plugin to ALSO accept tokens signed by our public key (with
 *   a distinct issuer URL), and sign whatever claims we need per-test.
 *
 * Security boundary:
 *   The auth plugin only enables this second verification path when
 *   `TEST_JWT_PUBLIC_KEY` env var is set AND `NODE_ENV !== 'production'`.
 *   Without both, our test tokens are rejected like any other bogus JWT.
 *
 * Algorithm choice:
 *   RS256 to match Entra (no algorithm confusion possible). The 2048-bit
 *   keypair takes ~50ms to generate, done once per test run.
 */

import { generateKeyPair, exportSPKI, exportPKCS8, importPKCS8, SignJWT } from 'jose';

import type { KeyLike } from 'jose';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The issuer string we use for test-signed JWTs. The auth plugin treats
 * any token with this `iss` claim as a test token and verifies it against
 * `TEST_JWT_PUBLIC_KEY` instead of Microsoft's JWKS.
 *
 * Chosen to look obviously synthetic — no chance of colliding with a
 * real Microsoft issuer URL.
 */
export const TEST_JWT_ISSUER = 'urn:inventario-test:dev';

/**
 * Test tenant ID — a fixed GUID used as the `tid` claim. The auth plugin
 * accepts whatever `tid` the test token carries (it only enforces tenant
 * match for Entra-issued tokens).
 */
export const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The `kid` (key ID) we embed in test JWT headers. Helps anyone debugging
 * a failed test identify the token as test-issued rather than Entra-issued.
 */
export const TEST_JWT_KID = 'inventario-test-key';

// ---------------------------------------------------------------------------
// Keypair generation
// ---------------------------------------------------------------------------

/**
 * Result of `generateTestKeyPair()`. Holds both keys plus their PEM
 * encodings — PEM is what we export to env vars / files.
 */
export interface TestKeyPair {
  publicKey: KeyLike;
  privateKey: KeyLike;
  publicKeyPem: string;
  privateKeyPem: string;
}

/**
 * Generate a fresh RSA-2048 keypair for test JWT signing.
 *
 * Called once at the start of each test run (via vitest globalSetup).
 * ~50ms cost; subsequent token signs are <1ms.
 */
export async function generateTestKeyPair(): Promise<TestKeyPair> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
    extractable: true,
  });

  const publicKeyPem = await exportSPKI(publicKey);
  const privateKeyPem = await exportPKCS8(privateKey);

  return { publicKey, privateKey, publicKeyPem, privateKeyPem };
}

// ---------------------------------------------------------------------------
// Token signing
// ---------------------------------------------------------------------------

/**
 * Subset of Entra claims that tests typically need to specify. Only `oid`
 * is required; everything else has a sensible default.
 *
 * Note that the actual token will ALSO include standard claims like `iss`,
 * `aud`, `iat`, `exp` that are set automatically.
 */
export interface SignTestTokenInput {
  /**
   * Microsoft Object ID — the stable per-user identifier our users
   * collection is keyed by. Tests pass a deterministic GUID here so
   * they can assert on later DB lookups.
   */
  oid: string;

  /** Display name; defaults to "Test User". */
  name?: string;
  /** Email; defaults to "<oid>@test.firma.sk". */
  email?: string;
  /** First name; defaults to "Test". */
  given_name?: string;
  /** Surname; defaults to "User". */
  family_name?: string;
  /** Preferred username; defaults to email. */
  preferred_username?: string;

  /**
   * Audience for the token. Defaults to whatever `ENTRA_API_CLIENT_ID`
   * was during test setup, but tests can override (e.g. to verify that
   * a wrong-audience token is rejected).
   */
  aud?: string;

  /** Scopes; defaults to "access_as_user". */
  scp?: string;

  /**
   * Override the issuer. Defaults to TEST_JWT_ISSUER. Tests can pass
   * something else to verify rejection of unknown issuers.
   */
  iss?: string;

  /**
   * Override expiration. Defaults to 1 hour from now. Pass a past
   * Unix timestamp to test rejection of expired tokens.
   */
  exp?: number;
}

/**
 * Sign a JWT with the test private key. Returns the compact JWS string.
 *
 * Use in tests:
 *   const token = await signTestToken(privateKey, { oid: 'user-abc' });
 *   const res = await app.inject({
 *     method: 'GET',
 *     url: '/v1/me',
 *     headers: { authorization: `Bearer ${token}` },
 *   });
 */
export async function signTestToken(
  privateKey: KeyLike,
  input: SignTestTokenInput,
  audience: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const name = input.name ?? 'Test User';
  const email = input.email ?? `${input.oid}@test.firma.sk`;

  const claims: Record<string, unknown> = {
    oid: input.oid,
    tid: TEST_TENANT_ID,
    sub: input.oid, // we don't distinguish sub from oid in tests
    ver: '2.0',
    scp: input.scp ?? 'access_as_user',
    name,
    given_name: input.given_name ?? 'Test',
    family_name: input.family_name ?? 'User',
    email,
    preferred_username: input.preferred_username ?? email,
  };

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: TEST_JWT_KID, typ: 'JWT' })
    .setIssuer(input.iss ?? TEST_JWT_ISSUER)
    .setAudience(input.aud ?? audience)
    .setIssuedAt(now)
    .setExpirationTime(input.exp ?? now + 3600)
    .sign(privateKey);
}

// ---------------------------------------------------------------------------
// Private key import (from PEM env var)
// ---------------------------------------------------------------------------

/**
 * Re-import a PKCS8 PEM private key as a jose KeyLike.
 *
 * The test setup generates a keypair and stores the private key PEM in
 * a global (module-scope) variable. Test files import that PEM and use
 * this helper to re-hydrate the key for signing.
 */
export async function importTestPrivateKey(pem: string): Promise<KeyLike> {
  return importPKCS8(pem, 'RS256');
}

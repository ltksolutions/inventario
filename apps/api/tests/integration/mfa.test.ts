/**
 * Integration tests for TOTP MFA — Slice #7.
 *
 * Covers all 5 endpoints + login flow integration:
 *   POST /v1/auth/mfa/setup
 *   POST /v1/auth/mfa/verify-setup
 *   POST /v1/auth/mfa/disable
 *   GET  /v1/auth/mfa/status
 *   POST /v1/auth/mfa/challenge
 *   POST /v1/auth/login/email  (with MFA gate)
 */

import { randomBytes } from 'node:crypto';

import { AccountType, AuthProvider, UserRole } from '@inventario/shared-types';
import argon2 from 'argon2';
import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { generateCodeForTesting } from '../../src/lib/totp.js';
import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { provisionUser, resolveTestTenantId } from '../helpers/test-fixtures.js';

import type { User } from '@inventario/shared-types';
import type { FastifyInstance } from 'fastify';
import type { WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * Provision an email-password user (LOCAL account) suitable for MFA tests.
 * Returns the user doc + the bcrypt-verified plaintext password +
 * an inv_access cookie value.
 */
async function provisionEmailUser(
  app: FastifyInstance,
  options: { mfaEnabled?: boolean; password?: string; email?: string } = {},
): Promise<{ user: WithId<User>; password: string; cookie: string }> {
  const stamp = randomBytes(4).toString('hex');
  const email = options.email ?? `mfa-user-${stamp}@example.com`;
  const password = options.password ?? 'securePassw0rd!!';
  const organisationId = await resolveTestTenantId(app);
  const now = new Date().toISOString();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const insertRes = await app.mongo.db.collection<User>('users').insertOne({
    organisationId,
    email,
    firstName: 'Test',
    lastName: 'User',
    displayName: 'Test User',
    accountType: AccountType.LOCAL,
    entraOid: null,
    authProviders: [
      {
        provider: AuthProvider.EMAIL,
        providerId: email,
        email,
        linkedAt: now,
      },
    ],
    emailVerified: true,
    emailVerificationToken: null,
    emailVerificationExpiresAt: null,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    passwordHash,
    roles: [UserRole.EMPLOYEE],
    organizationalUnit: null,
    teams: [],
    isActive: true,
    lastLoginAt: now,
    invitationSentAt: null,
    mustChangePassword: false,
    mfaEnabled: options.mfaEnabled ?? false,
    mfaSecret: null,
    mfaRecoveryCodes: [],
    mfaEnabledAt: null,
    preferences: {
      language: 'sk',
      timezone: 'Europe/Bratislava',
      emailNotifications: true,
      pushNotifications: false,
    },
    createdAt: now,
    updatedAt: now,
    createdBy: 'test',
    updatedBy: 'test',
    deletedAt: null,
    deletedBy: null,
  } as never);

  const user = (await app.mongo.db
    .collection<User>('users')
    .findOne({ _id: insertRes.insertedId } as never)) as WithId<User>;

  // Create membership so the login flow (which resolves tenant via membership)
  // can find the org. Without this, POST /v1/auth/login/email returns 401.
  await app.mongo.db.collection('memberships').insertOne({
    userId: String(insertRes.insertedId),
    organisationId,
    roles: [UserRole.EMPLOYEE],
    organizationalUnit: null,
    teams: [],
    status: 'ACTIVE',
    isDefault: true,
    invitedBy: 'test',
    invitedAt: now,
    acceptedAt: now,
    mustChangePassword: false,
    lastAccessedAt: now,
    notifications: { email: true, push: false },
    createdAt: now,
    updatedAt: now,
    createdBy: 'test',
    updatedBy: 'test',
    deletedAt: null,
    deletedBy: null,
  });

  const org = (await app.mongo.db
    .collection('organisations')
    .findOne({ _id: new ObjectId(organisationId) } as never)) as never;

  const cookie = await app.inventarioJwt.issueAccessToken(user as never, org);
  return { user, password, cookie };
}

// ---------------------------------------------------------------------------
// POST /v1/auth/mfa/setup
// ---------------------------------------------------------------------------

describe('POST /v1/auth/mfa/setup', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  it('returns secret + otpauth URL + 8 recovery codes', async () => {
    const { cookie } = await provisionEmailUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/setup',
      headers: { cookie: `inv_access=${cookie}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ secret: string; otpauthUrl: string; recoveryCodes: string[] }>();
    expect(body.secret).toMatch(/^[A-Z2-7]+$/); // base32
    expect(body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Inventario:/);
    expect(body.recoveryCodes).toHaveLength(8);
    expect(body.recoveryCodes.every((c) => /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c))).toBe(true);
  });

  it('stores encrypted secret + hashed recovery codes in DB', async () => {
    const { user, cookie } = await provisionEmailUser(app);
    await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/setup',
      headers: { cookie: `inv_access=${cookie}` },
    });
    const fresh = (await app.mongo.db
      .collection<User>('users')
      .findOne({ _id: user._id } as never)) as WithId<User>;
    expect(fresh.mfaEnabled).toBe(false); // not yet activated
    expect(fresh.mfaSecret).toMatch(/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/); // iv:tag:ct
    expect(fresh.mfaRecoveryCodes).toHaveLength(8);
    // Hashes, not plaintext
    expect(fresh.mfaRecoveryCodes.every((h) => h.startsWith('$argon2'))).toBe(true);
  });

  it('returns 401 without auth cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/mfa/setup' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when MFA is already enabled', async () => {
    const { cookie } = await provisionEmailUser(app, { mfaEnabled: true });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/setup',
      headers: { cookie: `inv_access=${cookie}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/already enabled/i);
  });

  it('idempotent — calling twice overwrites pending secret', async () => {
    const { cookie, user } = await provisionEmailUser(app);
    const r1 = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/setup',
      headers: { cookie: `inv_access=${cookie}` },
    });
    const r2 = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/setup',
      headers: { cookie: `inv_access=${cookie}` },
    });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    const s1 = r1.json<{ secret: string }>().secret;
    const s2 = r2.json<{ secret: string }>().secret;
    expect(s1).not.toBe(s2);
    const fresh = (await app.mongo.db
      .collection<User>('users')
      .findOne({ _id: user._id } as never)) as WithId<User>;
    expect(fresh.mfaEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /v1/auth/mfa/verify-setup
// ---------------------------------------------------------------------------

describe('POST /v1/auth/mfa/verify-setup', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  it('activates MFA with valid TOTP code → 204', async () => {
    const { cookie, user } = await provisionEmailUser(app);
    const setupRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/setup',
      headers: { cookie: `inv_access=${cookie}` },
    });
    const secret = setupRes.json<{ secret: string }>().secret;
    const code = generateCodeForTesting(secret);

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/verify-setup',
      headers: { cookie: `inv_access=${cookie}` },
      payload: { code },
    });
    expect(verifyRes.statusCode).toBe(204);

    const fresh = (await app.mongo.db
      .collection<User>('users')
      .findOne({ _id: user._id } as never)) as WithId<User>;
    expect(fresh.mfaEnabled).toBe(true);
    expect(fresh.mfaEnabledAt).not.toBeNull();
  });

  it('returns 400 for invalid TOTP code', async () => {
    const { cookie } = await provisionEmailUser(app);
    await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/setup',
      headers: { cookie: `inv_access=${cookie}` },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/verify-setup',
      headers: { cookie: `inv_access=${cookie}` },
      payload: { code: '000000' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/invalid code/i);
  });

  it('returns 400 if no pending setup exists', async () => {
    const { cookie } = await provisionEmailUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/verify-setup',
      headers: { cookie: `inv_access=${cookie}` },
      payload: { code: '123456' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/no pending/i);
  });

  it('returns 400 for malformed code (not 6 digits)', async () => {
    const { cookie } = await provisionEmailUser(app);
    await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/setup',
      headers: { cookie: `inv_access=${cookie}` },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/verify-setup',
      headers: { cookie: `inv_access=${cookie}` },
      payload: { code: 'abcdef' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when MFA is already enabled', async () => {
    const { cookie } = await provisionEmailUser(app, { mfaEnabled: true });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/verify-setup',
      headers: { cookie: `inv_access=${cookie}` },
      payload: { code: '123456' },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /v1/auth/mfa/disable
// ---------------------------------------------------------------------------

describe('POST /v1/auth/mfa/disable', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  it('disables MFA when password is correct → 204', async () => {
    // Setup an MFA-enabled user (provision + setup + verify-setup)
    const { cookie, password, user } = await provisionEmailUser(app);
    const setupRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/setup',
      headers: { cookie: `inv_access=${cookie}` },
    });
    const secret = setupRes.json<{ secret: string }>().secret;
    await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/verify-setup',
      headers: { cookie: `inv_access=${cookie}` },
      payload: { code: generateCodeForTesting(secret) },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/disable',
      headers: { cookie: `inv_access=${cookie}` },
      payload: { password },
    });
    expect(res.statusCode).toBe(204);

    const fresh = (await app.mongo.db
      .collection<User>('users')
      .findOne({ _id: user._id } as never)) as WithId<User>;
    expect(fresh.mfaEnabled).toBe(false);
    expect(fresh.mfaSecret).toBeNull();
    expect(fresh.mfaRecoveryCodes).toEqual([]);
    expect(fresh.mfaEnabledAt).toBeNull();
  });

  it('returns 401 for wrong password', async () => {
    const { cookie } = await provisionEmailUser(app, { mfaEnabled: true });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/disable',
      headers: { cookie: `inv_access=${cookie}` },
      payload: { password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for OAuth-only account (no passwordHash)', async () => {
    // Provision via the standard helper (ENTRA_ID accountType, no
    // passwordHash). Their mfaEnabled is false by default but the
    // route checks passwordHash before mfaEnabled state.
    const { token } = await provisionUser(app, { oid: 'oauth-mfa', role: UserRole.EMPLOYEE });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/disable',
      headers: { cookie: `inv_access=${token}` },
      payload: { password: 'anything' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/OAuth-only/i);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/auth/mfa/status
// ---------------------------------------------------------------------------

describe('GET /v1/auth/mfa/status', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  it('returns disabled state for a fresh user', async () => {
    const { cookie } = await provisionEmailUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/mfa/status',
      headers: { cookie: `inv_access=${cookie}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      enabled: boolean;
      enabledAt: string | null;
      recoveryCodesRemaining: number;
    }>();
    expect(body.enabled).toBe(false);
    expect(body.enabledAt).toBeNull();
    expect(body.recoveryCodesRemaining).toBe(0);
  });

  it('returns enabled state with recovery code count after activation', async () => {
    const { cookie } = await provisionEmailUser(app);
    const setupRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/setup',
      headers: { cookie: `inv_access=${cookie}` },
    });
    const secret = setupRes.json<{ secret: string }>().secret;
    await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/verify-setup',
      headers: { cookie: `inv_access=${cookie}` },
      payload: { code: generateCodeForTesting(secret) },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/mfa/status',
      headers: { cookie: `inv_access=${cookie}` },
    });
    const body = res.json<{ enabled: boolean; recoveryCodesRemaining: number }>();
    expect(body.enabled).toBe(true);
    expect(body.recoveryCodesRemaining).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Login flow MFA gate
// ---------------------------------------------------------------------------

describe('POST /v1/auth/login/email — MFA gate', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  it('returns 204 + cookies when MFA is disabled', async () => {
    const { password, user } = await provisionEmailUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login/email',
      payload: { email: user.email, password },
    });
    expect(res.statusCode).toBe(204);
    expect(res.cookies.some((c) => c.name === 'inv_access')).toBe(true);
  });

  it('returns 202 + mfaSessionToken when MFA is enabled', async () => {
    const { password, user } = await provisionEmailUser(app, { mfaEnabled: true });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login/email',
      payload: { email: user.email, password },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json<{ mfaRequired: boolean; mfaSessionToken: string }>();
    expect(body.mfaRequired).toBe(true);
    expect(body.mfaSessionToken.length).toBeGreaterThan(20);
    // No cookies should be set on 202
    expect(res.cookies.some((c) => c.name === 'inv_access')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /v1/auth/mfa/challenge
// ---------------------------------------------------------------------------

describe('POST /v1/auth/mfa/challenge', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  /** Helper: full MFA setup flow. Returns the user, password, plaintext secret + recovery codes, and a fresh mfaSessionToken from login. */
  async function setupEnabledUserAndLogin(): Promise<{
    user: WithId<User>;
    password: string;
    secret: string;
    recoveryCodes: string[];
    mfaSessionToken: string;
  }> {
    const { cookie, password, user } = await provisionEmailUser(app);
    const setupRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/setup',
      headers: { cookie: `inv_access=${cookie}` },
    });
    const { secret, recoveryCodes } = setupRes.json<{
      secret: string;
      recoveryCodes: string[];
    }>();
    await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/verify-setup',
      headers: { cookie: `inv_access=${cookie}` },
      payload: { code: generateCodeForTesting(secret) },
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login/email',
      payload: { email: user.email, password },
    });
    const { mfaSessionToken } = loginRes.json<{ mfaSessionToken: string }>();
    return { user, password, secret, recoveryCodes, mfaSessionToken };
  }

  it('valid TOTP code → 204 + auth cookies set', async () => {
    const { secret, mfaSessionToken } = await setupEnabledUserAndLogin();
    // Use a code 30s in the future so it isn't the same as the verify-setup code
    // (would still pass, but cleaner test).
    const code = generateCodeForTesting(secret);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/challenge',
      payload: { mfaSessionToken, code },
    });
    expect(res.statusCode).toBe(204);
    expect(res.cookies.some((c) => c.name === 'inv_access')).toBe(true);
    expect(res.cookies.some((c) => c.name === 'inv_refresh')).toBe(true);
  });

  it('valid recovery code → 204 + code consumed (removed from DB)', async () => {
    const { user, recoveryCodes, mfaSessionToken } = await setupEnabledUserAndLogin();
    const recoveryCode = recoveryCodes[0]!;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/challenge',
      payload: { mfaSessionToken, code: recoveryCode },
    });
    expect(res.statusCode).toBe(204);

    const fresh = (await app.mongo.db
      .collection<User>('users')
      .findOne({ _id: user._id } as never)) as WithId<User>;
    expect(fresh.mfaRecoveryCodes).toHaveLength(7); // one consumed
  });

  it('recovery code is single-use: second attempt fails', async () => {
    const { recoveryCodes, mfaSessionToken, user, password } = await setupEnabledUserAndLogin();
    const recoveryCode = recoveryCodes[0]!;

    await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/challenge',
      payload: { mfaSessionToken, code: recoveryCode },
    });

    // Get a fresh mfaSessionToken (the previous one is single-use too in principle)
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login/email',
      payload: { email: user.email, password },
    });
    const { mfaSessionToken: newToken } = loginRes.json<{ mfaSessionToken: string }>();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/challenge',
      payload: { mfaSessionToken: newToken, code: recoveryCode },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for invalid TOTP code', async () => {
    const { mfaSessionToken } = await setupEnabledUserAndLogin();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/challenge',
      payload: { mfaSessionToken, code: '000000' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for invalid recovery code', async () => {
    const { mfaSessionToken } = await setupEnabledUserAndLogin();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/challenge',
      payload: { mfaSessionToken, code: 'XXXX-XXXX' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for malformed mfaSessionToken', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/challenge',
      payload: { mfaSessionToken: 'not-a-jwt-token-just-junk-data', code: '123456' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 if user becomes inactive between login and challenge', async () => {
    const { user, secret, mfaSessionToken } = await setupEnabledUserAndLogin();
    await app.mongo.db
      .collection('users')
      .updateOne({ _id: user._id } as never, { $set: { isActive: false } });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/challenge',
      payload: { mfaSessionToken, code: generateCodeForTesting(secret) },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 if MFA gets disabled between login and challenge', async () => {
    const { user, secret, mfaSessionToken } = await setupEnabledUserAndLogin();
    await app.mongo.db.collection('users').updateOne({ _id: user._id } as never, {
      $set: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: [] },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/challenge',
      payload: { mfaSessionToken, code: generateCodeForTesting(secret) },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Full end-to-end MFA flow
// ---------------------------------------------------------------------------

describe('Full MFA E2E flow', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  it('setup → verify → logout → login → challenge → /me works', async () => {
    const { cookie, password, user } = await provisionEmailUser(app);

    // 1. Setup
    const setupRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/setup',
      headers: { cookie: `inv_access=${cookie}` },
    });
    expect(setupRes.statusCode).toBe(200);
    const { secret } = setupRes.json<{ secret: string }>();

    // 2. Verify-setup
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/verify-setup',
      headers: { cookie: `inv_access=${cookie}` },
      payload: { code: generateCodeForTesting(secret) },
    });
    expect(verifyRes.statusCode).toBe(204);

    // 3. Fresh login attempt → 202
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login/email',
      payload: { email: user.email, password },
    });
    expect(loginRes.statusCode).toBe(202);
    const { mfaSessionToken } = loginRes.json<{ mfaSessionToken: string }>();

    // 4. Challenge with TOTP → 204 + cookies
    const challengeRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/challenge',
      payload: { mfaSessionToken, code: generateCodeForTesting(secret) },
    });
    expect(challengeRes.statusCode).toBe(204);
    const accessCookie = challengeRes.cookies.find((c) => c.name === 'inv_access');
    expect(accessCookie).toBeDefined();

    // 5. Use the new cookie to call /v1/auth/me
    const meRes = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { cookie: `inv_access=${accessCookie!.value}` },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json<{ user: { email: string } }>().user.email).toBe(user.email);
  });
});

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests — K12a Forced MFA setup flow.
 *
 * Covers:
 *   - Login returns mfaSetupRequired when org requires MFA and user has no MFA
 *   - Login returns mfaRequired (not mfaSetupRequired) when user already has MFA
 *   - Login returns 204 (cookies) when org does not require MFA
 *   - Login returns 204 when org has no MFA settings at all
 *   - POST /v1/auth/mfa/forced-setup — happy path (returns secret, URL, codes)
 *   - POST /v1/auth/mfa/forced-setup — already enabled → 400
 *   - POST /v1/auth/mfa/forced-setup — bad token → 401
 *   - POST /v1/auth/mfa/forced-verify — full happy path → 204 + cookies + mfaEnabled
 *   - POST /v1/auth/mfa/forced-verify — wrong code → 400
 *   - POST /v1/auth/mfa/forced-verify — no pending setup → 400
 *   - POST /v1/auth/mfa/forced-verify — bad token → 401
 *   - POST /v1/auth/mfa/forced-verify — MFA already active → 400
 */

import { randomBytes } from 'node:crypto';

import { AccountType, AuthProvider, UserRole } from '@inventario/shared-types';
import argon2 from 'argon2';
import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { generateCodeForTesting } from '../../src/lib/totp.js';
import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { resolveTestTenantId } from '../helpers/test-fixtures.js';

import type { User } from '@inventario/shared-types';
import type { FastifyInstance } from 'fastify';
import type { WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Shared helper: provision a LOCAL email/password user
// ---------------------------------------------------------------------------

async function provisionLocalUser(
  app: FastifyInstance,
  options: { mfaEnabled?: boolean; email?: string } = {},
): Promise<{ user: WithId<User>; password: string; cookie: string }> {
  const stamp = randomBytes(4).toString('hex');
  const email = options.email ?? `forced-mfa-${stamp}@test.inv`;
  const password = 'TestPass123!!';
  const organisationId = await resolveTestTenantId(app);
  const now = new Date().toISOString();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const res = await app.mongo.db.collection<User>('users').insertOne({
    organisationId,
    email,
    firstName: 'Test',
    lastName: 'User',
    displayName: 'Test User',
    accountType: AccountType.LOCAL,
    entraOid: null,
    authProviders: [{ provider: AuthProvider.EMAIL, providerId: email, email, linkedAt: now }],
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
    .findOne({ _id: res.insertedId } as never)) as WithId<User>;

  const org = (await app.mongo.db
    .collection('organisations')
    .findOne({ _id: new ObjectId(organisationId) } as never)) as never;

  const cookie = await app.inventarioJwt.issueAccessToken(user as never, org);
  return { user, password, cookie };
}

/** Set org.settings.mfa.requireMfa for the test tenant. */
async function setOrgMfaRequired(app: FastifyInstance, requireMfa: boolean): Promise<void> {
  const tenantId = await resolveTestTenantId(app);
  await app.mongo.db
    .collection('organisations')
    .updateOne(
      { _id: new ObjectId(tenantId) as never },
      { $set: { 'settings.mfa': { requireMfa } } },
    );
}

// ---------------------------------------------------------------------------
// Tests — Login forced-MFA gate
// ---------------------------------------------------------------------------

describe('POST /v1/auth/login/email — forced MFA gate (K12a)', () => {
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

  it('returns 202 mfaSetupRequired when org requireMfa=true and user has no MFA', async () => {
    const { user, password } = await provisionLocalUser(app);
    await setOrgMfaRequired(app, true);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login/email',
      payload: { email: user.email, password },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json<{ mfaSetupRequired: boolean; mfaSetupToken: string }>();
    expect(body.mfaSetupRequired).toBe(true);
    expect(typeof body.mfaSetupToken).toBe('string');
    expect(body.mfaSetupToken.length).toBeGreaterThan(20);
    // Must NOT issue auth cookies
    expect(res.cookies.some((c) => c.name === 'inv_access')).toBe(false);
  });

  it('returns 204 (cookies) when requireMfa=false', async () => {
    const { user, password } = await provisionLocalUser(app);
    await setOrgMfaRequired(app, false);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login/email',
      payload: { email: user.email, password },
    });

    expect(res.statusCode).toBe(204);
    expect(res.cookies.some((c) => c.name === 'inv_access')).toBe(true);
  });

  it('returns 204 when org has no MFA settings at all', async () => {
    const { user, password } = await provisionLocalUser(app);
    // No setOrgMfaRequired call — default org has empty settings

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login/email',
      payload: { email: user.email, password },
    });

    expect(res.statusCode).toBe(204);
  });

  it('returns mfaRequired (not mfaSetupRequired) when user already has MFA + org requires it', async () => {
    const { user, password } = await provisionLocalUser(app, { mfaEnabled: true });
    await setOrgMfaRequired(app, true);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login/email',
      payload: { email: user.email, password },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json<{ mfaRequired?: boolean; mfaSetupRequired?: boolean }>();
    expect(body.mfaRequired).toBe(true);
    expect(body.mfaSetupRequired).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — POST /v1/auth/mfa/forced-setup
// ---------------------------------------------------------------------------

describe('POST /v1/auth/mfa/forced-setup', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
    await setOrgMfaRequired(app, true);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  async function getSetupToken(
    app: FastifyInstance,
  ): Promise<{ token: string; user: WithId<User>; password: string }> {
    const { user, password } = await provisionLocalUser(app);
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login/email',
      payload: { email: user.email, password },
    });
    expect(loginRes.statusCode).toBe(202);
    const { mfaSetupToken } = loginRes.json<{ mfaSetupToken: string }>();
    return { token: mfaSetupToken, user, password };
  }

  it('returns 200 with secret, otpauthUrl and 8 recoveryCodes', async () => {
    const { token } = await getSetupToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/forced-setup',
      payload: { mfaSetupToken: token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ secret: string; otpauthUrl: string; recoveryCodes: string[] }>();
    expect(body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(body.otpauthUrl).toContain('otpauth://totp/');
    expect(body.recoveryCodes).toHaveLength(8);
  });

  it('returns 401 for invalid mfaSetupToken', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/forced-setup',
      payload: { mfaSetupToken: 'invalid.garbage.token.value.x' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when user already has MFA enabled', async () => {
    const { token, user } = await getSetupToken(app);
    // Manually enable MFA
    await app.mongo.db.collection('users').updateOne({ _id: user._id } as never, {
      $set: { mfaEnabled: true, mfaEnabledAt: new Date().toISOString() },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/forced-setup',
      payload: { mfaSetupToken: token },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/already enabled/i);
  });
});

// ---------------------------------------------------------------------------
// Tests — POST /v1/auth/mfa/forced-verify
// ---------------------------------------------------------------------------

describe('POST /v1/auth/mfa/forced-verify', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
    await setOrgMfaRequired(app, true);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  async function getSetupTokenAndSecret(
    app: FastifyInstance,
  ): Promise<{ setupToken: string; secret: string; user: WithId<User>; password: string }> {
    const { user, password } = await provisionLocalUser(app);
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login/email',
      payload: { email: user.email, password },
    });
    expect(loginRes.statusCode).toBe(202);
    const { mfaSetupToken } = loginRes.json<{ mfaSetupToken: string }>();

    const setupRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/forced-setup',
      payload: { mfaSetupToken },
    });
    expect(setupRes.statusCode).toBe(200);
    const { secret } = setupRes.json<{ secret: string }>();

    return { setupToken: mfaSetupToken, secret, user, password };
  }

  it('full flow: valid code → 204, auth cookies set, mfaEnabled in DB', async () => {
    const { setupToken, secret, user } = await getSetupTokenAndSecret(app);
    const code = generateCodeForTesting(secret);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/forced-verify',
      payload: { mfaSetupToken: setupToken, code },
    });

    expect(res.statusCode).toBe(204);
    expect(res.cookies.some((c) => c.name === 'inv_access')).toBe(true);
    expect(res.cookies.some((c) => c.name === 'inv_refresh')).toBe(true);

    // Verify MFA enabled in DB
    const fresh = (await app.mongo.db
      .collection<User>('users')
      .findOne({ _id: user._id } as never)) as WithId<User>;
    expect(fresh.mfaEnabled).toBe(true);
    expect(fresh.mfaEnabledAt).not.toBeNull();
  });

  it('returns 400 for wrong TOTP code', async () => {
    const { setupToken } = await getSetupTokenAndSecret(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/forced-verify',
      payload: { mfaSetupToken: setupToken, code: '000000' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/invalid code/i);
  });

  it('returns 400 when forced-setup was not called first', async () => {
    const { user, password } = await provisionLocalUser(app);
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login/email',
      payload: { email: user.email, password },
    });
    const { mfaSetupToken } = loginRes.json<{ mfaSetupToken: string }>();

    // Skip forced-setup — go straight to forced-verify
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/forced-verify',
      payload: { mfaSetupToken, code: '123456' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/forced-setup first/i);
  });

  it('returns 401 for invalid mfaSetupToken', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/forced-verify',
      payload: { mfaSetupToken: 'bad.garbage.token', code: '123456' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when MFA already active at verify time', async () => {
    const { setupToken, user } = await getSetupTokenAndSecret(app);
    // Manually flip mfaEnabled
    await app.mongo.db.collection('users').updateOne({ _id: user._id } as never, {
      $set: { mfaEnabled: true, mfaEnabledAt: new Date().toISOString() },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/forced-verify',
      payload: { mfaSetupToken: setupToken, code: '123456' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/already active/i);
  });
});

// ---------------------------------------------------------------------------
// Full E2E forced-MFA flow
// ---------------------------------------------------------------------------

describe('Forced MFA E2E flow', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
    await setOrgMfaRequired(app, true);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  it('login → forced-setup → forced-verify → /v1/me works', async () => {
    const { user, password } = await provisionLocalUser(app);

    // 1. Login → 202 mfaSetupRequired
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login/email',
      payload: { email: user.email, password },
    });
    expect(loginRes.statusCode).toBe(202);
    const { mfaSetupToken } = loginRes.json<{ mfaSetupToken: string }>();

    // 2. Forced-setup → secret
    const setupRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/forced-setup',
      payload: { mfaSetupToken },
    });
    expect(setupRes.statusCode).toBe(200);
    const { secret } = setupRes.json<{ secret: string }>();

    // 3. Forced-verify → auth cookies
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/forced-verify',
      payload: { mfaSetupToken, code: generateCodeForTesting(secret) },
    });
    expect(verifyRes.statusCode).toBe(204);
    const accessCookie = verifyRes.cookies.find((c) => c.name === 'inv_access');
    expect(accessCookie).toBeDefined();

    // 4. Use the new cookie to hit /v1/me
    const meRes = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: `inv_access=${accessCookie!.value}` },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json<{ email: string }>().email).toBe(user.email);
  });
});

/**
 * Integration tests for invite accept via OAuth — Slice #6c K18.3.
 *
 * Tests the full invite-accept OAuth path:
 *   GET /v1/auth/login/:provider?invitationToken=...  — state cookie generation
 *   GET /v1/auth/callback/:provider                   — invite acceptance
 *
 * Arctic and external fetch calls (Google userinfo / MS Graph) are mocked
 * so no real OAuth traffic is made during tests.
 */

import { randomBytes } from 'node:crypto';

import { AccountType, AuthProvider, UserRole } from '@inventario/shared-types';
import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OAUTH_STATE_COOKIE,
  generateOAuthState,
  serializeOAuthState,
} from '../../src/modules/auth/oauth-state.js';
import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { resolveTestTenantId } from '../helpers/test-fixtures.js';

import type { User } from '@inventario/shared-types';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mock arctic so no real OAuth provider is hit
// ---------------------------------------------------------------------------

vi.mock('arctic', () => ({
  Google: vi.fn().mockImplementation(() => ({
    createAuthorizationURL: vi.fn().mockReturnValue(new URL('https://accounts.google.com')),
    validateAuthorizationCode: vi.fn().mockResolvedValue({
      accessToken: () => 'mock-google-access-token',
    }),
  })),
  MicrosoftEntraId: vi.fn().mockImplementation(() => ({
    createAuthorizationURL: vi.fn().mockReturnValue(new URL('https://login.microsoftonline.com')),
    validateAuthorizationCode: vi.fn().mockResolvedValue({
      accessToken: () => 'mock-ms-access-token',
    }),
  })),
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_OAUTH_STATE_SECRET = 'test-oauth-state-secret-32-bytes!!';
const TEST_REDIRECT_BASE = 'http://localhost:3000/v1/auth/callback';
const TEST_FRONTEND_BASE = 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Provision a pending invite user in the test DB. */
async function insertPendingInvite(
  app: FastifyInstance,
  opts: { email?: string; expiresInMs?: number; firstName?: string; lastName?: string } = {},
): Promise<{ userId: string; email: string; token: string }> {
  const stamp = randomBytes(4).toString('hex');
  const email = opts.email ?? `invite-oauth-${stamp}@example.com`;
  const token = randomBytes(32).toString('hex'); // 64-char hex
  const organisationId = await resolveTestTenantId(app);
  const now = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + (opts.expiresInMs ?? 7 * 24 * 60 * 60 * 1000),
  ).toISOString();

  const result = await app.mongo.db.collection<User>('users').insertOne({
    organisationId,
    email,
    firstName: opts.firstName ?? '',
    lastName: opts.lastName ?? '',
    displayName: email,
    accountType: AccountType.LOCAL,
    authProviders: [],
    emailVerified: false,
    emailVerificationToken: token,
    emailVerificationExpiresAt: expiresAt,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    passwordHash: null,
    roles: [UserRole.EMPLOYEE],
    organizationalUnit: null,
    teams: [],
    isActive: true,
    lastLoginAt: null,
    invitationSentAt: now,
    mustChangePassword: false,
    mfaEnabled: false,
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
    createdBy: 'test-setup',
    updatedBy: 'test-setup',
    deletedAt: null,
    deletedBy: null,
  } as never);

  return { userId: result.insertedId.toString(), email, token };
}

/** Build a signed oauth state cookie with invitationToken. */
function makeOAuthStateCookie(opts: {
  provider: 'google' | 'microsoft';
  invitationToken: string;
}): string {
  const payload = generateOAuthState({
    provider: opts.provider,
    invitationToken: opts.invitationToken,
  });
  return serializeOAuthState(payload, TEST_OAUTH_STATE_SECRET);
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('GET /v1/auth/login/:provider?invitationToken=... — state generation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env['OAUTH_STATE_SECRET'] = TEST_OAUTH_STATE_SECRET;
    process.env['OAUTH_REDIRECT_BASE_URL'] = TEST_REDIRECT_BASE;
    process.env['FRONTEND_BASE_URL'] = TEST_FRONTEND_BASE;
    process.env['GOOGLE_CLIENT_ID'] = 'test-google-client-id';
    process.env['GOOGLE_CLIENT_SECRET'] = 'test-google-client-secret';
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

  it('sets state cookie containing invitationToken', async () => {
    const invitationToken = randomBytes(32).toString('hex');
    const res = await app.inject({
      method: 'GET',
      url: `/v1/auth/login/google?invitationToken=${invitationToken}`,
    });

    // Should redirect to Google
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');

    // State cookie must be set
    const cookies = res.cookies;
    const stateCookie = cookies.find((c) => c.name === OAUTH_STATE_COOKIE);
    expect(stateCookie).toBeDefined();

    // Decode the cookie payload to verify invitationToken is embedded
    const cookieVal = stateCookie!.value;
    const dotIdx = cookieVal.lastIndexOf('.');
    const json = cookieVal.slice(0, dotIdx);
    const decoded = JSON.parse(Buffer.from(json, 'base64url').toString('utf-8')) as {
      invitationToken?: string;
    };
    expect(decoded.invitationToken).toBe(invitationToken);
  });

  it('does not include invitationToken in state when omitted', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/auth/login/google`,
    });

    const stateCookie = res.cookies.find((c) => c.name === OAUTH_STATE_COOKIE);
    expect(stateCookie).toBeDefined();

    const cookieVal = stateCookie!.value;
    const dotIdx = cookieVal.lastIndexOf('.');
    const json = cookieVal.slice(0, dotIdx);
    const decoded = JSON.parse(Buffer.from(json, 'base64url').toString('utf-8')) as Record<
      string,
      unknown
    >;
    expect(decoded['invitationToken']).toBeUndefined();
  });
});

describe('GET /v1/auth/callback/google — invite accept via OAuth', () => {
  let app: FastifyInstance;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeAll(async () => {
    process.env['OAUTH_STATE_SECRET'] = TEST_OAUTH_STATE_SECRET;
    process.env['OAUTH_REDIRECT_BASE_URL'] = TEST_REDIRECT_BASE;
    process.env['FRONTEND_BASE_URL'] = TEST_FRONTEND_BASE;
    process.env['GOOGLE_CLIENT_ID'] = 'test-google-client-id';
    process.env['GOOGLE_CLIENT_SECRET'] = 'test-google-client-secret';
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
    fetchSpy?.mockRestore();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
    fetchSpy?.mockRestore();
  });

  /** Helper: build a valid callback request for an invite accept. */
  async function callbackWithInvite(inviteToken: string, googleEmail: string) {
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          sub: `google-sub-${randomBytes(4).toString('hex')}`,
          email: googleEmail,
          email_verified: true,
          given_name: 'Test',
          family_name: 'User',
          name: 'Test User',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const stateCookieVal = makeOAuthStateCookie({
      provider: 'google',
      invitationToken: inviteToken,
    });
    // The state value in the state cookie payload must match the ?state= query param.
    const dotIdx = stateCookieVal.lastIndexOf('.');
    const json = stateCookieVal.slice(0, dotIdx);
    const payload = JSON.parse(Buffer.from(json, 'base64url').toString('utf-8')) as {
      state: string;
    };

    return app.inject({
      method: 'GET',
      url: `/v1/auth/callback/google?code=mock-code&state=${payload.state}`,
      headers: {
        cookie: `${OAUTH_STATE_COOKIE}=${stateCookieVal}`,
      },
    });
  }

  it('happy path: accepts invite + sets auth cookies + redirects to /dashboard?invited=accepted', async () => {
    const { email, token } = await insertPendingInvite(app);

    const res = await callbackWithInvite(token, email);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${TEST_FRONTEND_BASE}/dashboard?invited=accepted`);
    expect(res.cookies.some((c) => c.name === 'inv_access')).toBe(true);
    expect(res.cookies.some((c) => c.name === 'inv_refresh')).toBe(true);
  });

  it('activates user document (emailVerified, authProviders, accountType)', async () => {
    const { email, token, userId } = await insertPendingInvite(app);
    await callbackWithInvite(token, email);

    const updated = (await app.mongo.db
      .collection<User>('users')
      .findOne({ _id: new ObjectId(userId) as never })) as User;

    expect(updated.emailVerified).toBe(true);
    expect(updated.emailVerificationToken).toBeNull();
    expect(updated.accountType).toBe(AccountType.ENTRA_ID);
    expect(updated.authProviders).toHaveLength(1);
    expect(updated.authProviders[0]?.provider).toBe(AuthProvider.GOOGLE);
    expect(updated.passwordHash).toBeNull(); // never set
  });

  it('emits USER_INVITATION_ACCEPTED audit event with via=oauth-google', async () => {
    const { email, token } = await insertPendingInvite(app);
    await callbackWithInvite(token, email);

    const audit = await app.mongo.db.collection('audit_logs').findOne({
      action: 'USER_INVITATION_ACCEPTED',
    });
    expect(audit).not.toBeNull();
    expect(audit?.['metadata']?.['via']).toBe('oauth-google');
  });

  it('redirects to login?error=invite_email_mismatch when provider email differs', async () => {
    const { token } = await insertPendingInvite(app, { email: 'real@example.com' });

    const res = await callbackWithInvite(token, 'different@example.com');

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('error=invite_email_mismatch');
    expect(res.cookies.some((c) => c.name === 'inv_access')).toBe(false);
  });

  it('redirects to login?error=invite_expired when token is past expiry', async () => {
    const { email, token } = await insertPendingInvite(app, { expiresInMs: -1 }); // already expired

    const res = await callbackWithInvite(token, email);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('error=invite_expired');
  });

  it('redirects to login?error=invite_not_found for unknown token', async () => {
    const fakeToken = randomBytes(32).toString('hex');
    await insertPendingInvite(app, { email: 'real@example.com' });

    const res = await callbackWithInvite(fakeToken, 'real@example.com');

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('error=invite_not_found');
  });
});

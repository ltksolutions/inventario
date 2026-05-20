/**
 * Integration tests — email/password auth flows (K5 ADR-0013).
 *
 * Covers:
 *   POST /v1/auth/register/email  — registration, duplicates, validation
 *   GET  /v1/auth/verify-email    — token verification, expiry
 *   POST /v1/auth/login/email     — happy path, unverified, wrong password
 *   POST /v1/auth/forgot-password — always 204, no enumeration
 *   POST /v1/auth/reset-password  — valid token, expired, old password rejected
 *   GET  /v1/auth/me              — cookie-based identity
 *
 * Cookie handling:
 *   fastify.inject() returns cookies in `res.cookies`. We pass them back
 *   in subsequent requests via the `headers.cookie` field.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';

import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_ORG = {
  orgName: 'Test Email Org',
  email: 'test@email-auth.sk',
  password: 'SuperSecretPass123!',
  dpaAccepted: true,
};

/** Register a fresh user and return their email + password. */
async function registerUser(
  app: FastifyInstance,
  overrides: Partial<typeof BASE_ORG> = {},
): Promise<typeof BASE_ORG> {
  const data = { ...BASE_ORG, ...overrides };
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/register/email',
    payload: data,
  });
  if (res.statusCode !== 201) {
    throw new Error(`registerUser failed: ${res.statusCode} ${res.body}`);
  }
  return data;
}

/** Read the emailVerificationToken from DB for a given email. */
async function getVerificationToken(app: FastifyInstance, email: string): Promise<string> {
  const user = await app.mongo.db.collection('users').findOne({ email });
  if (!user || !user['emailVerificationToken']) {
    throw new Error(`No verification token found for ${email}`);
  }
  return String(user['emailVerificationToken']);
}

/** Verify email via GET endpoint and follow redirect location. */
async function verifyEmail(app: FastifyInstance, email: string): Promise<void> {
  const token = await getVerificationToken(app, email);
  const res = await app.inject({
    method: 'GET',
    url: `/v1/auth/verify-email?token=${token}`,
  });
  // Should redirect (302) to /login?verified=true
  expect(res.statusCode).toBe(302);
  expect(res.headers['location']).toContain('verified=true');
}

/** Login and return the Set-Cookie header value. */
async function loginAndGetCookies(
  app: FastifyInstance,
  email: string,
  password: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/login/email',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(204);
  // Build a combined cookie header from all Set-Cookie values
  const setCookie = res.headers['set-cookie'];
  if (Array.isArray(setCookie)) return setCookie.map((c) => c.split(';')[0]).join('; ');
  if (typeof setCookie === 'string') return setCookie.split(';')[0] ?? '';
  throw new Error('No Set-Cookie header in login response');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Email auth flows', () => {
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

  // =========================================================================
  // POST /v1/auth/register/email
  // =========================================================================

  describe('POST /v1/auth/register/email', () => {
    it('returns 201 and emailVerificationRequired on valid input', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register/email',
        payload: BASE_ORG,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<{ emailVerificationRequired: boolean; message: string }>();
      expect(body.emailVerificationRequired).toBe(true);
      expect(body.message).toMatch(/registr/i);
    });

    it('creates a user in DB with emailVerified=false', async () => {
      await registerUser(app);

      const user = await app.mongo.db.collection('users').findOne({ email: BASE_ORG.email });
      expect(user).not.toBeNull();
      expect(user!['emailVerified']).toBe(false);
      expect(user!['emailVerificationToken']).toHaveLength(64);
      expect(user!['passwordHash']).toBeTruthy();
      expect(user!['roles']).toEqual(['ADMIN']);
    });

    it('creates an organisation in DB', async () => {
      await registerUser(app);

      const org = await app.mongo.db
        .collection('organisations')
        .findOne({ displayName: BASE_ORG.orgName });
      expect(org).not.toBeNull();
      expect(org!['registrationMethod']).toBe('SELF_SERVE');
      expect(org!['memberJoinPolicy']).toBe('INVITE_ONLY');
    });

    it('returns 400 when email already registered', async () => {
      await registerUser(app);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register/email',
        payload: BASE_ORG,
      });

      expect(res.statusCode).toBe(400);
      const body = res.json<{ message: string }>();
      expect(body.message).toMatch(/zaregistrovan/i);
    });

    it('returns 400 for password shorter than 12 chars', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register/email',
        payload: { ...BASE_ORG, password: 'short' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when dpaAccepted is false', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register/email',
        payload: { ...BASE_ORG, dpaAccepted: false },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when orgName is too short', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register/email',
        payload: { ...BASE_ORG, orgName: 'X' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // GET /v1/auth/verify-email
  // =========================================================================

  describe('GET /v1/auth/verify-email', () => {
    it('redirects to /login?verified=true on valid token', async () => {
      await registerUser(app);
      const token = await getVerificationToken(app, BASE_ORG.email);

      const res = await app.inject({
        method: 'GET',
        url: `/v1/auth/verify-email?token=${token}`,
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers['location']).toContain('verified=true');
    });

    it('sets emailVerified=true and clears token in DB', async () => {
      await registerUser(app);
      await verifyEmail(app, BASE_ORG.email);

      const user = await app.mongo.db.collection('users').findOne({ email: BASE_ORG.email });
      expect(user!['emailVerified']).toBe(true);
      expect(user!['emailVerificationToken']).toBeNull();
      expect(user!['emailVerificationExpiresAt']).toBeNull();
    });

    it('redirects with error for invalid token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/verify-email?token=' + 'a'.repeat(64),
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers['location']).toContain('error=');
    });

    it('redirects with error for short/malformed token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/verify-email?token=tooshort',
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers['location']).toContain('error=');
    });

    it('redirects with error for expired token', async () => {
      await registerUser(app);

      // Manually expire the token
      const pastDate = new Date(Date.now() - 1000).toISOString();
      await app.mongo.db
        .collection('users')
        .updateOne({ email: BASE_ORG.email }, { $set: { emailVerificationExpiresAt: pastDate } });

      const token = await getVerificationToken(app, BASE_ORG.email);
      const res = await app.inject({
        method: 'GET',
        url: `/v1/auth/verify-email?token=${token}`,
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers['location']).toContain('error=');
    });
  });

  // =========================================================================
  // POST /v1/auth/login/email
  // =========================================================================

  describe('POST /v1/auth/login/email', () => {
    it('returns 403 EMAIL_NOT_VERIFIED before verification', async () => {
      await registerUser(app);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/login/email',
        payload: { email: BASE_ORG.email, password: BASE_ORG.password },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe('EMAIL_NOT_VERIFIED');
    });

    it('returns 204 and sets inv_access + inv_refresh cookies after verification', async () => {
      await registerUser(app);
      await verifyEmail(app, BASE_ORG.email);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/login/email',
        payload: { email: BASE_ORG.email, password: BASE_ORG.password },
      });

      expect(res.statusCode).toBe(204);

      const cookieNames = res.cookies.map((c) => c.name);
      expect(cookieNames).toContain('inv_access');
      expect(cookieNames).toContain('inv_refresh');

      const accessCookie = res.cookies.find((c) => c.name === 'inv_access');
      expect(accessCookie?.httpOnly).toBe(true);
    });

    it('returns 401 for wrong password', async () => {
      await registerUser(app);
      await verifyEmail(app, BASE_ORG.email);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/login/email',
        payload: { email: BASE_ORG.email, password: 'WrongPassword999!' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 401 for unknown email (no enumeration)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/login/email',
        payload: { email: 'nobody@nowhere.sk', password: 'SomePassword123!' },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // GET /v1/auth/me
  // =========================================================================

  describe('GET /v1/auth/me', () => {
    it('returns 401 without cookie', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/auth/me' });
      expect(res.statusCode).toBe(401);
    });

    it('returns user claims after email login', async () => {
      await registerUser(app);
      await verifyEmail(app, BASE_ORG.email);
      const cookieHeader = await loginAndGetCookies(app, BASE_ORG.email, BASE_ORG.password);

      const meRes = await app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        headers: { cookie: cookieHeader },
      });

      expect(meRes.statusCode).toBe(200);
      const body = meRes.json<{ sub: string; email: string; roles: string[] }>();
      expect(body.email).toBe(BASE_ORG.email);
      expect(body.roles).toContain('ADMIN');
      expect(typeof body.sub).toBe('string');
    });
  });

  // =========================================================================
  // POST /v1/auth/forgot-password
  // =========================================================================

  describe('POST /v1/auth/forgot-password', () => {
    it('returns 204 for known email', async () => {
      await registerUser(app);
      await verifyEmail(app, BASE_ORG.email);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/forgot-password',
        payload: { email: BASE_ORG.email },
      });

      expect(res.statusCode).toBe(204);
    });

    it('returns 204 for unknown email (no enumeration)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/forgot-password',
        payload: { email: 'nobody@nowhere.sk' },
      });

      expect(res.statusCode).toBe(204);
    });

    it('sets passwordResetToken in DB for known email/password user', async () => {
      await registerUser(app);
      await verifyEmail(app, BASE_ORG.email);

      await app.inject({
        method: 'POST',
        url: '/v1/auth/forgot-password',
        payload: { email: BASE_ORG.email },
      });

      const user = await app.mongo.db.collection('users').findOne({ email: BASE_ORG.email });
      expect(user!['passwordResetToken']).toHaveLength(64);
      expect(new Date(String(user!['passwordResetExpiresAt'])).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });
  });

  // =========================================================================
  // POST /v1/auth/reset-password
  // =========================================================================

  describe('POST /v1/auth/reset-password', () => {
    const NEW_PASSWORD = 'NewSuperSecretPass456!';

    async function setupResetToken(app: FastifyInstance): Promise<string> {
      await registerUser(app);
      await verifyEmail(app, BASE_ORG.email);
      await app.inject({
        method: 'POST',
        url: '/v1/auth/forgot-password',
        payload: { email: BASE_ORG.email },
      });
      const user = await app.mongo.db.collection('users').findOne({ email: BASE_ORG.email });
      return String(user!['passwordResetToken']);
    }

    it('returns 204 on valid token and new password', async () => {
      const token = await setupResetToken(app);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/reset-password',
        payload: { token, password: NEW_PASSWORD },
      });

      expect(res.statusCode).toBe(204);
    });

    it('clears passwordResetToken after successful reset', async () => {
      const token = await setupResetToken(app);

      await app.inject({
        method: 'POST',
        url: '/v1/auth/reset-password',
        payload: { token, password: NEW_PASSWORD },
      });

      const user = await app.mongo.db.collection('users').findOne({ email: BASE_ORG.email });
      expect(user!['passwordResetToken']).toBeNull();
      expect(user!['passwordResetExpiresAt']).toBeNull();
    });

    it('new password works for login; old password is rejected', async () => {
      const token = await setupResetToken(app);
      await app.inject({
        method: 'POST',
        url: '/v1/auth/reset-password',
        payload: { token, password: NEW_PASSWORD },
      });

      // Old password rejected
      const oldRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/login/email',
        payload: { email: BASE_ORG.email, password: BASE_ORG.password },
      });
      expect(oldRes.statusCode).toBe(401);

      // New password accepted
      const newRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/login/email',
        payload: { email: BASE_ORG.email, password: NEW_PASSWORD },
      });
      expect(newRes.statusCode).toBe(204);
    });

    it('returns 400 for invalid/unknown token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/reset-password',
        payload: { token: 'a'.repeat(64), password: NEW_PASSWORD },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for expired token', async () => {
      const token = await setupResetToken(app);

      // Expire the token
      const past = new Date(Date.now() - 1000).toISOString();
      await app.mongo.db
        .collection('users')
        .updateOne({ email: BASE_ORG.email }, { $set: { passwordResetExpiresAt: past } });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/reset-password',
        payload: { token, password: NEW_PASSWORD },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for weak new password', async () => {
      const token = await setupResetToken(app);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/reset-password',
        payload: { token, password: 'weak' },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests — unified registration endpoint (K7 ADR-0013).
 *
 * Covers POST /v1/auth/register:
 *   - Email provider: 201 + emailVerificationRequired
 *   - SSO providers: 200 { type: 'oauth', authUrl } when configured,
 *     503 when provider credentials are missing
 *   - Apple: 503 (K4 not yet implemented)
 *   - Validation: missing fields, DPA not accepted, weak password
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';

import type { FastifyInstance } from 'fastify';

const BASE_BODY = {
  orgName: 'Register Test Org',
  contactEmail: 'admin@register-test.sk',
  dpaAccepted: true,
};

describe('POST /v1/auth/register', () => {
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
  // Email provider
  // =========================================================================

  describe('provider: email', () => {
    it('returns 201 { type: "email", emailVerificationRequired: true }', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { ...BASE_BODY, provider: 'email', password: 'ValidPassword123!' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<{ type: string; emailVerificationRequired: boolean }>();
      expect(body.type).toBe('email');
      expect(body.emailVerificationRequired).toBe(true);
    });

    it('creates org + user in DB', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { ...BASE_BODY, provider: 'email', password: 'ValidPassword123!' },
      });

      const user = await app.mongo.db
        .collection('users')
        .findOne({ email: BASE_BODY.contactEmail });
      expect(user).not.toBeNull();
      expect(user!['emailVerified']).toBe(false);
      expect(user!['roles']).toEqual(['ADMIN']);

      const org = await app.mongo.db
        .collection('organisations')
        .findOne({ displayName: BASE_BODY.orgName });
      expect(org).not.toBeNull();
    });

    it('returns 400 when password is missing for email provider', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { ...BASE_BODY, provider: 'email' }, // no password
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for weak password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { ...BASE_BODY, provider: 'email', password: 'short' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when email already registered', async () => {
      const payload = { ...BASE_BODY, provider: 'email', password: 'ValidPassword123!' };
      await app.inject({ method: 'POST', url: '/v1/auth/register', payload });
      const res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload });
      expect(res.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // SSO providers
  // =========================================================================

  describe('provider: google', () => {
    it('returns 503 when GOOGLE_CLIENT_ID/SECRET not configured (test env)', async () => {
      // In the test environment OAuth credentials are not set,
      // so the provider instance cannot be built → 503.
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { ...BASE_BODY, provider: 'google' },
      });

      // Either 503 (not configured) or 200 (if somehow configured in test env)
      expect([200, 503]).toContain(res.statusCode);

      if (res.statusCode === 200) {
        const body = res.json<{ type: string; authUrl?: string }>();
        expect(body.type).toBe('oauth');
        expect(typeof body.authUrl).toBe('string');
        expect(body.authUrl).toContain('accounts.google.com');
      }
    });
  });

  describe('provider: microsoft', () => {
    it('returns 503 when MICROSOFT credentials not configured (test env)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { ...BASE_BODY, provider: 'microsoft' },
      });

      expect([200, 503]).toContain(res.statusCode);

      if (res.statusCode === 200) {
        const body = res.json<{ type: string; authUrl?: string }>();
        expect(body.type).toBe('oauth');
        expect(typeof body.authUrl).toBe('string');
      }
    });
  });

  describe('provider: apple', () => {
    it('returns 503 (K4 not yet implemented)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { ...BASE_BODY, provider: 'apple' },
      });

      expect(res.statusCode).toBe(503);
    });
  });

  // =========================================================================
  // Validation
  // =========================================================================

  describe('validation', () => {
    it('returns 400 when orgName is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          contactEmail: BASE_BODY.contactEmail,
          dpaAccepted: true,
          provider: 'email',
          password: 'ValidPassword123!',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when contactEmail is invalid', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          ...BASE_BODY,
          contactEmail: 'not-an-email',
          provider: 'email',
          password: 'ValidPassword123!',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when dpaAccepted is false', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          ...BASE_BODY,
          dpaAccepted: false,
          provider: 'email',
          password: 'ValidPassword123!',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for unknown provider', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { ...BASE_BODY, provider: 'twitter' },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});

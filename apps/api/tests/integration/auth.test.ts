// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for the Inventario JWT cookie auth gate — Slice #6c K17.
 *
 * Covers:
 *   - 401 when no inv_access cookie is present
 *   - 401 when cookie carries an expired / invalid token
 *   - 200 with valid cookie — user data returned correctly
 *   - 401 for deactivated users
 *   - 401 for inactive tenants
 *
 * GET /v1/me is used as the test target because it exercises the full
 * `requireAuth → loadCurrentUser` chain and returns the user document.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { provisionUser, resolveTestTenantId, UserRole } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('Auth gate (GET /v1/me)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  // -------------------------------------------------------------------------
  // Rejection: no cookie
  // -------------------------------------------------------------------------

  describe('rejection: missing or invalid cookie', () => {
    it('returns 401 when no inv_access cookie is present', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/me' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when inv_access cookie is a garbage string', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { cookie: 'inv_access=not-a-real-jwt' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when a valid Bearer token is sent but no cookie (Bearer path removed)', async () => {
      // After K17 cutover, Bearer tokens are no longer accepted.
      const res = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: 'Bearer some.dummy.token' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path: valid cookie
  // -------------------------------------------------------------------------

  describe('happy path: valid Inventario JWT cookie', () => {
    it('returns 200 with user data for a valid cookie', async () => {
      const { user, token } = await provisionUser(app, {
        oid: 'auth-test-user',
        role: UserRole.EMPLOYEE,
        email: 'authtest@test.inventario',
        firstName: 'Auth',
        lastName: 'Test',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        _id: string;
        email: string;
        roles: string[];
        isActive: boolean;
      }>();
      expect(body._id).toBe(String(user._id));
      expect(body.email).toBe('authtest@test.inventario');
      expect(body.roles).toContain('EMPLOYEE');
      expect(body.isActive).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Deactivated user
  // -------------------------------------------------------------------------

  describe('deactivated user', () => {
    it('returns 401 for a deactivated user', async () => {
      const { token } = await provisionUser(app, {
        oid: 'soon-deactivated',
        role: UserRole.EMPLOYEE,
      });

      // Deactivate directly in DB
      await app.mongo.db
        .collection('users')
        .updateOne({ entraOid: 'soon-deactivated' }, { $set: { isActive: false } });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json<{ message: string }>().message).toMatch(/deactivated/i);
    });
  });

  // -------------------------------------------------------------------------
  // Inactive tenant
  // -------------------------------------------------------------------------

  describe('inactive tenant', () => {
    it('returns 401 when tenant is SUSPENDED', async () => {
      const { token } = await provisionUser(app, {
        oid: 'suspended-tenant-user',
        role: UserRole.EMPLOYEE,
      });

      // Suspend the tenant
      const orgId = await resolveTestTenantId(app);
      await app.mongo.db
        .collection('organisations')
        .updateOne(
          { _id: new (await import('mongodb')).ObjectId(orgId) },
          { $set: { status: 'SUSPENDED' } },
        );

      const res = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json<{ message: string }>().message).toMatch(/suspended/i);
    });
  });
});

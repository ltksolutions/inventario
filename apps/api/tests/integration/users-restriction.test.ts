// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for POST /v1/users/:id/restriction — GDPR Art. 18
 * (right to restriction of processing) + enforcement in auth middleware.
 *
 * Test matrix:
 *   happy path:
 *     - admin restrictne usera → 200, isRestricted=true, restrictedAt set, reason uložený
 *     - admin zruší restrikciu → 200, isRestricted=false, restrictedAt=null
 *     - emituje USER_RESTRICTED / USER_UNRESTRICTED audit event
 *
 *   idempotencia / validácia:
 *     - restrict already-restricted → 400
 *     - unrestrict not-restricted → 400
 *     - 404 pre neznámeho usera
 *     - 400 pre nevalidný id
 *     - 400 ak chýba `restrict` v body
 *
 *   RBAC:
 *     - 403 pre EMPLOYEE
 *     - 401 bez cookie
 *
 *   enforcement (auth middleware):
 *     - restricted user: GET prejde (200)
 *     - restricted user: PATCH /v1/me → 403 PROCESSING_RESTRICTED
 *     - po zrušení restrikcie: PATCH /v1/me znova prejde (200)
 */

import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { insertTestUser, provisionUser, UserRole } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('POST /v1/users/:id/restriction (GDPR Art. 18)', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
    const { token } = await provisionUser(app, {
      oid: 'admin-for-restriction',
      role: UserRole.ADMIN,
    });
    adminToken = token;
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('restricts a user: 200 with isRestricted=true, restrictedAt set, reason stored', async () => {
      const target = await insertTestUser(app, { email: 'restrict-me@example.com' });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/users/${target._id}/restriction`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { restrict: true, reason: 'Pending dispute resolution' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();
      expect(body['isRestricted']).toBe(true);
      expect(body['restrictedAt']).not.toBeNull();
      expect(body['restrictionReason']).toBe('Pending dispute resolution');
    });

    it('lifts restriction: 200 with isRestricted=false, restrictedAt=null', async () => {
      const target = await insertTestUser(app);

      // First restrict
      await app.inject({
        method: 'POST',
        url: `/v1/users/${target._id}/restriction`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { restrict: true },
      });

      // Then lift
      const res = await app.inject({
        method: 'POST',
        url: `/v1/users/${target._id}/restriction`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { restrict: false },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();
      expect(body['isRestricted']).toBe(false);
      expect(body['restrictedAt']).toBeNull();
      expect(body['restrictionReason']).toBeNull();
    });

    it('emits USER_RESTRICTED audit event', async () => {
      const target = await insertTestUser(app);

      await app.inject({
        method: 'POST',
        url: `/v1/users/${target._id}/restriction`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { restrict: true },
      });

      const entry = await app.mongo.db.collection('audit_logs').findOne({
        action: 'USER_RESTRICTED',
        'target.entityId': target._id,
      });
      expect(entry).not.toBeNull();
    });

    it('emits USER_UNRESTRICTED audit event', async () => {
      const target = await insertTestUser(app);

      await app.inject({
        method: 'POST',
        url: `/v1/users/${target._id}/restriction`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { restrict: true },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/users/${target._id}/restriction`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { restrict: false },
      });

      const entry = await app.mongo.db.collection('audit_logs').findOne({
        action: 'USER_UNRESTRICTED',
        'target.entityId': target._id,
      });
      expect(entry).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency / validation
  // -------------------------------------------------------------------------

  describe('idempotency & validation', () => {
    it('returns 400 when restricting an already-restricted user', async () => {
      const target = await insertTestUser(app);

      await app.inject({
        method: 'POST',
        url: `/v1/users/${target._id}/restriction`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { restrict: true },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/users/${target._id}/restriction`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { restrict: true },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when lifting restriction on a non-restricted user', async () => {
      const target = await insertTestUser(app);

      const res = await app.inject({
        method: 'POST',
        url: `/v1/users/${target._id}/restriction`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { restrict: false },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for an unknown user', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/users/${new ObjectId().toString()}/restriction`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { restrict: true },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for a non-24-hex id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/users/not-a-hex/restriction',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { restrict: true },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when `restrict` is missing', async () => {
      const target = await insertTestUser(app);

      const res = await app.inject({
        method: 'POST',
        url: `/v1/users/${target._id}/restriction`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // RBAC
  // -------------------------------------------------------------------------

  describe('RBAC', () => {
    it('returns 403 for EMPLOYEE', async () => {
      const target = await insertTestUser(app);
      const { token } = await provisionUser(app, {
        oid: 'employee-for-restriction',
        role: UserRole.EMPLOYEE,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/users/${target._id}/restriction`,
        headers: { cookie: `inv_access=${token}` },
        payload: { restrict: true },
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 401 without auth cookie', async () => {
      const target = await insertTestUser(app);

      const res = await app.inject({
        method: 'POST',
        url: `/v1/users/${target._id}/restriction`,
        payload: { restrict: true },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // Enforcement (auth middleware)
  // -------------------------------------------------------------------------

  describe('enforcement', () => {
    it('restricted user: GET passes, PATCH /v1/me is blocked with 403', async () => {
      // Provision a normal employee with their own token
      const { user, token } = await provisionUser(app, {
        oid: 'restricted-enforcement',
        role: UserRole.EMPLOYEE,
      });

      // Admin restricts this user directly in DB (flag flip) — simpler than
      // routing through the admin endpoint which is tested above.
      await app.mongo.db
        .collection('users')
        .updateOne(
          { _id: new ObjectId(String(user._id)) },
          { $set: { isRestricted: true, restrictedAt: new Date().toISOString() } },
        );

      // GET should still work (read allowed under restriction)
      const getRes = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
      });
      expect(getRes.statusCode).toBe(200);

      // PATCH (mutating) should be blocked
      const patchRes = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: { firstName: 'ShouldNotWork' },
      });
      expect(patchRes.statusCode).toBe(403);
    });

    it('lifting restriction re-enables mutating requests', async () => {
      const { user, token } = await provisionUser(app, {
        oid: 'restricted-then-lifted',
        role: UserRole.EMPLOYEE,
      });

      // Restrict
      await app.mongo.db
        .collection('users')
        .updateOne(
          { _id: new ObjectId(String(user._id)) },
          { $set: { isRestricted: true, restrictedAt: new Date().toISOString() } },
        );

      const blocked = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: { firstName: 'Blocked' },
      });
      expect(blocked.statusCode).toBe(403);

      // Lift
      await app.mongo.db
        .collection('users')
        .updateOne(
          { _id: new ObjectId(String(user._id)) },
          { $set: { isRestricted: false, restrictedAt: null } },
        );

      const allowed = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: { firstName: 'Allowed' },
      });
      expect(allowed.statusCode).toBe(200);
    });
  });
});

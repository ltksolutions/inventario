// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for POST + PATCH + DELETE /v1/asset-conditions.
 * Mirrors asset-types.test.ts — same RBAC + FK protection patterns.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestAsset,
  insertTestAssetCondition,
  provisionUser,
  resolveTestTenantId,
  UserRole,
  validCreateAssetConditionBody,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('/v1/asset-conditions', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
  let employeeToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
    const { token: at } = await provisionUser(app, { oid: 'ac-admin', role: UserRole.ADMIN });
    const { token: mt } = await provisionUser(app, {
      oid: 'ac-manager',
      role: UserRole.ASSET_MANAGER,
    });
    const { token: et } = await provisionUser(app, {
      oid: 'ac-employee',
      role: UserRole.EMPLOYEE,
    });
    adminToken = at;
    managerToken = mt;
    employeeToken = et;
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  // -------------------------------------------------------------------------
  // GET list
  // -------------------------------------------------------------------------

  describe('GET /v1/asset-conditions', () => {
    it('returns 200 with data array for EMPLOYEE', async () => {
      await insertTestAssetCondition(app, { slug: 'nove', name: 'Nové' });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/asset-conditions',
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[]; pagination: { total: number } }>();
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 401 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/asset-conditions' });
      expect(res.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // POST
  // -------------------------------------------------------------------------

  describe('POST /v1/asset-conditions', () => {
    it('creates a condition and returns 201 (ADMIN)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/asset-conditions',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateAssetConditionBody({ name: 'Vynikajúce', slug: 'vynikajuce' }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ _id: string; name: string; slug: string }>();
      expect(body._id).toMatch(/^[a-f0-9]{24}$/);
      expect(body.name).toBe('Vynikajúce');
      expect(body.slug).toBe('vynikajuce');
    });

    it('creates a condition (ASSET_MANAGER)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/asset-conditions',
        headers: { cookie: `inv_access=${managerToken}` },
        payload: validCreateAssetConditionBody({ name: 'Dobré', slug: 'dobre' }),
      });
      expect(res.statusCode).toBe(201);
    });

    it('rejects POST for EMPLOYEE with 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/asset-conditions',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: validCreateAssetConditionBody(),
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects duplicate slug with 400', async () => {
      await insertTestAssetCondition(app, { slug: 'duplicate-condition' });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/asset-conditions',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateAssetConditionBody({ slug: 'duplicate-condition', name: 'Second' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/slug.*already exists/i);
    });

    it('auto-derives slug from name when omitted', async () => {
      const body = validCreateAssetConditionBody({ name: 'Opotrebované' });
      delete body['slug'];
      const res = await app.inject({
        method: 'POST',
        url: '/v1/asset-conditions',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<{ slug: string }>().slug).toBe('opotrebovane');
    });

    it('rejects empty name with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/asset-conditions',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateAssetConditionBody({ name: '' }),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // PATCH
  // -------------------------------------------------------------------------

  describe('PATCH /v1/asset-conditions/:id', () => {
    it('renames a condition (ADMIN)', async () => {
      const entry = await insertTestAssetCondition(app, { name: 'Staré', slug: 'stare' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/asset-conditions/${entry._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Použiteľné' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ name: string }>().name).toBe('Použiteľné');
    });

    it('rename does NOT change slug automatically', async () => {
      const entry = await insertTestAssetCondition(app, { name: 'Pôvodná', slug: 'povodna-cond' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/asset-conditions/${entry._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Nová' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ slug: string }>().slug).toBe('povodna-cond');
    });

    it('rejects PATCH for EMPLOYEE with 403', async () => {
      const entry = await insertTestAssetCondition(app, { slug: 'emp-patch-cond' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/asset-conditions/${entry._id}`,
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: { name: 'New name' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 404 for non-existent id', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/asset-conditions/0123456789abcdef01234567',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Whatever' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE
  // -------------------------------------------------------------------------

  describe('DELETE /v1/asset-conditions/:id', () => {
    it('soft-deletes an unused condition (ADMIN) and returns 204', async () => {
      const entry = await insertTestAssetCondition(app, { slug: 'deletable-cond' });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/asset-conditions/${entry._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(204);
    });

    it('rejects DELETE for ASSET_MANAGER with 403', async () => {
      const entry = await insertTestAssetCondition(app, { slug: 'manager-del-cond' });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/asset-conditions/${entry._id}`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects DELETE for EMPLOYEE with 403', async () => {
      const entry = await insertTestAssetCondition(app, { slug: 'emp-del-cond' });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/asset-conditions/${entry._id}`,
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects DELETE when assets reference the condition slug (FK protection)', async () => {
      const entry = await insertTestAssetCondition(app, { slug: 'referenced-cond' });
      const orgId = await resolveTestTenantId(app);
      await insertTestAsset(app, { condition: 'referenced-cond', organisationId: orgId });

      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/asset-conditions/${entry._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/asset.*reference/i);
    });

    it('soft-delete excludes entry from subsequent list', async () => {
      const entry = await insertTestAssetCondition(app, { slug: 'to-be-deleted-cond' });
      await app.inject({
        method: 'DELETE',
        url: `/v1/asset-conditions/${entry._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const list = await app.inject({
        method: 'GET',
        url: '/v1/asset-conditions',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const data = list.json<{ data: Array<{ _id: string }> }>().data;
      expect(data.find((c) => c._id === entry._id)).toBeUndefined();
    });

    it('returns 404 for non-existent id', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/asset-conditions/0123456789abcdef01234567',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});

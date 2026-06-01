/**
 * Integration tests for RBAC on /v1/assets endpoints — Slice #6c K17.
 * Authorization: cookie-based (inv_access) instead of Bearer token.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestAsset,
  provisionUser,
  seedAssetFkRefs,
  UserRole,
  validCreateAssetBody,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('RBAC on /v1/assets', () => {
  let app: FastifyInstance;
  let fkCategoryId: string;
  let fkLocationId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
    const fk = await seedAssetFkRefs(app);
    fkCategoryId = fk.categoryId;
    fkLocationId = fk.locationId;
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  const bodyWithFk = (overrides: Record<string, unknown> = {}) =>
    validCreateAssetBody({ categoryId: fkCategoryId, locationId: fkLocationId, ...overrides });

  describe('read access (EMPLOYEE)', () => {
    it('EMPLOYEE can GET /v1/assets (list)', async () => {
      const { token } = await provisionUser(app, {
        oid: 'employee-read-list',
        role: UserRole.EMPLOYEE,
      });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${token}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('EMPLOYEE can GET /v1/assets/:id', async () => {
      const asset = await insertTestAsset(app);
      const { token } = await provisionUser(app, {
        oid: 'employee-read-one',
        role: UserRole.EMPLOYEE,
      });
      const res = await app.inject({
        method: 'GET',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${token}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('EXTERNAL can also GET /v1/assets', async () => {
      const { token } = await provisionUser(app, {
        oid: 'external-read-list',
        role: UserRole.EXTERNAL,
      });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${token}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('write access (ASSET_MANAGER)', () => {
    it('ASSET_MANAGER can POST /v1/assets', async () => {
      const { token } = await provisionUser(app, {
        oid: 'asset-mgr-post',
        role: UserRole.ASSET_MANAGER,
      });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${token}` },
        payload: bodyWithFk(),
      });
      expect(res.statusCode).toBe(201);
    });

    it('ASSET_MANAGER can PATCH /v1/assets/:id', async () => {
      const asset = await insertTestAsset(app);
      const { token } = await provisionUser(app, {
        oid: 'asset-mgr-patch',
        role: UserRole.ASSET_MANAGER,
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${token}` },
        payload: { name: 'Updated by asset manager' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('ASSET_MANAGER cannot DELETE /v1/assets/:id (403)', async () => {
      const asset = await insertTestAsset(app);
      const { token } = await provisionUser(app, {
        oid: 'asset-mgr-delete-attempt',
        role: UserRole.ASSET_MANAGER,
      });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${token}` },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json<{ message: string }>().message).toMatch(/ADMIN/);
    });
  });

  describe('delete access (ADMIN only)', () => {
    it('ADMIN can DELETE /v1/assets/:id', async () => {
      const asset = await insertTestAsset(app);
      const { token } = await provisionUser(app, { oid: 'admin-delete', role: UserRole.ADMIN });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${token}` },
      });
      expect(res.statusCode).toBe(204);
    });
  });

  describe('EMPLOYEE forbidden writes', () => {
    it('EMPLOYEE cannot POST /v1/assets (403)', async () => {
      const { token } = await provisionUser(app, {
        oid: 'employee-post-attempt',
        role: UserRole.EMPLOYEE,
      });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${token}` },
        payload: bodyWithFk(),
      });
      expect(res.statusCode).toBe(403);
    });

    it('EMPLOYEE cannot PATCH /v1/assets/:id (403)', async () => {
      const asset = await insertTestAsset(app);
      const { token } = await provisionUser(app, {
        oid: 'employee-patch-attempt',
        role: UserRole.EMPLOYEE,
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${token}` },
        payload: { name: 'Should not be allowed' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('EMPLOYEE cannot DELETE /v1/assets/:id (403)', async () => {
      const asset = await insertTestAsset(app);
      const { token } = await provisionUser(app, {
        oid: 'employee-delete-attempt',
        role: UserRole.EMPLOYEE,
      });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${token}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('EXTERNAL forbidden writes', () => {
    it('EXTERNAL cannot POST /v1/assets (403)', async () => {
      const { token } = await provisionUser(app, {
        oid: 'external-post-attempt',
        role: UserRole.EXTERNAL,
      });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${token}` },
        payload: bodyWithFk(),
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

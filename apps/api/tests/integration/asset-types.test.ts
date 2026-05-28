// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for POST + PATCH + DELETE /v1/asset-types.
 *
 * Covers:
 *   - Happy path: create, update, list, get
 *   - Slug uniqueness + auto-generation
 *   - RBAC: EMPLOYEE can only GET, ASSET_MANAGER can POST/PATCH, ADMIN can DELETE
 *   - DELETE FK protection: blocked when assets reference the type slug
 *   - Soft-delete: deleted entry excluded from list
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestAsset,
  insertTestAssetType,
  provisionUser,
  resolveTestTenantId,
  UserRole,
  validCreateAssetTypeBody,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('/v1/asset-types', () => {
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
    const { token: at } = await provisionUser(app, { oid: 'at-admin', role: UserRole.ADMIN });
    const { token: mt } = await provisionUser(app, {
      oid: 'at-manager',
      role: UserRole.ASSET_MANAGER,
    });
    const { token: et } = await provisionUser(app, {
      oid: 'at-employee',
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

  describe('GET /v1/asset-types', () => {
    it('returns 200 with data array for EMPLOYEE', async () => {
      await insertTestAssetType(app, { slug: 'it-majetok', name: 'IT majetok' });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/asset-types',
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[]; pagination: { total: number } }>();
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.pagination.total).toBeGreaterThanOrEqual(1);
    });

    it('returns 401 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/asset-types' });
      expect(res.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // POST
  // -------------------------------------------------------------------------

  describe('POST /v1/asset-types', () => {
    it('creates an asset type and returns 201 (ADMIN)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/asset-types',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateAssetTypeBody({ name: 'Športová výstroj', slug: 'sportova-vystroj' }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ _id: string; name: string; slug: string; isActive: boolean }>();
      expect(body._id).toMatch(/^[a-f0-9]{24}$/);
      expect(body.name).toBe('Športová výstroj');
      expect(body.slug).toBe('sportova-vystroj');
      expect(body.isActive).toBe(true);
    });

    it('creates an asset type (ASSET_MANAGER)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/asset-types',
        headers: { cookie: `inv_access=${managerToken}` },
        payload: validCreateAssetTypeBody({ name: 'Kancelárske', slug: 'kancelarske' }),
      });
      expect(res.statusCode).toBe(201);
    });

    it('rejects POST for EMPLOYEE with 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/asset-types',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: validCreateAssetTypeBody(),
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects duplicate slug with 400', async () => {
      await insertTestAssetType(app, { slug: 'duplicate-type' });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/asset-types',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateAssetTypeBody({ slug: 'duplicate-type', name: 'Second' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/slug.*already exists/i);
    });

    it('auto-derives slug from name when omitted', async () => {
      const body = validCreateAssetTypeBody({ name: 'Tréningové vybavenie' });
      delete body['slug'];
      const res = await app.inject({
        method: 'POST',
        url: '/v1/asset-types',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<{ slug: string }>().slug).toBe('treningove-vybavenie');
    });

    it('appends -2 suffix when derived slug already exists', async () => {
      await insertTestAssetType(app, { slug: 'media', name: 'Médiá' });
      const body = validCreateAssetTypeBody({ name: 'Médiá' });
      delete body['slug'];
      const res = await app.inject({
        method: 'POST',
        url: '/v1/asset-types',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<{ slug: string }>().slug).toBe('media-2');
    });

    it('rejects empty name with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/asset-types',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateAssetTypeBody({ name: '' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid slug format (uppercase) with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/asset-types',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateAssetTypeBody({ slug: 'UPPER_CASE' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('sets createdBy to the calling user _id', async () => {
      const adminUser = await app.mongo.db.collection('users').findOne({ entraOid: 'at-admin' });
      const adminId = String(adminUser!._id);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/asset-types',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateAssetTypeBody(),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<{ createdBy: string }>().createdBy).toBe(adminId);
    });
  });

  // -------------------------------------------------------------------------
  // PATCH
  // -------------------------------------------------------------------------

  describe('PATCH /v1/asset-types/:id', () => {
    it('renames an asset type (ADMIN)', async () => {
      const entry = await insertTestAssetType(app, { name: 'Pôvodný názov', slug: 'povodny' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/asset-types/${entry._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Nový názov' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ name: string }>().name).toBe('Nový názov');
    });

    it('rename does NOT change slug automatically', async () => {
      const entry = await insertTestAssetType(app, { name: 'Pôvodný', slug: 'povodny-slug' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/asset-types/${entry._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Nový' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ slug: string }>().slug).toBe('povodny-slug');
    });

    it('rejects PATCH for EMPLOYEE with 403', async () => {
      const entry = await insertTestAssetType(app, { slug: 'emp-patch-type' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/asset-types/${entry._id}`,
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: { name: 'New name' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects PATCH with duplicate slug', async () => {
      await insertTestAssetType(app, { slug: 'taken-type-slug' });
      const entry = await insertTestAssetType(app, { slug: 'original-type-slug' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/asset-types/${entry._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { slug: 'taken-type-slug' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/slug.*already exists/i);
    });

    it('returns 404 for non-existent id', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/asset-types/0123456789abcdef01234567',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Whatever' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE
  // -------------------------------------------------------------------------

  describe('DELETE /v1/asset-types/:id', () => {
    it('soft-deletes an unused type (ADMIN) and returns 204', async () => {
      const entry = await insertTestAssetType(app, { slug: 'deletable-type' });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/asset-types/${entry._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(204);
    });

    it('rejects DELETE for ASSET_MANAGER with 403', async () => {
      const entry = await insertTestAssetType(app, { slug: 'manager-delete-type' });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/asset-types/${entry._id}`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects DELETE for EMPLOYEE with 403', async () => {
      const entry = await insertTestAssetType(app, { slug: 'emp-delete-type' });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/asset-types/${entry._id}`,
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects DELETE when assets reference the type slug (FK protection)', async () => {
      const entry = await insertTestAssetType(app, { slug: 'referenced-type' });
      const orgId = await resolveTestTenantId(app);
      await insertTestAsset(app, { type: 'referenced-type', organisationId: orgId });

      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/asset-types/${entry._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/asset.*reference/i);
    });

    it('soft-delete excludes entry from subsequent list', async () => {
      const entry = await insertTestAssetType(app, { slug: 'to-be-deleted-type' });
      await app.inject({
        method: 'DELETE',
        url: `/v1/asset-types/${entry._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const list = await app.inject({
        method: 'GET',
        url: '/v1/asset-types',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const data = list.json<{ data: Array<{ _id: string }> }>().data;
      expect(data.find((t) => t._id === entry._id)).toBeUndefined();
    });

    it('returns 404 for non-existent id', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/asset-types/0123456789abcdef01234567',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});

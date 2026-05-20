/**
 * Cross-tenant isolation tests — Slice #6c K17 (cookie auth).
 */

import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestAsset,
  insertTestCategory,
  insertTestLocation,
  insertTestUser,
  provisionUser,
  resolveTestTenantId,
  seedTestTenant,
  UserRole,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('Cross-tenant isolation', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
    const { token } = await provisionUser(app, {
      oid: 'admin-cross-tenant-a',
      role: UserRole.ADMIN,
    });
    adminToken = token;
    tenantAId = await resolveTestTenantId(app);
    const tenantB = await seedTestTenant(app, { slug: 'tenant-b', displayName: 'Tenant B' });
    tenantBId = tenantB._id;
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  describe('assets', () => {
    it('GET /v1/assets only returns tenant A assets', async () => {
      await insertTestAsset(app, {
        organisationId: tenantAId,
        name: 'Tenant A asset',
        inventoryNumber: 'A-001',
      });
      await insertTestAsset(app, {
        organisationId: tenantBId,
        name: 'Tenant B asset',
        inventoryNumber: 'B-001',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        data: Array<{ name: string; organisationId: string }>;
        pagination: { total: number };
      }>();
      expect(body.pagination.total).toBe(1);
      expect(body.data[0]?.name).toBe('Tenant A asset');
    });

    it('GET /v1/assets/:id returns 404 for a tenant B asset id', async () => {
      const tenantBAsset = await insertTestAsset(app, {
        organisationId: tenantBId,
        inventoryNumber: 'B-002',
      });
      const res = await app.inject({
        method: 'GET',
        url: `/v1/assets/${tenantBAsset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('PATCH /v1/assets/:id returns 404 for a tenant B asset id', async () => {
      const tenantBAsset = await insertTestAsset(app, {
        organisationId: tenantBId,
        inventoryNumber: 'B-003',
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${tenantBAsset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'I should never land' },
      });
      expect(res.statusCode).toBe(404);
      const after = await app.mongo.db
        .collection('assets')
        .findOne({ _id: new ObjectId(tenantBAsset._id) });
      expect(after?.['name']).not.toBe('I should never land');
    });

    it('DELETE /v1/assets/:id returns 404 for a tenant B asset id', async () => {
      const tenantBAsset = await insertTestAsset(app, {
        organisationId: tenantBId,
        inventoryNumber: 'B-004',
      });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/assets/${tenantBAsset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
      const after = await app.mongo.db
        .collection('assets')
        .findOne({ _id: new ObjectId(tenantBAsset._id) });
      expect(after).not.toBeNull();
      expect(after?.['deletedAt']).toBeNull();
    });

    it('inventory number is per-tenant: same value can exist in A and B', async () => {
      const sharedNumber = 'SHARED-2026-001';
      await insertTestAsset(app, {
        organisationId: tenantAId,
        inventoryNumber: sharedNumber,
        name: 'A copy',
      });
      const bAsset = await insertTestAsset(app, {
        organisationId: tenantBId,
        inventoryNumber: sharedNumber,
        name: 'B copy',
      });
      expect(bAsset._id).toMatch(/^[a-f0-9]{24}$/);
    });
  });

  describe('categories', () => {
    it('GET /v1/categories only returns tenant A categories', async () => {
      await insertTestCategory(app, {
        organisationId: tenantAId,
        slug: 'iso-cat-a',
        name: 'Tenant A category',
      });
      await insertTestCategory(app, {
        organisationId: tenantBId,
        slug: 'iso-cat-b',
        name: 'Tenant B category',
      });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const names = res.json<{ data: Array<{ name: string }> }>().data.map((c) => c.name);
      expect(names).toContain('Tenant A category');
      expect(names).not.toContain('Tenant B category');
    });

    it('GET /v1/categories/:id returns 404 for a tenant B category id', async () => {
      const tenantBCat = await insertTestCategory(app, {
        organisationId: tenantBId,
        slug: 'iso-cat-b-hidden',
      });
      const res = await app.inject({
        method: 'GET',
        url: `/v1/categories/${tenantBCat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('PATCH /v1/categories/:id returns 404 for a tenant B category id', async () => {
      const tenantBCat = await insertTestCategory(app, {
        organisationId: tenantBId,
        slug: 'iso-cat-b-patch',
        name: 'Original',
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${tenantBCat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Patched name' },
      });
      expect(res.statusCode).toBe(404);
      const after = await app.mongo.db
        .collection('categories')
        .findOne({ _id: new ObjectId(tenantBCat._id) });
      expect(after?.['name']).toBe('Original');
    });

    it('DELETE /v1/categories/:id returns 404 for a tenant B category id', async () => {
      const tenantBCat = await insertTestCategory(app, {
        organisationId: tenantBId,
        slug: 'iso-cat-b-del',
      });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/categories/${tenantBCat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('slug is per-tenant: same value can exist in A and B', async () => {
      await insertTestCategory(app, {
        organisationId: tenantBId,
        slug: 'elektronika',
        name: 'B Elektronika',
      });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          name: 'A Elektronika',
          slug: 'elektronika',
          parentId: null,
          assetType: 'IT',
          description: null,
          icon: null,
          color: null,
          approverIds: [],
          requiresApprovalByDefault: true,
          maxLoanDays: null,
          isActive: true,
          sortOrder: 0,
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<{ slug: string }>().slug).toBe('elektronika');
    });
  });

  describe('locations', () => {
    it('GET /v1/locations only returns tenant A locations', async () => {
      await insertTestLocation(app, {
        organisationId: tenantAId,
        slug: 'iso-loc-a',
        name: 'Tenant A location',
      });
      await insertTestLocation(app, {
        organisationId: tenantBId,
        slug: 'iso-loc-b',
        name: 'Tenant B location',
      });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/locations',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const names = res.json<{ data: Array<{ name: string }> }>().data.map((l) => l.name);
      expect(names).toContain('Tenant A location');
      expect(names).not.toContain('Tenant B location');
    });

    it('PATCH /v1/locations/:id returns 404 for a tenant B location id', async () => {
      const tenantBLoc = await insertTestLocation(app, {
        organisationId: tenantBId,
        slug: 'iso-loc-b-patch',
        name: 'Sklad B',
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${tenantBLoc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Should never apply' },
      });
      expect(res.statusCode).toBe(404);
      const after = await app.mongo.db
        .collection('locations')
        .findOne({ _id: new ObjectId(tenantBLoc._id) });
      expect(after?.['name']).toBe('Sklad B');
    });
  });

  describe('users', () => {
    it('GET /v1/users only returns tenant A users', async () => {
      await insertTestUser(app, { organisationId: tenantBId, email: 'tenant-b-user@example.com' });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: Array<{ email: string; organisationId: string }> }>();
      expect(body.data.map((u) => u.email)).not.toContain('tenant-b-user@example.com');
      for (const user of body.data) expect(user.organisationId).toBe(tenantAId);
    });

    it('GET /v1/users/:id returns 404 for a tenant B user id', async () => {
      const tenantBUser = await insertTestUser(app, { organisationId: tenantBId });
      const res = await app.inject({
        method: 'GET',
        url: `/v1/users/${tenantBUser._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('PATCH /v1/users/:id returns 404 for a tenant B user id', async () => {
      const tenantBUser = await insertTestUser(app, {
        organisationId: tenantBId,
        roles: [UserRole.EMPLOYEE],
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${tenantBUser._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: [UserRole.ADMIN] },
      });
      expect(res.statusCode).toBe(404);
      const after = await app.mongo.db
        .collection('users')
        .findOne({ _id: new ObjectId(tenantBUser._id) });
      expect(after?.['roles']).toEqual([UserRole.EMPLOYEE]);
    });

    it('email is per-tenant: same value can exist in A and B', async () => {
      const sharedEmail = 'admin@inventario.test';
      await insertTestUser(app, { organisationId: tenantBId, email: sharedEmail });
      const tenantAUser = await insertTestUser(app, {
        organisationId: tenantAId,
        email: sharedEmail,
      });
      expect(tenantAUser._id).toMatch(/^[a-f0-9]{24}$/);
    });
  });

  describe('audit log scope', () => {
    it('audit entries created by tenant A actions carry tenant A organisationId', async () => {
      const target = await insertTestUser(app, {
        organisationId: tenantAId,
        roles: [UserRole.EMPLOYEE],
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: [UserRole.ASSET_MANAGER] },
      });
      expect(res.statusCode).toBe(200);
      const auditDocs = await app.mongo.db
        .collection('audit_logs')
        .find({ 'target.entityId': target._id })
        .toArray();
      expect(auditDocs.length).toBeGreaterThan(0);
      for (const doc of auditDocs) expect(doc['organisationId']).toBe(tenantAId);
    });
  });
});

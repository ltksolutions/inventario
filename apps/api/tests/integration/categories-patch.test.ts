/**
 * Integration tests for PATCH /v1/categories/:id — Slice #6c K17 (cookie auth).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestAsset,
  insertTestCategory,
  provisionUser,
  resolveTestTenantId,
  UserRole,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('PATCH /v1/categories/:id', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
    const { user, token } = await provisionUser(app, {
      oid: 'admin-for-categories-patch',
      role: UserRole.ADMIN,
    });
    adminToken = token;
    adminId = String(user._id);
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  describe('happy path', () => {
    it('updates a single field (name) and returns 200', async () => {
      const cat = await insertTestCategory(app, { name: 'Old name', slug: 'old-name' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'New name' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ _id: string; name: string }>();
      expect(body._id).toBe(cat._id);
      expect(body.name).toBe('New name');
    });

    it('updates multiple fields in one request', async () => {
      const cat = await insertTestCategory(app, { name: 'Pôvodný', slug: 'povodny' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          name: 'Premenovaný',
          description: 'Nový popis',
          icon: 'briefcase',
          color: '#1450df',
          isActive: false,
          sortOrder: 10,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        name: string;
        description: string;
        icon: string;
        color: string;
        isActive: boolean;
        sortOrder: number;
      }>();
      expect(body.name).toBe('Premenovaný');
      expect(body.description).toBe('Nový popis');
      expect(body.isActive).toBe(false);
      expect(body.sortOrder).toBe(10);
    });

    it('updates parentId to a valid parent', async () => {
      const parent = await insertTestCategory(app, { slug: 'new-parent' });
      const child = await insertTestCategory(app, { slug: 'orphan-to-reparent' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${child._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: parent._id },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ parentId: string }>().parentId).toBe(parent._id);
    });

    it('updates parentId to null (reparent to root)', async () => {
      const parent = await insertTestCategory(app, { slug: 'will-be-detached' });
      const child = await insertTestCategory(app, { slug: 'attached-child', parentId: parent._id });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${child._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: null },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ parentId: string | null }>().parentId).toBeNull();
    });

    it('persists the change — second GET returns the updated values', async () => {
      const cat = await insertTestCategory(app, { name: 'Before' });
      await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'After' },
      });
      const get = await app.inject({
        method: 'GET',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(get.statusCode).toBe(200);
      expect(get.json<{ name: string }>().name).toBe('After');
    });
  });

  describe('not found', () => {
    it('returns 404 when category _id does not exist', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/categories/0123456789abcdef01234567',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Whatever' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for a soft-deleted category', async () => {
      const cat = await insertTestCategory(app);
      const { ObjectId } = await import('mongodb');
      await app.mongo.db
        .collection('categories')
        .updateOne(
          { _id: new ObjectId(cat._id) },
          { $set: { deletedAt: new Date().toISOString(), deletedBy: adminId } },
        );
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Trying to update deleted' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for malformed _id', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/categories/not-a-valid-id',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Whatever' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('hierarchy validation', () => {
    it('rejects self-parent assignment with 400', async () => {
      const cat = await insertTestCategory(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: cat._id },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/own parent/i);
    });

    it('rejects parentId pointing to a non-existent parent with 400', async () => {
      const cat = await insertTestCategory(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: '0123456789abcdef01234567' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('cycle detection', () => {
    it('rejects a 2-cycle: PATCH A.parentId = B when B.parentId = A', async () => {
      const a = await insertTestCategory(app, { slug: 'node-a' });
      const b = await insertTestCategory(app, { slug: 'node-b', parentId: a._id });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${a._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: b._id },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/cycle/i);
    });

    it('rejects reparenting onto a deeper descendant (3-level chain, direct-inserted)', async () => {
      // Direct DB insert obchádza 2-úrovňovú validáciu, takže vieme zostaviť
      // 3-úrovňový reťazec a–b–c. Pokus presunúť root `a` pod jeho vnuka `c`
      // je odmietnutý — pri maxDepth=1 sa skôr než cyklus zachytí prekročenie
      // hĺbky, takže akceptujeme obe znenia hlášky.
      const a = await insertTestCategory(app, { slug: 'cyc-a' });
      const b = await insertTestCategory(app, { slug: 'cyc-b', parentId: a._id });
      const c = await insertTestCategory(app, { slug: 'cyc-c', parentId: b._id });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${a._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: c._id },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/cycle|úrovne|hodnot/i);
    });

    it('allows reparenting a value from one root to another (no cycle, stays 2-level)', async () => {
      const rootA = await insertTestCategory(app, { slug: 'sib-a' });
      const rootB = await insertTestCategory(app, { slug: 'sib-b' });
      const value = await insertTestCategory(app, { slug: 'sib-c', parentId: rootA._id });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${value._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: rootB._id },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ parentId: string }>().parentId).toBe(rootB._id);
    });
  });

  describe('depth limit (presne 2 úrovne: root + hodnoty)', () => {
    it('allows reparenting a category to become a value under a root', async () => {
      const root = await insertTestCategory(app, { slug: 'depth-root' });
      const orphan = await insertTestCategory(app, { slug: 'depth-orphan' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${orphan._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: root._id },
      });
      expect(res.statusCode).toBe(200);
    });

    it('rejects reparenting under a value (would create a grandchild)', async () => {
      const root = await insertTestCategory(app, { slug: 'over-root' });
      const value = await insertTestCategory(app, { slug: 'over-value', parentId: root._id });
      const orphan = await insertTestCategory(app, { slug: 'over-orphan' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${orphan._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: value._id },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/úrovne|hodnot/i);
    });
  });

  describe('slug collision', () => {
    it('rejects changing slug to one that exists on another category with 400', async () => {
      await insertTestCategory(app, { slug: 'already-taken' });
      const cat = await insertTestCategory(app, { slug: 'free-slug' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { slug: 'already-taken' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/slug.*already exists/i);
    });

    it('allows PATCH with the same slug (no-op slug)', async () => {
      const cat = await insertTestCategory(app, { slug: 'unchanged-slug' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { slug: 'unchanged-slug', name: 'New name only' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ slug: string }>().slug).toBe('unchanged-slug');
    });
  });

  describe('validation', () => {
    it('accepts empty body (no-op)', async () => {
      const cat = await insertTestCategory(app, { name: 'Original' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ name: string }>().name).toBe('Original');
    });

    it('rejects promoting a child category to root while assets reference it', async () => {
      const root = await insertTestCategory(app, { name: 'R', slug: 'root-promote' });
      const child = await insertTestCategory(app, {
        name: 'C',
        slug: 'child-promote',
        parentId: root._id,
      });
      await insertTestAsset(app, { categoryId: child._id });

      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${child._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: null },
      });
      expect(res.statusCode).toBe(400);
    });

    it('allows promoting a child category to root when no assets reference it', async () => {
      const root = await insertTestCategory(app, { name: 'R2', slug: 'root-promote-ok' });
      const child = await insertTestCategory(app, {
        name: 'C2',
        slug: 'child-promote-ok',
        parentId: root._id,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${child._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: null },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ parentId: string | null }>().parentId).toBeNull();
    });
  });

  describe('audit fields', () => {
    it('updates updatedBy to the calling user _id', async () => {
      const cat = await insertTestCategory(app, { createdBy: 'someone-else' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'New name' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ createdBy: string; updatedBy: string }>();
      expect(body.createdBy).toBe('someone-else');
      expect(body.updatedBy).toBe(adminId);
    });

    it('advances updatedAt to a newer timestamp', async () => {
      const oldTimestamp = new Date(Date.now() - 60_000).toISOString();
      const organisationId = await resolveTestTenantId(app);
      const insertResult = await app.mongo.db.collection('categories').insertOne({
        organisationId,
        name: 'Old',
        slug: 'old-ts-cat',
        parentId: null,
        description: null,
        icon: null,
        color: null,
        approverIds: [],
        requiresApprovalByDefault: true,
        maxLoanDays: null,
        isActive: true,
        sortOrder: 0,
        createdAt: oldTimestamp,
        updatedAt: oldTimestamp,
        createdBy: 'test',
        updatedBy: 'test',
        deletedAt: null,
        deletedBy: null,
      });
      const id = String(insertResult.insertedId);
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/categories/${id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Trigger update' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ createdAt: string; updatedAt: string }>();
      expect(body.createdAt).toBe(oldTimestamp);
      expect(new Date(body.updatedAt).getTime()).toBeGreaterThan(new Date(oldTimestamp).getTime());
    });
  });
});

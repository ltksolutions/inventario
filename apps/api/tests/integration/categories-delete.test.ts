// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for DELETE /v1/categories/:id — Slice #6c K17 (cookie auth).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestAsset,
  insertTestCategory,
  provisionUser,
  UserRole,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('DELETE /v1/categories/:id', () => {
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
      oid: 'admin-for-categories-delete',
      role: UserRole.ADMIN,
    });
    adminToken = token;
    adminId = String(user._id);
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  describe('happy path', () => {
    it('soft-deletes a leaf category and returns 204', async () => {
      const cat = await insertTestCategory(app);
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
    });

    it('subsequent GET /:id returns 404', async () => {
      const cat = await insertTestCategory(app);
      await app.inject({
        method: 'DELETE',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const get = await app.inject({
        method: 'GET',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(get.statusCode).toBe(404);
    });

    it('GET list excludes soft-deleted categories', async () => {
      const keep = await insertTestCategory(app, { name: 'Keeper', slug: 'keeper-cat' });
      const remove = await insertTestCategory(app, { name: 'Doomed', slug: 'doomed-cat' });

      const before = await app.inject({
        method: 'GET',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(before.json<{ pagination: { total: number } }>().pagination.total).toBe(2);

      await app.inject({
        method: 'DELETE',
        url: `/v1/categories/${remove._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });

      const after = await app.inject({
        method: 'GET',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const afterBody = after.json<{
        data: Array<{ _id: string }>;
        pagination: { total: number };
      }>();
      expect(afterBody.pagination.total).toBe(1);
      expect(afterBody.data[0]?._id).toBe(keep._id);
    });

    it('sets deletedAt and deletedBy on the document', async () => {
      const cat = await insertTestCategory(app);
      const beforeDelete = Date.now();
      await app.inject({
        method: 'DELETE',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });

      const { ObjectId } = await import('mongodb');
      const doc = await app.mongo.db
        .collection<{ deletedAt: string | null; deletedBy: string | null }>('categories')
        .findOne({ _id: new ObjectId(cat._id) });

      expect(doc!.deletedAt).not.toBeNull();
      expect(doc!.deletedBy).toBe(adminId);
      expect(new Date(doc!.deletedAt!).getTime()).toBeGreaterThanOrEqual(beforeDelete);
    });
  });

  describe('not found', () => {
    it('returns 404 when category _id does not exist', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/categories/0123456789abcdef01234567',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when category is already soft-deleted', async () => {
      const cat = await insertTestCategory(app);
      await app.inject({
        method: 'DELETE',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const second = await app.inject({
        method: 'DELETE',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(second.statusCode).toBe(404);
    });

    it('returns 400 for malformed _id', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/categories/not-a-valid-id',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('child orphan protection', () => {
    it('returns 400 when deleting a category with one direct child', async () => {
      const parent = await insertTestCategory(app, { slug: 'parent-with-child' });
      await insertTestCategory(app, { slug: 'a-child', parentId: parent._id });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/categories/${parent._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ message: string }>();
      expect(body.message).toMatch(/cannot delete/i);
      expect(body.message).toMatch(/child categor/i);
    });

    it('returns 400 with correct count when there are multiple children', async () => {
      const parent = await insertTestCategory(app, { slug: 'parent-many-children' });
      await insertTestCategory(app, { slug: 'child-one', parentId: parent._id });
      await insertTestCategory(app, { slug: 'child-two', parentId: parent._id });
      await insertTestCategory(app, { slug: 'child-three', parentId: parent._id });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/categories/${parent._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toContain('3');
    });

    it('allows deletion when the only child was already soft-deleted', async () => {
      const parent = await insertTestCategory(app, { slug: 'parent-with-deleted-child' });
      const child = await insertTestCategory(app, {
        slug: 'soft-deleted-child',
        parentId: parent._id,
      });
      const { ObjectId } = await import('mongodb');
      await app.mongo.db
        .collection('categories')
        .updateOne(
          { _id: new ObjectId(child._id) },
          { $set: { deletedAt: new Date().toISOString(), deletedBy: adminId } },
        );
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/categories/${parent._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(204);
    });
  });

  describe('asset FK protection', () => {
    it('returns 400 when deleting a category referenced by one asset', async () => {
      const cat = await insertTestCategory(app, { slug: 'cat-with-asset' });
      await insertTestAsset(app, { categoryId: cat._id });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ message: string }>();
      expect(body.message).toMatch(/cannot delete/i);
      expect(body.message).toMatch(/asset.*reference/i);
    });

    it('returns 400 with correct count when multiple assets reference the category', async () => {
      const cat = await insertTestCategory(app, { slug: 'cat-many-assets' });
      await insertTestAsset(app, { categoryId: cat._id, inventoryNumber: 'FK-2026-001' });
      await insertTestAsset(app, { categoryId: cat._id, inventoryNumber: 'FK-2026-002' });
      await insertTestAsset(app, { categoryId: cat._id, inventoryNumber: 'FK-2026-003' });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toContain('3');
    });

    it('allows deletion when the only asset referencing it was soft-deleted', async () => {
      const cat = await insertTestCategory(app, { slug: 'cat-asset-deleted' });
      const asset = await insertTestAsset(app, { categoryId: cat._id });
      const { ObjectId } = await import('mongodb');
      await app.mongo.db
        .collection('assets')
        .updateOne(
          { _id: new ObjectId(asset._id) },
          { $set: { deletedAt: new Date().toISOString(), deletedBy: adminId } },
        );
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/categories/${cat._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(204);
    });
  });
});

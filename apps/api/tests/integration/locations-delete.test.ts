// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for DELETE /v1/locations/:id — Slice #6c K17 (cookie auth).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestAsset,
  insertTestLocation,
  provisionUser,
  UserRole,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('DELETE /v1/locations/:id', () => {
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
      oid: 'admin-for-locations-delete',
      role: UserRole.ADMIN,
    });
    adminToken = token;
    adminId = String(user._id);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  describe('happy path', () => {
    it('soft-deletes a leaf location and returns 204', async () => {
      const loc = await insertTestLocation(app);
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/locations/${loc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(204);
    });

    it('subsequent GET /:id returns 404', async () => {
      const loc = await insertTestLocation(app);
      await app.inject({
        method: 'DELETE',
        url: `/v1/locations/${loc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const get = await app.inject({
        method: 'GET',
        url: `/v1/locations/${loc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(get.statusCode).toBe(404);
    });

    it('GET list excludes soft-deleted locations', async () => {
      const keep = await insertTestLocation(app, { name: 'Keeper', slug: 'keeper-loc' });
      const remove = await insertTestLocation(app, { name: 'Doomed', slug: 'doomed-loc' });
      const before = await app.inject({
        method: 'GET',
        url: '/v1/locations',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(before.json<{ pagination: { total: number } }>().pagination.total).toBe(2);
      await app.inject({
        method: 'DELETE',
        url: `/v1/locations/${remove._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const after = await app.inject({
        method: 'GET',
        url: '/v1/locations',
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
      const loc = await insertTestLocation(app);
      const beforeDelete = Date.now();
      await app.inject({
        method: 'DELETE',
        url: `/v1/locations/${loc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const { ObjectId } = await import('mongodb');
      const doc = await app.mongo.db
        .collection<{ deletedAt: string | null; deletedBy: string | null }>('locations')
        .findOne({ _id: new ObjectId(loc._id) });
      expect(doc!.deletedAt).not.toBeNull();
      expect(doc!.deletedBy).toBe(adminId);
      expect(new Date(doc!.deletedAt!).getTime()).toBeGreaterThanOrEqual(beforeDelete);
    });
  });

  describe('not found', () => {
    it('returns 404 when location _id does not exist', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/locations/0123456789abcdef01234567',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when location is already soft-deleted', async () => {
      const loc = await insertTestLocation(app);
      await app.inject({
        method: 'DELETE',
        url: `/v1/locations/${loc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const second = await app.inject({
        method: 'DELETE',
        url: `/v1/locations/${loc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(second.statusCode).toBe(404);
    });

    it('returns 400 for malformed _id', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/locations/not-a-valid-id',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('child orphan protection', () => {
    it('returns 400 when deleting a location with one direct child', async () => {
      const parent = await insertTestLocation(app, { slug: 'parent-with-child-loc' });
      await insertTestLocation(app, { slug: 'a-child-loc', parentId: parent._id });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/locations/${parent._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/cannot delete/i);
    });

    it('allows deletion when the only child was soft-deleted', async () => {
      const parent = await insertTestLocation(app, { slug: 'parent-deleted-child-loc' });
      const child = await insertTestLocation(app, {
        slug: 'soft-deleted-child-loc',
        parentId: parent._id,
      });
      const { ObjectId } = await import('mongodb');
      await app.mongo.db
        .collection('locations')
        .updateOne(
          { _id: new ObjectId(child._id) },
          { $set: { deletedAt: new Date().toISOString(), deletedBy: adminId } },
        );
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/locations/${parent._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(204);
    });
  });

  describe('asset FK protection', () => {
    it('returns 400 when deleting a location referenced by one asset', async () => {
      const loc = await insertTestLocation(app, { slug: 'loc-with-asset' });
      await insertTestAsset(app, { locationId: loc._id });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/locations/${loc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/asset.*reference/i);
    });

    it('allows deletion when the only asset was soft-deleted', async () => {
      const loc = await insertTestLocation(app, { slug: 'loc-asset-deleted' });
      const asset = await insertTestAsset(app, { locationId: loc._id });
      const { ObjectId } = await import('mongodb');
      await app.mongo.db
        .collection('assets')
        .updateOne(
          { _id: new ObjectId(asset._id) },
          { $set: { deletedAt: new Date().toISOString(), deletedBy: adminId } },
        );
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/locations/${loc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(204);
    });
  });
});

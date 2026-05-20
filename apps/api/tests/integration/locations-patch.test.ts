/**
 * Integration tests for PATCH /v1/locations/:id — Slice #6c K17 (cookie auth).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestLocation,
  provisionUser,
  resolveTestTenantId,
  UserRole,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('PATCH /v1/locations/:id', () => {
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
      oid: 'admin-for-locations-patch',
      role: UserRole.ADMIN,
    });
    adminToken = token;
    adminId = String(user._id);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  describe('happy path', () => {
    it('updates a single field and returns 200', async () => {
      const loc = await insertTestLocation(app, { name: 'Old name', slug: 'old-name-loc' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${loc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'New name' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ name: string }>().name).toBe('New name');
    });

    it('updates multiple fields in one request', async () => {
      const loc = await insertTestLocation(app, { name: 'Pôvodný', slug: 'povodny-loc' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${loc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          name: 'Premenovaný',
          description: 'Nový popis',
          type: 'OFFICE',
          isActive: false,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ name: string; description: string; isActive: boolean }>();
      expect(body.name).toBe('Premenovaný');
      expect(body.description).toBe('Nový popis');
      expect(body.isActive).toBe(false);
    });

    it('updates parentId to a valid parent', async () => {
      const parent = await insertTestLocation(app, { slug: 'new-parent-loc' });
      const child = await insertTestLocation(app, { slug: 'orphan-loc' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${child._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: parent._id },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ parentId: string }>().parentId).toBe(parent._id);
    });

    it('updates parentId to null', async () => {
      const parent = await insertTestLocation(app, { slug: 'will-detach-loc' });
      const child = await insertTestLocation(app, {
        slug: 'attached-child-loc',
        parentId: parent._id,
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${child._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: null },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ parentId: string | null }>().parentId).toBeNull();
    });
  });

  describe('not found', () => {
    it('returns 404 when location _id does not exist', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/locations/0123456789abcdef01234567',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Whatever' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for a soft-deleted location', async () => {
      const loc = await insertTestLocation(app);
      const { ObjectId } = await import('mongodb');
      await app.mongo.db
        .collection('locations')
        .updateOne(
          { _id: new ObjectId(loc._id) },
          { $set: { deletedAt: new Date().toISOString(), deletedBy: adminId } },
        );
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${loc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Trying to update' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for malformed _id', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/locations/not-a-valid-id',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Whatever' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('hierarchy validation', () => {
    it('rejects self-parent assignment', async () => {
      const loc = await insertTestLocation(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${loc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: loc._id },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/own parent/i);
    });

    it('rejects parentId pointing to a non-existent parent', async () => {
      const loc = await insertTestLocation(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${loc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: '0123456789abcdef01234567' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('cycle detection', () => {
    it('rejects a 2-cycle', async () => {
      const a = await insertTestLocation(app, { slug: 'node-a-loc' });
      const b = await insertTestLocation(app, { slug: 'node-b-loc', parentId: a._id });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${a._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: b._id },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/cycle/i);
    });

    it('rejects a 3-cycle', async () => {
      const a = await insertTestLocation(app, { slug: 'cyc-a-loc' });
      const b = await insertTestLocation(app, { slug: 'cyc-b-loc', parentId: a._id });
      const c = await insertTestLocation(app, { slug: 'cyc-c-loc', parentId: b._id });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${a._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: c._id },
      });
      expect(res.statusCode).toBe(400);
    });

    it('allows sibling reparent (no cycle)', async () => {
      const a = await insertTestLocation(app, { slug: 'sib-a-loc' });
      const b = await insertTestLocation(app, { slug: 'sib-b-loc', parentId: a._id });
      const c = await insertTestLocation(app, { slug: 'sib-c-loc', parentId: a._id });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${c._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: b._id },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('depth limit', () => {
    it('allows reparenting at the maximum legal depth', async () => {
      const root = await insertTestLocation(app, { slug: 'depth-root-loc' });
      const d1 = await insertTestLocation(app, { slug: 'depth-d1-loc', parentId: root._id });
      const d2 = await insertTestLocation(app, { slug: 'depth-d2-loc', parentId: d1._id });
      const d3 = await insertTestLocation(app, { slug: 'depth-d3-loc', parentId: d2._id });
      const orphan = await insertTestLocation(app, { slug: 'depth-orphan-loc' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${orphan._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: d3._id },
      });
      expect(res.statusCode).toBe(200);
    });

    it('rejects reparenting that exceeds the maximum depth', async () => {
      const root = await insertTestLocation(app, { slug: 'over-root-loc' });
      const d1 = await insertTestLocation(app, { slug: 'over-d1-loc', parentId: root._id });
      const d2 = await insertTestLocation(app, { slug: 'over-d2-loc', parentId: d1._id });
      const d3 = await insertTestLocation(app, { slug: 'over-d3-loc', parentId: d2._id });
      const d4 = await insertTestLocation(app, { slug: 'over-d4-loc', parentId: d3._id });
      const orphan = await insertTestLocation(app, { slug: 'over-orphan-loc' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${orphan._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { parentId: d4._id },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/depth/i);
    });
  });

  describe('slug collision', () => {
    it('rejects changing slug to existing', async () => {
      await insertTestLocation(app, { slug: 'already-taken-loc' });
      const loc = await insertTestLocation(app, { slug: 'free-slug-loc' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${loc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { slug: 'already-taken-loc' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/slug.*already exists/i);
    });

    it('allows PATCH with the same slug (no-op slug)', async () => {
      const loc = await insertTestLocation(app, { slug: 'unchanged-slug-loc' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${loc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { slug: 'unchanged-slug-loc', name: 'New name only' },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('validation', () => {
    it('accepts empty body (no-op)', async () => {
      const loc = await insertTestLocation(app, { name: 'Original' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${loc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ name: string }>().name).toBe('Original');
    });

    it('rejects invalid type enum', async () => {
      const loc = await insertTestLocation(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${loc._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { type: 'TOTALLY_FAKE' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('audit fields', () => {
    it('updates updatedBy to the calling user _id', async () => {
      const loc = await insertTestLocation(app, { createdBy: 'someone-else' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/locations/${loc._id}`,
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
      const insertResult = await app.mongo.db.collection('locations').insertOne({
        organisationId,
        name: 'Old',
        slug: 'old-ts-loc',
        type: 'WAREHOUSE',
        address: null,
        coordinates: null,
        parentId: null,
        description: null,
        managerId: null,
        isActive: true,
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
        url: `/v1/locations/${id}`,
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

/**
 * Integration tests for PATCH /v1/assets/:id — Slice #6c K17 (cookie auth).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestAsset,
  insertTestCategory,
  insertTestLocation,
  provisionUser,
  resolveTestTenantId,
  UserRole,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('PATCH /v1/assets/:id', () => {
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
      oid: 'admin-for-patch',
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
      const asset = await insertTestAsset(app, { name: 'Original name' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Updated name' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ _id: string; name: string }>();
      expect(body._id).toBe(asset._id);
      expect(body.name).toBe('Updated name');
    });

    it('updates multiple fields in one request', async () => {
      const asset = await insertTestAsset(app, { name: 'Asset', condition: 'NEW' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Refurbished asset', condition: 'GOOD', internalNotes: 'Cleaned 2026-05' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ name: string; condition: string; internalNotes: string }>();
      expect(body.name).toBe('Refurbished asset');
      expect(body.condition).toBe('GOOD');
      expect(body.internalNotes).toBe('Cleaned 2026-05');
    });

    it('updates tags array (replaces, not merges)', async () => {
      const asset = await insertTestAsset(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { tags: ['urgent', 'reviewed', 'priority-1'] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ tags: string[] }>().tags).toEqual(['urgent', 'reviewed', 'priority-1']);
    });

    it('persists changes — second GET returns the updated values', async () => {
      const asset = await insertTestAsset(app, { name: 'Before' });
      await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'After' },
      });
      const get = await app.inject({
        method: 'GET',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(get.statusCode).toBe(200);
      expect(get.json<{ name: string }>().name).toBe('After');
    });
  });

  describe('not found', () => {
    it('returns 404 when asset _id does not exist', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/assets/0123456789abcdef01234567',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Whatever' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for a soft-deleted asset', async () => {
      const asset = await insertTestAsset(app);
      const { ObjectId } = await import('mongodb');
      await app.mongo.db
        .collection('assets')
        .updateOne(
          { _id: new ObjectId(asset._id) },
          { $set: { deletedAt: new Date().toISOString(), deletedBy: adminId } },
        );
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Trying to update a deleted asset' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for malformed _id', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/assets/not-a-valid-id',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Whatever' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('validation', () => {
    it('rejects attempt to update inventoryNumber (immutable)', async () => {
      const asset = await insertTestAsset(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { inventoryNumber: 'NEW-2026-999' },
      });
      expect([200, 400]).toContain(res.statusCode);
      const get = await app.inject({
        method: 'GET',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(get.statusCode).toBe(200);
      expect(get.json<{ inventoryNumber: string }>().inventoryNumber).toBe(asset.inventoryNumber);
    });

    it('rejects invalid enum value for status', async () => {
      const asset = await insertTestAsset(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { status: 'NOT_A_VALID_STATUS' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid enum value for condition (now accepts any non-empty string — per-tenant collection)', async () => {
      const asset = await insertTestAsset(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { condition: 'AMAZING' },
      });
      // condition is now a free string (per-tenant asset_conditions collection)
      expect(res.statusCode).toBe(200);
    });

    it('rejects empty string for condition', async () => {
      const asset = await insertTestAsset(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { condition: '' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('accepts empty body (no-op patch)', async () => {
      const asset = await insertTestAsset(app, { name: 'Original' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ name: string }>().name).toBe('Original');
    });
  });

  describe('FK validation', () => {
    it('rejects PATCH that changes categoryId to a non-existent category (400)', async () => {
      const asset = await insertTestAsset(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { categoryId: '0123456789abcdef01234567' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/category.*does not exist/i);
    });

    it('rejects PATCH that changes locationId to a non-existent location (400)', async () => {
      const asset = await insertTestAsset(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { locationId: '0123456789abcdef01234567' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/location.*does not exist/i);
    });

    it('accepts PATCH that changes categoryId to a real category', async () => {
      const asset = await insertTestAsset(app);
      const newCategory = await insertTestCategory(app, { slug: 'patch-target-cat' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { categoryId: newCategory._id },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ categoryId: string }>().categoryId).toBe(newCategory._id);
    });

    it('accepts PATCH that changes locationId to a real location', async () => {
      const asset = await insertTestAsset(app);
      const newLocation = await insertTestLocation(app, { slug: 'patch-target-loc' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { locationId: newLocation._id },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ locationId: string }>().locationId).toBe(newLocation._id);
    });

    it('skips FK check when categoryId is unchanged (no-op)', async () => {
      const category = await insertTestCategory(app, { slug: 'noop-fk-cat' });
      const asset = await insertTestAsset(app, { categoryId: category._id });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { categoryId: category._id },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('audit fields', () => {
    it('updates updatedBy to the calling user _id', async () => {
      const asset = await insertTestAsset(app, { createdBy: 'someone-else' });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
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
      const insertResult = await app.mongo.db.collection('assets').insertOne({
        organisationId,
        inventoryNumber: 'TS-2026-001',
        serialNumber: null,
        name: 'Timestamp test',
        description: null,
        type: 'IT',
        categoryId: '000000000000000000000001',
        condition: 'NEW',
        locationId: '000000000000000000000002',
        manufacturer: null,
        model: null,
        acquiredAt: oldTimestamp,
        acquisitionCost: null,
        warrantyUntil: null,
        specs: {},
        tags: [],
        imageIds: [],
        internalNotes: null,
        isLoanable: true,
        requiresApproval: true,
        status: 'AVAILABLE',
        currentLoanId: null,
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
        url: `/v1/assets/${id}`,
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

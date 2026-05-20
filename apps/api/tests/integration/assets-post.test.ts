/**
 * Integration tests for POST /v1/assets — Slice #6c K17 (cookie auth).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  provisionUser,
  seedAssetFkRefs,
  UserRole,
  validCreateAssetBody,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('POST /v1/assets', () => {
  let app: FastifyInstance;
  let adminToken: string;
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
    const { token } = await provisionUser(app, { oid: 'admin-for-post', role: UserRole.ADMIN });
    adminToken = token;
    const fk = await seedAssetFkRefs(app);
    fkCategoryId = fk.categoryId;
    fkLocationId = fk.locationId;
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  const bodyWithFk = (overrides: Record<string, unknown> = {}) =>
    validCreateAssetBody({ categoryId: fkCategoryId, locationId: fkLocationId, ...overrides });

  describe('happy path', () => {
    it('creates an asset with auto-generated inventoryNumber', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: bodyWithFk({ name: 'My laptop', inventoryNumberPrefix: 'LT' }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{
        _id: string;
        inventoryNumber: string;
        name: string;
        status: string;
        createdBy: string;
      }>();
      expect(body._id).toMatch(/^[a-f0-9]{24}$/);
      const year = new Date().getFullYear();
      expect(body.inventoryNumber).toBe(`LT-${year}-001`);
      expect(body.name).toBe('My laptop');
      expect(body.status).toBe('AVAILABLE');
      expect(body.createdBy).toMatch(/^[a-f0-9]{24}$/);
    });

    it('increments the inventory sequence across successive creates', async () => {
      const year = new Date().getFullYear();
      const first = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: bodyWithFk({ inventoryNumberPrefix: 'SEQ' }),
      });
      expect(first.statusCode).toBe(201);
      expect(first.json<{ inventoryNumber: string }>().inventoryNumber).toBe(`SEQ-${year}-001`);

      const second = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: bodyWithFk({ inventoryNumberPrefix: 'SEQ' }),
      });
      expect(second.statusCode).toBe(201);
      expect(second.json<{ inventoryNumber: string }>().inventoryNumber).toBe(`SEQ-${year}-002`);

      const third = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: bodyWithFk({ inventoryNumberPrefix: 'OTHER' }),
      });
      expect(third.statusCode).toBe(201);
      expect(third.json<{ inventoryNumber: string }>().inventoryNumber).toBe(`OTHER-${year}-001`);
    });

    it('persists the asset so GET retrieves it', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: bodyWithFk({ name: 'Persisted asset', inventoryNumberPrefix: 'PERS' }),
      });
      expect(create.statusCode).toBe(201);
      const id = create.json<{ _id: string }>()._id;

      const get = await app.inject({
        method: 'GET',
        url: `/v1/assets/${id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(get.statusCode).toBe(200);
      const body = get.json<{ name: string; inventoryNumber: string }>();
      expect(body.name).toBe('Persisted asset');
      expect(body.inventoryNumber).toBe(`PERS-${new Date().getFullYear()}-001`);
    });
  });

  describe('validation failures', () => {
    it('rejects missing name with 400', async () => {
      const body = validCreateAssetBody();
      delete body['name'];
      const res = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects empty name with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateAssetBody({ name: '' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects inventoryNumberPrefix with lowercase letters', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateAssetBody({ inventoryNumberPrefix: 'lt' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects inventoryNumberPrefix longer than 5 chars', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateAssetBody({ inventoryNumberPrefix: 'LONGPREFIX' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects malformed categoryId (not 24 hex)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateAssetBody({ categoryId: 'not-a-real-id' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects missing acquiredAt with 400', async () => {
      const body = validCreateAssetBody();
      delete body['acquiredAt'];
      const res = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('FK validation', () => {
    it('rejects POST with categoryId pointing to a non-existent category (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: bodyWithFk({
          categoryId: '0123456789abcdef01234567',
          inventoryNumberPrefix: 'FKA',
        }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/category.*does not exist/i);
    });

    it('rejects POST with locationId pointing to a non-existent location (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: bodyWithFk({
          locationId: '0123456789abcdef01234567',
          inventoryNumberPrefix: 'FKB',
        }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/location.*does not exist/i);
    });

    it('rejects POST when category is soft-deleted (400)', async () => {
      const { ObjectId } = await import('mongodb');
      await app.mongo.db
        .collection('categories')
        .updateOne(
          { _id: new ObjectId(fkCategoryId) },
          { $set: { deletedAt: new Date().toISOString(), deletedBy: 'test' } },
        );
      const res = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: bodyWithFk({ inventoryNumberPrefix: 'FKC' }),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('audit fields', () => {
    it('sets createdBy and updatedBy to the calling user _id', async () => {
      const adminUser = await app.mongo.db
        .collection('users')
        .findOne({ entraOid: 'admin-for-post' });
      expect(adminUser).not.toBeNull();
      const adminId = String(adminUser!._id);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: bodyWithFk(),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ createdBy: string; updatedBy: string }>();
      expect(body.createdBy).toBe(adminId);
      expect(body.updatedBy).toBe(adminId);
    });

    it('sets createdAt and updatedAt to ISO timestamps (equal on create)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: bodyWithFk(),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ createdAt: string; updatedAt: string }>();
      expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(body.updatedAt).toBe(body.createdAt);
    });
  });
});

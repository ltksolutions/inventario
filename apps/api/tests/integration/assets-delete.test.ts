// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for DELETE /v1/assets/:id — Slice #6c K17 (cookie auth).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { insertTestAsset, provisionUser, UserRole } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('DELETE /v1/assets/:id', () => {
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
      oid: 'admin-for-delete',
      role: UserRole.ADMIN,
    });
    adminToken = token;
    adminId = String(user._id);
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  describe('happy path', () => {
    it('soft-deletes an asset and returns 204', async () => {
      const asset = await insertTestAsset(app);
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
    });

    it('subsequent GET /:id returns 404', async () => {
      const asset = await insertTestAsset(app);
      await app.inject({
        method: 'DELETE',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const get = await app.inject({
        method: 'GET',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(get.statusCode).toBe(404);
    });

    it('GET list excludes soft-deleted assets', async () => {
      const keep = await insertTestAsset(app, { name: 'Keeper' });
      const remove = await insertTestAsset(app, { name: 'Doomed' });

      const before = await app.inject({
        method: 'GET',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(before.statusCode).toBe(200);
      expect(before.json<{ pagination: { total: number } }>().pagination.total).toBe(2);

      await app.inject({
        method: 'DELETE',
        url: `/v1/assets/${remove._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });

      const after = await app.inject({
        method: 'GET',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(after.statusCode).toBe(200);
      const afterBody = after.json<{
        data: Array<{ _id: string }>;
        pagination: { total: number };
      }>();
      expect(afterBody.pagination.total).toBe(1);
      expect(afterBody.data[0]?._id).toBe(keep._id);
    });

    it('sets deletedAt and deletedBy on the document', async () => {
      const asset = await insertTestAsset(app);
      const beforeDelete = Date.now();
      await app.inject({
        method: 'DELETE',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });

      const { ObjectId } = await import('mongodb');
      const doc = await app.mongo.db
        .collection<{ deletedAt: string | null; deletedBy: string | null }>('assets')
        .findOne({ _id: new ObjectId(asset._id) });

      expect(doc).not.toBeNull();
      expect(doc!.deletedAt).not.toBeNull();
      expect(doc!.deletedBy).toBe(adminId);
      const deletedAtMs = new Date(doc!.deletedAt!).getTime();
      expect(deletedAtMs).toBeGreaterThanOrEqual(beforeDelete);
      expect(deletedAtMs).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('not found', () => {
    it('returns 404 when asset _id does not exist', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/assets/0123456789abcdef01234567',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when asset is already soft-deleted', async () => {
      const asset = await insertTestAsset(app);
      await app.inject({
        method: 'DELETE',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const second = await app.inject({
        method: 'DELETE',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(second.statusCode).toBe(404);
    });

    it('returns 400 for malformed _id', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/assets/not-a-valid-id',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('business rule: on loan', () => {
    it('returns 400 when asset has currentLoanId set', async () => {
      const { ObjectId } = await import('mongodb');
      const asset = await insertTestAsset(app, { currentLoanId: new ObjectId() });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/on loan/i);
    });

    it('does NOT soft-delete an on-loan asset', async () => {
      const { ObjectId } = await import('mongodb');
      const asset = await insertTestAsset(app, { currentLoanId: new ObjectId() });
      await app.inject({
        method: 'DELETE',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const get = await app.inject({
        method: 'GET',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(get.statusCode).toBe(200);
      expect(get.json<{ deletedAt: string | null }>().deletedAt).toBeNull();
    });
  });
});

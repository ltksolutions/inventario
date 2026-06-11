// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for GET /v1/users/:id — Slice #6c K17 (cookie auth).
 */

import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { insertTestUser, provisionUser, UserRole } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('GET /v1/users/:id', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
    const { token } = await provisionUser(app, {
      oid: 'admin-for-users-get',
      role: UserRole.ADMIN,
    });
    adminToken = token;
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  describe('happy path', () => {
    it('returns 200 with the user matching :id', async () => {
      const target = await insertTestUser(app, {
        email: 'fetch-me@example.com',
        firstName: 'Fetch',
        lastName: 'Me',
      });
      const res = await app.inject({
        method: 'GET',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ _id: string; email: string; firstName: string; lastName: string }>();
      expect(body._id).toBe(target._id);
      expect(body.email).toBe('fetch-me@example.com');
      expect(body.firstName).toBe('Fetch');
    });

    it('does not return passwordHash', async () => {
      const target = await insertTestUser(app);
      const res = await app.inject({
        method: 'GET',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).not.toHaveProperty('passwordHash');
    });
  });

  describe('not found', () => {
    it('returns 404 for a valid but unknown id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/users/${new ObjectId().toString()}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for a soft-deleted user', async () => {
      const target = await insertTestUser(app, { email: 'deleted@example.com' });
      await app.mongo.db
        .collection('users')
        .updateOne(
          { _id: new ObjectId(target._id) },
          { $set: { deletedAt: new Date().toISOString(), deletedBy: 'test-admin' } },
        );
      const res = await app.inject({
        method: 'GET',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('validation', () => {
    it('returns 400 for a non-24-hex id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users/not-a-hex-id',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('RBAC', () => {
    it('returns 403 for EMPLOYEE', async () => {
      const target = await insertTestUser(app);
      const { token } = await provisionUser(app, {
        oid: 'employee-for-get-by-id',
        role: UserRole.EMPLOYEE,
      });
      const res = await app.inject({
        method: 'GET',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 401 without auth cookie', async () => {
      const target = await insertTestUser(app);
      const res = await app.inject({ method: 'GET', url: `/v1/users/${target._id}` });
      expect(res.statusCode).toBe(401);
    });
  });
});

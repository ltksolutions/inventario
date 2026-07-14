// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for GET /v1/users — Slice #6c K17 (cookie auth).
 */

import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestMembership,
  insertTestUser,
  provisionUser,
  resolveTestTenantId,
  UserRole,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('GET /v1/users', () => {
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
      oid: 'admin-for-users-list',
      role: UserRole.ADMIN,
    });
    adminToken = token;
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  describe('happy path', () => {
    it('returns the calling admin plus inserted users', async () => {
      await insertTestUser(app, { email: 'alice@example.com', roles: [UserRole.EMPLOYEE] });
      await insertTestUser(app, { email: 'bob@example.com', roles: [UserRole.ASSET_MANAGER] });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        data: Array<{ email: string }>;
        pagination: { total: number; limit: number; skip: number; hasMore: boolean };
      }>();
      expect(body.pagination.total).toBe(3);
      expect(body.pagination.limit).toBe(50);
      expect(body.pagination.hasMore).toBe(false);
    });

    it('returns documents without passwordHash', async () => {
      await insertTestUser(app, { email: 'check-hash@example.com' });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      for (const user of res.json<{ data: Array<Record<string, unknown>> }>().data) {
        expect(user).not.toHaveProperty('passwordHash');
      }
    });

    it('sorts users alphabetically by displayName ascending', async () => {
      await insertTestUser(app, { displayName: 'Zora Z', email: 'z@example.com' });
      await insertTestUser(app, { displayName: 'Adam A', email: 'a@example.com' });
      await insertTestUser(app, { displayName: 'Milan M', email: 'm@example.com' });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const displayNames = res
        .json<{ data: Array<{ displayName: string }> }>()
        .data.map((u) => u.displayName);
      const adamIdx = displayNames.indexOf('Adam A');
      const milanIdx = displayNames.indexOf('Milan M');
      const zoraIdx = displayNames.indexOf('Zora Z');
      expect(adamIdx).toBeLessThan(milanIdx);
      expect(milanIdx).toBeLessThan(zoraIdx);
    });
  });

  describe('pagination', () => {
    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) await insertTestUser(app, { email: `user-${i}@example.com` });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users?limit=3',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[]; pagination: { limit: number; hasMore: boolean } }>();
      expect(body.data).toHaveLength(3);
      expect(body.pagination.hasMore).toBe(true);
    });

    it('respects skip', async () => {
      for (let i = 0; i < 5; i++)
        await insertTestUser(app, { email: `user-skip-${i}@example.com` });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users?limit=2&skip=2',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[]; pagination: { skip: number; hasMore: boolean } }>();
      expect(body.data).toHaveLength(2);
      expect(body.pagination.skip).toBe(2);
    });

    it('rejects limit > 200', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users?limit=500',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('filters', () => {
    it('filters by role', async () => {
      await insertTestUser(app, { email: 'emp@example.com', roles: [UserRole.EMPLOYEE] });
      await insertTestUser(app, { email: 'mgr@example.com', roles: [UserRole.ASSET_MANAGER] });
      await insertTestUser(app, {
        email: 'both@example.com',
        roles: [UserRole.EMPLOYEE],
      });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users?role=EMPLOYEE',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const emails = res.json<{ data: Array<{ email: string }> }>().data.map((u) => u.email);
      expect(emails).toContain('emp@example.com');
      expect(emails).toContain('both@example.com');
      expect(emails).not.toContain('mgr@example.com');
    });

    it('filters by isActive=false', async () => {
      await insertTestUser(app, { email: 'active@example.com', isActive: true });
      await insertTestUser(app, { email: 'inactive@example.com', isActive: false });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users?isActive=false',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const body = res.json<{ data: Array<{ email: string; isActive: boolean }> }>();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]!.email).toBe('inactive@example.com');
    });

    it('combines role + isActive filters', async () => {
      await insertTestUser(app, {
        email: 'admin-active@example.com',
        roles: [UserRole.ADMIN],
        isActive: true,
      });
      await insertTestUser(app, {
        email: 'admin-inactive@example.com',
        roles: [UserRole.ADMIN],
        isActive: false,
      });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users?role=ADMIN&isActive=true',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const emails = res.json<{ data: Array<{ email: string }> }>().data.map((u) => u.email);
      expect(emails).toContain('admin-active@example.com');
      expect(emails).not.toContain('admin-inactive@example.com');
    });
  });

  describe('q (free-text search)', () => {
    it('matches partial email (case-insensitive)', async () => {
      await insertTestUser(app, { email: 'jano.letko@sfz.sk' });
      await insertTestUser(app, { email: 'someone@example.com' });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users?q=LETKO',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const emails = res.json<{ data: Array<{ email: string }> }>().data.map((u) => u.email);
      expect(emails).toContain('jano.letko@sfz.sk');
      expect(emails).not.toContain('someone@example.com');
    });

    it('escapes regex meta-characters so q="a.b" is not a wildcard', async () => {
      await insertTestUser(app, { email: 'aXb@example.com', firstName: 'aXb' });
      await insertTestUser(app, { email: 'a.b@example.com', firstName: 'a.b' });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users?q=a.b',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const emails = res.json<{ data: Array<{ email: string }> }>().data.map((u) => u.email);
      expect(emails).toContain('a.b@example.com');
      expect(emails).not.toContain('aXb@example.com');
    });
  });

  describe('cross-tenant users', () => {
    it('shows a cross-tenant invited user (no organisationId on User doc) in the list', async () => {
      const orgId = await resolveTestTenantId(app);

      // Insert a user WITHOUT organisationId matching the tenant (simulates cross-tenant invite).
      // createMembership:false so we control the membership manually.
      const crossTenantUser = await insertTestUser(app, {
        email: 'cross-tenant@other-org.com',
        createMembership: false,
      });

      // Manually insert membership linking this user to the test tenant
      // (mirrors what accept-invite does for existing-user path).
      await insertTestMembership(app, {
        userId: crossTenantUser._id,
        organisationId: orgId,
        roles: [UserRole.ASSET_MANAGER],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/users',
        headers: { cookie: `inv_access=${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const emails = res.json<{ data: Array<{ email: string }> }>().data.map((u) => u.email);
      expect(emails).toContain('cross-tenant@other-org.com');
    });

    it('does NOT show a user who has a membership in a different org', async () => {
      // Insert user with membership in a completely different org (not test tenant)
      const otherOrgId = new ObjectId().toHexString();
      const foreignUser = await insertTestUser(app, {
        email: 'foreign@other-org.com',
        organisationId: otherOrgId,
        createMembership: false, // no membership in test tenant
      });
      // Insert membership for the OTHER org only
      await insertTestMembership(app, {
        userId: foreignUser._id,
        organisationId: otherOrgId,
        roles: [UserRole.EMPLOYEE],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/users',
        headers: { cookie: `inv_access=${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const emails = res.json<{ data: Array<{ email: string }> }>().data.map((u) => u.email);
      expect(emails).not.toContain('foreign@other-org.com');
    });
  });

  describe('soft-deleted users', () => {
    it('excludes soft-deleted users from listings', async () => {
      const target = await insertTestUser(app, { email: 'will-be-deleted@example.com' });
      await app.mongo.db
        .collection('users')
        .updateOne(
          { _id: new ObjectId(target._id) },
          { $set: { deletedAt: new Date().toISOString(), deletedBy: 'test-admin' } },
        );
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.json<{ data: Array<{ email: string }> }>().data.map((u) => u.email)).not.toContain(
        'will-be-deleted@example.com',
      );
    });
  });

  describe('RBAC', () => {
    it.each([
      ['EMPLOYEE', UserRole.EMPLOYEE],
      ['EXTERNAL', UserRole.EXTERNAL],
    ])('returns 403 for %s', async (_label, role) => {
      const { token } = await provisionUser(app, { oid: `non-admin-${role}`, role });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users',
        headers: { cookie: `inv_access=${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 401 without cookie', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/users' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 with invalid cookie value', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users',
        headers: { cookie: 'inv_access=not-a-jwt' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // Osoby/Používatelia merge (2026-07-14): ASSET_MANAGER now reaches this
  // endpoint (previously ADMIN-only, see the RBAC describe above), but the
  // response is shaped down to the same fields the now-legacy
  // GET /v1/users/directory used to return, plus lastLoginAt (toManagerShape).
  describe('manager-shaped response (ASSET_MANAGER, 2026-07-14 merge)', () => {
    it('returns 200 for ASSET_MANAGER', async () => {
      await insertTestUser(app, { email: 'trimmed-target@example.com' });
      const { token } = await provisionUser(app, {
        oid: 'asset-manager-for-users-list',
        role: UserRole.ASSET_MANAGER,
      });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users',
        headers: { cookie: `inv_access=${token}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('trims ASSET_MANAGER response to _id/displayName/email/roles/isActive/lastLoginAt only', async () => {
      await insertTestUser(app, { email: 'trimmed-fields@example.com' });
      const { token } = await provisionUser(app, {
        oid: 'asset-manager-for-users-list-shape',
        role: UserRole.ASSET_MANAGER,
      });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users',
        headers: { cookie: `inv_access=${token}` },
      });
      const body = res.json<{ data: Array<Record<string, unknown>> }>();
      const target = body.data.find((u) => u['email'] === 'trimmed-fields@example.com');
      expect(target).toBeDefined();
      expect(Object.keys(target!).sort()).toEqual(
        ['_id', 'displayName', 'email', 'isActive', 'lastLoginAt', 'roles'].sort(),
      );
      // Admin-only fields must never reach an ASSET_MANAGER caller.
      expect(target).not.toHaveProperty('organisationId');
      expect(target).not.toHaveProperty('createdAt');
      expect(target).not.toHaveProperty('accountType');
      expect(target).not.toHaveProperty('preferences');
      expect(target).not.toHaveProperty('passwordHash');
    });

    it('ADMIN still receives the full (untrimmed) shape', async () => {
      await insertTestUser(app, { email: 'full-shape@example.com' });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/users',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const body = res.json<{ data: Array<Record<string, unknown>> }>();
      const target = body.data.find((u) => u['email'] === 'full-shape@example.com');
      expect(target).toBeDefined();
      expect(target).toHaveProperty('organisationId');
      expect(target).toHaveProperty('createdAt');
      expect(target).toHaveProperty('accountType');
    });
  });
});

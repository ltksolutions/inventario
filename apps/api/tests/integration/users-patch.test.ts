/**
 * Integration tests for PATCH /v1/users/:id — Slice #6c K17 (cookie auth).
 */

import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { insertTestUser, provisionUser, UserRole } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('PATCH /v1/users/:id', () => {
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
      oid: 'admin-for-users-patch',
      role: UserRole.ADMIN,
    });
    adminToken = token;
    adminId = String(user._id);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  describe('role changes', () => {
    it('grants a new role (EMPLOYEE → ASSET_MANAGER)', async () => {
      const target = await insertTestUser(app, { roles: [UserRole.EMPLOYEE] });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: [UserRole.ASSET_MANAGER] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ roles: string[] }>().roles).toEqual(['ASSET_MANAGER']);
    });

    it('adds an additional role', async () => {
      const target = await insertTestUser(app, { roles: [UserRole.EMPLOYEE] });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: [UserRole.EMPLOYEE, UserRole.TEAM_MANAGER] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ roles: string[] }>().roles).toEqual(['EMPLOYEE', 'TEAM_MANAGER']);
    });

    it('dedupes duplicate roles in the request body', async () => {
      const target = await insertTestUser(app, { roles: [UserRole.EMPLOYEE] });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: [UserRole.ASSET_MANAGER, UserRole.ASSET_MANAGER, UserRole.EMPLOYEE] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ roles: string[] }>().roles).toEqual(['ASSET_MANAGER', 'EMPLOYEE']);
    });

    it('emits USER_ROLE_GRANTED + USER_ROLE_REVOKED audit events', async () => {
      const target = await insertTestUser(app, {
        email: 'audit-target@example.com',
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
      const actions = auditDocs.map((d) => d['action']);
      expect(actions).toContain('USER_ROLE_GRANTED');
      expect(actions).toContain('USER_ROLE_REVOKED');
    });
  });

  describe('isActive flip', () => {
    it('deactivates an active user', async () => {
      const target = await insertTestUser(app, { isActive: true });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { isActive: false },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ isActive: boolean }>().isActive).toBe(false);
    });

    it('reactivates a deactivated user', async () => {
      const target = await insertTestUser(app, { isActive: false });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { isActive: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ isActive: boolean }>().isActive).toBe(true);
    });

    it('emits USER_DEACTIVATED on deactivation', async () => {
      const target = await insertTestUser(app, { isActive: true });
      await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { isActive: false },
      });
      const auditDoc = await app.mongo.db
        .collection('audit_logs')
        .findOne({ action: 'USER_DEACTIVATED', 'target.entityId': target._id });
      expect(auditDoc).not.toBeNull();
      expect(auditDoc?.['severity']).toBe('WARNING');
    });

    it('emits USER_REACTIVATED on reactivation', async () => {
      const target = await insertTestUser(app, { isActive: false });
      await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { isActive: true },
      });
      const auditDoc = await app.mongo.db
        .collection('audit_logs')
        .findOne({ action: 'USER_REACTIVATED', 'target.entityId': target._id });
      expect(auditDoc).not.toBeNull();
      expect(auditDoc?.['severity']).toBe('INFO');
    });
  });

  describe('combined + no-op', () => {
    it('changes both roles and isActive in one request', async () => {
      const target = await insertTestUser(app, { roles: [UserRole.EMPLOYEE], isActive: true });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: [UserRole.ASSET_MANAGER], isActive: false },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ roles: string[]; isActive: boolean }>();
      expect(body.roles).toEqual(['ASSET_MANAGER']);
      expect(body.isActive).toBe(false);
    });

    it('empty body returns 200 with the existing user (no-op)', async () => {
      const target = await insertTestUser(app, {
        email: 'noop@example.com',
        roles: [UserRole.EMPLOYEE],
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ email: string }>().email).toBe('noop@example.com');
    });

    it('same-role patch does not emit audit events', async () => {
      const target = await insertTestUser(app, { roles: [UserRole.EMPLOYEE] });
      await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: [UserRole.EMPLOYEE] },
      });
      const auditDocs = await app.mongo.db
        .collection('audit_logs')
        .find({ 'target.entityId': target._id })
        .toArray();
      expect(auditDocs).toHaveLength(0);
    });
  });

  describe('audit columns', () => {
    it('refreshes updatedBy to the admin actor', async () => {
      const target = await insertTestUser(app, {
        roles: [UserRole.EMPLOYEE],
        createdBy: 'someone-else',
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: [UserRole.ASSET_MANAGER] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ updatedBy: string }>().updatedBy).toBe(adminId);
    });

    it('advances updatedAt strictly forward', async () => {
      const target = await insertTestUser(app, { roles: [UserRole.EMPLOYEE] });
      const before = await app.mongo.db
        .collection('users')
        .findOne({ _id: new ObjectId(target._id) });
      const beforeTs = before?.['updatedAt'] as string;
      await new Promise((r) => setTimeout(r, 5));
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: [UserRole.ASSET_MANAGER] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ updatedAt: string }>().updatedAt > beforeTs).toBe(true);
    });
  });

  describe('not found + validation', () => {
    it('returns 404 for a valid but unknown id', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${new ObjectId().toString()}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: [UserRole.EMPLOYEE] },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for a soft-deleted target', async () => {
      const target = await insertTestUser(app);
      await app.mongo.db
        .collection('users')
        .updateOne(
          { _id: new ObjectId(target._id) },
          { $set: { deletedAt: new Date().toISOString(), deletedBy: 'test-admin' } },
        );
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: [UserRole.EMPLOYEE] },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for empty roles array', async () => {
      const target = await insertTestUser(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: [] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for invalid role enum value', async () => {
      const target = await insertTestUser(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: ['SUPER_USER'] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for malformed id', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/users/not-a-hex-id',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: [UserRole.EMPLOYEE] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('self-patch guardrails', () => {
    it('returns 400 when admin removes their own ADMIN role', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${adminId}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: [UserRole.EMPLOYEE] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/own ADMIN role/i);
    });

    it('returns 400 when admin deactivates themselves', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${adminId}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { isActive: false },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/deactivate themselves/i);
    });

    it('admin can patch themselves with no-op role set (still ADMIN)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${adminId}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: [UserRole.ADMIN] },
      });
      expect(res.statusCode).toBe(200);
    });

    it('admin can add another role while keeping ADMIN', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${adminId}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: [UserRole.ADMIN, UserRole.ASSET_MANAGER] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ roles: string[] }>().roles).toEqual(['ADMIN', 'ASSET_MANAGER']);
    });
  });

  describe('last-admin guardrail', () => {
    it('allows demoting another admin while at least one other remains active', async () => {
      const other = await insertTestUser(app, { roles: [UserRole.ADMIN] });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${other._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { roles: [UserRole.EMPLOYEE] },
      });
      expect(res.statusCode).toBe(200);
    });

    it('allows deactivating another admin while at least one other remains', async () => {
      const other = await insertTestUser(app, { roles: [UserRole.ADMIN] });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${other._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { isActive: false },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('RBAC', () => {
    it('returns 403 for EMPLOYEE', async () => {
      const target = await insertTestUser(app);
      const { token } = await provisionUser(app, {
        oid: 'employee-for-patch',
        role: UserRole.EMPLOYEE,
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${token}` },
        payload: { roles: [UserRole.EMPLOYEE] },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 for ASSET_MANAGER', async () => {
      const target = await insertTestUser(app);
      const { token } = await provisionUser(app, {
        oid: 'asset-manager-for-patch',
        role: UserRole.ASSET_MANAGER,
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        headers: { cookie: `inv_access=${token}` },
        payload: { roles: [UserRole.EMPLOYEE] },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 401 without auth cookie', async () => {
      const target = await insertTestUser(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/users/${target._id}`,
        payload: { roles: [UserRole.EMPLOYEE] },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});

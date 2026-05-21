/**
 * Integration tests for POST/GET/DELETE /v1/invitations — Slice #6c K18.
 */

import { randomBytes } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  provisionUser,
  resolveTestTenantId,
  seedTestTenant,
  UserRole,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validInviteBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const stamp = randomBytes(4).toString('hex');
  return {
    email: `invite-${stamp}@example.com`,
    roles: [UserRole.EMPLOYEE],
    firstName: 'Jana',
    lastName: 'Nováková',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// POST /v1/invitations
// ---------------------------------------------------------------------------

describe('POST /v1/invitations', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;
  let managerToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
    const admin = await provisionUser(app, { oid: 'invite-admin', role: UserRole.ADMIN });
    adminToken = admin.token;
    adminId = String(admin.user._id);
    const manager = await provisionUser(app, {
      oid: 'invite-manager',
      role: UserRole.ASSET_MANAGER,
    });
    managerToken = manager.token;
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  describe('happy path', () => {
    it('ADMIN creates invitation → 201 with expected shape', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validInviteBody(),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{
        _id: string;
        email: string;
        roles: string[];
        invitedBy: string;
        invitedAt: string;
        expiresAt: string;
      }>();
      expect(body._id).toMatch(/^[a-f0-9]{24}$/);
      expect(body.roles).toEqual([UserRole.EMPLOYEE]);
      expect(body.invitedBy).toBe(adminId);
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('ASSET_MANAGER can invite EMPLOYEE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${managerToken}` },
        payload: validInviteBody({ roles: [UserRole.EMPLOYEE] }),
      });
      expect(res.statusCode).toBe(201);
    });

    it('creates a pending User document in DB', async () => {
      const body = validInviteBody();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });
      expect(res.statusCode).toBe(201);
      const id = res.json<{ _id: string }>()._id;
      const { ObjectId } = await import('mongodb');
      const doc = await app.mongo.db.collection('users').findOne({ _id: new ObjectId(id) });
      expect(doc).not.toBeNull();
      expect(doc!['passwordHash']).toBeNull();
      expect(doc!['emailVerified']).toBe(false);
      expect(doc!['emailVerificationToken']).toMatch(/^[a-f0-9]{64}$/);
    });

    it('emits USER_INVITED audit event', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validInviteBody(),
      });
      const id = res.json<{ _id: string }>()._id;
      const audit = await app.mongo.db
        .collection('audit_logs')
        .findOne({ action: 'USER_INVITED', 'target.entityId': id });
      expect(audit).not.toBeNull();
      expect(audit!['severity']).toBe('INFO');
    });

    it('pre-fills firstName + lastName in the pending User doc', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validInviteBody({ firstName: 'Marta', lastName: 'Kováčová' }),
      });
      const id = res.json<{ _id: string }>()._id;
      const { ObjectId } = await import('mongodb');
      const doc = await app.mongo.db.collection('users').findOne({ _id: new ObjectId(id) });
      expect(doc!['firstName']).toBe('Marta');
      expect(doc!['lastName']).toBe('Kováčová');
    });
  });

  describe('RBAC', () => {
    it('returns 403 for EMPLOYEE', async () => {
      const { token } = await provisionUser(app, { oid: 'invite-emp', role: UserRole.EMPLOYEE });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${token}` },
        payload: validInviteBody(),
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 401 without cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        payload: validInviteBody(),
      });
      expect(res.statusCode).toBe(401);
    });

    it('ASSET_MANAGER cannot invite ADMIN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${managerToken}` },
        payload: validInviteBody({ roles: [UserRole.ADMIN] }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/Only ADMIN/i);
    });

    it('ADMIN can invite ADMIN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validInviteBody({ roles: [UserRole.ADMIN] }),
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe('email uniqueness', () => {
    it('returns 400 when email already has an active user', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validInviteBody({ email: 'already@example.com' }),
      });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validInviteBody({ email: 'already@example.com' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/already exists/i);
    });

    it('returns 400 when email exists in another tenant', async () => {
      const tenantB = await seedTestTenant(app, { slug: 'invite-tenant-b' });
      const { token: adminB } = await provisionUser(app, {
        oid: 'admin-b-inv',
        role: UserRole.ADMIN,
        organisationId: tenantB._id,
      });
      await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminB}` },
        payload: validInviteBody({ email: 'cross@example.com' }),
      });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validInviteBody({ email: 'cross@example.com' }),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('domain policy', () => {
    it('accepts any email when enforceAllowedDomains is false (default)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validInviteBody({ email: 'someone@gmail.com' }),
      });
      expect(res.statusCode).toBe(201);
    });

    it('rejects email outside whitelist when enforceAllowedDomains is true', async () => {
      const orgId = await resolveTestTenantId(app);
      const { ObjectId } = await import('mongodb');
      await app.mongo.db.collection('organisations').updateOne(
        { _id: new ObjectId(orgId) },
        {
          $set: {
            autoJoinDomains: ['futbalsfz.sk'],
            settings: { invitations: { enforceAllowedDomains: true } },
          },
        },
      );
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validInviteBody({ email: 'jano@gmail.com' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/@gmail\.com/);
      expect(res.json<{ message: string }>().message).toMatch(/futbalsfz\.sk/);
    });

    it('allows email matching the whitelist when enforceAllowedDomains is true', async () => {
      const orgId = await resolveTestTenantId(app);
      const { ObjectId } = await import('mongodb');
      await app.mongo.db.collection('organisations').updateOne(
        { _id: new ObjectId(orgId) },
        {
          $set: {
            autoJoinDomains: ['futbalsfz.sk'],
            settings: { invitations: { enforceAllowedDomains: true } },
          },
        },
      );
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validInviteBody({ email: 'jano@futbalsfz.sk' }),
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe('validation', () => {
    it('returns 400 for invalid email format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validInviteBody({ email: 'not-an-email' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for empty roles array', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validInviteBody({ roles: [] }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for invalid role enum value', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validInviteBody({ roles: ['SUPER_USER'] }),
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

// ---------------------------------------------------------------------------
// GET /v1/invitations
// ---------------------------------------------------------------------------

describe('GET /v1/invitations', () => {
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
    const admin = await provisionUser(app, { oid: 'list-admin', role: UserRole.ADMIN });
    adminToken = admin.token;
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  it('returns empty list when no invitations', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; pagination: { total: number } }>();
    expect(body.data).toHaveLength(0);
    expect(body.pagination.total).toBe(0);
  });

  it('lists pending invitations after creation', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminToken}` },
      payload: validInviteBody({ email: 'alpha@example.com' }),
    });
    await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminToken}` },
      payload: validInviteBody({ email: 'beta@example.com' }),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ pagination: { total: number } }>().pagination.total).toBe(2);
  });

  it('does not include accepted invitations in list', async () => {
    const inv = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminToken}` },
      payload: validInviteBody(),
    });
    const id = inv.json<{ _id: string }>()._id;
    // Simulate accept by setting passwordHash + emailVerified
    const { ObjectId } = await import('mongodb');
    await app.mongo.db
      .collection('users')
      .updateOne(
        { _id: new ObjectId(id) },
        { $set: { passwordHash: 'some-hash', emailVerified: true } },
      );
    const res = await app.inject({
      method: 'GET',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminToken}` },
    });
    expect(res.json<{ pagination: { total: number } }>().pagination.total).toBe(0);
  });

  it('supports q filter on email', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminToken}` },
      payload: validInviteBody({ email: 'findme@example.com' }),
    });
    await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminToken}` },
      payload: validInviteBody({ email: 'hidden@other.com' }),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/invitations?q=findme',
      headers: { cookie: `inv_access=${adminToken}` },
    });
    expect(res.json<{ pagination: { total: number } }>().pagination.total).toBe(1);
    expect(res.json<{ data: Array<{ email: string }> }>().data[0]!.email).toBe(
      'findme@example.com',
    );
  });

  it('does not include other tenant invitations (cross-tenant isolation)', async () => {
    const tenantB = await seedTestTenant(app, { slug: 'list-tenant-b' });
    const { token: adminB } = await provisionUser(app, {
      oid: 'admin-b-list',
      role: UserRole.ADMIN,
      organisationId: tenantB._id,
    });
    await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminB}` },
      payload: validInviteBody({ email: 'tenant-b-user@example.com' }),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminToken}` },
    });
    expect(res.json<{ pagination: { total: number } }>().pagination.total).toBe(0);
  });

  it('returns 403 for EMPLOYEE', async () => {
    const { token } = await provisionUser(app, { oid: 'list-emp', role: UserRole.EMPLOYEE });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE /v1/invitations/:id
// ---------------------------------------------------------------------------

describe('DELETE /v1/invitations/:id', () => {
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
    const admin = await provisionUser(app, { oid: 'revoke-admin', role: UserRole.ADMIN });
    adminToken = admin.token;
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  it('revokes pending invitation → 204', async () => {
    const inv = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminToken}` },
      payload: validInviteBody(),
    });
    const id = inv.json<{ _id: string }>()._id;
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/invitations/${id}`,
      headers: { cookie: `inv_access=${adminToken}` },
    });
    expect(res.statusCode).toBe(204);
  });

  it('soft-deletes the user document', async () => {
    const inv = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminToken}` },
      payload: validInviteBody(),
    });
    const id = inv.json<{ _id: string }>()._id;
    await app.inject({
      method: 'DELETE',
      url: `/v1/invitations/${id}`,
      headers: { cookie: `inv_access=${adminToken}` },
    });
    const { ObjectId } = await import('mongodb');
    const doc = await app.mongo.db.collection('users').findOne({ _id: new ObjectId(id) });
    expect(doc!['deletedAt']).not.toBeNull();
  });

  it('emits USER_INVITATION_REVOKED audit event', async () => {
    const inv = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminToken}` },
      payload: validInviteBody(),
    });
    const id = inv.json<{ _id: string }>()._id;
    await app.inject({
      method: 'DELETE',
      url: `/v1/invitations/${id}`,
      headers: { cookie: `inv_access=${adminToken}` },
    });
    const audit = await app.mongo.db
      .collection('audit_logs')
      .findOne({ action: 'USER_INVITATION_REVOKED', 'target.entityId': id });
    expect(audit).not.toBeNull();
    expect(audit!['severity']).toBe('WARNING');
  });

  it('excludes revoked invite from GET /v1/invitations list', async () => {
    const inv = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminToken}` },
      payload: validInviteBody(),
    });
    const id = inv.json<{ _id: string }>()._id;
    await app.inject({
      method: 'DELETE',
      url: `/v1/invitations/${id}`,
      headers: { cookie: `inv_access=${adminToken}` },
    });
    const list = await app.inject({
      method: 'GET',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminToken}` },
    });
    expect(list.json<{ pagination: { total: number } }>().pagination.total).toBe(0);
  });

  it('returns 404 for already revoked invite', async () => {
    const inv = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminToken}` },
      payload: validInviteBody(),
    });
    const id = inv.json<{ _id: string }>()._id;
    await app.inject({
      method: 'DELETE',
      url: `/v1/invitations/${id}`,
      headers: { cookie: `inv_access=${adminToken}` },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/invitations/${id}`,
      headers: { cookie: `inv_access=${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when trying to revoke an already accepted invite', async () => {
    const inv = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminToken}` },
      payload: validInviteBody(),
    });
    const id = inv.json<{ _id: string }>()._id;
    const { ObjectId } = await import('mongodb');
    await app.mongo.db
      .collection('users')
      .updateOne(
        { _id: new ObjectId(id) },
        { $set: { passwordHash: 'argon2hash', emailVerified: true } },
      );
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/invitations/${id}`,
      headers: { cookie: `inv_access=${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for malformed id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/invitations/not-valid',
      headers: { cookie: `inv_access=${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 for EMPLOYEE', async () => {
    const inv = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      headers: { cookie: `inv_access=${adminToken}` },
      payload: validInviteBody(),
    });
    const id = inv.json<{ _id: string }>()._id;
    const { token: empToken } = await provisionUser(app, {
      oid: 'revoke-emp',
      role: UserRole.EMPLOYEE,
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/invitations/${id}`,
      headers: { cookie: `inv_access=${empToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

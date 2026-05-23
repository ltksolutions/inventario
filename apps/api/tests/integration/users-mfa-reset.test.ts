// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests — K12b Admin MFA reset.
 *
 * Covers:
 *   - ADMIN resets MFA for user who has MFA enabled → 204, MFA fields cleared
 *   - USER_MFA_RESET_BY_ADMIN audit event recorded with WARNING severity
 *   - ADMIN tries to reset own MFA via this endpoint → 400
 *   - Target user has no MFA enabled → 400
 *   - ASSET_MANAGER gets 403
 *   - EMPLOYEE gets 403
 *   - Cross-tenant user → 404
 *   - Invalid ObjectId format → 400
 *   - Non-existent user ID → 404
 */

import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { insertTestUser, provisionUser, UserRole } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('DELETE /v1/users/:id/mfa', () => {
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
      oid: 'admin-for-mfa-reset',
      role: UserRole.ADMIN,
    });
    adminToken = token;
    adminId = String(user._id);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Insert a user with MFA already enabled. */
  async function insertMfaUser(options: { email?: string } = {}): Promise<{ _id: string }> {
    const target = await insertTestUser(app, {
      ...(options.email !== undefined ? { email: options.email } : {}),
      roles: [UserRole.EMPLOYEE],
    });
    // Set MFA fields directly
    await app.mongo.db.collection('users').updateOne(
      { _id: new ObjectId(target._id) as never },
      {
        $set: {
          mfaEnabled: true,
          mfaSecret: 'enc:aabbcc:ddeeff:112233',
          mfaRecoveryCodes: ['$argon2id$hash1', '$argon2id$hash2'],
          mfaEnabledAt: new Date().toISOString(),
        },
      },
    );
    return { _id: target._id };
  }

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('admin resets MFA for a user → 204, MFA fields cleared', async () => {
    const { _id } = await insertMfaUser({ email: 'mfa-target@test.inv' });

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/users/${_id}/mfa`,
      headers: { cookie: `inv_access=${adminToken}` },
    });

    expect(res.statusCode).toBe(204);

    const user = await app.mongo.db
      .collection('users')
      .findOne({ _id: new ObjectId(_id) as never });
    expect(user?.['mfaEnabled']).toBe(false);
    expect(user?.['mfaSecret']).toBeNull();
    expect(user?.['mfaRecoveryCodes']).toEqual([]);
    expect(user?.['mfaEnabledAt']).toBeNull();
  });

  it('records USER_MFA_RESET_BY_ADMIN audit event with WARNING severity', async () => {
    const { _id } = await insertMfaUser({ email: 'audit-mfa@test.inv' });

    await app.inject({
      method: 'DELETE',
      url: `/v1/users/${_id}/mfa`,
      headers: { cookie: `inv_access=${adminToken}` },
    });

    const auditEntry = await app.mongo.db.collection('audit_logs').findOne({
      action: 'USER_MFA_RESET_BY_ADMIN',
      'target.entityId': _id,
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.['severity']).toBe('WARNING');
    expect(auditEntry?.['actor']['userId']).toBe(adminId);
  });

  // -------------------------------------------------------------------------
  // Guardrails
  // -------------------------------------------------------------------------

  it('returns 400 when admin tries to reset their own MFA', async () => {
    // Give the admin MFA enabled
    await app.mongo.db.collection('users').updateOne(
      { _id: new ObjectId(adminId) as never },
      {
        $set: {
          mfaEnabled: true,
          mfaSecret: 'enc:x:y:z',
          mfaEnabledAt: new Date().toISOString(),
        },
      },
    );

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/users/${adminId}/mfa`,
      headers: { cookie: `inv_access=${adminToken}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toContain('/v1/auth/mfa/disable');
  });

  it('returns 400 when target user does not have MFA enabled', async () => {
    const target = await insertTestUser(app, { roles: [UserRole.EMPLOYEE] });
    // mfaEnabled defaults to false in insertTestUser

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/users/${target._id}/mfa`,
      headers: { cookie: `inv_access=${adminToken}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toContain('MFA is not enabled');
  });

  // -------------------------------------------------------------------------
  // RBAC
  // -------------------------------------------------------------------------

  it('returns 403 for ASSET_MANAGER', async () => {
    const { token } = await provisionUser(app, {
      oid: 'am-for-mfa-reset',
      role: UserRole.ASSET_MANAGER,
    });
    const { _id } = await insertMfaUser();

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/users/${_id}/mfa`,
      headers: { cookie: `inv_access=${token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 403 for EMPLOYEE', async () => {
    const { token } = await provisionUser(app, {
      oid: 'emp-for-mfa-reset',
      role: UserRole.EMPLOYEE,
    });
    const { _id } = await insertMfaUser();

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/users/${_id}/mfa`,
      headers: { cookie: `inv_access=${token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 401 without auth cookie', async () => {
    const { _id } = await insertMfaUser();

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/users/${_id}/mfa`,
    });

    expect(res.statusCode).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Not found / validation
  // -------------------------------------------------------------------------

  it('returns 404 for a user in a different tenant', async () => {
    // Seed a second tenant and user in it
    const otherTenantId = new ObjectId().toHexString();
    await app.mongo.db.collection('organisations').insertOne({
      _id: new ObjectId(otherTenantId) as never,
      displayName: 'Other Org',
      slug: `other-org-${otherTenantId.slice(-6)}`,
      status: 'ACTIVE',
      plan: 'FREE',
      settings: {},
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'SYSTEM',
      updatedBy: 'SYSTEM',
    } as never);

    const otherUser = await insertTestUser(app, {
      organisationId: otherTenantId,
      email: `cross-tenant-mfa@test.inv`,
    });
    // Enable MFA for cross-tenant user
    await app.mongo.db.collection('users').updateOne(
      { _id: new ObjectId(otherUser._id) as never },
      {
        $set: {
          mfaEnabled: true,
          mfaSecret: 'enc:x:y:z',
          mfaEnabledAt: new Date().toISOString(),
        },
      },
    );

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/users/${otherUser._id}/mfa`,
      headers: { cookie: `inv_access=${adminToken}` },
    });

    // Cross-tenant lookup returns 404 (not 403) to avoid information leakage
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a valid but non-existent user ID', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/users/${new ObjectId().toHexString()}/mfa`,
      headers: { cookie: `inv_access=${adminToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for invalid ObjectId format', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/users/not-a-valid-objectid/mfa',
      headers: { cookie: `inv_access=${adminToken}` },
    });

    expect(res.statusCode).toBe(400);
  });
});

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for GET /v1/me/export — GDPR Art. 20 (data portability).
 *
 * Test matrix:
 *   happy path:
 *     - vracia 200 so správnou štruktúrou (exportedAt, profile, memberships, auditLog)
 *     - profile obsahuje správne polia prihláseného používateľa
 *     - secrets (passwordHash, mfaSecret, mfaRecoveryCodes) NIE SÚ v profile
 *     - memberships obsahuje membership záznamy pre tohto používateľa
 *     - auditLog obsahuje záznamy kde je actor === userId
 *     - auditLog neobsahuje záznamy iného používateľa
 *     - po volaní vznikne DATA_EXPORT_REQUESTED audit záznam
 *
 *   RBAC / auth:
 *     - 401 bez auth cookie
 *     - EMPLOYEE môže exportovať vlastné dáta (nie len ADMIN)
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { insertTestMembership, provisionUser, UserRole } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert a raw audit log entry directly into the collection. */
async function insertTestAuditLog(
  app: FastifyInstance,
  options: {
    userId: string;
    organisationId: string;
    action?: string;
    displayName?: string;
  },
): Promise<{ _id: string }> {
  const now = new Date().toISOString();
  const doc = {
    organisationId: options.organisationId,
    at: now,
    actor: {
      userId: options.userId,
      displayName: options.displayName ?? 'Test User',
      accountType: 'ENTRA_ID',
      ipAddress: null,
      userAgent: null,
    },
    action: options.action ?? 'USER_LOGIN',
    target: {
      entityType: 'User',
      entityId: options.userId,
      snapshot: {},
    },
    description: 'Test audit entry',
    changes: null,
    metadata: {},
    severity: 'INFO',
    legalBasis: 'legitimate_interest',
    dataCategories: ['authentication'],
    isPseudonymized: false,
    pseudonymizedAt: null,
  };
  const result = await app.mongo.db.collection('audit_logs').insertOne(doc);
  return { _id: String(result.insertedId) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /v1/me/export', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('returns 200 with correct top-level shape', async () => {
      const { token } = await provisionUser(app, {
        oid: 'export-shape-test',
        role: UserRole.EMPLOYEE,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/me/export',
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();
      expect(body).toHaveProperty('exportedAt');
      expect(body).toHaveProperty('profile');
      expect(body).toHaveProperty('memberships');
      expect(body).toHaveProperty('auditLog');
      expect(typeof body['exportedAt']).toBe('string');
      expect(Array.isArray(body['memberships'])).toBe(true);
      expect(Array.isArray(body['auditLog'])).toBe(true);
    });

    it('profile contains the user fields of the caller', async () => {
      const { user, token } = await provisionUser(app, {
        oid: 'export-profile-test',
        role: UserRole.EMPLOYEE,
        email: 'export-test@example.com',
        firstName: 'Export',
        lastName: 'Tester',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/me/export',
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ profile: Record<string, unknown> }>();
      expect(body.profile['_id']).toBe(String(user._id));
      expect(body.profile['email']).toBe('export-test@example.com');
      expect(body.profile['firstName']).toBe('Export');
      expect(body.profile['lastName']).toBe('Tester');
    });

    it('profile does NOT contain passwordHash, mfaSecret, mfaRecoveryCodes', async () => {
      const { token } = await provisionUser(app, {
        oid: 'export-secrets-test',
        role: UserRole.EMPLOYEE,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/me/export',
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ profile: Record<string, unknown> }>();
      expect(body.profile).not.toHaveProperty('passwordHash');
      expect(body.profile).not.toHaveProperty('mfaSecret');
      expect(body.profile).not.toHaveProperty('mfaRecoveryCodes');
    });

    it('memberships contains the membership record of the caller', async () => {
      const { user, token } = await provisionUser(app, {
        oid: 'export-membership-test',
        role: UserRole.EMPLOYEE,
      });

      // Seed a membership for this user
      await insertTestMembership(app, {
        userId: String(user._id),
        roles: [UserRole.EMPLOYEE],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/me/export',
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ memberships: Record<string, unknown>[] }>();
      expect(body.memberships.length).toBeGreaterThanOrEqual(1);
      const found = body.memberships.find((m) => m['userId'] === String(user._id));
      expect(found).toBeDefined();
    });

    it('auditLog contains entries where caller is the actor', async () => {
      const { user, token } = await provisionUser(app, {
        oid: 'export-auditlog-test',
        role: UserRole.EMPLOYEE,
      });
      const userId = String(user._id);
      const organisationId = String(user.organisationId);

      await insertTestAuditLog(app, { userId, organisationId, action: 'USER_LOGIN' });
      await insertTestAuditLog(app, { userId, organisationId, action: 'USER_LOGOUT' });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/me/export',
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ auditLog: Record<string, unknown>[] }>();
      // At minimum the two we inserted (plus any emitted by this export call)
      expect(body.auditLog.length).toBeGreaterThanOrEqual(2);
      const actions = body.auditLog.map((e) => e['action'] as string);
      expect(actions).toContain('USER_LOGIN');
      expect(actions).toContain('USER_LOGOUT');
    });

    it('auditLog does NOT contain entries from a different user', async () => {
      const { user, token } = await provisionUser(app, {
        oid: 'export-isolation-caller',
        role: UserRole.EMPLOYEE,
      });
      const { user: otherUser } = await provisionUser(app, {
        oid: 'export-isolation-other',
        role: UserRole.EMPLOYEE,
      });

      const callerOrgId = String(user.organisationId);
      const otherId = String(otherUser._id);

      // Seed audit entries for the OTHER user only
      await insertTestAuditLog(app, {
        userId: otherId,
        organisationId: callerOrgId,
        action: 'USER_LOGIN',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/me/export',
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ auditLog: Record<string, unknown>[] }>();
      // None of the returned entries should belong to the other user
      for (const entry of body.auditLog) {
        const actor = entry['actor'] as Record<string, unknown> | undefined;
        expect(actor?.['userId']).not.toBe(otherId);
      }
    });

    it('emits DATA_EXPORT_REQUESTED audit event after export', async () => {
      const { user, token } = await provisionUser(app, {
        oid: 'export-audit-event-test',
        role: UserRole.EMPLOYEE,
      });

      await app.inject({
        method: 'GET',
        url: '/v1/me/export',
        headers: { cookie: `inv_access=${token}` },
      });

      // Give fire-and-forget a tick to complete
      await new Promise((r) => setTimeout(r, 50));

      const auditEntry = await app.mongo.db.collection('audit_logs').findOne({
        'actor.userId': String(user._id),
        action: 'DATA_EXPORT_REQUESTED',
      });
      expect(auditEntry).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // RBAC / auth
  // -------------------------------------------------------------------------

  describe('RBAC', () => {
    it('returns 401 without auth cookie', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/me/export',
      });
      expect(res.statusCode).toBe(401);
    });

    it('EMPLOYEE can export their own data (no ADMIN required)', async () => {
      const { token } = await provisionUser(app, {
        oid: 'export-employee-rbac',
        role: UserRole.EMPLOYEE,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/me/export',
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(200);
    });

    it('ASSET_MANAGER can export their own data', async () => {
      const { token } = await provisionUser(app, {
        oid: 'export-manager-rbac',
        role: UserRole.ASSET_MANAGER,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/me/export',
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(200);
    });
  });
});

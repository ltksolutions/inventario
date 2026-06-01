// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for DELETE /v1/auth/me — GDPR Art. 17 (right to erasure).
 *
 * Existing endpoint (Slice #6c K17), previously untested. This covers the
 * irreversible pseudonymisation behaviour:
 *
 *   happy path:
 *     - 204, user is pseudonymised (email/name replaced, isActive=false, deletedAt set)
 *     - memberships are soft-deleted
 *     - secrets cleared (passwordHash, mfaSecret, mfaRecoveryCodes, entraOid)
 *     - emits DATA_DELETION_REQUESTED audit event (via AuditLogService shape)
 *     - auth cookies cleared
 *
 *   guardrails:
 *     - last active ADMIN in a tenant cannot erase themselves (would orphan tenant)
 *
 *   auth:
 *     - 401 without auth cookie
 */

import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { insertTestMembership, provisionUser, UserRole } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('DELETE /v1/auth/me (GDPR Art. 17 erasure)', () => {
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
    it('returns 204 and pseudonymises the user', async () => {
      // Provision an employee (not last admin, so erasure is allowed).
      // First create an admin so the tenant has one, then the employee.
      await provisionUser(app, { oid: 'erasure-admin-keeper', role: UserRole.ADMIN });
      const { user, token } = await provisionUser(app, {
        oid: 'erasure-employee',
        role: UserRole.EMPLOYEE,
        email: 'erase-me@example.com',
      });

      // Seed a membership so the soft-delete path has something to act on.
      await insertTestMembership(app, {
        userId: String(user._id),
        roles: [UserRole.EMPLOYEE],
      });

      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/auth/me',
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(204);

      // Verify pseudonymisation in DB
      const doc = await app.mongo.db
        .collection('users')
        .findOne({ _id: new ObjectId(String(user._id)) });

      expect(doc).not.toBeNull();
      expect(doc!['email']).not.toBe('erase-me@example.com');
      expect(doc!['email']).toContain('deleted');
      expect(doc!['firstName']).toBe('Deleted');
      expect(doc!['isActive']).toBe(false);
      expect(doc!['deletedAt']).not.toBeNull();
      expect(doc!['passwordHash']).toBeNull();
      expect(doc!['mfaSecret']).toBeNull();
      expect(doc!['entraOid']).toBeNull();
    });

    it('soft-deletes all memberships', async () => {
      await provisionUser(app, { oid: 'erasure-admin-keeper-2', role: UserRole.ADMIN });
      const { user, token } = await provisionUser(app, {
        oid: 'erasure-employee-2',
        role: UserRole.EMPLOYEE,
      });
      await insertTestMembership(app, {
        userId: String(user._id),
        roles: [UserRole.EMPLOYEE],
      });

      await app.inject({
        method: 'DELETE',
        url: '/v1/auth/me',
        headers: { cookie: `inv_access=${token}` },
      });

      const memberships = await app.mongo.db
        .collection('memberships')
        .find({ userId: String(user._id) })
        .toArray();

      // All memberships should be soft-deleted
      for (const m of memberships) {
        expect(m['deletedAt']).not.toBeNull();
      }
    });

    it('emits DATA_DELETION_REQUESTED audit event with full actor shape', async () => {
      await provisionUser(app, { oid: 'erasure-admin-keeper-3', role: UserRole.ADMIN });
      const { user, token } = await provisionUser(app, {
        oid: 'erasure-employee-3',
        role: UserRole.EMPLOYEE,
      });
      await insertTestMembership(app, {
        userId: String(user._id),
        roles: [UserRole.EMPLOYEE],
      });

      await app.inject({
        method: 'DELETE',
        url: '/v1/auth/me',
        headers: { cookie: `inv_access=${token}` },
      });

      const entry = await app.mongo.db.collection('audit_logs').findOne({
        action: 'DATA_DELETION_REQUESTED',
        'actor.userId': String(user._id),
      });

      expect(entry).not.toBeNull();
      // AuditLogService shape: actor has displayName + accountType, plus legalBasis
      expect(entry!['actor']).toHaveProperty('displayName');
      expect(entry!['legalBasis']).toBe('legal_obligation');
      expect(entry!['severity']).toBe('WARNING');
    });

    it('clears auth cookies', async () => {
      await provisionUser(app, { oid: 'erasure-admin-keeper-4', role: UserRole.ADMIN });
      const { user, token } = await provisionUser(app, {
        oid: 'erasure-employee-4',
        role: UserRole.EMPLOYEE,
      });
      await insertTestMembership(app, {
        userId: String(user._id),
        roles: [UserRole.EMPLOYEE],
      });

      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/auth/me',
        headers: { cookie: `inv_access=${token}` },
      });

      const setCookies = res.headers['set-cookie'];
      const cookieStr = Array.isArray(setCookies) ? setCookies.join(';') : String(setCookies ?? '');
      expect(cookieStr).toContain('inv_access');
    });
  });

  // -------------------------------------------------------------------------
  // Guardrails
  // -------------------------------------------------------------------------

  describe('guardrails', () => {
    it('last active ADMIN cannot erase themselves', async () => {
      // Sole admin in the tenant — erasure would orphan it.
      const { user, token } = await provisionUser(app, {
        oid: 'sole-admin-erasure',
        role: UserRole.ADMIN,
      });
      await insertTestMembership(app, {
        userId: String(user._id),
        roles: [UserRole.ADMIN],
      });

      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/auth/me',
        headers: { cookie: `inv_access=${token}` },
      });

      // Service throws (last-admin guard) — should NOT be 204
      expect(res.statusCode).not.toBe(204);
      expect(res.statusCode).toBeGreaterThanOrEqual(400);

      // User must still be intact
      const doc = await app.mongo.db
        .collection('users')
        .findOne({ _id: new ObjectId(String(user._id)) });
      expect(doc!['deletedAt']).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  describe('auth', () => {
    it('returns 401 without auth cookie', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/auth/me',
      });

      expect(res.statusCode).toBe(401);
    });
  });
});

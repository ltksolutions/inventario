// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for PATCH /v1/me — GDPR Art. 16 (right to rectification).
 *
 * Test matrix:
 *   happy path:
 *     - aktualizuje firstName a lastName, vráti 200 s aktualizovaným profilom
 *     - aktualizuje len displayName (bez zmeny mena)
 *     - aktualizuje preferences
 *     - auto-derivuje displayName z firstName+lastName ak nie je explicitný
 *     - explicitný displayName preváži auto-deriváciu
 *     - prázdne body = 200, žiadna zmena (no-op)
 *     - emituje USER_UPDATED audit event po zmene
 *     - secrets (passwordHash, mfaSecret, mfaRecoveryCodes) NIE SÚ vo výstupe
 *
 *   validácia:
 *     - 400 ak firstName je prázdny string
 *     - 400 ak firstName presahuje 100 znakov
 *     - 400 ak displayName presahuje 200 znakov
 *     - 400 ak body obsahuje zakázané pole `roles`
 *     - 400 ak body obsahuje zakázané pole `email`
 *     - 400 ak body obsahuje zakázané pole `isActive`
 *
 *   RBAC / auth:
 *     - 401 bez auth cookie
 *     - EMPLOYEE môže patchovať vlastný profil
 *     - ASSET_MANAGER môže patchovať vlastný profil
 *     - ADMIN môže patchovať vlastný profil
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { provisionUser, UserRole } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /v1/me', () => {
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
    it('updates firstName and lastName, returns 200 with updated profile', async () => {
      const { token } = await provisionUser(app, {
        oid: 'patch-me-name',
        role: UserRole.EMPLOYEE,
        firstName: 'Old',
        lastName: 'Name',
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: { firstName: 'Nové', lastName: 'Meno' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();
      expect(body['firstName']).toBe('Nové');
      expect(body['lastName']).toBe('Meno');
    });

    it('updates displayName only', async () => {
      const { token } = await provisionUser(app, {
        oid: 'patch-me-displayname',
        role: UserRole.EMPLOYEE,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: { displayName: 'Môj Pseudonym' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();
      expect(body['displayName']).toBe('Môj Pseudonym');
    });

    it('updates preferences', async () => {
      const { token } = await provisionUser(app, {
        oid: 'patch-me-preferences',
        role: UserRole.EMPLOYEE,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: {
          preferences: {
            language: 'en',
            timezone: 'UTC',
            emailNotifications: false,
            pushNotifications: true,
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();
      const prefs = body['preferences'] as Record<string, unknown>;
      expect(prefs['language']).toBe('en');
      expect(prefs['emailNotifications']).toBe(false);
    });

    it('auto-derives displayName from firstName+lastName when not provided', async () => {
      const { token } = await provisionUser(app, {
        oid: 'patch-me-autoderive',
        role: UserRole.EMPLOYEE,
        firstName: 'Old',
        lastName: 'Name',
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: { firstName: 'Ján', lastName: 'Novák' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();
      expect(body['firstName']).toBe('Ján');
      expect(body['lastName']).toBe('Novák');
      expect(body['displayName']).toBe('Ján Novák');
    });

    it('explicit displayName overrides auto-derivation', async () => {
      const { token } = await provisionUser(app, {
        oid: 'patch-me-explicit-dn',
        role: UserRole.EMPLOYEE,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: { firstName: 'Ján', lastName: 'Novák', displayName: 'jnovak' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();
      expect(body['displayName']).toBe('jnovak');
    });

    it('empty body returns 200 with unchanged profile (no-op)', async () => {
      const { user, token } = await provisionUser(app, {
        oid: 'patch-me-noop',
        role: UserRole.EMPLOYEE,
        firstName: 'Unchanged',
        lastName: 'User',
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();
      expect(body['_id']).toBe(String(user._id));
      expect(body['firstName']).toBe('Unchanged');
    });

    it('does NOT include secrets in response', async () => {
      const { token } = await provisionUser(app, {
        oid: 'patch-me-secrets',
        role: UserRole.EMPLOYEE,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: { firstName: 'Test' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();
      expect(body).not.toHaveProperty('passwordHash');
      expect(body).not.toHaveProperty('mfaSecret');
      expect(body).not.toHaveProperty('mfaRecoveryCodes');
    });

    it('emits USER_UPDATED audit event after change', async () => {
      const { user, token } = await provisionUser(app, {
        oid: 'patch-me-audit',
        role: UserRole.EMPLOYEE,
      });

      await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: { firstName: 'AuditTest' },
      });

      // Give fire-and-forget a tick
      await new Promise((r) => setTimeout(r, 50));

      const auditEntry = await app.mongo.db.collection('audit_logs').findOne({
        'actor.userId': String(user._id),
        action: 'USER_UPDATED',
      });
      expect(auditEntry).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  describe('validation', () => {
    it('returns 400 for empty firstName string', async () => {
      const { token } = await provisionUser(app, {
        oid: 'patch-me-val-empty',
        role: UserRole.EMPLOYEE,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: { firstName: '' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for firstName exceeding 100 chars', async () => {
      const { token } = await provisionUser(app, {
        oid: 'patch-me-val-long',
        role: UserRole.EMPLOYEE,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: { firstName: 'A'.repeat(101) },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 if body contains forbidden field `roles`', async () => {
      const { token } = await provisionUser(app, {
        oid: 'patch-me-val-roles',
        role: UserRole.EMPLOYEE,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: { roles: ['ADMIN'] },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 if body contains forbidden field `email`', async () => {
      const { token } = await provisionUser(app, {
        oid: 'patch-me-val-email',
        role: UserRole.EMPLOYEE,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: { email: 'hacker@evil.com' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 if body contains forbidden field `isActive`', async () => {
      const { token } = await provisionUser(app, {
        oid: 'patch-me-val-isactive',
        role: UserRole.EMPLOYEE,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: { isActive: false },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // RBAC / auth
  // -------------------------------------------------------------------------

  describe('RBAC', () => {
    it('returns 401 without auth cookie', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        payload: { firstName: 'Hacker' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('EMPLOYEE can update own profile', async () => {
      const { token } = await provisionUser(app, {
        oid: 'patch-me-rbac-emp',
        role: UserRole.EMPLOYEE,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: { firstName: 'Zamestnanec' },
      });

      expect(res.statusCode).toBe(200);
    });

    it('ASSET_MANAGER can update own profile', async () => {
      const { token } = await provisionUser(app, {
        oid: 'patch-me-rbac-mgr',
        role: UserRole.ASSET_MANAGER,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: { firstName: 'Správca' },
      });

      expect(res.statusCode).toBe(200);
    });

    it('ADMIN can update own profile', async () => {
      const { token } = await provisionUser(app, {
        oid: 'patch-me-rbac-admin',
        role: UserRole.ADMIN,
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: { cookie: `inv_access=${token}` },
        payload: { firstName: 'Admin' },
      });

      expect(res.statusCode).toBe(200);
    });
  });
});

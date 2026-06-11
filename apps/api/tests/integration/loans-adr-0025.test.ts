// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests pre ADR-0025 — open-ended výpožičky + members endpoint.
 *
 * Pokrýva:
 *   - POST /v1/loan-requests bez plannedTo (do odvolania) → 201
 *   - POST /v1/loan-requests s plannedTo null → 201
 *   - POST /v1/loan-requests plannedFrom > plannedTo → 400
 *   - POST /v1/loans (direct) bez dueAt → 201
 *   - GET  /v1/loans/:id — open-ended loan má isOverdue === false
 *   - GET  /v1/loans/:id — fixed-term loan po termíne má isOverdue === true
 *   - GET  /v1/members — EMPLOYEE+ vidí aktívnych členov (picker)
 *   - GET  /v1/members — vracia len picker-safe polia (bez email, passwordHash...)
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestAsset,
  insertTestCategory,
  insertTestLoan,
  insertTestMembership,
  provisionUser,
  UserRole,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('ADR-0025 — open-ended loans + members endpoint', () => {
  let app: FastifyInstance;
  let managerToken: string;
  let managerId: string;
  let employeeToken: string;
  let employeeId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
    const manager = await provisionUser(app, {
      oid: 'adr0025-manager',
      role: UserRole.ASSET_MANAGER,
    });
    managerToken = manager.token;
    managerId = String(manager.user._id);
    const employee = await provisionUser(app, {
      oid: 'adr0025-employee',
      role: UserRole.EMPLOYEE,
    });
    employeeToken = employee.token;
    employeeId = String(employee.user._id);
    // Seed membership records pre /v1/members endpoint
    await insertTestMembership(app, { userId: managerId, roles: [UserRole.ASSET_MANAGER] });
    await insertTestMembership(app, { userId: employeeId, roles: [UserRole.EMPLOYEE] });
  });

  // -------------------------------------------------------------------------
  // POST /v1/loan-requests — open-ended (plannedTo chýba / null)
  // -------------------------------------------------------------------------

  describe('POST /v1/loan-requests bez termínu (do odvolania)', () => {
    it('vytvori request bez plannedTo → 201 (omitted)', async () => {
      const category = await insertTestCategory(app);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Trvalé pridelenie notebooku',
          plannedFrom: new Date().toISOString(),
          // plannedTo vynehané — open-ended
          items: [{ categoryId: category._id, quantityRequested: 1 }],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<{ plannedTo: unknown }>();
      expect(body.plannedTo).toBeNull();
    });

    it('vytvori request s plannedTo: null → 201', async () => {
      const category = await insertTestCategory(app);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Trvalé pridelenie telefónu',
          plannedFrom: new Date().toISOString(),
          plannedTo: null,
          items: [{ categoryId: category._id, quantityRequested: 1 }],
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json<{ plannedTo: unknown }>().plannedTo).toBeNull();
    });

    it('zamietne request kde plannedFrom > plannedTo → 400', async () => {
      const category = await insertTestCategory(app);
      const now = new Date();
      const yesterday = new Date(now.getTime() - 86400000);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Zlý termín',
          plannedFrom: now.toISOString(),
          plannedTo: yesterday.toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 1 }],
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/loans (direct loan) bez dueAt
  // -------------------------------------------------------------------------

  describe('POST /v1/loans (direct) bez dueAt', () => {
    it('vytvori priamu výpožičku bez dueAt → 201', async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/loans',
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          borrowerId: employeeId,
          purpose: 'Pridelenie notebooku správcom',
          items: [{ assetId: asset._id }],
          // dueAt vynechané — open-ended
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<{ dueAt: unknown; isOverdue: unknown }>();
      expect(body.dueAt).toBeNull();
      expect(body.isOverdue).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // isOverdue — OVERDUE guard
  // -------------------------------------------------------------------------

  describe('isOverdue computed field', () => {
    it('open-ended loan (dueAt null) má isOverdue === false vždy', async () => {
      const asset = await insertTestAsset(app, { status: 'BORROWED' });
      const loan = await insertTestLoan(app, {
        assetIds: [asset._id],
        status: 'ACTIVE',
        dueAt: null, // open-ended
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loan._id}`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ isOverdue: boolean }>().isOverdue).toBe(false);
    });

    it('fixed-term loan po termíne má isOverdue === true', async () => {
      const asset = await insertTestAsset(app, { status: 'BORROWED' });
      const pastDate = new Date(Date.now() - 7 * 86400000).toISOString(); // 7 dní v minulosti
      const loan = await insertTestLoan(app, {
        assetIds: [asset._id],
        status: 'ACTIVE',
        dueAt: pastDate,
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loan._id}`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ isOverdue: boolean }>().isOverdue).toBe(true);
    });

    it('fixed-term loan pred termínom má isOverdue === false', async () => {
      const asset = await insertTestAsset(app, { status: 'BORROWED' });
      const futureDate = new Date(Date.now() + 7 * 86400000).toISOString();
      const loan = await insertTestLoan(app, {
        assetIds: [asset._id],
        status: 'ACTIVE',
        dueAt: futureDate,
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loan._id}`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ isOverdue: boolean }>().isOverdue).toBe(false);
    });

    it('RETURNED loan (má dueAt v minulosti) má isOverdue === false', async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });
      const pastDate = new Date(Date.now() - 7 * 86400000).toISOString();
      const loan = await insertTestLoan(app, {
        assetIds: [asset._id],
        status: 'RETURNED',
        dueAt: pastDate,
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loan._id}`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      expect(res.statusCode).toBe(200);
      // RETURNED loan nie je ACTIVE → isOverdue === false
      expect(res.json<{ isOverdue: boolean }>().isOverdue).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // GET /v1/members — picker endpoint
  // -------------------------------------------------------------------------

  describe('GET /v1/members', () => {
    it('EMPLOYEE vidí aktívnych členov (200)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/members',
        headers: { cookie: `inv_access=${employeeToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[]; pagination: unknown }>();
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toBeDefined();
    });

    it('ASSET_MANAGER vidí aktívnych členov (200)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/members',
        headers: { cookie: `inv_access=${managerToken}` },
      });

      expect(res.statusCode).toBe(200);
    });

    it('vracia len picker-safe polia (žiadny email, passwordHash)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/members',
        headers: { cookie: `inv_access=${employeeToken}` },
      });

      expect(res.statusCode).toBe(200);
      const members = res.json<{ data: Record<string, unknown>[] }>().data;
      // Aspoň manager a employee sú v DB
      expect(members.length).toBeGreaterThanOrEqual(1);
      for (const m of members) {
        // Picker-safe polia musia byť prítomné
        expect(m['_id']).toBeDefined();
        expect(m['displayName']).toBeDefined();
        // Citlivé polia nesmú byť prítomné
        expect(m['email']).toBeUndefined();
        expect(m['passwordHash']).toBeUndefined();
        expect(m['passwordResetToken']).toBeUndefined();
      }
    });

    it('vracia seba aj iných členov tej istej org', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/members',
        headers: { cookie: `inv_access=${employeeToken}` },
      });

      expect(res.statusCode).toBe(200);
      const ids = res.json<{ data: Array<{ _id: string }> }>().data.map((m) => m._id);
      // Obaja (manager aj employee) musia byť v zozname
      expect(ids).toContain(managerId);
      expect(ids).toContain(employeeId);
    });

    it('vráti 401 pre neautentifikovaný request', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/members',
      });

      expect(res.statusCode).toBe(401);
    });
  });
});

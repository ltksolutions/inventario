/**
 * Integration tests for loan endpoints.
 *
 * Covers:
 *   - Return flow: ACTIVE → RETURNED, assets → AVAILABLE
 *   - Damage flow: any requiresService → DAMAGED, assets → IN_SERVICE
 *   - Lost flow: ACTIVE → LOST, assets → LOST
 *   - isOverdue computed field (lazy, not persisted)
 *   - GET /v1/loans and /v1/loans/my — RBAC + ownership
 *   - Cross-tenant isolation
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestLoan,
  insertTestAsset,
  provisionUserAsAndSignToken,
  UserRole,
} from '../helpers/test-fixtures.js';
import { createTokenSigner } from '../helpers/test-jwt-loader.js';

import type { SignTestTokenInput } from '../helpers/test-jwt.js';
import type { FastifyInstance } from 'fastify';

describe('Loans', () => {
  let app: FastifyInstance;
  let signToken: (input: SignTestTokenInput) => Promise<string>;
  let managerToken: string;
  let managerId: string;
  let employeeToken: string;
  let employeeId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    signToken = await createTokenSigner();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);

    const admin = await provisionUserAsAndSignToken(app, signToken, {
      oid: 'loans-admin',
      role: UserRole.ADMIN,
    });
    void admin;

    const manager = await provisionUserAsAndSignToken(app, signToken, {
      oid: 'loans-manager',
      role: UserRole.ASSET_MANAGER,
    });
    managerToken = manager.token;
    managerId = String(manager.user._id);

    const employee = await provisionUserAsAndSignToken(app, signToken, {
      oid: 'loans-employee',
      role: UserRole.EMPLOYEE,
    });
    employeeToken = employee.token;
    employeeId = String(employee.user._id);
  });

  // -------------------------------------------------------------------------
  // POST /v1/loans/:id/return
  // -------------------------------------------------------------------------

  describe('POST /v1/loans/:id/return', () => {
    it('returns ACTIVE loan → RETURNED, assets → AVAILABLE (200)', async () => {
      const asset = await insertTestAsset(app, { status: 'BORROWED' });
      const loan = await insertTestLoan(app, { assetIds: [asset._id], status: 'ACTIVE' });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loan._id}/return`,
        headers: { authorization: `Bearer ${managerToken}` },
        payload: {
          returnedTo: managerId,
          items: [
            {
              assetId: asset._id,
              condition: 'GOOD',
              note: null,
              requiresService: false,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ status: string; returnedAt: string }>();
      expect(body.status).toBe('RETURNED');
      expect(body.returnedAt).not.toBeNull();

      // Asset released
      const assetDoc = await app.mongo.db.collection('assets').findOne({});
      expect(assetDoc?.status).toBe('AVAILABLE');
      expect(assetDoc?.currentLoanId).toBeNull();
    });

    it('returns DAMAGED when any item requiresService=true', async () => {
      const asset1 = await insertTestAsset(app, { status: 'BORROWED' });
      const asset2 = await insertTestAsset(app, { status: 'BORROWED' });
      const loan = await insertTestLoan(app, {
        assetIds: [asset1._id, asset2._id],
        status: 'ACTIVE',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loan._id}/return`,
        headers: { authorization: `Bearer ${managerToken}` },
        payload: {
          returnedTo: managerId,
          items: [
            { assetId: asset1._id, condition: 'GOOD', note: null, requiresService: false },
            {
              assetId: asset2._id,
              condition: 'POOR',
              note: 'Broken zipper',
              requiresService: true,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ status: string }>().status).toBe('DAMAGED');

      // asset1 → AVAILABLE, asset2 → IN_SERVICE
      const assets = await app.mongo.db.collection('assets').find({}).sort({ _id: 1 }).toArray();
      const a1 = assets.find((a) => String(a._id) === asset1._id);
      const a2 = assets.find((a) => String(a._id) === asset2._id);
      expect(a1?.status).toBe('AVAILABLE');
      expect(a2?.status).toBe('IN_SERVICE');
    });

    it('returns 400 when loan is not ACTIVE', async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });
      const loan = await insertTestLoan(app, { assetIds: [asset._id], status: 'RETURNED' });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loan._id}/return`,
        headers: { authorization: `Bearer ${managerToken}` },
        payload: {
          returnedTo: managerId,
          items: [{ assetId: asset._id, condition: 'GOOD', note: null, requiresService: false }],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 403 when EMPLOYEE tries to process return', async () => {
      const asset = await insertTestAsset(app, { status: 'BORROWED' });
      const loan = await insertTestLoan(app, { assetIds: [asset._id], status: 'ACTIVE' });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loan._id}/return`,
        headers: { authorization: `Bearer ${employeeToken}` },
        payload: {
          returnedTo: employeeId,
          items: [{ assetId: asset._id, condition: 'GOOD', note: null, requiresService: false }],
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 400 when return items missing a loan asset', async () => {
      const asset1 = await insertTestAsset(app, { status: 'BORROWED' });
      const asset2 = await insertTestAsset(app, { status: 'BORROWED' });
      const loan = await insertTestLoan(app, { assetIds: [asset1._id, asset2._id] });

      // Only return one item
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loan._id}/return`,
        headers: { authorization: `Bearer ${managerToken}` },
        payload: {
          returnedTo: managerId,
          items: [{ assetId: asset1._id, condition: 'GOOD', note: null, requiresService: false }],
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/loans/:id/lost
  // -------------------------------------------------------------------------

  describe('POST /v1/loans/:id/lost', () => {
    it('marks ACTIVE loan as LOST, all assets → LOST (204)', async () => {
      const asset = await insertTestAsset(app, { status: 'BORROWED' });
      const loan = await insertTestLoan(app, { assetIds: [asset._id], status: 'ACTIVE' });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loan._id}/lost`,
        headers: { authorization: `Bearer ${managerToken}` },
        payload: { reason: 'Equipment lost during away match' },
      });
      expect(res.statusCode).toBe(204);

      const loanDoc = await app.mongo.db.collection('loans').findOne({});
      expect(loanDoc?.status).toBe('LOST');

      const assetDoc = await app.mongo.db.collection('assets').findOne({});
      expect(assetDoc?.status).toBe('LOST');
    });

    it('returns 400 when loan is already RETURNED', async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });
      const loan = await insertTestLoan(app, { assetIds: [asset._id], status: 'RETURNED' });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loan._id}/lost`,
        headers: { authorization: `Bearer ${managerToken}` },
        payload: { reason: 'Accidentally marked' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 403 when EMPLOYEE tries to mark lost', async () => {
      const asset = await insertTestAsset(app, { status: 'BORROWED' });
      const loan = await insertTestLoan(app, { assetIds: [asset._id], status: 'ACTIVE' });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loan._id}/lost`,
        headers: { authorization: `Bearer ${employeeToken}` },
        payload: { reason: 'Lost it' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 400 when reason is too short', async () => {
      const loan = await insertTestLoan(app);
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loan._id}/lost`,
        headers: { authorization: `Bearer ${managerToken}` },
        payload: { reason: 'No' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // GET /v1/loans/my + GET /v1/loans
  // -------------------------------------------------------------------------

  describe('GET /v1/loans/my', () => {
    it('returns only loans for the authenticated user', async () => {
      const myLoan = await insertTestLoan(app, { borrowerId: employeeId });
      const otherLoan = await insertTestLoan(app, { borrowerId: managerId });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/loans/my',
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: Array<{ _id: string }>; pagination: { total: number } }>();
      expect(body.pagination.total).toBe(1);
      expect(body.data[0]?._id).toBe(myLoan._id);
      void otherLoan; // ensures it was created (exists in DB)
    });

    it('includes isOverdue: true for loans past dueAt', async () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      const loan = await insertTestLoan(app, {
        borrowerId: employeeId,
        dueAt: past,
        status: 'ACTIVE',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/loans/my',
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      expect(res.statusCode).toBe(200);
      const data = res.json<{ data: Array<{ _id: string; isOverdue: boolean }> }>().data;
      const found = data.find((l) => l._id === loan._id);
      expect(found?.isOverdue).toBe(true);
    });

    it('includes isOverdue: false for loans with future dueAt', async () => {
      const future = new Date(Date.now() + 86400000).toISOString();
      const loan = await insertTestLoan(app, {
        borrowerId: employeeId,
        dueAt: future,
        status: 'ACTIVE',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/loans/my',
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      const data = res.json<{ data: Array<{ _id: string; isOverdue: boolean }> }>().data;
      const found = data.find((l) => l._id === loan._id);
      expect(found?.isOverdue).toBe(false);
    });
  });

  describe('GET /v1/loans', () => {
    it('EMPLOYEE sees only own loans', async () => {
      await insertTestLoan(app, { borrowerId: employeeId });
      await insertTestLoan(app, { borrowerId: managerId });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/loans',
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      expect(res.json<{ pagination: { total: number } }>().pagination.total).toBe(1);
    });

    it('ASSET_MANAGER sees all loans in tenant', async () => {
      await insertTestLoan(app, { borrowerId: employeeId });
      await insertTestLoan(app, { borrowerId: managerId });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/loans',
        headers: { authorization: `Bearer ${managerToken}` },
      });
      expect(res.json<{ pagination: { total: number } }>().pagination.total).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // GET /v1/loans/:id — ownership check
  // -------------------------------------------------------------------------

  describe('GET /v1/loans/:id', () => {
    it('borrower can view own loan', async () => {
      const loan = await insertTestLoan(app, { borrowerId: employeeId });
      const res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loan._id}`,
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("EMPLOYEE cannot view another user's loan (403)", async () => {
      const other = await provisionUserAsAndSignToken(app, signToken, {
        oid: 'other-borrower',
        role: UserRole.EMPLOYEE,
      });
      const loan = await insertTestLoan(app, { borrowerId: String(other.user._id) });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loan._id}`,
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('ASSET_MANAGER can view any loan', async () => {
      const loan = await insertTestLoan(app, { borrowerId: employeeId });
      const res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loan._id}`,
        headers: { authorization: `Bearer ${managerToken}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Cross-tenant isolation
  // -------------------------------------------------------------------------

  describe('cross-tenant isolation', () => {
    it('cannot view a loan from a different tenant', async () => {
      const { seedTestTenant } = await import('../helpers/test-fixtures.js');
      const tenantB = await seedTestTenant(app, { slug: 'tenant-b-loans' });
      const loan = await insertTestLoan(app, { organisationId: tenantB._id });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loan._id}`,
        headers: { authorization: `Bearer ${managerToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('cannot return a loan from a different tenant', async () => {
      const { seedTestTenant } = await import('../helpers/test-fixtures.js');
      const tenantB = await seedTestTenant(app, { slug: 'tenant-b-loans-return' });
      const asset = await insertTestAsset(app, { organisationId: tenantB._id, status: 'BORROWED' });
      const loan = await insertTestLoan(app, {
        organisationId: tenantB._id,
        assetIds: [asset._id],
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loan._id}/return`,
        headers: { authorization: `Bearer ${managerToken}` },
        payload: {
          returnedTo: managerId,
          items: [{ assetId: asset._id, condition: 'GOOD', note: null, requiresService: false }],
        },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});

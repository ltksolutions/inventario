/**
 * Integration tests for loan endpoints — Slice #6c K17 (cookie auth).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestLoan,
  insertTestAsset,
  provisionUser,
  UserRole,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('Loans', () => {
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
    await provisionUser(app, { oid: 'loans-admin', role: UserRole.ADMIN });
    const manager = await provisionUser(app, {
      oid: 'loans-manager',
      role: UserRole.ASSET_MANAGER,
    });
    managerToken = manager.token;
    managerId = String(manager.user._id);
    const employee = await provisionUser(app, { oid: 'loans-employee', role: UserRole.EMPLOYEE });
    employeeToken = employee.token;
    employeeId = String(employee.user._id);
  });

  describe('POST /v1/loans/:id/return', () => {
    it('returns ACTIVE loan → RETURNED, assets → AVAILABLE (200)', async () => {
      const asset = await insertTestAsset(app, { status: 'BORROWED' });
      const loan = await insertTestLoan(app, { assetIds: [asset._id], status: 'ACTIVE' });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loan._id}/return`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          returnedTo: managerId,
          items: [{ assetId: asset._id, condition: 'GOOD', note: null, requiresService: false }],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ status: string }>().status).toBe('RETURNED');
      const assetDoc = await app.mongo.db.collection('assets').findOne({});
      expect(assetDoc?.status).toBe('AVAILABLE');
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
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          returnedTo: managerId,
          items: [
            { assetId: asset1._id, condition: 'GOOD', note: null, requiresService: false },
            { assetId: asset2._id, condition: 'POOR', note: 'Broken', requiresService: true },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ status: string }>().status).toBe('DAMAGED');
    });

    it('returns 400 when loan is not ACTIVE', async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });
      const loan = await insertTestLoan(app, { assetIds: [asset._id], status: 'RETURNED' });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loan._id}/return`,
        headers: { cookie: `inv_access=${managerToken}` },
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
        headers: { cookie: `inv_access=${employeeToken}` },
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
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loan._id}/return`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          returnedTo: managerId,
          items: [{ assetId: asset1._id, condition: 'GOOD', note: null, requiresService: false }],
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /v1/loans/:id/lost', () => {
    it('marks ACTIVE loan as LOST, all assets → LOST (204)', async () => {
      const asset = await insertTestAsset(app, { status: 'BORROWED' });
      const loan = await insertTestLoan(app, { assetIds: [asset._id], status: 'ACTIVE' });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loan._id}/lost`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: { reason: 'Equipment lost during away match' },
      });
      expect(res.statusCode).toBe(204);
      expect((await app.mongo.db.collection('loans').findOne({}))?.status).toBe('LOST');
      expect((await app.mongo.db.collection('assets').findOne({}))?.status).toBe('LOST');
    });

    it('returns 400 when loan is already RETURNED', async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });
      const loan = await insertTestLoan(app, { assetIds: [asset._id], status: 'RETURNED' });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loan._id}/lost`,
        headers: { cookie: `inv_access=${managerToken}` },
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
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: { reason: 'Lost it' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 400 when reason is too short', async () => {
      const loan = await insertTestLoan(app);
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loan._id}/lost`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: { reason: 'No' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /v1/loans/my', () => {
    it('returns only loans for the authenticated user', async () => {
      const myLoan = await insertTestLoan(app, { borrowerId: employeeId });
      await insertTestLoan(app, { borrowerId: managerId });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/loans/my',
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: Array<{ _id: string }>; pagination: { total: number } }>();
      expect(body.pagination.total).toBe(1);
      expect(body.data[0]?._id).toBe(myLoan._id);
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
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      const data = res.json<{ data: Array<{ _id: string; isOverdue: boolean }> }>().data;
      expect(data.find((l) => l._id === loan._id)?.isOverdue).toBe(true);
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
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      const data = res.json<{ data: Array<{ _id: string; isOverdue: boolean }> }>().data;
      expect(data.find((l) => l._id === loan._id)?.isOverdue).toBe(false);
    });
  });

  describe('GET /v1/loans', () => {
    it('EMPLOYEE sees only own loans', async () => {
      await insertTestLoan(app, { borrowerId: employeeId });
      await insertTestLoan(app, { borrowerId: managerId });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/loans',
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(res.json<{ pagination: { total: number } }>().pagination.total).toBe(1);
    });

    it('ASSET_MANAGER sees all loans in tenant', async () => {
      await insertTestLoan(app, { borrowerId: employeeId });
      await insertTestLoan(app, { borrowerId: managerId });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/loans',
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(res.json<{ pagination: { total: number } }>().pagination.total).toBe(2);
    });
  });

  describe('GET /v1/loans/:id', () => {
    it('borrower can view own loan', async () => {
      const loan = await insertTestLoan(app, { borrowerId: employeeId });
      const res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loan._id}`,
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("EMPLOYEE cannot view another user's loan (403)", async () => {
      const other = await provisionUser(app, { oid: 'other-borrower', role: UserRole.EMPLOYEE });
      const loan = await insertTestLoan(app, { borrowerId: String(other.user._id) });
      const res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loan._id}`,
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('ASSET_MANAGER can view any loan', async () => {
      const loan = await insertTestLoan(app, { borrowerId: employeeId });
      const res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loan._id}`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('cross-tenant isolation', () => {
    it('cannot view a loan from a different tenant', async () => {
      const { seedTestTenant } = await import('../helpers/test-fixtures.js');
      const tenantB = await seedTestTenant(app, { slug: 'tenant-b-loans' });
      const loan = await insertTestLoan(app, { organisationId: tenantB._id });
      const res = await app.inject({
        method: 'GET',
        url: `/v1/loans/${loan._id}`,
        headers: { cookie: `inv_access=${managerToken}` },
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
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          returnedTo: managerId,
          items: [{ assetId: asset._id, condition: 'GOOD', note: null, requiresService: false }],
        },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});

/**
 * Integration tests for loan request endpoints — Slice #6c K17 (cookie auth).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestAsset,
  insertTestLoanRequest,
  provisionUser,
  UserRole,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('Loan Requests', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
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
    const admin = await provisionUser(app, { oid: 'loan-admin', role: UserRole.ADMIN });
    adminToken = admin.token;
    const manager = await provisionUser(app, { oid: 'loan-manager', role: UserRole.ASSET_MANAGER });
    managerToken = manager.token;
    const employee = await provisionUser(app, { oid: 'loan-employee', role: UserRole.EMPLOYEE });
    employeeToken = employee.token;
    employeeId = String(employee.user._id);
  });

  describe('POST /v1/loan-requests', () => {
    it('creates a PENDING request and reserves assets (201)', async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Training session',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [{ assetId: asset._id }],
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ status: string; requesterId: string }>();
      expect(body.status).toBe('PENDING');
      expect(body.requesterId).toBe(employeeId);
      const assetDoc = await app.mongo.db.collection('assets').findOne({ _id: { $exists: true } });
      expect(assetDoc?.status).toBe('RESERVED');
    });

    it('returns 400 if any requested asset is not AVAILABLE', async () => {
      const available = await insertTestAsset(app, { status: 'AVAILABLE' });
      const borrowed = await insertTestAsset(app, { status: 'BORROWED' });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Training',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [{ assetId: available._id }, { assetId: borrowed._id }],
        },
      });
      expect(res.statusCode).toBe(400);
      const assets = await app.mongo.db.collection('assets').find({}).toArray();
      expect(assets.every((a) => a.status !== 'RESERVED')).toBe(true);
    });

    it('returns 400 if asset does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Test',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [{ assetId: '0123456789abcdef01234567' }],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for empty items array', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Test',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 401 on GET without cookie', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/loan-requests' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /v1/loan-requests/:id/approve', () => {
    it('approves a PENDING request, creates ACTIVE loan, assets → BORROWED (200)', async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Match kit',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [{ assetId: asset._id }],
        },
      });
      expect(createRes.statusCode).toBe(201);
      const requestId = createRes.json<{ _id: string }>()._id;

      const approveRes = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(approveRes.statusCode).toBe(200);

      const loans = await app.mongo.db.collection('loans').find({}).toArray();
      expect(loans).toHaveLength(1);
      expect(loans[0]?.status).toBe('ACTIVE');
      const assetDoc = await app.mongo.db.collection('assets').findOne({});
      expect(assetDoc?.status).toBe('BORROWED');
    });

    it('returns 400 when trying to approve a non-PENDING request', async () => {
      const request = await insertTestLoanRequest(app, { status: 'REJECTED' });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 403 when EMPLOYEE tries to approve', async () => {
      const request = await insertTestLoanRequest(app, { status: 'PENDING' });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/approve`,
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 404 for non-existent request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests/0123456789abcdef01234567/approve',
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /v1/loan-requests/:id/reject', () => {
    it('rejects PENDING request and releases assets → AVAILABLE (204)', async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Test',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [{ assetId: asset._id }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;

      const rejectRes = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/reject`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: { reason: 'Not available during that period' },
      });
      expect(rejectRes.statusCode).toBe(204);
      expect((await app.mongo.db.collection('assets').findOne({}))?.status).toBe('AVAILABLE');
      expect((await app.mongo.db.collection('loan_requests').findOne({}))?.status).toBe('REJECTED');
    });

    it('returns 400 when reason is missing', async () => {
      const request = await insertTestLoanRequest(app, { status: 'PENDING' });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/reject`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 403 when EMPLOYEE tries to reject', async () => {
      const request = await insertTestLoanRequest(app, { status: 'PENDING' });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/reject`,
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: { reason: 'Because I said so' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('DELETE /v1/loan-requests/:id (cancel)', () => {
    it('requester can cancel own PENDING request (204)', async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Cancel test',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [{ assetId: asset._id }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;
      const cancelRes = await app.inject({
        method: 'DELETE',
        url: `/v1/loan-requests/${requestId}`,
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(cancelRes.statusCode).toBe(204);
      expect((await app.mongo.db.collection('assets').findOne({}))?.status).toBe('AVAILABLE');
      expect((await app.mongo.db.collection('loan_requests').findOne({}))?.status).toBe(
        'CANCELLED',
      );
    });

    it("ADMIN can cancel someone else's request", async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Cancel by admin',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [{ assetId: asset._id }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;
      const cancelRes = await app.inject({
        method: 'DELETE',
        url: `/v1/loan-requests/${requestId}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(cancelRes.statusCode).toBe(204);
    });

    it("EMPLOYEE cannot cancel another employee's request (403)", async () => {
      const otherEmployee = await provisionUser(app, {
        oid: 'other-employee',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${otherEmployee.token}` },
        payload: {
          purpose: 'Other employee request',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [{ assetId: asset._id }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;
      const cancelRes = await app.inject({
        method: 'DELETE',
        url: `/v1/loan-requests/${requestId}`,
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(cancelRes.statusCode).toBe(403);
    });
  });

  describe('GET /v1/loan-requests', () => {
    it('EMPLOYEE sees only own requests', async () => {
      const asset1 = await insertTestAsset(app, { status: 'AVAILABLE' });
      const asset2 = await insertTestAsset(app, { status: 'AVAILABLE' });
      await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Mine',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [{ assetId: asset1._id }],
        },
      });
      const other = await provisionUser(app, { oid: 'other-emp-list', role: UserRole.EMPLOYEE });
      await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${other.token}` },
        payload: {
          purpose: 'Not mine',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [{ assetId: asset2._id }],
        },
      });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ pagination: { total: number } }>().pagination.total).toBe(1);
    });

    it('ASSET_MANAGER sees all requests in tenant', async () => {
      const { resolveTestTenantId } = await import('../helpers/test-fixtures.js');
      const orgId = await resolveTestTenantId(app);
      await insertTestLoanRequest(app, { organisationId: orgId, requesterId: employeeId });
      await insertTestLoanRequest(app, { organisationId: orgId });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ pagination: { total: number } }>().pagination.total).toBe(2);
    });
  });

  describe('cross-tenant isolation', () => {
    it('cannot approve a loan request from a different tenant', async () => {
      const { seedTestTenant } = await import('../helpers/test-fixtures.js');
      const tenantB = await seedTestTenant(app, { slug: 'tenant-b-lr' });
      const request = await insertTestLoanRequest(app, { organisationId: tenantB._id });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('cannot view a loan request from a different tenant', async () => {
      const { seedTestTenant } = await import('../helpers/test-fixtures.js');
      const tenantB = await seedTestTenant(app, { slug: 'tenant-b-lr-get' });
      const request = await insertTestLoanRequest(app, { organisationId: tenantB._id });
      const res = await app.inject({
        method: 'GET',
        url: `/v1/loan-requests/${request._id}`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});

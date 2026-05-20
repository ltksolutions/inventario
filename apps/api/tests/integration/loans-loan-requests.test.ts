/**
 * Integration tests for loan request endpoints.
 *
 * Covers:
 *   - State transitions: PENDING → APPROVED, REJECTED, CANCELLED
 *   - Asset reservation on create, release on reject/cancel
 *   - All-or-nothing: request fails if any asset not AVAILABLE
 *   - RBAC: who can create, approve, reject, cancel
 *   - Ownership: EMPLOYEE sees only own requests
 *   - Cross-tenant isolation: cannot see other tenant's requests
 *   - Validation: missing fields, bad IDs
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestAsset,
  insertTestLoanRequest,
  provisionUserAsAndSignToken,
  UserRole,
} from '../helpers/test-fixtures.js';
import { createTokenSigner } from '../helpers/test-jwt-loader.js';

import type { SignTestTokenInput } from '../helpers/test-jwt.js';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

describe('Loan Requests', () => {
  let app: FastifyInstance;
  let signToken: (input: SignTestTokenInput) => Promise<string>;
  let adminToken: string;
  let managerToken: string;
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
      oid: 'loan-admin',
      role: UserRole.ADMIN,
    });
    adminToken = admin.token;

    const manager = await provisionUserAsAndSignToken(app, signToken, {
      oid: 'loan-manager',
      role: UserRole.ASSET_MANAGER,
    });
    managerToken = manager.token;

    const employee = await provisionUserAsAndSignToken(app, signToken, {
      oid: 'loan-employee',
      role: UserRole.EMPLOYEE,
    });
    employeeToken = employee.token;
    employeeId = String(employee.user._id);
  });

  // -------------------------------------------------------------------------
  // POST /v1/loan-requests — create
  // -------------------------------------------------------------------------

  describe('POST /v1/loan-requests', () => {
    it('creates a PENDING request and reserves assets (201)', async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { authorization: `Bearer ${employeeToken}` },
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

      // Asset must be RESERVED
      const assetDoc = await app.mongo.db.collection('assets').findOne({ _id: { $exists: true } });
      expect(assetDoc?.status).toBe('RESERVED');
    });

    it('returns 400 if any requested asset is not AVAILABLE', async () => {
      const available = await insertTestAsset(app, { status: 'AVAILABLE' });
      const borrowed = await insertTestAsset(app, { status: 'BORROWED' });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { authorization: `Bearer ${employeeToken}` },
        payload: {
          purpose: 'Training',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [{ assetId: available._id }, { assetId: borrowed._id }],
        },
      });

      expect(res.statusCode).toBe(400);
      // Neither asset should be reserved (all-or-nothing)
      const assets = await app.mongo.db.collection('assets').find({}).toArray();
      expect(assets.every((a) => a.status !== 'RESERVED')).toBe(true);
    });

    it('returns 400 if asset does not exist', async () => {
      const fakeId = '0123456789abcdef01234567';
      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { authorization: `Bearer ${employeeToken}` },
        payload: {
          purpose: 'Test',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [{ assetId: fakeId }],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for empty items array', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { authorization: `Bearer ${employeeToken}` },
        payload: {
          purpose: 'Test',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for missing purpose', async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { authorization: `Bearer ${employeeToken}` },
        payload: {
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [{ assetId: asset._id }],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 401 on GET without token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/loan-requests',
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/loan-requests/:id/approve
  // -------------------------------------------------------------------------

  describe('POST /v1/loan-requests/:id/approve', () => {
    it('approves a PENDING request, creates ACTIVE loan, assets → BORROWED (200)', async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });

      // Create request via API
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { authorization: `Bearer ${employeeToken}` },
        payload: {
          purpose: 'Match kit',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [{ assetId: asset._id }],
        },
      });
      expect(createRes.statusCode).toBe(201);
      const requestId = createRes.json<{ _id: string }>()._id;

      // Approve
      const approveRes = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/approve`,
        headers: { authorization: `Bearer ${managerToken}` },
      });
      expect(approveRes.statusCode).toBe(200);

      // Loan should exist and be ACTIVE
      const loans = await app.mongo.db.collection('loans').find({}).toArray();
      expect(loans).toHaveLength(1);
      expect(loans[0]?.status).toBe('ACTIVE');

      // Asset should be BORROWED
      const assetDoc = await app.mongo.db.collection('assets').findOne({});
      expect(assetDoc?.status).toBe('BORROWED');

      // Request should be APPROVED
      const reqDoc = await app.mongo.db.collection('loan_requests').findOne({});
      expect(reqDoc?.status).toBe('APPROVED');
      expect(reqDoc?.resultingLoanId).not.toBeNull();
    });

    it('returns 400 when trying to approve a non-PENDING request', async () => {
      const request = await insertTestLoanRequest(app, { status: 'REJECTED' });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/approve`,
        headers: { authorization: `Bearer ${managerToken}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 403 when EMPLOYEE tries to approve', async () => {
      const request = await insertTestLoanRequest(app, { status: 'PENDING' });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/approve`,
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 404 for non-existent request', async () => {
      const fakeId = '0123456789abcdef01234567';
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${fakeId}/approve`,
        headers: { authorization: `Bearer ${managerToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/loan-requests/:id/reject
  // -------------------------------------------------------------------------

  describe('POST /v1/loan-requests/:id/reject', () => {
    it('rejects PENDING request and releases assets → AVAILABLE (204)', async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { authorization: `Bearer ${employeeToken}` },
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
        headers: { authorization: `Bearer ${managerToken}` },
        payload: { reason: 'Not available during that period' },
      });
      expect(rejectRes.statusCode).toBe(204);

      // Asset released
      const assetDoc = await app.mongo.db.collection('assets').findOne({});
      expect(assetDoc?.status).toBe('AVAILABLE');

      // Request REJECTED
      const reqDoc = await app.mongo.db.collection('loan_requests').findOne({});
      expect(reqDoc?.status).toBe('REJECTED');
      expect(reqDoc?.rejectionReason).toBe('Not available during that period');
    });

    it('returns 400 when reason is missing', async () => {
      const request = await insertTestLoanRequest(app, { status: 'PENDING' });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/reject`,
        headers: { authorization: `Bearer ${managerToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 403 when EMPLOYEE tries to reject', async () => {
      const request = await insertTestLoanRequest(app, { status: 'PENDING' });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/reject`,
        headers: { authorization: `Bearer ${employeeToken}` },
        payload: { reason: 'Because I said so' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /v1/loan-requests/:id — cancel
  // -------------------------------------------------------------------------

  describe('DELETE /v1/loan-requests/:id (cancel)', () => {
    it('requester can cancel own PENDING request → 204, assets released', async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { authorization: `Bearer ${employeeToken}` },
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
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      expect(cancelRes.statusCode).toBe(204);

      const assetDoc = await app.mongo.db.collection('assets').findOne({});
      expect(assetDoc?.status).toBe('AVAILABLE');

      const reqDoc = await app.mongo.db.collection('loan_requests').findOne({});
      expect(reqDoc?.status).toBe('CANCELLED');
    });

    it("ADMIN can cancel someone else's request", async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { authorization: `Bearer ${employeeToken}` },
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
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(cancelRes.statusCode).toBe(204);
    });

    it("EMPLOYEE cannot cancel another employee's request (403)", async () => {
      // Seed a request belonging to a different user
      const otherEmployee = await provisionUserAsAndSignToken(app, signToken, {
        oid: 'other-employee',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { authorization: `Bearer ${otherEmployee.token}` },
        payload: {
          purpose: 'Other employee request',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [{ assetId: asset._id }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;

      // Our employee tries to cancel it — should 403
      const cancelRes = await app.inject({
        method: 'DELETE',
        url: `/v1/loan-requests/${requestId}`,
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      expect(cancelRes.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // GET /v1/loan-requests — list
  // -------------------------------------------------------------------------

  describe('GET /v1/loan-requests', () => {
    it('EMPLOYEE sees only own requests', async () => {
      const asset1 = await insertTestAsset(app, { status: 'AVAILABLE' });
      const asset2 = await insertTestAsset(app, { status: 'AVAILABLE' });

      // Employee creates one
      await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { authorization: `Bearer ${employeeToken}` },
        payload: {
          purpose: 'Mine',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [{ assetId: asset1._id }],
        },
      });

      // Other employee creates one
      const other = await provisionUserAsAndSignToken(app, signToken, {
        oid: 'other-emp-list',
        role: UserRole.EMPLOYEE,
      });
      await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { authorization: `Bearer ${other.token}` },
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
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[]; pagination: { total: number } }>();
      expect(body.pagination.total).toBe(1);
    });

    it('ASSET_MANAGER sees all requests in tenant', async () => {
      const { resolveTestTenantId } = await import('../helpers/test-fixtures.js');
      const orgId = await resolveTestTenantId(app);
      await insertTestLoanRequest(app, { organisationId: orgId, requesterId: employeeId });
      await insertTestLoanRequest(app, { organisationId: orgId });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/loan-requests',
        headers: { authorization: `Bearer ${managerToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ pagination: { total: number } }>().pagination.total).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Cross-tenant isolation
  // -------------------------------------------------------------------------

  describe('cross-tenant isolation', () => {
    it('cannot approve a loan request from a different tenant', async () => {
      // Seed a request in a different org directly
      const { seedTestTenant } = await import('../helpers/test-fixtures.js');
      const tenantB = await seedTestTenant(app, { slug: 'tenant-b-lr' });
      const request = await insertTestLoanRequest(app, { organisationId: tenantB._id });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/approve`,
        headers: { authorization: `Bearer ${managerToken}` },
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
        headers: { authorization: `Bearer ${managerToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});

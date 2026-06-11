// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for ADR-0023 — beneficiary model + direct loan.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  UserRole,
  insertTestAsset,
  insertTestCategory,
  insertTestMembership,
  provisionUser,
  seedTestTenant,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function futureDate(daysFromNow = 7): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

async function createLoanRequestViaApi(
  app: FastifyInstance,
  token: string,
  categoryId: string,
  extra: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/v1/loan-requests',
    headers: { cookie: `inv_access=${token}` },
    payload: {
      purpose: 'Test účel',
      plannedFrom: new Date().toISOString(),
      items: [{ categoryId, quantityRequested: 1 }],
      ...extra,
    },
  });
}

async function approveLoanRequest(app: FastifyInstance, managerToken: string, requestId: string) {
  return app.inject({
    method: 'POST',
    url: `/v1/loan-requests/${requestId}/approve`,
    headers: { cookie: `inv_access=${managerToken}` },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ADR-0023 — beneficiary model + direct loan', () => {
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
  // Beneficiary — LoanRequest for another person
  // -------------------------------------------------------------------------

  describe('beneficiary — žiadosť v mene inej osoby', () => {
    it('accepts beneficiaryId and sets it on the created LoanRequest', async () => {
      const { token: requesterToken } = await provisionUser(app, {
        oid: 'requester-1',
        role: UserRole.EMPLOYEE,
      });
      const { user: beneficiary } = await provisionUser(app, {
        oid: 'beneficiary-1',
        role: UserRole.EMPLOYEE,
      });
      await insertTestMembership(app, { userId: String(beneficiary._id) });
      const category = await insertTestCategory(app);

      const res = await createLoanRequestViaApi(app, requesterToken, category._id, {
        beneficiaryId: String(beneficiary._id),
      });

      expect(res.statusCode).toBe(201);
      expect(res.json<{ beneficiaryId: string }>().beneficiaryId).toBe(String(beneficiary._id));
    });

    it('defaults beneficiaryId to requesterId when not provided', async () => {
      const { user, token } = await provisionUser(app, {
        oid: 'requester-self',
        role: UserRole.EMPLOYEE,
      });
      const category = await insertTestCategory(app);

      const res = await createLoanRequestViaApi(app, token, category._id);

      expect(res.statusCode).toBe(201);
      const body = res.json<{ requesterId: string; beneficiaryId: string }>();
      expect(body.beneficiaryId).toBe(body.requesterId);
      expect(body.requesterId).toBe(String(user._id));
    });

    it('approve sets borrowerId = beneficiaryId on resulting Loan (after fulfil)', async () => {
      const { token: requesterToken } = await provisionUser(app, {
        oid: 'requester-approve',
        role: UserRole.EMPLOYEE,
      });
      const { user: beneficiary } = await provisionUser(app, {
        oid: 'beneficiary-approve',
        role: UserRole.EMPLOYEE,
      });
      await insertTestMembership(app, { userId: String(beneficiary._id) });
      const { token: managerToken } = await provisionUser(app, {
        oid: 'manager-approve',
        role: UserRole.ASSET_MANAGER,
      });
      const category = await insertTestCategory(app);
      const asset = await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });

      const reqRes = await createLoanRequestViaApi(app, requesterToken, category._id, {
        beneficiaryId: String(beneficiary._id),
      });
      expect(reqRes.statusCode).toBe(201);
      const requestId = reqRes.json<{ _id: string }>()._id;

      // ADR-0026: approve len zmena stavu, vydanie cez fulfil
      const approveRes = await approveLoanRequest(app, managerToken, requestId);
      expect(approveRes.statusCode).toBe(200);
      expect(approveRes.json<{ status: string }>().status).toBe('APPROVED');

      // Vydaj cez fulfil
      const fulfilRes = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [{ requestItemIndex: 0, type: 'SERIALIZED', assetIds: [asset._id] }],
          dueAt: futureDate(),
        },
      });
      expect(fulfilRes.statusCode).toBe(201);
      // borrowerId = beneficiaryId
      expect(fulfilRes.json<{ borrowerId: string }>().borrowerId).toBe(String(beneficiary._id));
    });

    it('rejects beneficiaryId that is not a member of this tenant (cross-tenant)', async () => {
      const { token } = await provisionUser(app, {
        oid: 'requester-xtenant',
        role: UserRole.EMPLOYEE,
      });
      const otherTenant = await seedTestTenant(app, { slug: 'other-tenant-bene' });
      const { user: outsider } = await provisionUser(app, {
        oid: 'outsider-bene',
        role: UserRole.EMPLOYEE,
        organisationId: otherTenant._id,
      });
      const category = await insertTestCategory(app);

      const res = await createLoanRequestViaApi(app, token, category._id, {
        beneficiaryId: String(outsider._id),
      });

      expect(res.statusCode).toBe(400);
    });

    it('EMPLOYEE sees requests where they are beneficiary (not just requester)', async () => {
      const { token: requesterToken } = await provisionUser(app, {
        oid: 'requester-list',
        role: UserRole.EMPLOYEE,
      });
      const { user: beneficiary, token: beneficiaryToken } = await provisionUser(app, {
        oid: 'beneficiary-list',
        role: UserRole.EMPLOYEE,
      });
      await insertTestMembership(app, { userId: String(beneficiary._id) });
      const category = await insertTestCategory(app);

      const reqRes = await createLoanRequestViaApi(app, requesterToken, category._id, {
        beneficiaryId: String(beneficiary._id),
      });
      expect(reqRes.statusCode).toBe(201);

      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${beneficiaryToken}` },
      });
      expect(listRes.statusCode).toBe(200);
      const ids = listRes.json<{ data: Array<{ _id: string }> }>().data.map((r) => r._id);
      expect(ids).toContain(reqRes.json<{ _id: string }>()._id);
    });

    it('EMPLOYEE does not see requests where they are neither requester nor beneficiary', async () => {
      const { token: otherToken } = await provisionUser(app, {
        oid: 'requester-other',
        role: UserRole.EMPLOYEE,
      });
      const { token: unrelatedToken } = await provisionUser(app, {
        oid: 'unrelated-user',
        role: UserRole.EMPLOYEE,
      });
      const category = await insertTestCategory(app);

      await createLoanRequestViaApi(app, otherToken, category._id);

      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${unrelatedToken}` },
      });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json<{ data: unknown[] }>().data).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Direct loan — POST /v1/loans
  // -------------------------------------------------------------------------

  describe('direct loan — POST /v1/loans', () => {
    it('creates a loan with requestId null and asset AVAILABLE → BORROWED', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'manager-direct',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-direct',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/loans',
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          borrowerId: String(borrower._id),
          items: [{ assetId: asset._id }],
          purpose: 'Priamy výdaj',
          dueAt: futureDate(14),
        },
      });

      expect(res.statusCode).toBe(201);
      const loan = res.json<{
        requestId: null;
        borrowerId: string;
        status: string;
        isOverdue: boolean;
      }>();
      expect(loan.requestId).toBeNull();
      expect(loan.borrowerId).toBe(String(borrower._id));
      expect(loan.status).toBe('ACTIVE');
      expect(loan.isOverdue).toBe(false);

      // Verify asset is now BORROWED via API
      const assetRes = await app.inject({
        method: 'GET',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(assetRes.json<{ status: string }>().status).toBe('BORROWED');
    });

    it('direct loan audit action is LOAN_CREATED_DIRECT', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'manager-audit',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-audit',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/loans',
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          borrowerId: String(borrower._id),
          items: [{ assetId: asset._id }],
          purpose: 'Audit test',
          dueAt: futureDate(),
        },
      });
      expect(res.statusCode).toBe(201);
      const loanId = res.json<{ _id: string }>()._id;

      const auditDoc = await app.mongo.db
        .collection('audit_logs')
        .findOne({ action: 'LOAN_CREATED_DIRECT', 'target.entityId': loanId });
      expect(auditDoc).not.toBeNull();
    });

    it('EMPLOYEE cannot create a direct loan (403)', async () => {
      const { token } = await provisionUser(app, {
        oid: 'employee-direct',
        role: UserRole.EMPLOYEE,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-e',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/loans',
        headers: { cookie: `inv_access=${token}` },
        payload: {
          borrowerId: String(borrower._id),
          items: [{ assetId: asset._id }],
          purpose: 'Pokus',
          dueAt: futureDate(),
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects borrowerId that is not a member of this tenant', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'manager-xtenant',
        role: UserRole.ASSET_MANAGER,
      });
      const otherTenant = await seedTestTenant(app, { slug: 'other-tenant-loan' });
      const { user: outsider } = await provisionUser(app, {
        oid: 'outsider-loan',
        role: UserRole.EMPLOYEE,
        organisationId: otherTenant._id,
      });
      const asset = await insertTestAsset(app);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/loans',
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          borrowerId: String(outsider._id),
          items: [{ assetId: asset._id }],
          purpose: 'Cross-tenant test',
          dueAt: futureDate(),
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(
        /nie je členom|does not exist|not a member/i,
      );
    });

    it('rejects asset that is not AVAILABLE (already BORROWED)', async () => {
      const { token: managerToken } = await provisionUser(app, {
        oid: 'manager-busy',
        role: UserRole.ASSET_MANAGER,
      });
      const { user: borrower } = await provisionUser(app, {
        oid: 'borrower-busy',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app, { status: 'BORROWED' });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/loans',
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          borrowerId: String(borrower._id),
          items: [{ assetId: asset._id }],
          purpose: 'Busy asset test',
          dueAt: futureDate(),
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/nie je dostupný|not available/i);
    });
  });
});

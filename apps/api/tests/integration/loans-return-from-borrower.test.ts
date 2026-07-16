// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for "Vrátiť od osoby" (ADR-0036) — partial and
 * cross-loan return of a subset of a borrower's items.
 *
 *   - GET  /v1/users/:id/borrowed-items
 *   - POST /v1/users/:id/return-items
 *
 * These are a doplnková (additive) flow alongside POST /v1/loans/:id/return
 * (tested in loans-loans.test.ts), which stays unchanged.
 */

import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestLoan,
  insertTestAsset,
  provisionUser,
  UserRole,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('Vrátiť od osoby (ADR-0036)', () => {
  let app: FastifyInstance;
  let managerToken: string;
  let managerId: string;
  let employeeToken: string;
  let borrowerId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
    await provisionUser(app, { oid: 'rfb-admin', role: UserRole.ADMIN });
    const manager = await provisionUser(app, { oid: 'rfb-manager', role: UserRole.ASSET_MANAGER });
    managerToken = manager.token;
    managerId = String(manager.user._id);
    const employee = await provisionUser(app, { oid: 'rfb-employee', role: UserRole.EMPLOYEE });
    employeeToken = employee.token;
    const borrower = await provisionUser(app, { oid: 'rfb-borrower', role: UserRole.EMPLOYEE });
    borrowerId = String(borrower.user._id);
  });

  describe('GET /v1/users/:id/borrowed-items', () => {
    it('lists items from an ACTIVE loan, tagged with their loanId', async () => {
      const asset1 = await insertTestAsset(app, { status: 'BORROWED' });
      const asset2 = await insertTestAsset(app, { status: 'BORROWED' });
      const loan = await insertTestLoan(app, {
        borrowerId,
        assetIds: [asset1._id, asset2._id],
        status: 'ACTIVE',
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/users/${borrowerId}/borrowed-items`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Array<{ loanId: string; assetId: string }>>();
      expect(body).toHaveLength(2);
      expect(body.every((row) => row.loanId === loan._id)).toBe(true);
      expect(body.map((row) => row.assetId).sort()).toEqual([asset1._id, asset2._id].sort());
    });

    it('excludes items already marked returned on a PARTIALLY_RETURNED loan', async () => {
      const asset1 = await insertTestAsset(app, { status: 'BORROWED' });
      const asset2 = await insertTestAsset(app, { status: 'AVAILABLE' });
      const loan = await insertTestLoan(app, {
        borrowerId,
        assetIds: [asset1._id, asset2._id],
        status: 'ACTIVE',
      });

      // Simulate a prior partial return of asset2 directly against the
      // loans collection (the state a real PARTIALLY_RETURNED loan would
      // be in after one return-items call already returned asset2).
      await app.mongo.db.collection('loans').updateOne(
        { _id: ObjectId.createFromHexString(loan._id) },
        {
          $set: {
            status: 'PARTIALLY_RETURNED',
            'items.1.condition.atReturn': {
              condition: 'GOOD',
              note: null,
              photoIds: [],
              requiresService: false,
            },
          },
        },
      );

      const res = await app.inject({
        method: 'GET',
        url: `/v1/users/${borrowerId}/borrowed-items`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Array<{ assetId: string }>>();
      expect(body).toHaveLength(1);
      expect(body[0]?.assetId).toBe(asset1._id);
    });

    it('returns 403 when EMPLOYEE calls it', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/users/${borrowerId}/borrowed-items`,
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /v1/users/:id/return-items', () => {
    it('partially returns one loan — loan → PARTIALLY_RETURNED, one protocol created', async () => {
      const asset1 = await insertTestAsset(app, { status: 'BORROWED' });
      const asset2 = await insertTestAsset(app, { status: 'BORROWED' });
      const loan = await insertTestLoan(app, {
        borrowerId,
        assetIds: [asset1._id, asset2._id],
        status: 'ACTIVE',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/users/${borrowerId}/return-items`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          returnedTo: managerId,
          items: [
            {
              loanId: loan._id,
              assetId: asset1._id,
              condition: 'GOOD',
              note: null,
              requiresService: false,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ returnProtocolId: string | null; loanIds: string[] }>();
      expect(body.loanIds).toEqual([loan._id]);
      expect(body.returnProtocolId).not.toBeNull();

      const loanDoc = await app.mongo.db.collection('loans').findOne({});
      expect(loanDoc?.status).toBe('PARTIALLY_RETURNED');

      const asset1Doc = await app.mongo.db
        .collection('assets')
        .findOne({ inventoryNumber: asset1.inventoryNumber });
      expect(asset1Doc?.status).toBe('AVAILABLE');
      const asset2Doc = await app.mongo.db
        .collection('assets')
        .findOne({ inventoryNumber: asset2.inventoryNumber });
      expect(asset2Doc?.status).toBe('BORROWED');

      const protocol = await app.mongo.db
        .collection('loan_protocols')
        .findOne({ loanIds: loan._id });
      expect(protocol).not.toBeNull();
      expect(protocol?.loanIds).toEqual([loan._id]);
      expect(protocol?.type).toBe('RETURN');
    });

    it('closes a PARTIALLY_RETURNED loan to RETURNED when the last item comes back', async () => {
      const asset1 = await insertTestAsset(app, { status: 'AVAILABLE' });
      const asset2 = await insertTestAsset(app, { status: 'BORROWED' });
      const loan = await insertTestLoan(app, {
        borrowerId,
        assetIds: [asset1._id, asset2._id],
        status: 'ACTIVE',
      });

      await app.mongo.db.collection('loans').updateOne(
        { _id: ObjectId.createFromHexString(loan._id) },
        {
          $set: {
            status: 'PARTIALLY_RETURNED',
            'items.0.condition.atReturn': {
              condition: 'GOOD',
              note: null,
              photoIds: [],
              requiresService: false,
            },
          },
        },
      );

      const res = await app.inject({
        method: 'POST',
        url: `/v1/users/${borrowerId}/return-items`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          returnedTo: managerId,
          items: [
            {
              loanId: loan._id,
              assetId: asset2._id,
              condition: 'GOOD',
              note: null,
              requiresService: false,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const loanDoc = await app.mongo.db.collection('loans').findOne({});
      expect(loanDoc?.status).toBe('RETURNED');
      expect(loanDoc?.returnedAt).not.toBeNull();
    });

    it('closes to DAMAGED when the last returned item requiresService=true', async () => {
      const asset = await insertTestAsset(app, { status: 'BORROWED' });
      const loan = await insertTestLoan(app, {
        borrowerId,
        assetIds: [asset._id],
        status: 'ACTIVE',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/users/${borrowerId}/return-items`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          returnedTo: managerId,
          items: [
            {
              loanId: loan._id,
              assetId: asset._id,
              condition: 'POOR',
              note: 'Broken screen',
              requiresService: true,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const loanDoc = await app.mongo.db.collection('loans').findOne({});
      expect(loanDoc?.status).toBe('DAMAGED');
      const assetDoc = await app.mongo.db.collection('assets').findOne({});
      expect(assetDoc?.status).toBe('IN_SERVICE');
    });

    it('returns items across two different loans in one call, producing ONE consolidated protocol', async () => {
      const asset1 = await insertTestAsset(app, { status: 'BORROWED' });
      const asset2 = await insertTestAsset(app, { status: 'BORROWED' });
      const loan1 = await insertTestLoan(app, {
        borrowerId,
        assetIds: [asset1._id],
        status: 'ACTIVE',
      });
      const loan2 = await insertTestLoan(app, {
        borrowerId,
        assetIds: [asset2._id],
        status: 'ACTIVE',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/users/${borrowerId}/return-items`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          returnedTo: managerId,
          items: [
            {
              loanId: loan1._id,
              assetId: asset1._id,
              condition: 'GOOD',
              note: null,
              requiresService: false,
            },
            {
              loanId: loan2._id,
              assetId: asset2._id,
              condition: 'GOOD',
              note: null,
              requiresService: false,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ returnProtocolId: string | null; loanIds: string[] }>();
      expect(body.loanIds.slice().sort()).toEqual([loan1._id, loan2._id].sort());

      const protocols = await app.mongo.db.collection('loan_protocols').find({}).toArray();
      expect(protocols).toHaveLength(1);
      expect(protocols[0]?.loanIds.slice().sort()).toEqual([loan1._id, loan2._id].sort());
      expect(protocols[0]?.items).toHaveLength(2);

      const loan1Doc = await app.mongo.db
        .collection('loans')
        .findOne({ _id: ObjectId.createFromHexString(loan1._id) });
      const loan2Doc = await app.mongo.db
        .collection('loans')
        .findOne({ _id: ObjectId.createFromHexString(loan2._id) });
      expect(loan1Doc?.status).toBe('RETURNED');
      expect(loan2Doc?.status).toBe('RETURNED');
      expect(loan1Doc?.returnProtocolId).toBe(body.returnProtocolId);
      expect(loan2Doc?.returnProtocolId).toBe(body.returnProtocolId);
    });

    it('returns 400 when a loanId in the payload does not belong to the borrower', async () => {
      const otherBorrower = await provisionUser(app, {
        oid: 'rfb-other-borrower',
        role: UserRole.EMPLOYEE,
      });
      const asset = await insertTestAsset(app, { status: 'BORROWED' });
      const loan = await insertTestLoan(app, {
        borrowerId: String(otherBorrower.user._id),
        assetIds: [asset._id],
        status: 'ACTIVE',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/users/${borrowerId}/return-items`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          returnedTo: managerId,
          items: [
            {
              loanId: loan._id,
              assetId: asset._id,
              condition: 'GOOD',
              note: null,
              requiresService: false,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when the asset was already returned in that loan', async () => {
      const asset = await insertTestAsset(app, { status: 'AVAILABLE' });
      const loan = await insertTestLoan(app, {
        borrowerId,
        assetIds: [asset._id],
        status: 'ACTIVE',
      });
      await app.mongo.db.collection('loans').updateOne(
        { _id: ObjectId.createFromHexString(loan._id) },
        {
          $set: {
            status: 'RETURNED',
            'items.0.condition.atReturn': {
              condition: 'GOOD',
              note: null,
              photoIds: [],
              requiresService: false,
            },
          },
        },
      );

      const res = await app.inject({
        method: 'POST',
        url: `/v1/users/${borrowerId}/return-items`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          returnedTo: managerId,
          items: [
            {
              loanId: loan._id,
              assetId: asset._id,
              condition: 'GOOD',
              note: null,
              requiresService: false,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 403 when EMPLOYEE tries to process a return-from-borrower', async () => {
      const asset = await insertTestAsset(app, { status: 'BORROWED' });
      const loan = await insertTestLoan(app, {
        borrowerId,
        assetIds: [asset._id],
        status: 'ACTIVE',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/users/${borrowerId}/return-items`,
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          returnedTo: borrowerId,
          items: [
            {
              loanId: loan._id,
              assetId: asset._id,
              condition: 'GOOD',
              note: null,
              requiresService: false,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });
});

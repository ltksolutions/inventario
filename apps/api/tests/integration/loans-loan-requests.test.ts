// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests — Loan Requests (ADR-0026: katalógové žiadosti + oddelené vydávanie).
 *
 * Kľúčové zmeny oproti ADR-0012:
 *   - POST /v1/loan-requests: kategória + množstvo (nie assetId), BEZ rezervácie
 *   - POST /v1/loan-requests/:id/approve: len PENDING → APPROVED, nevytvára Loan
 *   - POST /v1/loan-requests/:id/fulfil: vydanie → ACTIVE Loan + BORROWED assety
 *   - reject / cancel: žiadne uvoľnenie rezervácie (nič nebolo rezervované)
 */

import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestAsset,
  insertTestCategory,
  insertTestLoanRequest,
  insertTestMembership,
  provisionUser,
  seedTestTenant,
  UserRole,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('Loan Requests (ADR-0026)', () => {
  let app: FastifyInstance;
  let adminToken: string;
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
    const admin = await provisionUser(app, { oid: 'loan-admin', role: UserRole.ADMIN });
    adminToken = admin.token;
    const manager = await provisionUser(app, { oid: 'loan-manager', role: UserRole.ASSET_MANAGER });
    managerToken = manager.token;
    managerId = String(manager.user._id);
    const employee = await provisionUser(app, { oid: 'loan-employee', role: UserRole.EMPLOYEE });
    employeeToken = employee.token;
    employeeId = String(employee.user._id);
  });

  // -------------------------------------------------------------------------
  // POST /v1/loan-requests — katalógová žiadosť (BEZ rezervácie)
  // -------------------------------------------------------------------------

  describe('POST /v1/loan-requests', () => {
    it('vytvorí PENDING žiadosť s kategóriou + množstvom, BEZ rezervácie assetov (201)', async () => {
      const category = await insertTestCategory(app);
      const asset = await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Tréningový kemp',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          plannedTo: new Date(Date.now() + 86400000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 2 }],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<Record<string, unknown>>();
      expect(body.status).toBe('PENDING');
      expect(body.requesterId).toBe(employeeId);
      expect(Array.isArray(body.resultingLoanIds)).toBe(true);
      expect((body.resultingLoanIds as unknown[]).length).toBe(0);

      // ADR-0026: žiadna rezervácia — asset ostáva AVAILABLE
      const assetDoc = await app.mongo.db.collection('assets').findOne({ _id: { $exists: true } });
      expect(assetDoc?.status).toBe('AVAILABLE');

      void asset; // referenced only for AVAILABLE check
    });

    it('items obsahujú categorySnapshot z DB (201)', async () => {
      const category = await insertTestCategory(app, { name: 'Lopty', slug: 'lopty' });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Zápas',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 10, note: 'ak sú skladom' }],
        },
      });

      expect(res.statusCode).toBe(201);
      const items = res.json<{ items: Array<Record<string, unknown>> }>().items;
      expect(items[0]?.categorySnapshot).toMatchObject({ name: 'Lopty', slug: 'lopty' });
      expect(items[0]?.quantityRequested).toBe(10);
      expect(items[0]?.quantityFulfilled).toBe(0);
      expect(items[0]?.note).toBe('ak sú skladom');
    });

    it('vráti 400 ak categoryId neexistuje', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Test',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: '0123456789abcdef01234567', quantityRequested: 1 }],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('vráti 400 pre prázdny items pole', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Test',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('vráti 401 bez cookie', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/loan-requests' });
      expect(res.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/loan-requests/:id/approve — len stav, BEZ Loan
  // -------------------------------------------------------------------------

  describe('POST /v1/loan-requests/:id/approve', () => {
    it('zmení stav PENDING → APPROVED, nevytvára Loan ani BORROWED asset (200)', async () => {
      const category = await insertTestCategory(app);
      const asset = await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Schválenie test',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 1 }],
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
      const approved = approveRes.json<Record<string, unknown>>();
      expect(approved.status).toBe('APPROVED');

      // ADR-0026: approve NEVYTVÁRA Loan
      const loans = await app.mongo.db.collection('loans').find({}).toArray();
      expect(loans).toHaveLength(0);

      // ADR-0026: asset ostáva AVAILABLE (nie RESERVED/BORROWED)
      const assetDoc = await app.mongo.db.collection('assets').findOne({});
      expect(assetDoc?.status).toBe('AVAILABLE');

      void asset;
    });

    it('vráti 400 pri pokuse schváliť non-PENDING žiadosť', async () => {
      const request = await insertTestLoanRequest(app, { status: 'REJECTED' });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('vráti 403 ak EMPLOYEE skúsi schváliť', async () => {
      const request = await insertTestLoanRequest(app, { status: 'PENDING' });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/approve`,
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('vráti 404 pre neexistujúcu žiadosť', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests/0123456789abcdef01234567/approve',
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/loan-requests/:id/fulfil — vydanie (vznik Loan)
  // -------------------------------------------------------------------------

  describe('POST /v1/loan-requests/:id/fulfil', () => {
    it('vydá SERIALIZED asset, vytvorí ACTIVE Loan, asset → BORROWED, žiadosť → FULFILLED (201)', async () => {
      const category = await insertTestCategory(app);
      const asset = await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });

      // Vytvor + schváľ žiadosť
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Vydanie test',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 1 }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;
      await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      // Vydaj
      const fulfilRes = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [{ requestItemIndex: 0, type: 'SERIALIZED', assetIds: [asset._id] }],
          dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        },
      });

      expect(fulfilRes.statusCode).toBe(201);
      const loan = fulfilRes.json<Record<string, unknown>>();
      expect(loan.status).toBe('ACTIVE');
      expect(loan.requestId).toBe(requestId);

      // Žiadosť → FULFILLED
      const reqDoc = await app.mongo.db.collection('loan_requests').findOne({});
      expect(reqDoc?.status).toBe('FULFILLED');
      expect((reqDoc?.resultingLoanIds as string[]).length).toBe(1);
      expect(reqDoc?.items[0].quantityFulfilled).toBe(1);

      // Asset → BORROWED
      const assetDoc = await app.mongo.db.collection('assets').findOne({});
      expect(assetDoc?.status).toBe('BORROWED');
    });

    it('čiastočné vydanie → žiadosť PARTIALLY_FULFILLED, asset BORROWED, zvyšok ostáva', async () => {
      const category = await insertTestCategory(app);
      const asset1 = await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });
      await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id }); // asset2 nevydáme

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Čiastočné',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 2 }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;
      await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      // Vydaj len 1 z 2
      const fulfilRes = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [{ requestItemIndex: 0, type: 'SERIALIZED', assetIds: [asset1._id] }],
          dueAt: null,
        },
      });

      expect(fulfilRes.statusCode).toBe(201);

      const reqDoc = await app.mongo.db.collection('loan_requests').findOne({});
      expect(reqDoc?.status).toBe('PARTIALLY_FULFILLED');
      expect(reqDoc?.items[0].quantityFulfilled).toBe(1);
    });

    it('closeRemainder=true uzavrie žiadosť aj s nevydaným zvyškom → CLOSED', async () => {
      const category = await insertTestCategory(app);
      const asset = await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Close remainder',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 3 }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;
      await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      const fulfilRes = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [{ requestItemIndex: 0, type: 'SERIALIZED', assetIds: [asset._id] }],
          dueAt: null,
          closeRemainder: true,
        },
      });

      expect(fulfilRes.statusCode).toBe(201);
      const reqDoc = await app.mongo.db.collection('loan_requests').findOne({});
      expect(reqDoc?.status).toBe('CLOSED');
    });

    it('1 žiadosť → 2 Loanmi (postupné vydanie)', async () => {
      const category = await insertTestCategory(app);
      const asset1 = await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });
      const asset2 = await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Viac Loanov',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 2 }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;
      await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      // Prvé vydanie: 1 kus
      await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [{ requestItemIndex: 0, type: 'SERIALIZED', assetIds: [asset1._id] }],
          dueAt: null,
        },
      });

      // Druhé vydanie: 1 kus
      const fulfil2 = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [{ requestItemIndex: 0, type: 'SERIALIZED', assetIds: [asset2._id] }],
          dueAt: null,
        },
      });

      expect(fulfil2.statusCode).toBe(201);

      // 2 Loanmi v DB
      const loans = await app.mongo.db.collection('loans').find({}).toArray();
      expect(loans).toHaveLength(2);

      // Žiadosť → FULFILLED, resultingLoanIds má 2 položky
      const reqDoc = await app.mongo.db.collection('loan_requests').findOne({});
      expect(reqDoc?.status).toBe('FULFILLED');
      expect((reqDoc?.resultingLoanIds as string[]).length).toBe(2);
    });

    it('žiadny strop na zostatok (2026-07-16): vydanie viac než žiadané uspeje, quantityFulfilled > quantityRequested', async () => {
      // Žiadosť je len orientačný podnet, nie strop — správca môže vydať viac.
      const category = await insertTestCategory(app);
      const asset1 = await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });
      const asset2 = await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Vydanie viac než žiadané',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 1 }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;
      await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      // Vydá 2 kusy, hoci žiadané bolo len 1 — musí uspieť.
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [
            {
              requestItemIndex: 0,
              type: 'SERIALIZED',
              assetIds: [asset1._id, asset2._id],
            },
          ],
          dueAt: null,
        },
      });

      expect(res.statusCode).toBe(201);
      const reqDoc = await app.mongo.db.collection('loan_requests').findOne({});
      expect(reqDoc?.items[0].quantityFulfilled).toBe(2);
      expect(reqDoc?.items[0].quantityRequested).toBe(1);
      expect(reqDoc?.status).toBe('FULFILLED');
    });

    it('viac BULK položiek v jednej kategórii (napr. SAP + Office licencia pod "Software") sa vydajú oboje naraz', async () => {
      const category = await insertTestCategory(app);
      const sapLicense = await insertTestAsset(app, {
        categoryId: category._id,
        trackingMode: 'BULK',
        quantityOnHand: 5,
        name: 'SAP licencia',
      });
      const officeLicense = await insertTestAsset(app, {
        categoryId: category._id,
        trackingMode: 'BULK',
        quantityOnHand: 5,
        name: 'Office licencia',
      });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Software',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 1 }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;
      await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [
            { requestItemIndex: 0, type: 'BULK', bulkItemId: sapLicense._id, quantity: 1 },
            { requestItemIndex: 0, type: 'BULK', bulkItemId: officeLicense._id, quantity: 1 },
          ],
          dueAt: null,
        },
      });

      expect(res.statusCode).toBe(201);
      const loan = res.json<{ items: Array<{ assetId: string }> }>();
      expect(loan.items.map((i) => i.assetId).sort()).toEqual(
        [sapLicense._id, officeLicense._id].sort(),
      );

      const reqDoc = await app.mongo.db.collection('loan_requests').findOne({});
      expect(reqDoc?.items[0].quantityFulfilled).toBe(2);
    });

    it('EXTRA_SERIALIZED: správca doplní majetok mimo pôvodnej žiadosti (napr. predlžovačka), dopíše sa do žiadosti', async () => {
      const category = await insertTestCategory(app);
      const notebook = await insertTestAsset(app, {
        status: 'AVAILABLE',
        categoryId: category._id,
      });

      const extraCategory = await insertTestCategory(app);
      const extensionCord = await insertTestAsset(app, {
        status: 'AVAILABLE',
        categoryId: extraCategory._id,
        name: 'Predlžovačka',
      });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Notebook + navyše',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 1 }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;
      await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [
            { requestItemIndex: 0, type: 'SERIALIZED', assetIds: [notebook._id] },
            {
              type: 'EXTRA_SERIALIZED',
              categoryId: extraCategory._id,
              assetIds: [extensionCord._id],
            },
          ],
          dueAt: null,
        },
      });

      expect(res.statusCode).toBe(201);
      const loan = res.json<{ items: Array<{ assetId: string }> }>();
      expect(loan.items.map((i) => i.assetId).sort()).toEqual(
        [notebook._id, extensionCord._id].sort(),
      );

      const reqDoc = await app.mongo.db.collection('loan_requests').findOne({});
      expect(reqDoc?.items).toHaveLength(2);
      expect(reqDoc?.items[1].categoryId).toBe(extraCategory._id);
      expect(reqDoc?.items[1].quantityRequested).toBe(1);
      expect(reqDoc?.items[1].quantityFulfilled).toBe(1);
      expect(reqDoc?.items[1].note).toBe('Doplnené správcom pri vydaní (mimo pôvodnej žiadosti).');

      const assetDoc = await app.mongo.db
        .collection('assets')
        .findOne({ _id: new ObjectId(extensionCord._id) });
      expect(assetDoc?.status).toBe('BORROWED');
    });

    it('EXTRA_BULK: správca doplní BULK majetok mimo pôvodnej žiadosti', async () => {
      const category = await insertTestCategory(app);
      const notebook = await insertTestAsset(app, {
        status: 'AVAILABLE',
        categoryId: category._id,
      });

      const extraCategory = await insertTestCategory(app);
      const cables = await insertTestAsset(app, {
        categoryId: extraCategory._id,
        trackingMode: 'BULK',
        quantityOnHand: 20,
        name: 'HDMI kábel',
      });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Notebook + BULK navyše',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 1 }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;
      await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [
            { requestItemIndex: 0, type: 'SERIALIZED', assetIds: [notebook._id] },
            {
              type: 'EXTRA_BULK',
              categoryId: extraCategory._id,
              bulkItemId: cables._id,
              quantity: 2,
            },
          ],
          dueAt: null,
        },
      });

      expect(res.statusCode).toBe(201);
      const reqDoc = await app.mongo.db.collection('loan_requests').findOne({});
      expect(reqDoc?.items).toHaveLength(2);
      expect(reqDoc?.items[1].categoryId).toBe(extraCategory._id);
      expect(reqDoc?.items[1].quantityRequested).toBe(2);
      expect(reqDoc?.items[1].quantityFulfilled).toBe(2);
    });

    it('vráti 400 ak asset nie je AVAILABLE pri vydaní', async () => {
      const category = await insertTestCategory(app);
      const borrowedAsset = await insertTestAsset(app, {
        status: 'BORROWED',
        categoryId: category._id,
      });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Unavailable asset',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 1 }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;
      await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [{ requestItemIndex: 0, type: 'SERIALIZED', assetIds: [borrowedAsset._id] }],
          dueAt: null,
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('vráti 400 ak žiadosť nie je APPROVED/PARTIALLY_FULFILLED', async () => {
      const request = await insertTestLoanRequest(app, { status: 'PENDING' });
      const category = await insertTestCategory(app);
      const asset = await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [{ requestItemIndex: 0, type: 'SERIALIZED', assetIds: [asset._id] }],
          dueAt: null,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('vráti 403 ak EMPLOYEE skúsi vydať', async () => {
      const request = await insertTestLoanRequest(app, { status: 'APPROVED' });
      const category = await insertTestCategory(app);
      const asset = await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/fulfil`,
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          items: [{ requestItemIndex: 0, type: 'SERIALIZED', assetIds: [asset._id] }],
          dueAt: null,
        },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // Skladové pohyby (StockMovement) pri výdaji/vrátení BULK majetku
  // (2026-07-16, ADR-0020 wiring — pred týmto zmenami sa `quantityOnHand`
  // nikdy nemenilo a neexistovali žiadne LOAN_OUT/LOAN_RETURN záznamy).
  // -------------------------------------------------------------------------

  describe('Skladové pohyby pri BULK výdaji/vrátení (ADR-0020)', () => {
    it('vydanie BULK položky zapíše LOAN_OUT pohyb a zníži quantityOnHand', async () => {
      const category = await insertTestCategory(app);
      const cables = await insertTestAsset(app, {
        categoryId: category._id,
        trackingMode: 'BULK',
        quantityOnHand: 5,
        name: 'HDMI kábel',
      });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Káble',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 2 }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;
      await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      const fulfilRes = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [{ requestItemIndex: 0, type: 'BULK', bulkItemId: cables._id, quantity: 2 }],
          dueAt: null,
        },
      });
      expect(fulfilRes.statusCode).toBe(201);
      const loan = fulfilRes.json<{ _id: string }>();

      const assetDoc = await app.mongo.db
        .collection('assets')
        .findOne({ _id: new ObjectId(cables._id) });
      expect(assetDoc?.quantityOnHand).toBe(3);
      // BULK asset doc je len kategóriový placeholder — status/currentLoanId
      // sa pri BULK výdaji nikdy nemenil (už pred týmto wiringom).
      expect(assetDoc?.status).toBe('AVAILABLE');
      expect(assetDoc?.currentLoanId).toBeNull();

      const movement = await app.mongo.db.collection('stock_movements').findOne({
        itemId: cables._id,
        type: 'LOAN_OUT',
      });
      expect(movement).toBeTruthy();
      expect(movement?.quantity).toBe(-2);
      expect(movement?.balanceAfter).toBe(3);
      expect(movement?.loanId).toBe(loan._id);
    });

    it('viac BULK položiek v jednej kategórii zapíše samostatný LOAN_OUT pohyb pre každú', async () => {
      const category = await insertTestCategory(app);
      const sapLicense = await insertTestAsset(app, {
        categoryId: category._id,
        trackingMode: 'BULK',
        quantityOnHand: 5,
        name: 'SAP licencia',
      });
      const officeLicense = await insertTestAsset(app, {
        categoryId: category._id,
        trackingMode: 'BULK',
        quantityOnHand: 5,
        name: 'Office licencia',
      });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Software',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 1 }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;
      await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [
            { requestItemIndex: 0, type: 'BULK', bulkItemId: sapLicense._id, quantity: 1 },
            { requestItemIndex: 0, type: 'BULK', bulkItemId: officeLicense._id, quantity: 3 },
          ],
          dueAt: null,
        },
      });
      expect(res.statusCode).toBe(201);

      const sapDoc = await app.mongo.db
        .collection('assets')
        .findOne({ _id: new ObjectId(sapLicense._id) });
      const officeDoc = await app.mongo.db
        .collection('assets')
        .findOne({ _id: new ObjectId(officeLicense._id) });
      expect(sapDoc?.quantityOnHand).toBe(4);
      expect(officeDoc?.quantityOnHand).toBe(2);

      const sapMovement = await app.mongo.db
        .collection('stock_movements')
        .findOne({ itemId: sapLicense._id, type: 'LOAN_OUT' });
      const officeMovement = await app.mongo.db
        .collection('stock_movements')
        .findOne({ itemId: officeLicense._id, type: 'LOAN_OUT' });
      expect(sapMovement?.quantity).toBe(-1);
      expect(officeMovement?.quantity).toBe(-3);
    });

    it('vrátenie BULK výpožičky zapíše LOAN_RETURN pohyb a vráti quantityOnHand naspäť', async () => {
      const category = await insertTestCategory(app);
      const cables = await insertTestAsset(app, {
        categoryId: category._id,
        trackingMode: 'BULK',
        quantityOnHand: 5,
        name: 'HDMI kábel',
      });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Káble',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 2 }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;
      await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      const fulfilRes = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [{ requestItemIndex: 0, type: 'BULK', bulkItemId: cables._id, quantity: 2 }],
          dueAt: null,
        },
      });
      const loan = fulfilRes.json<{ _id: string }>();

      const returnRes = await app.inject({
        method: 'POST',
        url: `/v1/loans/${loan._id}/return`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          returnedTo: managerId,
          items: [{ assetId: cables._id, condition: 'GOOD', note: null, requiresService: false }],
        },
      });
      expect(returnRes.statusCode).toBe(200);
      expect(returnRes.json<{ status: string }>().status).toBe('RETURNED');

      const assetDoc = await app.mongo.db
        .collection('assets')
        .findOne({ _id: new ObjectId(cables._id) });
      expect(assetDoc?.quantityOnHand).toBe(5);
      expect(assetDoc?.status).toBe('AVAILABLE');
      expect(assetDoc?.currentLoanId).toBeNull();

      const returnMovement = await app.mongo.db.collection('stock_movements').findOne({
        itemId: cables._id,
        type: 'LOAN_RETURN',
      });
      expect(returnMovement).toBeTruthy();
      expect(returnMovement?.quantity).toBe(2);
      expect(returnMovement?.balanceAfter).toBe(5);
    });

    it('vráti 400 ak výdaj BULK položky prekročí reálnu skladovú zásobu (záporný zostatok guard)', async () => {
      const category = await insertTestCategory(app);
      const cables = await insertTestAsset(app, {
        categoryId: category._id,
        trackingMode: 'BULK',
        quantityOnHand: 2,
        name: 'HDMI kábel',
      });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Káble',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 5 }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;
      await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });

      // Žiadosť je len orientačná (žiadny strop na quantityRequested), ale
      // fyzický sklad áno — 5 ks pri 2 na sklade musí padnúť na skladovom
      // guarde (nie na "strope žiadosti", ten bol zrušený inou zmenou).
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [{ requestItemIndex: 0, type: 'BULK', bulkItemId: cables._id, quantity: 5 }],
          dueAt: null,
        },
      });
      expect(res.statusCode).toBe(400);

      // Transakcia sa celá rollback-ovala — quantityOnHand ostal nezmenený,
      // žiadny StockMovement nevznikol, Loan sa nevytvoril.
      const assetDoc = await app.mongo.db
        .collection('assets')
        .findOne({ _id: new ObjectId(cables._id) });
      expect(assetDoc?.quantityOnHand).toBe(2);
      const movement = await app.mongo.db
        .collection('stock_movements')
        .findOne({ itemId: cables._id });
      expect(movement).toBeNull();
      const loansCount = await app.mongo.db.collection('loans').countDocuments({});
      expect(loansCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/loan-requests/:id/reject — žiadna rezervácia
  // -------------------------------------------------------------------------

  describe('POST /v1/loan-requests/:id/reject', () => {
    it('zamietne PENDING žiadosť, asset ostáva AVAILABLE (ADR-0026: nič netreba uvoľniť) (204)', async () => {
      const category = await insertTestCategory(app);
      const asset = await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Zamietnutie test',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 1 }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;

      const rejectRes = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${requestId}/reject`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: { reason: 'Majetok nie je k dispozícii' },
      });
      expect(rejectRes.statusCode).toBe(204);

      // Asset nikdy nebol rezervovaný — zostáva AVAILABLE
      const assetDoc = await app.mongo.db.collection('assets').findOne({});
      expect(assetDoc?.status).toBe('AVAILABLE');
      const reqDoc = await app.mongo.db.collection('loan_requests').findOne({});
      expect(reqDoc?.status).toBe('REJECTED');

      void asset;
    });

    it('vráti 400 ak chýba dôvod', async () => {
      const request = await insertTestLoanRequest(app, { status: 'PENDING' });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/reject`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('vráti 403 ak EMPLOYEE skúsi zamietnuť', async () => {
      const request = await insertTestLoanRequest(app, { status: 'PENDING' });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/reject`,
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: { reason: 'Nechcem ho' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /v1/loan-requests/:id — cancel
  // -------------------------------------------------------------------------

  describe('DELETE /v1/loan-requests/:id (cancel)', () => {
    it('žiadateľ môže zrušiť vlastnú PENDING žiadosť, asset ostáva AVAILABLE (204)', async () => {
      const category = await insertTestCategory(app);
      const asset = await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Cancel test',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 1 }],
        },
      });
      const requestId = createRes.json<{ _id: string }>()._id;

      const cancelRes = await app.inject({
        method: 'DELETE',
        url: `/v1/loan-requests/${requestId}`,
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(cancelRes.statusCode).toBe(204);

      const assetDoc = await app.mongo.db.collection('assets').findOne({});
      expect(assetDoc?.status).toBe('AVAILABLE');
      const reqDoc = await app.mongo.db.collection('loan_requests').findOne({});
      expect(reqDoc?.status).toBe('CANCELLED');

      void asset;
    });

    it('ADMIN môže zrušiť cudziu žiadosť', async () => {
      const category = await insertTestCategory(app);
      await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Admin cancel',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 1 }],
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

    it('EMPLOYEE nemôže zrušiť cudzí žiadosť (403)', async () => {
      const otherEmployee = await provisionUser(app, {
        oid: 'other-cancel-employee',
        role: UserRole.EMPLOYEE,
      });
      const category = await insertTestCategory(app);
      await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${otherEmployee.token}` },
        payload: {
          purpose: 'Other',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 1 }],
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

  // -------------------------------------------------------------------------
  // GET /v1/loan-requests — zoznam
  // -------------------------------------------------------------------------

  describe('GET /v1/loan-requests', () => {
    it('EMPLOYEE vidí len vlastné žiadosti', async () => {
      const category = await insertTestCategory(app);
      await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });
      await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });

      await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Moja',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 1 }],
        },
      });
      const other = await provisionUser(app, { oid: 'other-emp-list', role: UserRole.EMPLOYEE });
      await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${other.token}` },
        payload: {
          purpose: 'Nie moja',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 1 }],
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

    it('ASSET_MANAGER vidí všetky žiadosti tenanta', async () => {
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

  // -------------------------------------------------------------------------
  // Cross-tenant izolácia
  // -------------------------------------------------------------------------

  describe('cross-tenant izolácia', () => {
    it('nemôže schváliť žiadosť z iného tenanta (404)', async () => {
      const tenantB = await seedTestTenant(app, { slug: 'tenant-b-lr-approve' });
      const request = await insertTestLoanRequest(app, { organisationId: tenantB._id });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/approve`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('nemôže zobraziť žiadosť z iného tenanta (404)', async () => {
      const tenantB = await seedTestTenant(app, { slug: 'tenant-b-lr-get' });
      const request = await insertTestLoanRequest(app, { organisationId: tenantB._id });
      const res = await app.inject({
        method: 'GET',
        url: `/v1/loan-requests/${request._id}`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('nemôže vydávať z žiadosti z iného tenanta (404)', async () => {
      const tenantB = await seedTestTenant(app, { slug: 'tenant-b-lr-fulfil' });
      const request = await insertTestLoanRequest(app, {
        organisationId: tenantB._id,
        status: 'APPROVED',
      });
      const category = await insertTestCategory(app);
      const asset = await insertTestAsset(app, { status: 'AVAILABLE', categoryId: category._id });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/loan-requests/${request._id}/fulfil`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: {
          items: [{ requestItemIndex: 0, type: 'SERIALIZED', assetIds: [asset._id] }],
          dueAt: null,
        },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // RBAC — beneficiary
  // -------------------------------------------------------------------------

  describe('beneficiaryId (ADR-0023)', () => {
    it('žiadateľ môže podať žiadosť za iného (s platným beneficiaryId)', async () => {
      const beneficiary = await provisionUser(app, {
        oid: 'beneficiary-user',
        role: UserRole.EMPLOYEE,
      });
      await insertTestMembership(app, {
        userId: String(beneficiary.user._id),
      });
      const category = await insertTestCategory(app);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: {
          purpose: 'Za kolegu',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 1 }],
          beneficiaryId: String(beneficiary.user._id),
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<Record<string, unknown>>();
      expect(body.beneficiaryId).toBe(String(beneficiary.user._id));
      expect(body.requesterId).toBe(employeeId);
    });
  });
});

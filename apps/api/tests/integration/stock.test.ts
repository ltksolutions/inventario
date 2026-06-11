// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests — POST/GET endpoints pre skladové pohyby BULK položiek.
 * Slice #5a K5.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestAsset,
  insertTestLocation,
  provisionUser,
  resolveTestTenantId,
  seedTestTenant,
  UserRole,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('Stock endpoints (Slice #5a)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
  let employeeToken: string;
  let locationId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
    // Najprv vyriešime tenant (aby nedošlo k duplicate key pri súčasnom provisionUser)
    await resolveTestTenantId(app);
    [{ token: adminToken }, { token: managerToken }, { token: employeeToken }] = await Promise.all([
      provisionUser(app, { oid: 'stock-admin', role: UserRole.ADMIN }),
      provisionUser(app, { oid: 'stock-manager', role: UserRole.ASSET_MANAGER }),
      provisionUser(app, { oid: 'stock-employee', role: UserRole.EMPLOYEE }),
    ]);
    const loc = await insertTestLocation(app, { slug: 'sklad-test', name: 'Sklad test' });
    locationId = loc._id;
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  async function createBulkAsset(quantityOnHand = 0) {
    return insertTestAsset(app, {
      name: 'Tréningové kužele',
      trackingMode: 'BULK',
      quantityOnHand,
    });
  }

  // -------------------------------------------------------------------------
  // POST /v1/stock/:itemId/receive
  // -------------------------------------------------------------------------

  describe('POST /v1/stock/:itemId/receive', () => {
    it('zaúčtuje príjem a aktualizuje quantityOnHand', async () => {
      const { _id } = await createBulkAsset();

      const res = await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/receive`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { quantity: 30, locationId, reason: 'Nákup Q2' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<Record<string, unknown>>();
      expect(body['type']).toBe('RECEIPT');
      expect(body['quantity']).toBe(30);
      expect(body['balanceAfter']).toBe(30);

      // Overenie že cache sa aktualizovala na asset
      const asset = await app.mongo.db
        .collection('assets')
        .findOne({ _id: { $exists: true }, name: 'Tréningové kužele' });
      expect(asset?.['quantityOnHand']).toBe(30);
    });

    it('akumuluje viacero príjmov', async () => {
      const { _id } = await createBulkAsset(20);

      const res = await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/receive`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { quantity: 10, locationId },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json<Record<string, unknown>>()['balanceAfter']).toBe(30);
    });

    it('400 — záporné quantity', async () => {
      const { _id } = await createBulkAsset();
      const res = await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/receive`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { quantity: -5, locationId },
      });
      expect(res.statusCode).toBe(400);
    });

    it('400 — SERIALIZED asset nemôže mať skladový pohyb', async () => {
      const { _id } = await insertTestAsset(app, { name: 'Laptop', trackingMode: 'SERIALIZED' });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/receive`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { quantity: 1, locationId },
      });
      expect(res.statusCode).toBe(400);
    });

    it('404 — neexistujúca položka', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/stock/000000000000000000000099/receive',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { quantity: 10, locationId },
      });
      expect(res.statusCode).toBe(404);
    });

    it('403 — EMPLOYEE nemôže zaúčtovať príjem', async () => {
      const { _id } = await createBulkAsset();
      const res = await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/receive`,
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: { quantity: 10, locationId },
      });
      expect(res.statusCode).toBe(403);
    });

    it('ASSET_MANAGER môže zaúčtovať príjem', async () => {
      const { _id } = await createBulkAsset();
      const res = await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/receive`,
        headers: { cookie: `inv_access=${managerToken}` },
        payload: { quantity: 5, locationId },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/stock/:itemId/adjust
  // -------------------------------------------------------------------------

  describe('POST /v1/stock/:itemId/adjust', () => {
    it('kladná korekcia zvýši zostatok', async () => {
      const { _id } = await createBulkAsset(10);
      const res = await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/adjust`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { quantity: 5, locationId, reason: 'Inventúra — nájdené kusy' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<Record<string, unknown>>()['balanceAfter']).toBe(15);
    });

    it('záporná korekcia zníži zostatok', async () => {
      const { _id } = await createBulkAsset(20);
      const res = await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/adjust`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { quantity: -3, locationId, reason: 'Inventúra — chýbajúce kusy' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<Record<string, unknown>>()['balanceAfter']).toBe(17);
    });

    it('400 — korekcia stiahne zostatok pod nulu', async () => {
      const { _id } = await createBulkAsset(5);
      const res = await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/adjust`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { quantity: -10, locationId, reason: 'Odpis strát' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('400 — chýbajúci reason', async () => {
      const { _id } = await createBulkAsset(10);
      const res = await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/adjust`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { quantity: 2, locationId },
      });
      expect(res.statusCode).toBe(400);
    });

    it('400 — príliš krátky reason (< 3 znaky)', async () => {
      const { _id } = await createBulkAsset(10);
      const res = await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/adjust`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { quantity: 2, locationId, reason: 'AB' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('400 — SERIALIZED asset', async () => {
      const { _id } = await insertTestAsset(app);
      const res = await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/adjust`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { quantity: 1, locationId, reason: 'Test korekcia' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // GET /v1/stock/:itemId/movements
  // -------------------------------------------------------------------------

  describe('GET /v1/stock/:itemId/movements', () => {
    it('vracia zoznam pohybov po príjmoch', async () => {
      const { _id } = await createBulkAsset();

      // Zaúčtuj 2 príjmy
      await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/receive`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { quantity: 20, locationId },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/receive`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { quantity: 10, locationId },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/stock/${_id}/movements`,
        headers: { cookie: `inv_access=${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[]; pagination: { total: number } }>();
      expect(body.data).toHaveLength(2);
      expect(body.pagination.total).toBe(2);
    });

    it('EMPLOYEE môže čítať pohyby (read access)', async () => {
      const { _id } = await createBulkAsset();
      const res = await app.inject({
        method: 'GET',
        url: `/v1/stock/${_id}/movements`,
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('filtruje pohyby podľa type', async () => {
      const { _id } = await createBulkAsset();

      await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/receive`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { quantity: 30, locationId },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/adjust`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { quantity: -5, locationId, reason: 'Inventúra odpis' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/stock/${_id}/movements?type=RECEIPT`,
        headers: { cookie: `inv_access=${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: Array<{ type: string }> }>();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.type).toBe('RECEIPT');
    });

    it('401 — bez tokenu', async () => {
      const { _id } = await createBulkAsset();
      const res = await app.inject({
        method: 'GET',
        url: `/v1/stock/${_id}/movements`,
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/stock/:itemId/reconcile
  // -------------------------------------------------------------------------

  describe('POST /v1/stock/:itemId/reconcile', () => {
    it('wasConsistent: true ak cache sedí s ledgerom', async () => {
      const { _id } = await createBulkAsset();
      await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/receive`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { quantity: 15, locationId },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/reconcile`,
        headers: { cookie: `inv_access=${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ wasConsistent: boolean; ledgerBalance: number; cacheWas: number }>();
      expect(body.wasConsistent).toBe(true);
      expect(body.ledgerBalance).toBe(15);
      expect(body.cacheWas).toBe(15);
    });

    it('wasConsistent: false + opraví cache ak divergovala', async () => {
      const { _id } = await createBulkAsset(20);

      // Manuálne posuniem quantityOnHand na asset (simulácia divergencie)
      const tenantId = await resolveTestTenantId(app);
      await app.mongo.db
        .collection('assets')
        .updateOne(
          { organisationId: tenantId, name: 'Tréningové kužele' },
          { $set: { quantityOnHand: 99 } },
        );

      const res = await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/reconcile`,
        headers: { cookie: `inv_access=${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ wasConsistent: boolean; ledgerBalance: number; cacheWas: number }>();
      expect(body.wasConsistent).toBe(false);
      expect(body.cacheWas).toBe(99);
      expect(body.ledgerBalance).toBe(0); // žiadne pohyby → sum = 0

      // Cache opravená
      const asset = await app.mongo.db.collection('assets').findOne({ name: 'Tréningové kužele' });
      expect(asset?.['quantityOnHand']).toBe(0);
    });

    it('403 — ASSET_MANAGER nemôže volať reconcile (len ADMIN)', async () => {
      const { _id } = await createBulkAsset();
      const res = await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/reconcile`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // Cross-tenant izolácia
  // -------------------------------------------------------------------------

  describe('cross-tenant izolácia', () => {
    it('receive na asset iného tenanta vráti 404', async () => {
      const tenantB = await seedTestTenant(app, { slug: 'tenant-b-stock' });
      const { _id } = await insertTestAsset(app, {
        organisationId: tenantB._id,
        trackingMode: 'BULK',
        quantityOnHand: 0,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/stock/${_id}/receive`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { quantity: 10, locationId },
      });

      // Tenant A admin nemôže vidieť asset tenanta B → 404
      expect(res.statusCode).toBe(404);
    });
  });
});

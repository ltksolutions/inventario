// SPDX-FileCopyrightText: 2026 Jan Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests pre GET /v1/public/scan/:publicToken (ADR-0021 K4).
 *
 * Bez autentifikacie. Testuje:
 * - happy path: tenant ma publicAssetLookup=true, token existuje
 * - 404 ak tenant nema publicAssetLookup (no oracle)
 * - 404 ak token neexistuje (no oracle)
 * - 404 ak asset je soft-deleted
 * - whitelist: response neobsahuje citlive polia
 */

import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { insertTestAsset, resolveTestTenantId } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('GET /v1/public/scan/:publicToken', () => {
  let app: FastifyInstance;
  let tenantId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
    tenantId = await resolveTestTenantId(app);
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  // Helper: nastav publicAssetLookup na tenant
  async function setPublicAssetLookup(enabled: boolean) {
    await app.mongo.db
      .collection('organisations')
      .updateOne({ _id: new ObjectId(tenantId) }, { $set: { publicAssetLookup: enabled } });
  }

  describe('happy path', () => {
    it('vrati PublicAssetView ak tenant ma publicAssetLookup=true', async () => {
      await setPublicAssetLookup(true);
      const asset = await insertTestAsset(app, { name: 'Najdeny notebook' });

      // Zisti publicToken z DB
      const dbAsset = await app.mongo.db
        .collection('assets')
        .findOne({ _id: new ObjectId(asset._id) });
      const token = dbAsset?.['publicToken'] as string;
      expect(token).toBeTruthy();

      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/scan/${token}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();

      // Povinne polia musia byt pritomne
      expect(typeof body['organisationName']).toBe('string');
      expect(body['inventoryNumber']).toBe(asset.inventoryNumber);
      expect(body['name']).toBe('Najdeny notebook');
      expect('foundContact' in body).toBe(true);
      expect('organisationLogoUrl' in body).toBe(true);
    });

    it('whitelist: response neobsahuje citlive polia', async () => {
      await setPublicAssetLookup(true);
      const asset = await insertTestAsset(app);
      const dbAsset = await app.mongo.db
        .collection('assets')
        .findOne({ _id: new ObjectId(asset._id) });
      const token = dbAsset?.['publicToken'] as string;

      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/scan/${token}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();

      // Citlive polia NESMU byt v response
      const forbidden = [
        '_id',
        'organisationId',
        'publicToken',
        'internalNotes',
        'acquisitionCost',
        'locationId',
        'categoryId',
        'status',
        'specs',
        'tags',
        'imageIds',
        'createdBy',
        'updatedBy',
      ];
      for (const field of forbidden) {
        expect(body).not.toHaveProperty(field);
      }

      // Presne 5 klucev
      const keys = Object.keys(body).sort();
      expect(keys).toEqual(
        [
          'foundContact',
          'inventoryNumber',
          'name',
          'organisationLogoUrl',
          'organisationName',
        ].sort(),
      );
    });
  });

  describe('privacy / security', () => {
    it('vrati 404 ak tenant ma publicAssetLookup=false (default)', async () => {
      // resolveTestTenantId nastavi publicAssetLookup: false
      const asset = await insertTestAsset(app);
      const dbAsset = await app.mongo.db
        .collection('assets')
        .findOne({ _id: new ObjectId(asset._id) });
      const token = dbAsset?.['publicToken'] as string;

      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/scan/${token}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it('vrati 404 pre neexistujuci token (no oracle — rovnaka odpoved ako disabled)', async () => {
      await setPublicAssetLookup(true);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/public/scan/NEEXISTUJUCI_TOKEN_XXXXXXXXXX',
      });
      expect(res.statusCode).toBe(404);
    });

    it('vrati 404 pre soft-deleted asset', async () => {
      await setPublicAssetLookup(true);
      const asset = await insertTestAsset(app);
      const dbAsset = await app.mongo.db
        .collection('assets')
        .findOne({ _id: new ObjectId(asset._id) });
      const token = dbAsset?.['publicToken'] as string;

      // Soft-delete asset
      await app.mongo.db
        .collection('assets')
        .updateOne(
          { _id: new ObjectId(asset._id) },
          { $set: { deletedAt: new Date().toISOString(), deletedBy: 'test' } },
        );

      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/scan/${token}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it('nevyzaduje autentifikaciu (bez cookie/Bearer)', async () => {
      await setPublicAssetLookup(true);
      const asset = await insertTestAsset(app);
      const dbAsset = await app.mongo.db
        .collection('assets')
        .findOne({ _id: new ObjectId(asset._id) });
      const token = dbAsset?.['publicToken'] as string;

      // Bez akychkolvek auth hlaviciek
      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/scan/${token}`,
        // ziadne headers.cookie, ziadny Authorization
      });
      expect(res.statusCode).toBe(200);
    });
  });
});

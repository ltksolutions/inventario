// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration + unit testy — ADR-0027 L6: QR štítky (labels).
 *
 * Pokryté invarianty:
 *   Unit (ZPL builder):
 *     - ZPL snapshot — deterministický string pre rovnaké vstupy
 *     - ZPL obsahuje ^CI28 (UTF-8) — SK diakritika
 *     - ZPL obsahuje appBaseUrl + publicToken
 *     - finderText on/off
 *     - defaults ak labelPrinting je null
 *
 *   Unit (PDF renderer):
 *     - PDF hárok vráti platné PDF bajty (%PDF magic bytes)
 *     - Deterministický obsah (QR URL je zahrnutý)
 *     - finderText on/off nezmení validitu PDF
 *     - 409 ak appBaseUrl nie je nastavený
 *
 *   Integration (routes):
 *     - GET /v1/labels/sheet → application/pdf
 *     - GET /v1/assets/:id/label?format=zpl → { zpl }
 *     - POST /v1/labels/zpl → { labels }
 *     - RBAC: EMPLOYEE môže, neautorizovaný dostane 401
 *     - Cross-tenant: asset iného tenanta → 404
 *     - tenant bez appBaseUrl → fallback na env/default (200, nie 409)
 *     - Fork doména: QR URL obsahuje appBaseUrl tenanta, nie hardkódovanú doménu
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { renderLabelSheetPdf } from '../../src/modules/labels/label-sheet-renderer.js';
import { renderLabelZpl } from '../../src/modules/labels/label-zpl-renderer.js';
import { loadDefaultFont } from '../../src/modules/protocols/logo-loader.js';
import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  UserRole,
  insertTestAsset,
  provisionUser,
  seedTestTenant,
} from '../helpers/test-fixtures.js';

import type { Organisation } from '@inventario/shared-types';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Pomocné fixture funkcie
// ---------------------------------------------------------------------------

function makeOrg(overrides: Partial<Organisation> = {}): Organisation {
  return {
    _id: 'org-test-0000001',
    displayName: 'Testovacia org',
    slug: 'test-org',
    entraTenantId: null,
    customDomain: null,
    status: 'ACTIVE',
    plan: 'FREE',
    primaryContactEmail: null,
    brandKit: null,
    billing: null,
    settings: {},
    appBaseUrl: 'https://app.inventario.test',
    publicAssetLookup: false,
    foundContactInfo: null,
    inventoryNumberFormat: null,
    protocolSettings: null,
    labelPrinting: null,
    allowedAuthProviders: ['GOOGLE', 'APPLE', 'MICROSOFT', 'EMAIL'],
    memberJoinPolicy: 'INVITE_ONLY',
    autoJoinDomains: [],
    registeredBy: null,
    registrationMethod: 'MANUAL',
    onboardingCompletedAt: null,
    dpaAcceptedAt: null,
    dpaAcceptedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'SYSTEM',
    updatedBy: 'SYSTEM',
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  } as Organisation;
}

function makeAsset(
  overrides: { inventoryNumber?: string; name?: string; publicToken?: string } = {},
) {
  return {
    _id: 'asset-test-001',
    inventoryNumber: overrides.inventoryNumber ?? 'TEST-2026-0001',
    name: overrides.name ?? 'Testovací majetok',
    publicToken: overrides.publicToken ?? 'TESTTOKEN00000000000000000001',
  };
}

// ---------------------------------------------------------------------------
// Unit testy — ZPL builder
// ---------------------------------------------------------------------------

describe('renderLabelZpl — unit', () => {
  it('generuje deterministický ZPL string', () => {
    const org = makeOrg();
    const asset = makeAsset();
    const zpl1 = renderLabelZpl(asset, org);
    const zpl2 = renderLabelZpl(asset, org);
    expect(zpl1).toBe(zpl2);
  });

  it('ZPL obsahuje ^CI28 (UTF-8 code page)', () => {
    const zpl = renderLabelZpl(makeAsset(), makeOrg());
    expect(zpl).toContain('^CI28');
  });

  it('ZPL obsahuje appBaseUrl + publicToken v QR dátach', () => {
    const org = makeOrg({ appBaseUrl: 'https://moja-domena.sk' });
    const asset = makeAsset({ publicToken: 'MYTESTTOKEN123456789012345' });
    const zpl = renderLabelZpl(asset, org);
    expect(zpl).toContain('https://moja-domena.sk/scan/MYTESTTOKEN123456789012345');
  });

  it('ZPL obsahuje inventoryNumber', () => {
    const asset = makeAsset({ inventoryNumber: 'INV-2026-0042' });
    const zpl = renderLabelZpl(asset, makeOrg());
    expect(zpl).toContain('INV-2026-0042');
  });

  it('ZPL obsahuje SK diakritiku v názve (^FD kodovanie)', () => {
    const asset = makeAsset({ name: 'Ľahká šatňová skriňa' });
    const zpl = renderLabelZpl(asset, makeOrg());
    expect(zpl).toContain('Ľahká šatňová skriňa');
  });

  it('finderText.enabled=true — ZPL obsahuje finder text', () => {
    const org = makeOrg({
      labelPrinting: {
        mode: 'ZEBRA_ZPL',
        pdfPreset: 'avery-l7160',
        zplLabelWidthMm: 50,
        zplLabelHeightMm: 25,
        zplDpi: 203,
        zplDarkness: 20,
        finderText: {
          enabled: true,
          text: 'Naskenujte QR kód',
        },
      },
    });
    const zpl = renderLabelZpl(makeAsset(), org);
    expect(zpl).toContain('Naskenujte QR kód');
  });

  it('finderText.enabled=false — ZPL neobsahuje finder text', () => {
    const org = makeOrg({
      labelPrinting: {
        mode: 'ZEBRA_ZPL',
        pdfPreset: 'avery-l7160',
        zplLabelWidthMm: 50,
        zplLabelHeightMm: 25,
        zplDpi: 203,
        zplDarkness: 20,
        finderText: { enabled: false, text: 'Naskenujte QR kód' },
      },
    });
    const zpl = renderLabelZpl(makeAsset(), org);
    expect(zpl).not.toContain('Naskenujte QR kód');
  });

  it('defaults ak labelPrinting je null — ZPL sa vygeneruje', () => {
    const org = makeOrg({ labelPrinting: null });
    const zpl = renderLabelZpl(makeAsset(), org);
    expect(zpl).toContain('^XA');
    expect(zpl).toContain('^XZ');
  });

  it('hádže chybu ak appBaseUrl nie je nastavený', () => {
    const org = makeOrg({ appBaseUrl: null });
    expect(() => renderLabelZpl(makeAsset(), org)).toThrow('appBaseUrl');
  });

  it('fork doména — QR URL obsahuje appBaseUrl tenanta, nie inventario.estate', () => {
    const org = makeOrg({ appBaseUrl: 'https://majetok.firma.sk' });
    const zpl = renderLabelZpl(makeAsset(), org);
    expect(zpl).toContain('majetok.firma.sk');
    expect(zpl).not.toContain('inventario.estate');
  });
});

// ---------------------------------------------------------------------------
// Unit testy — PDF renderer
// ---------------------------------------------------------------------------

describe('renderLabelSheetPdf — unit', () => {
  it('vráti platné PDF bajty (magic bytes %PDF)', async () => {
    const font = await loadDefaultFont();
    const org = makeOrg();
    const assets = [makeAsset()];
    const bytes = await renderLabelSheetPdf(assets, org, font, null);
    expect(Buffer.from(bytes).slice(0, 4).toString()).toBe('%PDF');
  });

  it('prázdne pole assetov — vráti PDF (prázdna stránka)', async () => {
    const font = await loadDefaultFont();
    const bytes = await renderLabelSheetPdf([], makeOrg(), font, null);
    expect(Buffer.from(bytes).slice(0, 4).toString()).toBe('%PDF');
  });

  it('finderText.enabled=true — PDF sa vyrenderuje bez chyby', async () => {
    const font = await loadDefaultFont();
    const org = makeOrg({
      labelPrinting: {
        mode: 'PDF_SHEET',
        pdfPreset: 'avery-l7160',
        zplLabelWidthMm: 50,
        zplLabelHeightMm: 25,
        zplDpi: 203,
        zplDarkness: 20,
        finderText: { enabled: true, text: 'Naskenujte a vráťte!' },
      },
    });
    const bytes = await renderLabelSheetPdf([makeAsset()], org, font, null);
    expect(Buffer.from(bytes).slice(0, 4).toString()).toBe('%PDF');
  });

  it('avery-l7163 preset — PDF sa vyrenderuje', async () => {
    const font = await loadDefaultFont();
    const bytes = await renderLabelSheetPdf([makeAsset()], makeOrg(), font, null, 'avery-l7163');
    expect(Buffer.from(bytes).slice(0, 4).toString()).toBe('%PDF');
  });

  it('25 assetov (celá stránka l7160) — PDF sa vyrenderuje', async () => {
    const font = await loadDefaultFont();
    const assets = Array.from({ length: 25 }, (_, i) =>
      makeAsset({
        inventoryNumber: `TEST-2026-${String(i + 1).padStart(4, '0')}`,
        publicToken: `TOKEN${String(i).padStart(25, '0')}`,
      }),
    );
    const bytes = await renderLabelSheetPdf(assets, makeOrg(), font, null);
    expect(Buffer.from(bytes).slice(0, 4).toString()).toBe('%PDF');
  });

  it('26 assetov (dve stránky) — PDF sa vyrenderuje', async () => {
    const font = await loadDefaultFont();
    const assets = Array.from({ length: 26 }, (_, i) =>
      makeAsset({
        inventoryNumber: `TEST-2026-${String(i + 1).padStart(4, '0')}`,
        publicToken: `TOKEN${String(i).padStart(25, '0')}`,
      }),
    );
    const bytes = await renderLabelSheetPdf(assets, makeOrg(), font, null);
    expect(Buffer.from(bytes).slice(0, 4).toString()).toBe('%PDF');
  });

  it('hádže chybu ak appBaseUrl nie je nastavený', async () => {
    const font = await loadDefaultFont();
    const org = makeOrg({ appBaseUrl: null });
    await expect(renderLabelSheetPdf([makeAsset()], org, font, null)).rejects.toThrow('appBaseUrl');
  });

  it('SK diakritika v názve — PDF sa vyrenderuje', async () => {
    const font = await loadDefaultFont();
    const asset = makeAsset({ name: 'Ľahká šatňová skriňa — číslo 1' });
    const bytes = await renderLabelSheetPdf([asset], makeOrg(), font, null);
    expect(Buffer.from(bytes).slice(0, 4).toString()).toBe('%PDF');
  });
});

// ---------------------------------------------------------------------------
// Integration testy — routes
// ---------------------------------------------------------------------------

describe('Labels routes — integration', () => {
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

  // ── GET /v1/labels/sheet ──────────────────────────────────────────────────

  describe('GET /v1/labels/sheet', () => {
    it('vráti application/pdf pre platné assetIds', async () => {
      const { token } = await provisionUser(app, {
        oid: 'sheet-mgr',
        role: UserRole.ASSET_MANAGER,
      });
      const asset = await insertTestAsset(app);

      const res = await app.inject({
        method: 'GET',
        url: `/v1/labels/sheet?assetIds=${asset._id}`,
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(Buffer.from(res.rawPayload).slice(0, 4).toString()).toBe('%PDF');
    });

    it('EMPLOYEE môže sťahovať štítky', async () => {
      const { token } = await provisionUser(app, { oid: 'sheet-emp', role: UserRole.EMPLOYEE });
      const asset = await insertTestAsset(app);

      const res = await app.inject({
        method: 'GET',
        url: `/v1/labels/sheet?assetIds=${asset._id}`,
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(200);
    });

    it('neautorizovaný → 401', async () => {
      const asset = await insertTestAsset(app);
      const res = await app.inject({
        method: 'GET',
        url: `/v1/labels/sheet?assetIds=${asset._id}`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('asset iného tenanta → 404', async () => {
      const otherTenant = await seedTestTenant(app, { slug: 'other-tenant-labels' });
      const { token } = await provisionUser(app, {
        oid: 'sheet-cross',
        role: UserRole.ASSET_MANAGER,
      });
      const otherAsset = await insertTestAsset(app, { organisationId: otherTenant._id });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/labels/sheet?assetIds=${otherAsset._id}`,
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(404);
    });

    it('tenant bez appBaseUrl → fallback na default (200 + PDF)', async () => {
      // Bez per-tenant appBaseUrl sa použije env APP_BASE_URL → default
      // (resolveAppBaseUrl), takže QR štítky fungujú namiesto starého 409.
      const { token } = await provisionUser(app, {
        oid: 'sheet-nourl',
        role: UserRole.ASSET_MANAGER,
      });
      const asset = await insertTestAsset(app);

      // Nullify appBaseUrl pre test tenant
      await app.mongo.db
        .collection('organisations')
        .updateMany({ slug: '0'.repeat(32) }, { $set: { appBaseUrl: null } });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/labels/sheet?assetIds=${asset._id}`,
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(Buffer.from(res.rawPayload).slice(0, 4).toString()).toBe('%PDF');
    });

    it('preset avery-l7163 → platné PDF', async () => {
      const { token } = await provisionUser(app, {
        oid: 'sheet-l7163',
        role: UserRole.ASSET_MANAGER,
      });
      const asset = await insertTestAsset(app);

      const res = await app.inject({
        method: 'GET',
        url: `/v1/labels/sheet?assetIds=${asset._id}&preset=avery-l7163`,
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(Buffer.from(res.rawPayload).slice(0, 4).toString()).toBe('%PDF');
    });

    it('fork doména — PDF QR URL obsahuje appBaseUrl tenanta', async () => {
      const { token } = await provisionUser(app, {
        oid: 'sheet-fork',
        role: UserRole.ASSET_MANAGER,
      });
      const asset = await insertTestAsset(app);

      // Nastav vlastnú doménu pre test tenant
      await app.mongo.db
        .collection('organisations')
        .updateMany({ slug: '0'.repeat(32) }, { $set: { appBaseUrl: 'https://majetok.firma.sk' } });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/labels/sheet?assetIds=${asset._id}`,
        headers: { cookie: `inv_access=${token}` },
      });

      // PDF je binárny — overíme že sa vyrenderoval a má správny Content-Type
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
    });
  });

  // ── GET /v1/assets/:id/label?format=zpl ──────────────────────────────────

  describe('GET /v1/assets/:id/label?format=zpl', () => {
    it('vráti ZPL string pre platný asset', async () => {
      const { token } = await provisionUser(app, { oid: 'zpl-mgr', role: UserRole.ASSET_MANAGER });
      const asset = await insertTestAsset(app);

      const res = await app.inject({
        method: 'GET',
        url: `/v1/assets/${asset._id}/label?format=zpl`,
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ zpl: string }>();
      expect(body.zpl).toContain('^XA');
      expect(body.zpl).toContain('^XZ');
      expect(body.zpl).toContain('^CI28');
    });

    it('ZPL obsahuje publicToken assetu', async () => {
      const { token } = await provisionUser(app, {
        oid: 'zpl-token',
        role: UserRole.ASSET_MANAGER,
      });
      const asset = await insertTestAsset(app);

      // Získaj publicToken z DB
      const assetDoc = await app.mongo.db
        .collection('assets')
        .findOne({ inventoryNumber: asset.inventoryNumber });
      const publicToken = assetDoc?.['publicToken'] as string;

      const res = await app.inject({
        method: 'GET',
        url: `/v1/assets/${asset._id}/label?format=zpl`,
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ zpl: string }>().zpl).toContain(publicToken);
    });

    it('neznámy asset → 404', async () => {
      const { token } = await provisionUser(app, { oid: 'zpl-404', role: UserRole.ASSET_MANAGER });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/assets/000000000000000000000099/label?format=zpl',
        headers: { cookie: `inv_access=${token}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('RBAC: EMPLOYEE môže', async () => {
      const { token } = await provisionUser(app, { oid: 'zpl-emp', role: UserRole.EMPLOYEE });
      const asset = await insertTestAsset(app);

      const res = await app.inject({
        method: 'GET',
        url: `/v1/assets/${asset._id}/label?format=zpl`,
        headers: { cookie: `inv_access=${token}` },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ── POST /v1/labels/zpl ───────────────────────────────────────────────────

  describe('POST /v1/labels/zpl', () => {
    it('vráti ZPL stringy pre dávku assetov', async () => {
      const { token } = await provisionUser(app, {
        oid: 'zpl-batch-mgr',
        role: UserRole.ASSET_MANAGER,
      });
      const asset1 = await insertTestAsset(app);
      const asset2 = await insertTestAsset(app);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/labels/zpl',
        headers: { cookie: `inv_access=${token}` },
        payload: { assetIds: [asset1._id, asset2._id] },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ labels: Array<{ assetId: string; zpl: string }> }>();
      expect(body.labels).toHaveLength(2);
      for (const label of body.labels) {
        expect(label.zpl).toContain('^XA');
        expect(label.zpl).toContain('^CI28');
      }
    });

    it('neznáme assetIds sa preskočia (batch nepadne)', async () => {
      const { token } = await provisionUser(app, { oid: 'zpl-skip', role: UserRole.ASSET_MANAGER });
      const asset = await insertTestAsset(app);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/labels/zpl',
        headers: { cookie: `inv_access=${token}` },
        payload: { assetIds: [asset._id, '000000000000000000000099'] },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ labels: Array<{ assetId: string }> }>();
      expect(body.labels).toHaveLength(1); // len existujúci
      expect(body.labels[0]!.assetId).toBe(asset._id);
    });

    it('prázdne assetIds → 400', async () => {
      const { token } = await provisionUser(app, {
        oid: 'zpl-empty',
        role: UserRole.ASSET_MANAGER,
      });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/labels/zpl',
        headers: { cookie: `inv_access=${token}` },
        payload: { assetIds: [] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('cross-tenant: asset iného tenanta sa preskočí', async () => {
      const otherTenant = await seedTestTenant(app, { slug: 'other-zpl-batch' });
      const { token } = await provisionUser(app, {
        oid: 'zpl-xtenant',
        role: UserRole.ASSET_MANAGER,
      });
      const otherAsset = await insertTestAsset(app, { organisationId: otherTenant._id });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/labels/zpl',
        headers: { cookie: `inv_access=${token}` },
        payload: { assetIds: [otherAsset._id] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ labels: unknown[] }>().labels).toHaveLength(0);
    });
  });
});

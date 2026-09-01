// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integračné testy pre branding PATCH /v1/organisations/current (ADR-0028 v2).
 *
 * v2 zmeny oproti v1:
 *   - Preset, font aj logo sú dostupné VŠETKÝM plánom (žiadny Pro+ gating).
 *   - Farby sa nastavujú cez `presetId` (UI skratka) → backend naplní hex.
 *   - `fontFamilySans` je enum ID ('system-ui'|'Inter'|'Open Sans'|'Roboto'|'Lato').
 *
 * Pokrýva:
 *   - logoUrl (happy path, všetky plány)
 *   - presetId → expanzia na hex polia (primary/primaryFg/accent/accentFg/logoDot)
 *   - neznámy presetId → 400
 *   - fontFamilySans enum: platná hodnota OK, neplatná → 400 (Zod)
 *   - WCAG poistka: priame hex pod 4.5:1 → 400
 *   - SVG logo → 400
 *   - brandKit: null vynuluje celý brand kit
 *   - FREE plán smie preset/font/logo (žiadny gating)
 *   - Audit log ORGANISATION_BRANDING_UPDATED
 */

import { getBrandPreset } from '@inventario/shared-types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { provisionUser, UserRole } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('PATCH /v1/organisations/current — branding (ADR-0028 v2)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let orgId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);

    const { token } = await provisionUser(app, { oid: 'branding-admin', role: UserRole.ADMIN });
    adminToken = token;

    const meRes = await app.inject({
      method: 'GET',
      url: '/v1/organisations/current',
      headers: { cookie: `inv_access=${adminToken}` },
    });
    orgId = meRes.json<{ _id: string }>()._id;
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  async function setOrgPlan(plan: 'FREE' | 'PRO' | 'ENTERPRISE'): Promise<void> {
    await app.mongo.db
      .collection('organisations')
      .updateOne({ _id: new (await import('mongodb')).ObjectId(orgId) }, { $set: { plan } });
  }

  // -------------------------------------------------------------------------
  // Logo URL (všetky plány)
  // -------------------------------------------------------------------------

  describe('logoUrl', () => {
    it('smie nastaviť logoUrl (PNG URL)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: { logoUrl: 'https://firma.sk/logo.png' } },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<{ brandKit: { logoUrl: string } }>().brandKit?.logoUrl).toBe(
        'https://firma.sk/logo.png',
      );
    });

    it('smie nastaviť brandKit: null (vynuluje branding)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: null },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<{ brandKit: unknown }>().brandKit).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Preset expanzia (ADR-0028 v2 — rozhodnutie B)
  // -------------------------------------------------------------------------

  describe('presetId → hex expanzia', () => {
    it('presetId naplní primary/primaryFg/accent/accentFg/logoDot z palety', async () => {
      const preset = getBrandPreset('royal-blue');
      expect(preset).toBeDefined();

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: { presetId: 'royal-blue' } },
      });
      expect(res.statusCode, res.body).toBe(200);

      const bk = res.json<{
        brandKit: {
          presetId: string;
          primary: string;
          primaryFg: string;
          accent: string;
          accentFg: string;
          logoDot: string;
        };
      }>().brandKit;

      expect(bk?.presetId).toBe('royal-blue');
      expect(bk?.primary).toBe(preset!.primary);
      expect(bk?.primaryFg).toBe(preset!.primaryFg);
      expect(bk?.accent).toBe(preset!.accent);
      expect(bk?.accentFg).toBe(preset!.accentFg);
      expect(bk?.logoDot).toBe(preset!.logoDot);
    });

    it('default preset inventario-navy funguje', async () => {
      const preset = getBrandPreset('inventario-navy');
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: { presetId: 'inventario-navy' } },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<{ brandKit: { primary: string } }>().brandKit?.primary).toBe(preset!.primary);
    });

    it('neznámy presetId → 400', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: { presetId: 'neexistuje-xyz' } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toContain('preset');
    });

    it('FREE plán tiež smie preset (žiadny Pro+ gating v2)', async () => {
      await setOrgPlan('FREE');
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: { presetId: 'forest-green' } },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<{ brandKit: { presetId: string } }>().brandKit?.presetId).toBe(
        'forest-green',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Font enum (ADR-0028 v2)
  // -------------------------------------------------------------------------

  describe('fontFamilySans enum', () => {
    it('smie nastaviť platnú enum hodnotu (Open Sans)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: { fontFamilySans: 'Open Sans' } },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<{ brandKit: { fontFamilySans: string } }>().brandKit?.fontFamilySans).toBe(
        'Open Sans',
      );
    });

    it('smie nastaviť system-ui', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: { fontFamilySans: 'system-ui' } },
      });
      expect(res.statusCode, res.body).toBe(200);
    });

    it('odmietne neplatnú font hodnotu (voľný string) → 400', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: { fontFamilySans: 'Comic Sans MS' } },
      });
      expect(res.statusCode).toBe(400);
    });

    it('FREE plán tiež smie font (žiadny gating v2)', async () => {
      await setOrgPlan('FREE');
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: { fontFamilySans: 'Inter' } },
      });
      expect(res.statusCode, res.body).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // SVG logo validácia (všetky plány)
  // -------------------------------------------------------------------------

  describe('SVG logo validácia', () => {
    it('odmietne .svg URL s 400', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: { logoUrl: 'https://firma.sk/logo.svg' } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toContain('SVG');
    });

    it('odmietne .svg? URL s query parametrom s 400', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: { logoUrl: 'https://cdn.example.com/logo.svg?v=2' } },
      });
      expect(res.statusCode).toBe(400);
    });

    it('akceptuje .png URL', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: { logoUrl: 'https://firma.sk/logo.png' } },
      });
      expect(res.statusCode, res.body).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // WCAG poistka (priame hex cez API, mimo presetu)
  // -------------------------------------------------------------------------

  describe('WCAG poistka (priame hex)', () => {
    it('odmietne primary + primaryFg s kontrastom pod 4.5:1 → 400', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          brandKit: {
            primary: '#ffd700', // žltá na bielej ~1.28:1
            primaryFg: '#ffffff',
          },
        },
      });
      expect(res.statusCode).toBe(400);
      const msg = res.json<{ message: string }>().message;
      expect(msg).toContain('4.5');
      expect(msg).toContain('primárnej');
    });

    it('odmietne accent + accentFg s kontrastom pod 4.5:1 → 400', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          brandKit: {
            accent: '#aaaaaa', // sivá na bielej ~2.3:1
            accentFg: '#ffffff',
          },
        },
      });
      expect(res.statusCode).toBe(400);
      const msg = res.json<{ message: string }>().message;
      expect(msg).toContain('4.5');
      expect(msg).toContain('akcentovej');
    });

    it('akceptuje primary bez primaryFg (nekontroluje kontrast pri jednom poli)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: { primary: '#ffd700' } },
      });
      expect(res.statusCode, res.body).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Audit log
  // -------------------------------------------------------------------------

  describe('Audit log', () => {
    it('zaznamená ORGANISATION_BRANDING_UPDATED pri branding-only patchi', async () => {
      await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: { logoUrl: 'https://firma.sk/logo.png' } },
      });

      const auditEntry = await app.mongo.db
        .collection('audit_logs')
        .findOne({ action: 'ORGANISATION_BRANDING_UPDATED' });

      expect(auditEntry).not.toBeNull();
      expect(auditEntry?.action).toBe('ORGANISATION_BRANDING_UPDATED');
    });

    it('zaznamená ORGANISATION_UPDATED pri kombinovanom patchi (brandKit + displayName)', async () => {
      await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          displayName: 'Nový názov',
          brandKit: { logoUrl: 'https://firma.sk/logo.png' },
        },
      });

      const auditEntry = await app.mongo.db
        .collection('audit_logs')
        .findOne({ action: 'ORGANISATION_UPDATED' });

      expect(auditEntry).not.toBeNull();
    });
  });
});

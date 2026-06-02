// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integračné testy pre branding PATCH /v1/organisations/current (ADR-0028).
 *
 * Pokrýva:
 *   - FREE tenant smie nastaviť logoUrl (happy path)
 *   - FREE tenant dostane 403 pri pokuse o farby / font
 *   - Pro tenant smie nastaviť farby + font (happy path)
 *   - WCAG kontrast pod 4.5:1 → 400 (primary+primaryFg, accent+accentFg)
 *   - SVG logo → 400
 *   - logoDot sa uloží a vráti
 *   - brandKit: null vynuluje celý brand kit
 *   - Audit log zaznamená ORGANISATION_BRANDING_UPDATED
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { provisionUser, UserRole } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('PATCH /v1/organisations/current — branding (ADR-0028)', () => {
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

    // Resolve test tenant _id
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

  // -------------------------------------------------------------------------
  // Helper: elevate test tenant plan directly in DB (bypass API — plan je
  // platform-operator concern, nie tenant self-service)
  // -------------------------------------------------------------------------

  async function setOrgPlan(plan: 'FREE' | 'PRO' | 'ENTERPRISE'): Promise<void> {
    await app.mongo.db
      .collection('organisations')
      .updateOne({ _id: new (await import('mongodb')).ObjectId(orgId) }, { $set: { plan } });
  }

  // -------------------------------------------------------------------------
  // FREE plán — len logo povolené
  // -------------------------------------------------------------------------

  describe('FREE plán', () => {
    it('smie nastaviť logoUrl (PNG URL)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          brandKit: {
            logoUrl: 'https://sfz.sk/logo.png',
          },
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json<{ brandKit: { logoUrl: string } }>();
      expect(body.brandKit?.logoUrl).toBe('https://sfz.sk/logo.png');
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

    it('dostane 403 pri pokuse o primary farbu', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          brandKit: {
            primary: '#003d7a',
            primaryFg: '#ffffff',
          },
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json<{ message: string }>().message).toContain('Pro');
    });

    it('dostane 403 pri pokuse o accent farbu', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          brandKit: {
            accent: '#ffd700',
            accentFg: '#1a2d47',
          },
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('dostane 403 pri pokuse o fontFamilySans', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          brandKit: {
            fontFamilySans: "'Open Sans', system-ui, sans-serif",
          },
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('dostane 403 pri pokuse o logoDot', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          brandKit: {
            logoDot: '#ffd700',
          },
        },
      });
      expect(res.statusCode).toBe(403);
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
        payload: {
          brandKit: {
            logoUrl: 'https://sfz.sk/logo.svg',
          },
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toContain('SVG');
    });

    it('odmietne .svg? URL s query parametrom s 400', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          brandKit: {
            logoUrl: 'https://cdn.example.com/logo.svg?v=2',
          },
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('akceptuje .png URL', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: { logoUrl: 'https://sfz.sk/logo.png' } },
      });
      expect(res.statusCode, res.body).toBe(200);
    });

    it('akceptuje .jpg URL', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: { logoUrl: 'https://sfz.sk/logo.jpg' } },
      });
      expect(res.statusCode, res.body).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Pro plán — farby + font povolené
  // -------------------------------------------------------------------------

  describe('Pro plán', () => {
    beforeEach(async () => {
      await setOrgPlan('PRO');
    });

    it('smie nastaviť primary + primaryFg s dostatočným kontrastom', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          brandKit: {
            primary: '#003d7a', // navy — tmavá
            primaryFg: '#ffffff', // biela — kontrast ~13.3:1 ✓
          },
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      const bk = res.json<{ brandKit: { primary: string; primaryFg: string } }>().brandKit;
      expect(bk?.primary).toBe('#003d7a');
      expect(bk?.primaryFg).toBe('#ffffff');
    });

    it('smie nastaviť accent + accentFg s dostatočným kontrastom', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          brandKit: {
            accent: '#1a2d47', // navy — tmavá
            accentFg: '#ffffff', // biela — kontrast ~13.9:1 ✓
          },
        },
      });
      expect(res.statusCode, res.body).toBe(200);
    });

    it('smie nastaviť fontFamilySans', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          brandKit: {
            fontFamilySans: "'Open Sans', system-ui, sans-serif",
          },
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<{ brandKit: { fontFamilySans: string } }>().brandKit?.fontFamilySans).toBe(
        "'Open Sans', system-ui, sans-serif",
      );
    });

    it('smie nastaviť logoDot', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          brandKit: {
            logoDot: '#ffd700',
          },
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<{ brandKit: { logoDot: string } }>().brandKit?.logoDot).toBe('#ffd700');
    });

    it('happy path — celý brand kit naraz', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          brandKit: {
            logoUrl: 'https://sfz.sk/logo.png',
            primary: '#003d7a',
            primaryFg: '#ffffff',
            accent: '#1a2d47',
            accentFg: '#ffffff',
            logoDot: '#003d7a',
            fontFamilySans: "'Open Sans', system-ui, sans-serif",
          },
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      const bk = res.json<{
        brandKit: {
          logoUrl: string;
          primary: string;
          primaryFg: string;
          accent: string;
          accentFg: string;
          logoDot: string;
          fontFamilySans: string;
        };
      }>().brandKit;
      expect(bk?.logoUrl).toBe('https://sfz.sk/logo.png');
      expect(bk?.primary).toBe('#003d7a');
      expect(bk?.logoDot).toBe('#003d7a');
      expect(bk?.fontFamilySans).toBe("'Open Sans', system-ui, sans-serif");
    });

    // WCAG kontrast odmietnutia

    it('odmietne primary + primaryFg s kontrastom pod 4.5:1 → 400', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          brandKit: {
            // svetlá žltá na bielej — kontrast ~1.28:1
            primary: '#ffd700',
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
            // sivá na bielej — kontrast ~2.3:1
            accent: '#aaaaaa',
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
      // Ak je zadaný len primary bez primaryFg, nevieme spočítať kontrast →
      // validácia sa preskočí, PATCH uspeje.
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { brandKit: { primary: '#ffd700' } },
      });
      expect(res.statusCode, res.body).toBe(200);
    });

    it('ENTERPRISE plán tiež smie farby', async () => {
      await setOrgPlan('ENTERPRISE');
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          brandKit: {
            primary: '#003d7a',
            primaryFg: '#ffffff',
          },
        },
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
        payload: { brandKit: { logoUrl: 'https://sfz.sk/logo.png' } },
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
          brandKit: { logoUrl: 'https://sfz.sk/logo.png' },
        },
      });

      const auditEntry = await app.mongo.db
        .collection('audit_logs')
        .findOne({ action: 'ORGANISATION_UPDATED' });

      expect(auditEntry).not.toBeNull();
    });
  });
});

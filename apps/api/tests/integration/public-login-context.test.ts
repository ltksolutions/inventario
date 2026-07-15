// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests pre GET /v1/public/organisations/login-context (ADR-0035 F1).
 *
 * Bez autentifikacie. Testuje:
 * - happy path cez ?slug=
 * - happy path cez ?domain=
 * - 400 ak sú zadané oba parametre alebo žiadny
 * - 404 pre neexistujúci slug/domain (no oracle)
 * - 404 pre soft-deleted organizáciu
 * - whitelist: response neobsahuje citlivé polia (entraTenantId samotný)
 * - allowedAuthProviders presne odráža nastavenie organizácie
 */

import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { resolveTestTenantId } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('GET /v1/public/organisations/login-context', () => {
  let app: FastifyInstance;
  let tenantId: string;
  let tenantSlug: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
    tenantId = await resolveTestTenantId(app);
    const org = await app.mongo.db
      .collection('organisations')
      .findOne({ _id: new ObjectId(tenantId) });
    tenantSlug = org?.['slug'] as string;
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  describe('happy path', () => {
    it('vráti login-context podľa ?slug=', async () => {
      await app.mongo.db
        .collection('organisations')
        .updateOne(
          { _id: new ObjectId(tenantId) },
          { $set: { allowedAuthProviders: ['MICROSOFT'], entraTenantId: null } },
        );

      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/organisations/login-context?slug=${tenantSlug}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();
      expect(body['allowedAuthProviders']).toEqual(['MICROSOFT']);
      expect(typeof body['displayName']).toBe('string');
      expect(body['hasEntraRestriction']).toBe(false);
    });

    it('vráti login-context podľa ?domain=', async () => {
      const customDomain = 'majetok.example-test.sk';
      await app.mongo.db
        .collection('organisations')
        .updateOne({ _id: new ObjectId(tenantId) }, { $set: { customDomain } });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/organisations/login-context?domain=${customDomain}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();
      expect(typeof body['displayName']).toBe('string');
    });

    it('hasEntraRestriction je true ak má organizácia nastavený entraTenantId', async () => {
      await app.mongo.db
        .collection('organisations')
        .updateOne(
          { _id: new ObjectId(tenantId) },
          { $set: { entraTenantId: '11111111-1111-4111-8111-111111111111' } },
        );

      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/organisations/login-context?slug=${tenantSlug}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();
      expect(body['hasEntraRestriction']).toBe(true);
    });

    it('vráti brandColors null ak organizácia nemá brandKit', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/organisations/login-context?slug=${tenantSlug}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();
      expect(body['brandColors']).toBeNull();
      expect(body['logoUrl']).toBeNull();
    });

    it('vráti brandColors a logoUrl ak organizácia má brandKit', async () => {
      await app.mongo.db.collection('organisations').updateOne(
        { _id: new ObjectId(tenantId) },
        {
          $set: {
            brandKit: {
              presetId: null,
              logoUrl: 'https://example.com/logo.png',
              faviconUrl: null,
              primary: '#003d7a',
              primaryFg: '#ffffff',
              accent: '#ffd700',
              accentFg: '#1a2d47',
              logoDot: null,
              fontFamilySans: null,
            },
          },
        },
      );

      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/organisations/login-context?slug=${tenantSlug}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        logoUrl: string | null;
        brandColors: Record<string, string | null> | null;
      }>();
      expect(body.logoUrl).toBe('https://example.com/logo.png');
      expect(body.brandColors).toEqual({
        primary: '#003d7a',
        primaryFg: '#ffffff',
        accent: '#ffd700',
        accentFg: '#1a2d47',
      });
    });
  });

  describe('validácia a privacy', () => {
    it('vráti 400 ak nie je zadaný ani slug ani domain', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/public/organisations/login-context',
      });
      expect(res.statusCode).toBe(400);
    });

    it('vráti 400 ak sú zadané oba parametre naraz', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/organisations/login-context?slug=${tenantSlug}&domain=foo.sk`,
      });
      expect(res.statusCode).toBe(400);
    });

    it('vráti 404 pre neexistujúci slug (no oracle)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/public/organisations/login-context?slug=neexistujuca-organizacia-xxx',
      });
      expect(res.statusCode).toBe(404);
    });

    it('vráti 404 pre neexistujúcu doménu (no oracle)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/public/organisations/login-context?domain=neexistuje.example.sk',
      });
      expect(res.statusCode).toBe(404);
    });

    it('vráti 404 pre soft-deleted organizáciu', async () => {
      await app.mongo.db
        .collection('organisations')
        .updateOne(
          { _id: new ObjectId(tenantId) },
          { $set: { deletedAt: new Date().toISOString(), deletedBy: 'test' } },
        );

      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/organisations/login-context?slug=${tenantSlug}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it('whitelist: response neobsahuje entraTenantId ani interné ID', async () => {
      await app.mongo.db
        .collection('organisations')
        .updateOne(
          { _id: new ObjectId(tenantId) },
          { $set: { entraTenantId: '11111111-1111-4111-8111-111111111111' } },
        );

      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/organisations/login-context?slug=${tenantSlug}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();
      const forbidden = ['_id', 'entraTenantId', 'customDomain', 'oauthCredentials', 'settings'];
      for (const field of forbidden) {
        expect(body).not.toHaveProperty(field);
      }
      const keys = Object.keys(body).sort();
      expect(keys).toEqual(
        [
          'slug',
          'displayName',
          'logoUrl',
          'brandColors',
          'allowedAuthProviders',
          'hasEntraRestriction',
        ]
          .slice()
          .sort(),
      );
    });

    it('vracia slug organizácie (ADR-0035 F6, potrebné pre OAuth ?org= hint na /tenant-login)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/organisations/login-context?slug=${tenantSlug}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ slug: string }>().slug).toBe(tenantSlug);
    });

    it('nevyžaduje autentifikáciu (bez cookie/Bearer)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/organisations/login-context?slug=${tenantSlug}`,
      });
      expect(res.statusCode).toBe(200);
    });
  });
});

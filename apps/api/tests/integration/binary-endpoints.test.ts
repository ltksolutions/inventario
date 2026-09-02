// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integračné testy pre servírovanie binárok z Monga (ADR-0037, fáza 1).
 *
 * Dva endpointy s ZÁMERNE opačnou politikou:
 *
 *   GET /v1/attachments/:id/thumbnail    autentifikované, `private, no-cache`
 *   GET /v1/public/organisations/:slug/logo   verejné, `public, s-maxage`
 *
 * Rozdiel nie je kozmetický. Logo je CDN-cachované, takže chyba v tenant
 * scope by bola cachovaná chyba — logo jedného tenanta pod slugom iného,
 * a jeden deploy by to nezmazal. Preto tu testujeme aj to, čo endpoint
 * NEVRACIA.
 *
 * Autentifikácia ide cookie-ou `inv_access` (ADR-0012), nie `Authorization`
 * hlavičkou — `requireAuth` číta výlučne cookie.
 *
 * Ani jeden nemá response schému: `fastify-type-provider-zod` používa
 * response schému aj ako runtime serializér a z Bufferu by spravil JSON.
 * Testy na Content-Type a magic bytes strážia práve to.
 */

import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { UserRole, provisionUser, resolveTestTenantId } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

/** Minimálny platný JPEG header — stačí na kontrolu, že telo je binárka. */
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let app: FastifyInstance;
let employeeToken: string;
let tenantId: string;
let attachmentId: string;
let updatedAt: string;
/**
 * Slug DEFAULTNÉHO testovacieho tenanta. Zámerne nesedíme vlastného:
 * token z `provisionUser` patrí práve tomuto tenantovi a príloha musí byť
 * v tom istom, inak by test meral tenant scope namiesto endpointu.
 */
let tenantSlug: string;

function storedImage(data: Buffer, mimeType: string): Record<string, unknown> {
  return { data, mimeType, width: 800, height: 600, sizeBytes: data.byteLength };
}

describe('binárne endpointy — náhľad prílohy a logo organizácie', () => {
  beforeAll(async () => {
    app = await buildTestApp();
    await cleanTestDatabase(app);

    tenantId = await resolveTestTenantId(app);
    const tenantDoc = await app.mongo.db
      .collection('organisations')
      .findOne({ _id: new ObjectId(tenantId) });
    tenantSlug = String(tenantDoc?.['slug']);

    employeeToken = (await provisionUser(app, { oid: 'bin-emp', role: UserRole.EMPLOYEE })).token;

    updatedAt = new Date().toISOString();
    const inserted = await app.mongo.db.collection('attachments').insertOne({
      organisationId: tenantId,
      originalFilename: 'foto.jpg',
      storageKey: 'https://example.invalid/foto.jpg',
      storagePathname: null,
      storageAccess: 'PUBLIC_LEGACY',
      thumbnail: storedImage(JPEG_BYTES, 'image/jpeg'),
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
      sha256: 'a'.repeat(64),
      attachmentType: 'ASSET_PHOTO',
      linkedTo: { entityType: 'Asset', entityId: new ObjectId().toHexString() },
      caption: null,
      imageDimensions: null,
      isPublic: false,
      isPrimary: false,
      createdAt: updatedAt,
      updatedAt,
      createdBy: 'SYSTEM',
      updatedBy: 'SYSTEM',
      deletedAt: null,
      deletedBy: null,
    });
    attachmentId = inserted.insertedId.toHexString();
  });

  afterAll(async () => {
    await app.close();
  });

  // --- náhľad prílohy ------------------------------------------------------

  describe('GET /v1/attachments/:id/thumbnail', () => {
    it('bez tokenu → 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/attachments/${attachmentId}/thumbnail`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('vráti JPEG bajty, nie JSON', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/attachments/${attachmentId}/thumbnail`,
        headers: { cookie: `inv_access=${employeeToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('image/jpeg');
      expect(res.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      expect(res.rawPayload).toEqual(JPEG_BYTES);
    });

    it('nikdy nesmie byť CDN-cachovaný — je za autentifikáciou', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/attachments/${attachmentId}/thumbnail`,
        headers: { cookie: `inv_access=${employeeToken}` },
      });

      expect(res.headers['cache-control']).toBe('private, no-cache');
      expect(res.headers['cache-control']).not.toContain('s-maxage');
    });

    it('If-None-Match s platným ETagom → 304 a prázdne telo', async () => {
      const first = await app.inject({
        method: 'GET',
        url: `/v1/attachments/${attachmentId}/thumbnail`,
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      const etag = first.headers['etag'] as string;
      expect(etag).toBeTruthy();

      const second = await app.inject({
        method: 'GET',
        url: `/v1/attachments/${attachmentId}/thumbnail`,
        headers: { cookie: `inv_access=${employeeToken}`, 'if-none-match': etag },
      });

      expect(second.statusCode).toBe(304);
      expect(second.rawPayload.byteLength).toBe(0);
    });

    it('príloha bez náhľadu → 404, nie prázdny obrázok', async () => {
      const bare = await app.mongo.db.collection('attachments').insertOne({
        organisationId: tenantId,
        originalFilename: 'zmluva.pdf',
        storageKey: 'https://example.invalid/zmluva.pdf',
        storagePathname: null,
        storageAccess: 'PUBLIC_LEGACY',
        thumbnail: null,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        sha256: 'c'.repeat(64),
        attachmentType: 'ASSET_DOCUMENT',
        linkedTo: { entityType: 'Asset', entityId: new ObjectId().toHexString() },
        caption: null,
        imageDimensions: null,
        isPublic: false,
        isPrimary: false,
        createdAt: updatedAt,
        updatedAt,
        createdBy: 'SYSTEM',
        updatedBy: 'SYSTEM',
        deletedAt: null,
        deletedBy: null,
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/attachments/${bare.insertedId.toHexString()}/thumbnail`,
        headers: { cookie: `inv_access=${employeeToken}` },
      });

      expect(res.statusCode).toBe(404);
    });

    it('neexistujúce id → 404', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/attachments/${new ObjectId().toHexString()}/thumbnail`,
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // --- verejné logo --------------------------------------------------------

  describe('GET /v1/public/organisations/:slug/logo', () => {
    beforeAll(async () => {
      // Celý brandKit, nie `brandKit.logo`: v seedovanom tenantovi je
      // `brandKit` null a Mongo do null-u pole nevytvorí.
      await app.mongo.db.collection('organisations').updateOne(
        { _id: new ObjectId(tenantId) },
        {
          $set: {
            brandKit: {
              presetId: null,
              logo: storedImage(PNG_BYTES, 'image/png'),
              logoUrl: null,
              faviconUrl: null,
              primary: null,
              primaryFg: null,
              accent: null,
              accentFg: null,
              logoDot: null,
              fontFamilySans: null,
            },
          },
        },
      );
    });

    it('funguje BEZ tokenu — logo je na prihlasovacej stránke', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/organisations/${tenantSlug}/logo`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(res.rawPayload).toEqual(PNG_BYTES);
    });

    it('je CDN-cachovaný', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/organisations/${tenantSlug}/logo`,
      });

      expect(res.headers['cache-control']).toContain('public');
      expect(res.headers['cache-control']).toContain('s-maxage=86400');
    });

    // Regresia z 2026-09-02: helmet dáva globálne CORP `same-origin`, takže
    // logo servírované z api.* by sa v `<img>` na app.* nezobrazilo. Pri
    // starých Blob URL to nevadilo — tie CORP hlavičku nemali.
    it('má CORP cross-origin, inak by ho appka na inej doméne nezobrazila', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/organisations/${tenantSlug}/logo`,
      });

      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    it('vracia LEN obrázok — žiadne dáta organizácie', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/organisations/${tenantSlug}/logo`,
      });

      // Keby sa sem dostal celý dokument, telo by obsahovalo slug alebo
      // názvy polí. Endpoint je CDN-cachovaný, takže únik by prežil deploy.
      const asText = res.rawPayload.toString('utf8');
      expect(asText).not.toContain(tenantSlug);
      expect(asText).not.toContain('organisationId');
      expect(asText).not.toContain('brandKit');
    });

    it('If-None-Match → 304', async () => {
      const first = await app.inject({
        method: 'GET',
        url: `/v1/public/organisations/${tenantSlug}/logo`,
      });
      const etag = first.headers['etag'] as string;

      const second = await app.inject({
        method: 'GET',
        url: `/v1/public/organisations/${tenantSlug}/logo`,
        headers: { 'if-none-match': etag },
      });

      expect(second.statusCode).toBe(304);
      expect(second.rawPayload.byteLength).toBe(0);
    });

    it('neznámy slug → 404', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/public/organisations/neexistuje/logo',
      });
      expect(res.statusCode).toBe(404);
    });
  });
});

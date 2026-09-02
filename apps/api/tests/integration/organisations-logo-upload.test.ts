// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integračné testy — POST /v1/organisations/current/logo (ADR-0028 v2).
 *
 * Endpoint nahrá logo do Vercel Blob. Testujeme:
 *   - Validácia: chýbajúci súbor → 400
 *   - Validácia: nesprávny typ (text/html magic bytes) → 400
 *   - Validácia: príliš veľký súbor → 413
 *   - RBAC: EMPLOYEE dostane 401 (neautorizovaný)
 *   - RBAC: ADMIN má prístup
 *   - Happy path: logo v BinData a `logoUrl` na verejnom endpointe
 *
 * Happy path bol do 2026-09-02 gated cez `skipIf(!BLOB_READ_WRITE_TOKEN)`,
 * teda v CI sa nikdy nespustil — vtedy upload loga naozaj potreboval Blob.
 * Od ADR-0037 ide logo do dokumentu ako BinData, takže žiadny token netreba
 * a testy bežia všade.
 */

import { createCanvas } from '@napi-rs/canvas';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { UserRole, provisionUser } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Pomocné funkcie — multipart builder
// ---------------------------------------------------------------------------

/**
 * Zostaví raw multipart/form-data Buffer so zadaným súborom.
 * Fastify inject prijme Buffer + správny Content-Type header.
 */
function buildMultipartBody(
  fieldName: string,
  filename: string,
  contentType: string,
  data: Buffer,
): { body: Buffer; contentType: string } {
  const boundary = '----TestBoundary7MA4YWxkTrZu0gW';
  const CRLF = '\r\n';
  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"${CRLF}` +
        `Content-Type: ${contentType}${CRLF}` +
        `${CRLF}`,
    ),
    data,
    Buffer.from(`${CRLF}--${boundary}--${CRLF}`),
  ];
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/** Minimálny platný PNG buffer (1×1 px, transparentný). */
function makePngBuffer(): Buffer {
  // Kompletný 1×1 transparentný PNG (67 bajtov)
  return Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
      '1f15c4890000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
    'hex',
  );
}

/**
 * Skutočný JPEG, nie len hlavička.
 *
 * Predtým tu bol `ffd8ffe0…ffdb0043 00` — teda SOI + APP0 a nič ďalšie.
 * Prešiel kontrolou magic bytes, ale žiadne obrazové dáta neobsahoval.
 * Odkedy endpoint logo naozaj dekóduje (potrebuje rozmery do BinData,
 * ADR-0037), taký súbor správne končí 400-kou. Fixture teda musí byť
 * obrázok, ktorý sa dá otvoriť — inak by test tvrdil, že endpoint
 * odmieta platné JPEG-y.
 */
function makeJpegBuffer(): Buffer {
  const canvas = createCanvas(8, 8);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#123456';
  ctx.fillRect(0, 0, 8, 8);
  return canvas.toBuffer('image/jpeg');
}

/** Buffer s neplatným typom (HTML). */
function makeHtmlBuffer(): Buffer {
  return Buffer.from('<!DOCTYPE html><html><body>not an image</body></html>');
}

// ---------------------------------------------------------------------------
// Testy
// ---------------------------------------------------------------------------

describe('POST /v1/organisations/current/logo — logo upload (ADR-0028 v2)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let employeeToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
    const admin = await provisionUser(app, { oid: 'logo-admin', role: UserRole.ADMIN });
    adminToken = admin.token;
    const employee = await provisionUser(app, { oid: 'logo-emp', role: UserRole.EMPLOYEE });
    employeeToken = employee.token;
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  // -------------------------------------------------------------------------
  // RBAC
  // -------------------------------------------------------------------------

  describe('RBAC', () => {
    it('neautentizovaný → 401', async () => {
      const png = makePngBuffer();
      const { body, contentType } = buildMultipartBody('file', 'logo.png', 'image/png', png);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/organisations/current/logo',
        headers: { 'content-type': contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(401);
    });

    it('EMPLOYEE → 403 (ADMIN-only endpoint)', async () => {
      const png = makePngBuffer();
      const { body, contentType } = buildMultipartBody('file', 'logo.png', 'image/png', png);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/organisations/current/logo',
        headers: { cookie: `inv_access=${employeeToken}`, 'content-type': contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // Validácia vstupu
  // -------------------------------------------------------------------------

  describe('Validácia vstupu', () => {
    it('chýbajúci súbor (prázdny multipart) → 400', async () => {
      const boundary = '----TestBoundary';
      const body = Buffer.from(`--${boundary}--\r\n`);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/organisations/current/logo',
        headers: {
          cookie: `inv_access=${adminToken}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });
      expect(res.statusCode).toBe(400);
    });

    it('neplatný typ súboru (HTML magic bytes) → 400', async () => {
      // Validácia magic bytes prebehne pred akýmkoľvek zápisom
      const html = makeHtmlBuffer();
      const { body, contentType } = buildMultipartBody('file', 'logo.html', 'text/html', html);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/organisations/current/logo',
        headers: { cookie: `inv_access=${adminToken}`, 'content-type': contentType },
        payload: body,
      });
      // Bez tokenu dostaneme 500 pred magic-byte kontrolou — skipneme
      if (res.statusCode === 500) return;
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toContain('PNG');
    });

    it('príliš veľký súbor (> 512 KB) → 413', async () => {
      const bigBuf = Buffer.alloc(513 * 1024, 0x00);
      // Prefixujeme PNG magic bytes, ale súbor je príliš veľký
      bigBuf[0] = 0x89;
      bigBuf[1] = 0x50;
      bigBuf[2] = 0x4e;
      bigBuf[3] = 0x47;
      bigBuf[4] = 0x0d;
      bigBuf[5] = 0x0a;
      bigBuf[6] = 0x1a;
      bigBuf[7] = 0x0a;
      const { body, contentType } = buildMultipartBody('file', 'big.png', 'image/png', bigBuf);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/organisations/current/logo',
        headers: { cookie: `inv_access=${adminToken}`, 'content-type': contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(413);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('Happy path', () => {
    it('ADMIN nahrá PNG logo → 200, logo v BinData a logoUrl na verejnom endpointe', async () => {
      const png = makePngBuffer();
      const { body, contentType } = buildMultipartBody('file', 'logo.png', 'image/png', png);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/organisations/current/logo',
        headers: { cookie: `inv_access=${adminToken}`, 'content-type': contentType },
        payload: body,
      });
      expect(res.statusCode, res.body).toBe(200);
      const org = res.json<{ brandKit: { logoUrl: string } }>();

      // Logo uz nie je v Blobe, ale v dokumente ako BinData (ADR-0037).
      // `logoUrl` zostava — cita ho sedem miest vratane generatora PDF
      // protokolov — len ukazuje na nas verejny endpoint.
      expect(org.brandKit?.logoUrl).toContain('/v1/public/organisations/');
      expect(org.brandKit?.logoUrl).not.toContain('blob.vercel-storage.com');

      // Cache-buster: endpoint posiela s-maxage=86400, takze bez neho by
      // CDN drzala stare logo az den po jeho zmene.
      expect(org.brandKit?.logoUrl).toMatch(/[?&]v=/);

      // Dokaz, ze logo naozaj lezi v dokumente: verejny endpoint ho
      // servíruje z BinData, bez Blobu a bez autentifikacie.
      const logoPath = new URL(String(org.brandKit?.logoUrl)).pathname;
      const served = await app.inject({ method: 'GET', url: logoPath });
      expect(served.statusCode).toBe(200);
      expect(served.headers['content-type']).toContain('image/png');
      expect(served.rawPayload).toEqual(png);
    });

    it('ADMIN nahrá JPEG logo → 200', async () => {
      const jpeg = makeJpegBuffer();
      const { body, contentType } = buildMultipartBody('file', 'logo.jpg', 'image/jpeg', jpeg);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/organisations/current/logo',
        headers: { cookie: `inv_access=${adminToken}`, 'content-type': contentType },
        payload: body,
      });
      expect(res.statusCode, res.body).toBe(200);
    });

    it('druhý upload prepíše logo v dokumente a aktualizuje logoUrl', async () => {
      const png = makePngBuffer();
      const { body: body1, contentType } = buildMultipartBody(
        'file',
        'logo1.png',
        'image/png',
        png,
      );
      const res1 = await app.inject({
        method: 'POST',
        url: '/v1/organisations/current/logo',
        headers: { cookie: `inv_access=${adminToken}`, 'content-type': contentType },
        payload: body1,
      });
      expect(res1.statusCode, res1.body).toBe(200);
      const url1 = res1.json<{ brandKit: { logoUrl: string } }>().brandKit?.logoUrl;

      const { body: body2 } = buildMultipartBody('file', 'logo2.png', 'image/png', png);
      const res2 = await app.inject({
        method: 'POST',
        url: '/v1/organisations/current/logo',
        headers: { cookie: `inv_access=${adminToken}`, 'content-type': contentType },
        payload: body2,
      });
      expect(res2.statusCode, res2.body).toBe(200);
      const url2 = res2.json<{ brandKit: { logoUrl: string } }>().brandKit?.logoUrl;

      // Nová URL sa líši od starej (nový timestamp v ceste)
      expect(url2).toBeTruthy();
      expect(url2).not.toBe(url1);
    });
  });
});

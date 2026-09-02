// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integračné testy — prílohy majetku (foto/doklady), modul `attachments`.
 *
 * Pokrytie:
 *   - POST /v1/assets/:id/attachments — upload PNG/JPEG/PDF, validácia typu, RBAC
 *   - GET  /v1/assets/:id/attachments — zoznam
 *   - PATCH /v1/attachments/:id/primary — hlavné foto (len ASSET_PHOTO)
 *   - DELETE /v1/attachments/:id — soft-delete
 *   - Audit eventy ASSET_ATTACHMENT_ADDED/_SET_PRIMARY/_REMOVED (cieľ Asset)
 *   - EXIF strip — nahraný JPEG s EXIF blokom sa uloží menší (metadata preč)
 *   - Cross-tenant izolácia
 *
 * Vercel Blob (`put`/`del`) je mockovaný — testy nepotrebujú sieť ani reálny
 * token (nastavíme len dummy `BLOB_READ_WRITE_TOKEN`, ktorý route kontroluje
 * pred volaním Blob API).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestAsset,
  provisionUser,
  resolveTestTenantId,
  seedTestTenant,
  UserRole,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

// Mock Vercel Blob — put vráti neuhádnuteľnú vercel-storage URL, del je no-op.
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (path: string) => ({
    url: `https://test.public.blob.vercel-storage.com/${path}`,
  })),
  del: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Multipart + súborové buildery
// ---------------------------------------------------------------------------

function buildMultipartBody(
  fieldName: string,
  filename: string,
  contentType: string,
  data: Buffer,
): { body: Buffer; contentType: string } {
  const boundary = '----TestBoundaryAttach7MA4YWxk';
  const CRLF = '\r\n';
  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"${CRLF}` +
        `Content-Type: ${contentType}${CRLF}${CRLF}`,
    ),
    data,
    Buffer.from(`${CRLF}--${boundary}--${CRLF}`),
  ];
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function makePngBuffer(): Buffer {
  return Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
      '1f15c4890000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
    'hex',
  );
}

function makePdfBuffer(): Buffer {
  return Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
}

function makeHtmlBuffer(): Buffer {
  return Buffer.from('<!DOCTYPE html><html><body>nie obrázok</body></html>');
}

/** JPEG s APP1 (EXIF) blokom — strip ho musí pri uploade odstrániť. */
function makeJpegWithExif(): Buffer {
  const exifPayload = Buffer.concat([
    Buffer.from('Exif\0\0'),
    Buffer.from('GPS:48.148598N,17.107748E;Device:SecretPhone12'),
  ]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(exifPayload.length + 2, 0);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    Buffer.from([0xff, 0xe1]), // APP1
    len,
    exifPayload,
    Buffer.from([0xff, 0xda]), // SOS
    Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55]), // "scan" dáta
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

// ---------------------------------------------------------------------------
// Testy
// ---------------------------------------------------------------------------

describe('Attachments — prílohy majetku', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let employeeToken: string;
  let assetId: string;

  // Route kontroluje BLOB_READ_WRITE_TOKEN pred volaním (mockovaného) put().
  // Nastavíme dummy token, ale MUSÍME ho po sebe vrátiť — process.env je
  // zdieľaný medzi test súbormi v rámci vitest workera a iné testy (napr.
  // organisations-logo-upload) majú happy-path gated cez skipIf(!token).
  const originalBlobToken = process.env['BLOB_READ_WRITE_TOKEN'];

  beforeAll(async () => {
    process.env['BLOB_READ_WRITE_TOKEN'] = 'test-blob-token';
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
    if (originalBlobToken === undefined) {
      delete process.env['BLOB_READ_WRITE_TOKEN'];
    } else {
      process.env['BLOB_READ_WRITE_TOKEN'] = originalBlobToken;
    }
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
    adminToken = (await provisionUser(app, { oid: 'attach-admin', role: UserRole.ADMIN })).token;
    employeeToken = (await provisionUser(app, { oid: 'attach-emp', role: UserRole.EMPLOYEE }))
      .token;
    const asset = await insertTestAsset(app, { name: 'Asset s prílohami' });
    assetId = asset._id;
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  async function uploadFile(
    token: string,
    filename: string,
    contentType: string,
    data: Buffer,
    targetAssetId = assetId,
  ) {
    const { body, contentType: ct } = buildMultipartBody('file', filename, contentType, data);
    return app.inject({
      method: 'POST',
      url: `/v1/assets/${targetAssetId}/attachments`,
      headers: { cookie: `inv_access=${token}`, 'content-type': ct },
      payload: body,
    });
  }

  async function getAudit(targetAssetId = assetId) {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/assets/${targetAssetId}/audit`,
      headers: { cookie: `inv_access=${adminToken}` },
    });
    return res.json<{ data: Array<{ action: string }> }>().data;
  }

  // -------------------------------------------------------------------------
  // RBAC
  // -------------------------------------------------------------------------

  describe('RBAC', () => {
    it('neautentizovaný upload → 401', async () => {
      const { body, contentType } = buildMultipartBody(
        'file',
        'a.png',
        'image/png',
        makePngBuffer(),
      );
      const res = await app.inject({
        method: 'POST',
        url: `/v1/assets/${assetId}/attachments`,
        headers: { 'content-type': contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(401);
    });

    it('EMPLOYEE upload → 403 (ASSET_MANAGER/ADMIN-only)', async () => {
      const res = await uploadFile(employeeToken, 'a.png', 'image/png', makePngBuffer());
      expect(res.statusCode).toBe(403);
    });

    it('EMPLOYEE smie čítať zoznam → 200', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/assets/${assetId}/attachments`,
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Upload + validácia
  // -------------------------------------------------------------------------

  describe('Upload', () => {
    it('ADMIN nahrá PNG → 201, attachmentType ASSET_PHOTO', async () => {
      const res = await uploadFile(adminToken, 'foto.png', 'image/png', makePngBuffer());
      expect(res.statusCode, res.body).toBe(201);
      const att = res.json<{
        attachmentType: string;
        isPrimary: boolean;
        url: string;
        storageAccess: string;
      }>();
      expect(att.attachmentType).toBe('ASSET_PHOTO');
      expect(att.isPrimary).toBe(false);
      // Originály idú do PRIVATE storu (ADR-0037), takže `url` už nie je
      // verejná Blob URL, ale cesta v store. Verejná URL pri privátnom
      // objekte ani existovať nemôže — podpis expiruje.
      expect(att.url).toMatch(/^attachments\/[a-f0-9]{24}\/[a-f0-9]{24}\/[0-9a-f-]+\.png$/);
      expect(att.storageAccess).toBe('PRIVATE');
    });

    it('ADMIN nahrá PDF → 201, attachmentType ASSET_DOCUMENT', async () => {
      const res = await uploadFile(adminToken, 'doklad.pdf', 'application/pdf', makePdfBuffer());
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json<{ attachmentType: string }>().attachmentType).toBe('ASSET_DOCUMENT');
    });

    it('neplatný typ (HTML) → 400', async () => {
      const res = await uploadFile(adminToken, 'x.html', 'text/html', makeHtmlBuffer());
      expect(res.statusCode).toBe(400);
    });

    it('EXIF strip: nahraný JPEG s EXIF sa uloží menší (metadata preč)', async () => {
      const jpeg = makeJpegWithExif();
      const res = await uploadFile(adminToken, 'foto.jpg', 'image/jpeg', jpeg);
      expect(res.statusCode, res.body).toBe(201);
      const att = res.json<{ sizeBytes: number; attachmentType: string }>();
      expect(att.attachmentType).toBe('ASSET_PHOTO');
      // APP1 (EXIF) blok bol odstránený → uložená veľkosť < pôvodná.
      expect(att.sizeBytes).toBeLessThan(jpeg.byteLength);
    });
  });

  // -------------------------------------------------------------------------
  // Zoznam + hlavné foto + delete
  // -------------------------------------------------------------------------

  describe('Zoznam, primary, delete', () => {
    it('GET zoznam vráti nahranú prílohu', async () => {
      await uploadFile(adminToken, 'foto.png', 'image/png', makePngBuffer());
      const res = await app.inject({
        method: 'GET',
        url: `/v1/assets/${assetId}/attachments`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ data: unknown[] }>().data).toHaveLength(1);
    });

    it('PATCH primary na fotke → 204 a isPrimary=true', async () => {
      const up = await uploadFile(adminToken, 'foto.png', 'image/png', makePngBuffer());
      const id = up.json<{ id: string }>().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/attachments/${id}/primary`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(204);

      const list = await app.inject({
        method: 'GET',
        url: `/v1/assets/${assetId}/attachments`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const item = list.json<{ data: Array<{ id: string; isPrimary: boolean }> }>().data[0];
      expect(item?.isPrimary).toBe(true);
    });

    it('PATCH primary na PDF doklade → 400', async () => {
      const up = await uploadFile(adminToken, 'doklad.pdf', 'application/pdf', makePdfBuffer());
      const id = up.json<{ id: string }>().id;
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/attachments/${id}/primary`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('DELETE prílohy → 204 a zmizne zo zoznamu', async () => {
      const up = await uploadFile(adminToken, 'foto.png', 'image/png', makePngBuffer());
      const id = up.json<{ id: string }>().id;

      const del = await app.inject({
        method: 'DELETE',
        url: `/v1/attachments/${id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(del.statusCode).toBe(204);

      const list = await app.inject({
        method: 'GET',
        url: `/v1/assets/${assetId}/attachments`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(list.json<{ data: unknown[] }>().data).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Audit eventy (cieľ Asset → zobrazia sa v audit tabe detailu)
  // -------------------------------------------------------------------------

  describe('Audit eventy', () => {
    it('upload zapíše ASSET_ATTACHMENT_ADDED na Asset', async () => {
      await uploadFile(adminToken, 'foto.png', 'image/png', makePngBuffer());
      const actions = (await getAudit()).map((e) => e.action);
      expect(actions).toContain('ASSET_ATTACHMENT_ADDED');
    });

    it('set primary zapíše ASSET_ATTACHMENT_SET_PRIMARY', async () => {
      const up = await uploadFile(adminToken, 'foto.png', 'image/png', makePngBuffer());
      const id = up.json<{ id: string }>().id;
      await app.inject({
        method: 'PATCH',
        url: `/v1/attachments/${id}/primary`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const actions = (await getAudit()).map((e) => e.action);
      expect(actions).toContain('ASSET_ATTACHMENT_SET_PRIMARY');
    });

    it('delete zapíše ASSET_ATTACHMENT_REMOVED', async () => {
      const up = await uploadFile(adminToken, 'foto.png', 'image/png', makePngBuffer());
      const id = up.json<{ id: string }>().id;
      await app.inject({
        method: 'DELETE',
        url: `/v1/attachments/${id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const actions = (await getAudit()).map((e) => e.action);
      expect(actions).toContain('ASSET_ATTACHMENT_REMOVED');
    });
  });

  // -------------------------------------------------------------------------
  // Cross-tenant izolácia
  // -------------------------------------------------------------------------

  describe('Cross-tenant izolácia', () => {
    it('admin tenantu B nezmaže prílohu tenantu A → 404', async () => {
      const up = await uploadFile(adminToken, 'foto.png', 'image/png', makePngBuffer());
      const attId = up.json<{ id: string }>().id;

      await resolveTestTenantId(app); // tenant A (default)
      const tenantB = await seedTestTenant(app, {
        slug: 'attach-tenant-b',
        displayName: 'Tenant B',
      });
      const tokenB = (
        await provisionUser(app, {
          oid: 'attach-admin-b',
          role: UserRole.ADMIN,
          organisationId: tenantB._id,
        })
      ).token;

      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/attachments/${attId}`,
        headers: { cookie: `inv_access=${tokenB}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});

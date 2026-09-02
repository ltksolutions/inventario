// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integračné testy priameho uploadu do private storu (ADR-0037, fáza 2).
 *
 * Dvojkrokový tok: `upload-url` vydá podpísaný PUT, klient nahrá priamo do
 * storu, `confirm` objekt overí a založí prílohu. V testoch je pod tým stub
 * úložisko, takže „nahratie" simulujeme zápisom do stubu.
 *
 * Ťažisko testov je na tom, čo `confirm` ODMIETNE. Je to jediné miesto, kde
 * server vidí obsah, ktorý mu nikto nesprostredkoval — klient ho nahral sám.
 * Konkrétne:
 *
 *   - cudzia cesta → 400. Bez tejto kontroly by stačilo poslať `pathname`
 *     iného tenanta a príloha by sa naviazala na vlastný majetok, hoci obsah
 *     patrí niekomu inému.
 *   - neexistujúci objekt → 400, nie prázdna príloha v evidencii.
 *   - PDF vydávané za obrázok → server verí magic bytes, nie tvrdeniu klienta.
 *
 * A jedna vec, ktorú robiť MUSÍ: odstrániť EXIF. Priamy upload obchádza
 * `stripImageMetadata`, takže GPS súradnice z mobilu by inak skončili v store
 * nedotknuté.
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  UserRole,
  insertTestAsset,
  provisionUser,
  resolveTestTenantId,
} from '../helpers/test-fixtures.js';

import type { StubStorage } from '../../src/lib/storage/index.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let managerToken: string;
let employeeToken: string;
let tenantId: string;
let assetId: string;

function storage(): StubStorage {
  return app.objectStorage as StubStorage;
}

/** Minimálny PNG, ktorý @napi-rs/canvas dekóduje (1×1 px). */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF_BYTES = Buffer.from('%PDF-1.4\nfake', 'utf8');

async function requestUploadUrl(
  token: string,
  contentType: string,
): Promise<{
  statusCode: number;
  body: { uploadUrl?: string; pathname?: string; headers?: Record<string, string> };
}> {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/assets/${assetId}/attachments/upload-url`,
    headers: { cookie: `inv_access=${token}` },
    payload: { contentType },
  });
  return { statusCode: res.statusCode, body: res.json() };
}

describe('priamy upload do private storu', () => {
  beforeAll(async () => {
    app = await buildTestApp();
    await cleanTestDatabase(app);
    tenantId = await resolveTestTenantId(app);
    managerToken = (await provisionUser(app, { oid: 'pu-mgr', role: UserRole.ASSET_MANAGER }))
      .token;
    employeeToken = (await provisionUser(app, { oid: 'pu-emp', role: UserRole.EMPLOYEE })).token;
    const asset = await insertTestAsset(app, { name: 'Majetok s prílohami' });
    assetId = asset._id;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    storage().reset();
  });

  it('v testoch beží stub — integračný test nesmie zapísať do reálneho storu', () => {
    expect(app.objectStorage.name).toBe('stub');
  });

  // --- upload-url ----------------------------------------------------------

  it('EMPLOYEE nesmie žiadať o upload URL', async () => {
    const res = await requestUploadUrl(employeeToken, 'image/png');
    expect(res.statusCode).toBe(403);
  });

  it('vráti podpísanú URL a cestu v rámci tenanta a majetku', async () => {
    const res = await requestUploadUrl(managerToken, 'image/png');

    expect(res.statusCode).toBe(200);
    expect(res.body.pathname).toMatch(
      new RegExp(`^attachments/${tenantId}/${assetId}/[0-9a-f-]+\\.png$`),
    );
    expect(res.body.uploadUrl).toBeTruthy();
  });

  // Regresia z 2026-09-02: podpísaná URL sama nestačí. Bez týchto hlavičiek
  // endpoint úložiska odpovie 200, ale objekt neuloží tam, kde ho `confirm`
  // hľadá — používateľ dostal „Objekt v úložisku neexistuje".
  it('vráti hlavičky, ktoré musí klient poslať s PUT', async () => {
    const res = await requestUploadUrl(managerToken, 'image/png');

    expect(res.statusCode).toBe(200);
    // `access` diktuje server: klient nesmie prepnúť upload na public.
    expect(res.body.headers?.['x-vercel-blob-access']).toBe('private');
    expect(res.body.headers?.['x-content-type']).toBe('image/png');
    expect(res.body.headers?.['x-api-version']).toBeTruthy();
  });

  it('neznámy content type odmietne (400), nepodpíše ho', async () => {
    const res = await requestUploadUrl(managerToken, 'application/x-msdownload');
    expect(res.statusCode).toBe(400);
  });

  // --- confirm -------------------------------------------------------------

  async function confirm(
    token: string,
    pathname: string,
    originalFilename = 'foto.png',
  ): Promise<ReturnType<FastifyInstance['inject']>> {
    return app.inject({
      method: 'POST',
      url: `/v1/assets/${assetId}/attachments/confirm`,
      headers: { cookie: `inv_access=${token}` },
      payload: { pathname, originalFilename },
    });
  }

  it('confirm ODMIETNE cestu mimo tohto majetku', async () => {
    const foreign = `attachments/000000000000000000000000/000000000000000000000000/x.png`;
    storage().seed({ pathname: foreign, body: PNG_1X1, contentType: 'image/png' });

    const res = await confirm(managerToken, foreign);

    expect(res.statusCode).toBe(400);
  });

  it('confirm odmietne cestu, na ktorej nič neleží', async () => {
    const up = await requestUploadUrl(managerToken, 'image/png');
    const res = await confirm(managerToken, String(up.body.pathname));

    expect(res.statusCode).toBe(400);
  });

  it('confirm verí magic bytes, nie ohlásenému typu', async () => {
    // Klient si vypýtal podpis na PNG, do storu dal PDF.
    const up = await requestUploadUrl(managerToken, 'image/png');
    storage().seed({
      pathname: String(up.body.pathname),
      body: PDF_BYTES,
      contentType: 'image/png',
    });

    const res = await confirm(managerToken, String(up.body.pathname));

    expect(res.statusCode).toBe(201);
    expect(res.json().mimeType).toBe('application/pdf');
    expect(res.json().attachmentType).toBe('ASSET_DOCUMENT');
  });

  it('confirm založí prílohu s náhľadom a označí ju ako PRIVATE', async () => {
    const up = await requestUploadUrl(managerToken, 'image/png');
    storage().seed({ pathname: String(up.body.pathname), body: PNG_1X1, contentType: 'image/png' });

    const res = await confirm(managerToken, String(up.body.pathname));

    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.mimeType).toBe('image/png');

    const doc = await app.mongo.db
      .collection('attachments')
      .findOne({ storagePathname: up.body.pathname });

    expect(doc?.['storageAccess']).toBe('PRIVATE');
    expect(doc?.['thumbnail']).toBeTruthy();
    expect(doc?.['sha256']).toMatch(/^[a-f0-9]{64}$/);
  });

  it('EMPLOYEE nesmie potvrdiť upload', async () => {
    const up = await requestUploadUrl(managerToken, 'image/png');
    storage().seed({ pathname: String(up.body.pathname), body: PNG_1X1, contentType: 'image/png' });

    const res = await confirm(employeeToken, String(up.body.pathname));

    expect(res.statusCode).toBe(403);
  });

  // --- download ------------------------------------------------------------

  it('download vráti podpísanú URL s expiráciou', async () => {
    const up = await requestUploadUrl(managerToken, 'image/png');
    storage().seed({ pathname: String(up.body.pathname), body: PNG_1X1, contentType: 'image/png' });
    const created = await confirm(managerToken, String(up.body.pathname));
    const attachmentId = created.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/attachments/${attachmentId}/download`,
      headers: { cookie: `inv_access=${employeeToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().url).toBeTruthy();
    expect(res.json().expiresAt).toBeTruthy();
  });

  it('download bez tokenu → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/attachments/000000000000000000000000/download`,
    });
    expect(res.statusCode).toBe(401);
  });
});

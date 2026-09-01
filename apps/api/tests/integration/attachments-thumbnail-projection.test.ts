// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Strážny test pre náhľady v BinData (ADR-0037, fáza 1).
 *
 * Náhľad je ~300 KB binárky v dokumente prílohy. Keby unikol do bežných
 * dotazov, zoznam dvadsiatich fotiek majetku by mal 6 MB — a funkcia na
 * Verceli má strop 4,5 MB na telo odpovede, takže by to skončilo 413.
 * Nie je to teda kozmetika, ale hranica, za ktorou appka prestane fungovať.
 *
 * Test preto vkladá prílohu S náhľadom priamo do kolekcie (obchádza
 * repository, aby overoval čítanie, nie zápis) a kontroluje, že KAŽDÁ
 * čítacia cesta repository ho odreže. `findThumbnailById` je jediná
 * výnimka — a musí náhľad naozaj vrátiť, inak by endpoint nemal odkiaľ
 * brať dáta a test by bol zelený proti nefunkčnej ceste.
 */

import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AttachmentsRepository } from '../../src/modules/attachments/attachments.repository.js';
import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { seedTestTenant } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

/** 1×1 px JPEG-ish výplň — obsah nás nezaujíma, len že je to binárka. */
const THUMB_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);

let app: FastifyInstance;
let repo: AttachmentsRepository;
let tenantId: string;
let attachmentId: string;

async function insertAttachmentWithThumbnail(): Promise<string> {
  const now = new Date().toISOString();
  const result = await app.mongo.db.collection('attachments').insertOne({
    organisationId: tenantId,
    originalFilename: 'foto.jpg',
    storageKey: 'https://example.invalid/foto.jpg',
    storagePathname: `org/${tenantId}/attachments/foto.jpg`,
    storageAccess: 'PRIVATE',
    thumbnail: {
      data: THUMB_BYTES,
      mimeType: 'image/jpeg',
      width: 800,
      height: 600,
      sizeBytes: THUMB_BYTES.byteLength,
    },
    mimeType: 'image/jpeg',
    sizeBytes: 1234,
    sha256: 'a'.repeat(64),
    attachmentType: 'ASSET_PHOTO',
    linkedTo: { entityType: 'Asset', entityId: new ObjectId().toHexString() },
    caption: null,
    imageDimensions: null,
    isPublic: false,
    isPrimary: false,
    createdAt: now,
    updatedAt: now,
    createdBy: 'SYSTEM',
    updatedBy: 'SYSTEM',
    deletedAt: null,
    deletedBy: null,
  });
  return result.insertedId.toHexString();
}

describe('attachments — náhľad nesmie uniknúť z bežných dotazov', () => {
  beforeAll(async () => {
    app = await buildTestApp();
    await cleanTestDatabase(app);
    const tenant = await seedTestTenant(app, { slug: 'thumb-projection' });
    tenantId = tenant._id;
    repo = new AttachmentsRepository(app.mongo.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.mongo.db.collection('attachments').deleteMany({});
    attachmentId = await insertAttachmentWithThumbnail();
  });

  it('náhľad je naozaj v DB (inak by zvyšok testu nič nedokazoval)', async () => {
    const raw = await app.mongo.db.collection('attachments').findOne({
      _id: new ObjectId(attachmentId),
    });
    expect(raw?.['thumbnail']).toBeDefined();
  });

  it('findById náhľad neodovzdá', async () => {
    const doc = await repo.findById(tenantId, attachmentId);
    expect(doc).not.toBeNull();
    expect(doc).not.toHaveProperty('thumbnail');
  });

  it('listByLinked náhľad neodovzdá', async () => {
    const raw = await app.mongo.db.collection('attachments').findOne({
      _id: new ObjectId(attachmentId),
    });
    const entityId = String((raw?.['linkedTo'] as { entityId: string }).entityId);

    const items = await repo.listByLinked(tenantId, 'Asset', entityId);
    expect(items).toHaveLength(1);
    for (const item of items) {
      expect(item).not.toHaveProperty('thumbnail');
    }
  });

  it('softDelete vracia dokument bez náhľadu', async () => {
    const deleted = await repo.softDelete(tenantId, attachmentId, 'SYSTEM');
    expect(deleted).not.toBeNull();
    expect(deleted).not.toHaveProperty('thumbnail');
  });

  it('insert vracia dokument bez náhľadu', async () => {
    const now = new Date().toISOString();
    const inserted = await repo.insert({
      organisationId: tenantId,
      originalFilename: 'druhy.jpg',
      storageKey: 'https://example.invalid/druhy.jpg',
      storagePathname: null,
      storageAccess: 'PUBLIC_LEGACY',
      thumbnail: {
        data: THUMB_BYTES,
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        sizeBytes: THUMB_BYTES.byteLength,
      },
      mimeType: 'image/jpeg',
      sizeBytes: 4321,
      sha256: 'b'.repeat(64),
      attachmentType: 'ASSET_PHOTO',
      linkedTo: { entityType: 'Asset', entityId: new ObjectId().toHexString() },
      caption: null,
      imageDimensions: null,
      isPublic: false,
      isPrimary: false,
      createdAt: now,
      updatedAt: now,
      createdBy: 'SYSTEM',
      updatedBy: 'SYSTEM',
      deletedAt: null,
      deletedBy: null,
    });

    expect(inserted).not.toHaveProperty('thumbnail');
  });

  it('findThumbnailById náhľad naozaj vráti — inak by endpoint nemal dáta', async () => {
    const found = await repo.findThumbnailById(tenantId, attachmentId);
    expect(found?.thumbnail?.mimeType).toBe('image/jpeg');
    expect(Buffer.from(found?.thumbnail?.data as Uint8Array)).toEqual(THUMB_BYTES);
  });

  it('findThumbnailById nevydá náhľad cudziemu tenantovi', async () => {
    const other = new ObjectId().toHexString();
    const found = await repo.findThumbnailById(other, attachmentId);
    expect(found).toBeNull();
  });
});

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Attachments repository — metadata súborov v kolekcii `attachments`.
 *
 * Reálny obsah súboru je v object storage (Vercel Blob) — tu sú len
 * metadata + `storageKey` (verejná Blob URL). Tenant-scoped cez
 * `organisationId`. Mazanie je soft-delete; reálny blob maže service.
 */

import { Binary, ObjectId } from 'mongodb';

import { requireTenantId, tenantFilter } from '../../lib/organisation-scoping.js';

import type { Attachment } from '@inventario/shared-types';
import type { ClientSession, Collection, Db, Filter, WithId } from 'mongodb';

/**
 * Príloha bez náhľadu — to, čo vracia každý bežný dotaz.
 *
 * `thumbnail` je BinData (~300 KB). Keby odchádzal z výpisov, zoznam
 * dvadsiatich fotiek majetku by ťahal 6 MB cez funkciu, ktorá má strop
 * 4,5 MB na odpoveď. Typ je preto `Omit<…>`: kto náhľad chce, musí si ho
 * vypýtať `findThumbnailById` — tam ho TypeScript aj vidí.
 */
export type AttachmentWithoutThumbnail = Omit<Attachment, 'thumbnail'>;

/**
 * Projekcia, ktorá náhľad odreže. Patrí do KAŽDÉHO dotazu nad
 * `attachments` okrem `findThumbnailById`. Stráži to test
 * `attachments-thumbnail-projection`.
 */
const WITHOUT_THUMBNAIL = { thumbnail: 0 } as const;

/**
 * BSON `Binary` → `Buffer`. Driver pri čítaní BinData vracia `Binary`,
 * ktorý NIE JE `Uint8Array`, takže `Buffer.from(...)` naň dá prázdny
 * buffer — ticho a bez chyby. Preto explicitná vetva.
 */
function toBuffer(value: Uint8Array): Buffer {
  if (value instanceof Binary) return Buffer.from(value.buffer);
  return Buffer.from(value);
}

export class AttachmentsRepository {
  private readonly collection: Collection<Attachment>;

  constructor(db: Db) {
    this.collection = db.collection<Attachment>('attachments');
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex(
        { organisationId: 1, 'linkedTo.entityType': 1, 'linkedTo.entityId': 1, deletedAt: 1 },
        { name: 'attachments_org_linked' },
      ),
      this.collection.createIndex({ createdAt: -1 }, { name: 'attachments_createdAt' }),
    ]);
  }

  /** Zoznam neudzmazaných príloh naviazaných na entitu (najnovšie prvé). */
  async listByLinked(
    organisationId: string,
    entityType: Attachment['linkedTo']['entityType'],
    entityId: string,
  ): Promise<WithId<AttachmentWithoutThumbnail>[]> {
    const tenantId = requireTenantId(organisationId);
    return this.collection
      .find(
        tenantFilter<Attachment>(tenantId, {
          'linkedTo.entityType': entityType,
          'linkedTo.entityId': entityId,
        } as Filter<Attachment>),
        { projection: WITHOUT_THUMBNAIL },
      )
      .sort({ createdAt: -1 })
      .toArray();
  }

  async findById(
    organisationId: string,
    id: string,
    session?: ClientSession,
  ): Promise<WithId<AttachmentWithoutThumbnail> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;
    return this.collection.findOne(
      tenantFilter<Attachment>(tenantId, {
        _id: new ObjectId(id) as unknown as Attachment['_id'],
      } as Filter<Attachment>),
      { projection: WITHOUT_THUMBNAIL, ...(session ? { session } : {}) },
    );
  }

  /**
   * Jediná cesta k náhľadu. Vracia LEN `thumbnail` a `updatedAt` (na ETag) —
   * nie celý dokument, aby sa binárka nespájala s metadátami tam, kde ju
   * nikto nechce.
   *
   * BinData chodí z drivera ako BSON `Binary`, nie ako `Buffer` — schéma
   * pritom sľubuje `Uint8Array`. Normalizujeme to tu, v jedinom mieste,
   * kde binárka opúšťa DB; volajúci tak dostane niečo, čo sa dá priamo
   * poslať do `reply.send()`.
   */
  async findThumbnailById(
    organisationId: string,
    id: string,
  ): Promise<Pick<Attachment, 'thumbnail' | 'updatedAt'> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;
    const doc = await this.collection.findOne<Pick<Attachment, 'thumbnail' | 'updatedAt'>>(
      tenantFilter<Attachment>(tenantId, {
        _id: new ObjectId(id) as unknown as Attachment['_id'],
      } as Filter<Attachment>),
      { projection: { thumbnail: 1, updatedAt: 1, _id: 0 } },
    );
    if (!doc?.thumbnail) return doc;
    return {
      ...doc,
      thumbnail: { ...doc.thumbnail, data: toBuffer(doc.thumbnail.data) },
    };
  }

  async insert(
    doc: Omit<Attachment, '_id'>,
    session?: ClientSession,
  ): Promise<WithId<AttachmentWithoutThumbnail>> {
    const result = await this.collection.insertOne(
      doc as unknown as Attachment,
      session ? { session } : undefined,
    );
    const inserted = await this.collection.findOne(
      { _id: result.insertedId } as Filter<Attachment>,
      { projection: WITHOUT_THUMBNAIL, ...(session ? { session } : {}) },
    );
    if (!inserted) {
      throw new Error(
        `Attachment insert succeeded but read-back failed for _id=${String(result.insertedId)}`,
      );
    }
    return inserted;
  }

  /**
   * Nastaví danú prílohu ako hlavné foto entity. Najprv zruší príznak na
   * všetkých ASSET_PHOTO danej entity, potom ho nastaví na cieľovej prílohe.
   * Tým je zaručené max jedno `isPrimary=true` na entitu.
   */
  async setPrimary(
    organisationId: string,
    entityType: Attachment['linkedTo']['entityType'],
    entityId: string,
    attachmentId: string,
  ): Promise<void> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(attachmentId)) return;

    await this.collection.updateMany(
      tenantFilter<Attachment>(tenantId, {
        'linkedTo.entityType': entityType,
        'linkedTo.entityId': entityId,
        attachmentType: 'ASSET_PHOTO',
        isPrimary: true,
      } as Filter<Attachment>),
      { $set: { isPrimary: false, updatedAt: new Date().toISOString() } },
    );

    await this.collection.updateOne(
      tenantFilter<Attachment>(tenantId, {
        _id: new ObjectId(attachmentId) as unknown as Attachment['_id'],
      } as Filter<Attachment>),
      { $set: { isPrimary: true, updatedAt: new Date().toISOString() } },
    );
  }

  async softDelete(
    organisationId: string,
    id: string,
    deletedBy: string,
    session?: ClientSession,
  ): Promise<WithId<AttachmentWithoutThumbnail> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;
    const now = new Date().toISOString();
    const result = await this.collection.findOneAndUpdate(
      tenantFilter<Attachment>(tenantId, {
        _id: new ObjectId(id) as unknown as Attachment['_id'],
      } as Filter<Attachment>),
      { $set: { deletedAt: now, deletedBy, updatedAt: now, updatedBy: deletedBy } },
      {
        returnDocument: 'after',
        projection: WITHOUT_THUMBNAIL,
        ...(session ? { session } : {}),
      },
    );
    return result ?? null;
  }
}

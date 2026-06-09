// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Attachments repository — metadata súborov v kolekcii `attachments`.
 *
 * Reálny obsah súboru je v object storage (Vercel Blob) — tu sú len
 * metadata + `storageKey` (verejná Blob URL). Tenant-scoped cez
 * `organisationId`. Mazanie je soft-delete; reálny blob maže service.
 */

import { ObjectId } from 'mongodb';

import { requireTenantId, tenantFilter } from '../../lib/organisation-scoping.js';

import type { Attachment } from '@inventario/shared-types';
import type { ClientSession, Collection, Db, Filter, WithId } from 'mongodb';

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
  ): Promise<WithId<Attachment>[]> {
    const tenantId = requireTenantId(organisationId);
    return this.collection
      .find(
        tenantFilter<Attachment>(tenantId, {
          'linkedTo.entityType': entityType,
          'linkedTo.entityId': entityId,
        } as Filter<Attachment>),
      )
      .sort({ createdAt: -1 })
      .toArray();
  }

  async findById(
    organisationId: string,
    id: string,
    session?: ClientSession,
  ): Promise<WithId<Attachment> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;
    return this.collection.findOne(
      tenantFilter<Attachment>(tenantId, {
        _id: new ObjectId(id) as unknown as Attachment['_id'],
      } as Filter<Attachment>),
      session ? { session } : undefined,
    );
  }

  async insert(doc: Omit<Attachment, '_id'>, session?: ClientSession): Promise<WithId<Attachment>> {
    const result = await this.collection.insertOne(
      doc as unknown as Attachment,
      session ? { session } : undefined,
    );
    const inserted = await this.collection.findOne(
      { _id: result.insertedId } as Filter<Attachment>,
      session ? { session } : undefined,
    );
    if (!inserted) {
      throw new Error(
        `Attachment insert succeeded but read-back failed for _id=${String(result.insertedId)}`,
      );
    }
    return inserted;
  }

  async softDelete(
    organisationId: string,
    id: string,
    deletedBy: string,
    session?: ClientSession,
  ): Promise<WithId<Attachment> | null> {
    const tenantId = requireTenantId(organisationId);
    if (!ObjectId.isValid(id)) return null;
    const now = new Date().toISOString();
    const result = await this.collection.findOneAndUpdate(
      tenantFilter<Attachment>(tenantId, {
        _id: new ObjectId(id) as unknown as Attachment['_id'],
      } as Filter<Attachment>),
      { $set: { deletedAt: now, deletedBy, updatedAt: now, updatedBy: deletedBy } },
      { returnDocument: 'after', ...(session ? { session } : {}) },
    );
    return result ?? null;
  }
}

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Attachments routes — nahrávanie a správa príloh majetku (foto, doklady).
 *
 * Úložisko: Vercel Blob (rovnako ako tenant logo, ADR-0028 v2). Server-side
 * upload — súbor tečie cez API, zvaliduje sa (magic bytes + veľkosť), nahrá
 * do Blobu a metadata sa zapíšu do kolekcie `attachments`.
 *
 * RBAC:
 *   - GET    /v1/assets/:id/attachments   EMPLOYEE+   (zobrazenie)
 *   - POST   /v1/assets/:id/attachments   ASSET_MANAGER + ADMIN
 *   - DELETE /v1/attachments/:id          ASSET_MANAGER + ADMIN
 *
 * Povolené typy (magic bytes): PNG, JPEG, WEBP (→ ASSET_PHOTO) a PDF
 * (→ ASSET_DOCUMENT). Max veľkosť 4 MB (strop Vercelu, viď server.ts).
 */

import { createHash } from 'node:crypto';

import { del, put } from '@vercel/blob';
import { z } from 'zod';

import { ensureIndexesOnBoot } from '../../lib/ensure-indexes.js';
import { stripImageMetadata } from '../../lib/strip-image-metadata.js';
import { BadRequestError, HttpError, NotFoundError } from '../../plugins/error-handler.js';
import { AssetsRepository } from '../assets/assets.repository.js';

import { AttachmentsRepository } from './attachments.repository.js';

import type { Attachment } from '@inventario/shared-types';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// 4 MB, nie 20: Vercel zahodí request nad 4,5 MB s 413 ešte pred našou
// funkciou (overené na produkcii 2026-09-01). Musí zostať v zhode
// s `limits.fileSize` v server.ts. Väčšie súbory rieši ADR-0037.
const ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;

const AssetIdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát ID (očakáva sa 24 hex znakov).'),
});

const AttachmentIdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát ID (očakáva sa 24 hex znakov).'),
});

const AttachmentListResponseSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
});

/** Detekcia typu z magic bytes — nie z deklarovaného Content-Type. */
function detectFileType(
  buf: Buffer,
): { ext: string; contentType: string; kind: 'image' | 'pdf' } | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: 'png', contentType: 'image/png', kind: 'image' };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg', kind: 'image' };
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return { ext: 'webp', contentType: 'image/webp', kind: 'image' };
  }
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return { ext: 'pdf', contentType: 'application/pdf', kind: 'pdf' };
  }
  return null;
}

/** API tvar prílohy (bez interných polí). */
function toApiShape(a: Attachment & { _id: unknown }): Record<string, unknown> {
  return {
    id: String(a._id),
    originalFilename: a.originalFilename,
    url: a.storageKey, // verejná Blob URL
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    attachmentType: a.attachmentType,
    caption: a.caption,
    isPrimary: a.isPrimary,
    createdAt: a.createdAt,
  };
}

const attachmentsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const attachmentsRepo = new AttachmentsRepository(fastify.mongo.db);
  const assetsRepo = new AssetsRepository(fastify.mongo.db);
  await ensureIndexesOnBoot(fastify, 'attachments', attachmentsRepo);

  // Multipart parser je registrovaný GLOBÁLNE v server.ts (limit fileSize
  // pokrýva aj prílohy). Veľkosť kontrolujeme ešte raz v handleri.

  const canRead = fastify.requireRole(['EMPLOYEE', 'ASSET_MANAGER', 'ADMIN', 'EXTERNAL']);
  const canWrite = fastify.requireRole(['ASSET_MANAGER', 'ADMIN']);

  // --- GET /v1/assets/:id/attachments --------------------------------------
  app.get(
    '/v1/assets/:id/attachments',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Attachments'],
        summary: 'Zoznam príloh majetku',
        description: 'Prílohy (foto, doklady) naviazané na majetok, najnovšie prvé.',
        security: [{ bearerAuth: [] }],
        params: AssetIdParamsSchema,
        response: { 200: AttachmentListResponseSchema },
      },
    },
    async (request) => {
      const tenantId = String(request.currentUser.organisationId);
      const { id } = request.params;

      const asset = await assetsRepo.findById(tenantId, id);
      if (!asset) throw new NotFoundError('Asset', id);

      const items = await attachmentsRepo.listByLinked(tenantId, 'Asset', id);
      return { data: items.map((a) => toApiShape(a)) };
    },
  );

  // --- POST /v1/assets/:id/attachments (multipart) -------------------------
  // Plain `fastify` (nie `app`) — multipart nemá Zod body schému.
  fastify.post(
    '/v1/assets/:id/attachments',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Attachments'],
        summary: 'Nahrať prílohu majetku (ASSET_MANAGER/ADMIN)',
        description:
          'Multipart upload jedného súboru (PNG/JPEG/WEBP → foto, PDF → doklad). ' +
          'Max 4 MB (strop platformy). Súbor sa uloží do Vercel Blob, metadata do DB.',
        security: [{ bearerAuth: [] }],
        consumes: ['multipart/form-data'],
      },
    },
    async (request, reply) => {
      const tenantId = String(request.currentUser.organisationId);
      const actorId = String(request.currentUser._id);
      const { id } = request.params as { id: string };

      if (!/^[a-f\d]{24}$/i.test(id)) {
        throw new BadRequestError('Neplatný formát ID majetku.');
      }

      const asset = await assetsRepo.findById(tenantId, id);
      if (!asset) throw new NotFoundError('Asset', id);

      const data = await request.file();
      if (!data) {
        throw new BadRequestError('Chýba súbor. Očakáva sa multipart/form-data s jedným súborom.');
      }

      let buffer: Buffer;
      try {
        buffer = await data.toBuffer();
      } catch {
        throw new HttpError(
          413,
          `Súbor je príliš veľký. Maximálna veľkosť je ${ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB.`,
        );
      }
      if (data.file.truncated || buffer.byteLength > ATTACHMENT_MAX_BYTES) {
        throw new HttpError(
          413,
          `Súbor je príliš veľký. Maximálna veľkosť je ${ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB.`,
        );
      }

      const detected = detectFileType(buffer);
      if (!detected) {
        throw new BadRequestError(
          'Nepodporovaný typ súboru. Povolené sú PNG, JPEG, WEBP (foto) a PDF (doklad).',
        );
      }

      const blobToken = process.env['BLOB_READ_WRITE_TOKEN'];
      if (!blobToken) {
        throw new HttpError(500, 'Upload nie je nakonfigurovaný (chýba BLOB_READ_WRITE_TOKEN).');
      }

      // Privacy: pri fotkách odstráň EXIF/XMP metadata (GPS, zariadenie, čas)
      // pred uložením. PDF doklady ostávajú nedotknuté. sha256 sa počíta až
      // z očisteného bufferu (to je presne to, čo uložíme do Blobu).
      const storedBuffer =
        detected.kind === 'image' ? stripImageMetadata(buffer, detected.ext) : buffer;

      const sha256 = createHash('sha256').update(storedBuffer).digest('hex');
      const blobPath = `attachments/${tenantId}/${id}/${Date.now()}.${detected.ext}`;
      const { url } = await put(blobPath, storedBuffer, {
        access: 'public',
        contentType: detected.contentType,
        token: blobToken,
      });

      const now = new Date().toISOString();
      const doc: Omit<Attachment, '_id'> = {
        organisationId: tenantId,
        originalFilename: data.filename || `${Date.now()}.${detected.ext}`,
        storageKey: url,
        mimeType: detected.contentType,
        sizeBytes: storedBuffer.byteLength,
        sha256,
        attachmentType: detected.kind === 'image' ? 'ASSET_PHOTO' : 'ASSET_DOCUMENT',
        linkedTo: { entityType: 'Asset', entityId: id },
        caption: null,
        imageDimensions: null,
        isPublic: true,
        isPrimary: false,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
        deletedAt: null,
        deletedBy: null,
      };

      const inserted = await attachmentsRepo.insert(doc);

      // Audit: príloha pridaná k majetku. Cieľ = Asset, aby sa záznam
      // zobrazil v audit tabe detailu majetku (GET /v1/assets/:id/audit).
      await fastify.auditLog.record(request.currentUser, request, {
        action: 'ASSET_ATTACHMENT_ADDED',
        target: {
          entityType: 'Asset',
          entityId: id,
          snapshot: {
            attachmentId: String(inserted._id),
            originalFilename: doc.originalFilename,
            attachmentType: doc.attachmentType,
            mimeType: doc.mimeType,
            sizeBytes: doc.sizeBytes,
          },
        },
        description:
          doc.attachmentType === 'ASSET_PHOTO'
            ? 'Pridaná fotografia k majetku.'
            : 'Pridaný doklad k majetku.',
      });

      return reply.status(201).send(toApiShape(inserted));
    },
  );

  // --- PATCH /v1/attachments/:id/primary -----------------------------------
  // Nastaví fotku ako hlavné foto majetku (zobrazí sa na hero karte).
  app.patch(
    '/v1/attachments/:id/primary',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Attachments'],
        summary: 'Nastaviť prílohu ako hlavné foto (ASSET_MANAGER/ADMIN)',
        description: 'Označí ASSET_PHOTO ako hlavné foto entity; ostatné sa odznačia.',
        security: [{ bearerAuth: [] }],
        params: AttachmentIdParamsSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const tenantId = String(request.currentUser.organisationId);
      const { id } = request.params;

      const existing = await attachmentsRepo.findById(tenantId, id);
      if (!existing || existing.deletedAt) throw new NotFoundError('Attachment', id);
      if (existing.attachmentType !== 'ASSET_PHOTO') {
        throw new BadRequestError('Hlavné foto možno nastaviť len pre fotografiu (ASSET_PHOTO).');
      }

      await attachmentsRepo.setPrimary(
        tenantId,
        existing.linkedTo.entityType,
        String(existing.linkedTo.entityId),
        id,
      );

      await fastify.auditLog.record(request.currentUser, request, {
        action: 'ASSET_ATTACHMENT_SET_PRIMARY',
        target: {
          entityType: existing.linkedTo.entityType,
          entityId: String(existing.linkedTo.entityId),
          snapshot: {
            attachmentId: id,
            originalFilename: existing.originalFilename,
          },
        },
        description: 'Príloha označená ako hlavné foto majetku.',
      });

      return reply.status(204).send(null);
    },
  );

  // --- DELETE /v1/attachments/:id ------------------------------------------
  app.delete(
    '/v1/attachments/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Attachments'],
        summary: 'Zmazať prílohu (ASSET_MANAGER/ADMIN)',
        description: 'Soft-delete metadata + odstránenie blobu z úložiska (best-effort).',
        security: [{ bearerAuth: [] }],
        params: AttachmentIdParamsSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const tenantId = String(request.currentUser.organisationId);
      const actorId = String(request.currentUser._id);
      const { id } = request.params;

      const existing = await attachmentsRepo.findById(tenantId, id);
      if (!existing || existing.deletedAt) throw new NotFoundError('Attachment', id);

      await attachmentsRepo.softDelete(tenantId, id, actorId);

      await fastify.auditLog.record(request.currentUser, request, {
        action: 'ASSET_ATTACHMENT_REMOVED',
        target: {
          entityType: existing.linkedTo.entityType,
          entityId: String(existing.linkedTo.entityId),
          snapshot: {
            attachmentId: id,
            originalFilename: existing.originalFilename,
            attachmentType: existing.attachmentType,
          },
        },
        description:
          existing.attachmentType === 'ASSET_PHOTO'
            ? 'Zmazaná fotografia majetku.'
            : 'Zmazaný doklad majetku.',
      });

      // Best-effort zmazanie blobu — zlyhanie nesmie rozbiť odpoveď.
      const blobToken = process.env['BLOB_READ_WRITE_TOKEN'];
      if (blobToken && existing.storageKey.includes('.public.blob.vercel-storage.com')) {
        try {
          await del(existing.storageKey, { token: blobToken });
        } catch (err) {
          request.log.warn({ err, key: existing.storageKey }, 'Blob sa nepodarilo zmazať');
        }
      }

      return reply.status(204).send(null);
    },
  );
};

export default attachmentsRoutes;

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Attachments routes — nahrávanie a správa príloh majetku (foto, doklady).
 *
 * Úložisko: PRIVATE Vercel Blob store (ADR-0037). Dve cesty nahrávania:
 *
 *   - multipart cez API (táto routa) — do 4 MB, strop platformy
 *   - podpísaný PUT priamo do storu (`upload-url` + `confirm`) — do 25 MB
 *
 * Obe končia rovnako: objekt v privátnom store, metadata v `attachments`,
 * náhľad v BinData. Staré prílohy vo verejnom store zostávajú čitateľné —
 * rozlišuje ich `storageAccess`.
 *
 * RBAC:
 *   - GET    /v1/assets/:id/attachments   EMPLOYEE+   (zobrazenie)
 *   - POST   /v1/assets/:id/attachments   ASSET_MANAGER + ADMIN
 *   - DELETE /v1/attachments/:id          ASSET_MANAGER + ADMIN
 *
 * Povolené typy (magic bytes): PNG, JPEG, WEBP (→ ASSET_PHOTO) a PDF
 * (→ ASSET_DOCUMENT). Max veľkosť 4 MB (strop Vercelu, viď server.ts).
 */

import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import { ensureIndexesOnBoot } from '../../lib/ensure-indexes.js';
import {
  ALLOWED_UPLOAD_CONTENT_TYPES,
  detectFileType,
  extensionForContentType,
  type AllowedUploadContentType,
} from '../../lib/file-type.js';
import { stripImageMetadata } from '../../lib/strip-image-metadata.js';
import { canRenderThumbnail, createThumbnail } from '../../lib/thumbnail.js';
import { BadRequestError, HttpError, NotFoundError } from '../../plugins/error-handler.js';
import { AssetsRepository } from '../assets/assets.repository.js';

import { AttachmentsRepository } from './attachments.repository.js';

import type { AttachmentWithoutThumbnail } from './attachments.repository.js';
import type { Attachment, StoredImage } from '@inventario/shared-types';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
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

/**
 * Strop pre originál pri PRIAMOM uploade do storu.
 *
 * Vyšší než 4 MB pri multipart ceste: priamy PUT ide mimo funkcie, takže
 * platformový strop 4,5 MB na telo requestu sa naň nevzťahuje. Krok `confirm`
 * si ale objekt sťahuje do funkcie (pamäť 1024 MB, maxDuration 30 s), tak to
 * nemôže byť neobmedzené. 25 MB pokryje fotku z mobilu aj skenovaný doklad.
 */
const ORIGINAL_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Náhľad je pohodlie, nie podmienka. Keby jeho výroba mohla zhodiť upload,
 * stačil by neobvykle zakódovaný alebo mierne poškodený obrázok a používateľ
 * by prílohu neuložil vôbec — hoci samotný súbor je v poriadku a uložiť sa dá.
 *
 * Odhalil to test s umelo zostaveným JPEG-om: Skia ho odmietla dekódovať
 * a celý POST skončil 500-kou.
 */
async function tryCreateThumbnail(
  input: { data: Buffer; mimeType: string },
  logger: FastifyBaseLogger,
): Promise<StoredImage | null> {
  if (!canRenderThumbnail(input.mimeType)) return null;
  try {
    return await createThumbnail(input);
  } catch (err) {
    logger.warn({ err, mimeType: input.mimeType }, 'Náhľad sa nepodarilo vyrobiť');
    return null;
  }
}

/** Prefix cesty pre prílohy jedného majetku. Určuje ho server, nikdy klient. */
function attachmentPathnamePrefix(tenantId: string, assetId: string): string {
  return `attachments/${tenantId}/${assetId}/`;
}

function buildAttachmentPathname(
  tenantId: string,
  assetId: string,
  contentType: AllowedUploadContentType,
): string {
  const ext = extensionForContentType(contentType);
  return `${attachmentPathnamePrefix(tenantId, assetId)}${randomUUID()}.${ext}`;
}

const UploadUrlBodySchema = z
  .object({
    contentType: z.enum(ALLOWED_UPLOAD_CONTENT_TYPES),
  })
  .strict();

const UploadUrlResponseSchema = z.object({
  uploadUrl: z.string().url(),
  pathname: z.string(),
  expiresAt: z.string(),
  maxBytes: z.number().int().positive(),
  /**
   * Hlavičky, ktoré MUSÍ klient poslať s PUT požiadavkou. Diktuje ich
   * server, nie klient — dôvod je v `uploadRequestHeaders`.
   */
  headers: z.record(z.string(), z.string()),
});

/**
 * Verzia control-plane API Vercel Blobu, ktorú posiela `@vercel/blob@2.8.0`
 * (`BLOB_API_VERSION` v jeho builde). Nie je z balíka exportovaná, takže je
 * tu ako konštanta a stráži ju test — pri bumpe SDK treba overiť, či sa
 * nezmenila.
 */
const BLOB_API_VERSION = '12';

/**
 * Hlavičky pre PUT na podpísanú URL.
 *
 * Podpísaná URL sama nestačí. Endpoint `https://vercel.com/api/blob/` je
 * control-plane rozhranie SDK a parametre uploadu čaká v hlavičkách, nie
 * v URL: bez `x-vercel-blob-access` a `x-content-type` odpovie 200, ale
 * objekt neuloží tam, kde ho `confirm` potom hľadá — a užívateľ vidí
 * „Objekt v úložisku neexistuje". Overené na produkcii 2026-09-02.
 *
 * Prečo ich diktuje server: `access` musí byť `private` bez ohľadu na to,
 * čo si myslí klient, a verzia API patrí k SDK, ktoré má v rukách API.
 * Klient dopĺňa len `Content-Type` a `x-content-length`, ktoré vie z File.
 *
 * SDK-cesta `uploadPresigned` z `@vercel/blob/client` sa použiť nedá: jej
 * fetch na `handleUploadUrl` nemá `credentials: 'include'`, takže by naša
 * cookie neprešla a endpoint by vrátil 401.
 */
function uploadRequestHeaders(
  contentType: AllowedUploadContentType,
  storeId: string | undefined,
): Record<string, string> {
  return {
    'x-api-version': BLOB_API_VERSION,
    'x-vercel-blob-access': 'private',
    'x-content-type': contentType,
    ...(storeId === undefined ? {} : { 'x-vercel-blob-store-id': storeId }),
  };
}

const ConfirmUploadBodySchema = z
  .object({
    pathname: z.string().min(1).max(500),
    originalFilename: z.string().min(1).max(500),
    caption: z.string().max(500).nullable().optional(),
  })
  .strict();

const DownloadResponseSchema = z.object({
  url: z.string(),
  /** `null` pri starých verejných prílohách — tie neexpirujú. */
  expiresAt: z.string().nullable(),
});

const AttachmentListResponseSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
});

/** Detekcia typu z magic bytes — nie z deklarovaného Content-Type. */

/** API tvar prílohy (bez interných polí). */
// Berie prílohu BEZ náhľadu — a je to zámer, nie zjednodušenie. Náhľad je
// BinData a do JSON odpovede nepatrí; klient si ho vypýta cez
// GET /v1/attachments/:id/thumbnail. Ak by sem niekto chcel `thumbnail`
// pridať, TypeScript ho zastaví už tu.
function toApiShape(a: AttachmentWithoutThumbnail & { _id: unknown }): Record<string, unknown> {
  return {
    id: String(a._id),
    originalFilename: a.originalFilename,
    // Pri PRIVATE prílohách je to CESTA v store, nie verejná URL — tá pri
    // privátnom objekte existovať nemôže. Klient musí podľa storageAccess
    // rozhodnúť, či si vypýta podpísanú URL cez /download.
    url: a.storageKey,
    storageAccess: a.storageAccess,
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

      if (!fastify.objectStorage.isConfigured) {
        throw new HttpError(503, 'Úložisko príloh nie je nakonfigurované.');
      }

      // Privacy: pri fotkách odstráň EXIF/XMP metadata (GPS, zariadenie, čas)
      // pred uložením. PDF doklady ostávajú nedotknuté. sha256 sa počíta až
      // z očisteného bufferu (to je presne to, čo uložíme do Blobu).
      const storedBuffer =
        detected.kind === 'image' ? stripImageMetadata(buffer, detected.ext) : buffer;

      const sha256 = createHash('sha256').update(storedBuffer).digest('hex');
      const pathname = `${attachmentPathnamePrefix(tenantId, id)}${randomUUID()}.${detected.ext}`;
      await fastify.objectStorage.put({
        pathname,
        body: storedBuffer,
        contentType: detected.contentType,
      });

      // Náhľad robíme aj tu, nielen v `confirm`: bez neho by výpis majetku
      // musel pre každú fotku pýtať podpísanú URL na originál.
      const thumbnail = await tryCreateThumbnail(
        { data: storedBuffer, mimeType: detected.contentType },
        request.log,
      );

      const now = new Date().toISOString();
      const doc: Omit<Attachment, '_id'> = {
        organisationId: tenantId,
        originalFilename: data.filename || `${Date.now()}.${detected.ext}`,
        // Pri privátnych objektoch žiadna trvalá URL neexistuje (podpis
        // expiruje), tak `storageKey` nesie rovnakú cestu ako
        // `storagePathname`. Historický názov poľa zostal.
        storageKey: pathname,
        storagePathname: pathname,
        storageAccess: 'PRIVATE',
        thumbnail,
        mimeType: detected.contentType,
        sizeBytes: storedBuffer.byteLength,
        sha256,
        attachmentType: detected.kind === 'image' ? 'ASSET_PHOTO' : 'ASSET_DOCUMENT',
        linkedTo: { entityType: 'Asset', entityId: id },
        caption: null,
        imageDimensions: thumbnail ? { width: thumbnail.width, height: thumbnail.height } : null,
        // Objekt leží v privátnom store — verejne čitateľný nie je.
        isPublic: false,
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

      // Best-effort zmazanie objektu — zlyhanie nesmie rozbiť odpoveď.
      //
      // Len privátny store. Vetva pre starý public Blob tu bola do
      // 2026-09-02, kým existovali prílohy so `storageAccess:
      // 'PUBLIC_LEGACY'`; po migrácii ich nemá ani jedna a store je
      // zrušený. Čítacia vetva v `/download` zostáva — nepotrebuje token
      // a v dev či demo databázach také riadky ešte môžu byť.
      try {
        if (existing.storageAccess === 'PRIVATE' && existing.storagePathname) {
          await fastify.objectStorage.remove(existing.storagePathname);
        } else {
          request.log.warn(
            { id, storageAccess: existing.storageAccess },
            'Príloha nie je v privátnom store — objekt sa nemazal, len záznam',
          );
        }
      } catch (err) {
        request.log.warn({ err, key: existing.storageKey }, 'Objekt sa nepodarilo zmazať');
      }

      return reply.status(204).send(null);
    },
  );

  // --- GET /v1/attachments/:id/thumbnail -----------------------------------
  //
  // Servíruje náhľad z BinData. Za autentifikáciou, s tenant scope, pretože
  // fotka majetku je interný údaj — na rozdiel od loga organizácie.
  //
  // ŽIADNA response schéma: `fastify-type-provider-zod` používa response
  // schému aj ako runtime serializér, takže by z Bufferu spravil JSON.
  // Content-Type a telo nastavujeme sami.
  //
  // `private, no-cache`: odpoveď závisí od prihláseného používateľa a
  // CDN ju nesmie zdieľať. ETag + `If-None-Match` napriek tomu ušetria
  // prenos — prehliadač si náhľad drží a pýta sa len na zmenu.
  app.get(
    '/v1/attachments/:id/thumbnail',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Attachments'],
        summary: 'Náhľad prílohy (JPEG, dlhšia strana 800 px)',
        security: [{ bearerAuth: [] }],
        params: AttachmentIdParamsSchema,
      },
    },
    async (request, reply) => {
      const tenantId = String(request.currentUser.organisationId);
      const { id } = request.params;

      const found = await attachmentsRepo.findThumbnailById(tenantId, id);
      if (!found?.thumbnail) throw new NotFoundError('Thumbnail', id);

      // ETag z updatedAt: náhľad sa mení len spolu s dokumentom prílohy.
      const etag = `W/"thumb-${id}-${found.updatedAt}"`;
      reply.header('Cache-Control', 'private, no-cache');
      reply.header('ETag', etag);

      if (request.headers['if-none-match'] === etag) {
        return reply.status(304).send();
      }

      reply.header('Content-Type', found.thumbnail.mimeType);
      // Repository už BinData normalizovalo na Buffer (`bsonBinaryToBuffer`).
      return reply.send(found.thumbnail.data);
    },
  );

  // --- POST /v1/assets/:id/attachments/upload-url --------------------------
  //
  // Krok 1 z dvoch. Vráti podpísanú PUT URL; prehliadač nahrá originál PRIAMO
  // do private storu, takže sa obchádza 4,5 MB strop Vercelu na telo requestu.
  //
  // `pathname` si určuje SERVER, nie klient. Keby ho posielal klient, mohol by
  // si vypýtať podpis na cestu iného tenanta. Tenant a asset sú preto v ceste
  // zapečené tu a `confirm` si ich znova overí.
  app.post(
    '/v1/assets/:id/attachments/upload-url',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Attachments'],
        summary: 'Podpísaná URL na priamy upload originálu do private storu',
        description:
          'Krok 1/2. Klient dostane PUT URL a nahrá na ňu súbor priamo. ' +
          'Potom musí zavolať /confirm, inak príloha nevznikne.',
        security: [{ bearerAuth: [] }],
        params: AssetIdParamsSchema,
        body: UploadUrlBodySchema,
        response: { 200: UploadUrlResponseSchema },
      },
    },
    async (request, reply) => {
      const tenantId = String(request.currentUser.organisationId);
      const { id } = request.params;
      const { contentType } = request.body;

      const asset = await assetsRepo.findById(tenantId, id);
      if (!asset) throw new NotFoundError('Asset', id);

      if (!fastify.objectStorage.isConfigured) {
        throw new HttpError(503, 'Úložisko príloh nie je nakonfigurované.');
      }

      const pathname = buildAttachmentPathname(tenantId, id, contentType);
      const presigned = await fastify.objectStorage.presignUpload({ pathname, contentType });

      return reply.send({
        uploadUrl: presigned.url,
        pathname: presigned.pathname,
        expiresAt: presigned.expiresAt,
        maxBytes: ORIGINAL_MAX_BYTES,
        headers: uploadRequestHeaders(contentType, fastify.config.BLOB_PRIVATE_STORE_ID),
      });
    },
  );

  // --- POST /v1/assets/:id/attachments/confirm -----------------------------
  //
  // Krok 2 z dvoch. Až tu vzniká záznam v DB.
  //
  // Server si objekt STIAHNE a prezrie, hoci ho práve nahral klient. Dôvody:
  //
  //   1. EXIF. Priamy upload obchádza `stripImageMetadata`, takže GPS súradnice
  //      a sériové číslo telefónu by sa dostali do storu nedotknuté. To je
  //      vecná regresia v ochrane osobných údajov, nie detail — fotky majetku
  //      sa robia mobilom. Preto stiahnuť, odstrániť, prepísať.
  //   2. Magic bytes. `contentType` v kroku 1 tvrdí klient. Čo v store naozaj
  //      leží, vie server až keď sa na to pozrie.
  //   3. Náhľad. Vyrobiť sa dá len z obsahu, a keď už je stiahnutý, je zadarmo.
  //
  // 4,5 MB strop Vercelu sa na tento fetch NEVZŤAHUJE — je to limit tela
  // requestu a odpovede _funkcie voči klientovi_, nie odchádzajúcich volaní.
  app.post(
    '/v1/assets/:id/attachments/confirm',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canWrite],
      schema: {
        tags: ['Attachments'],
        summary: 'Potvrdenie uploadu — overí obsah, odstráni EXIF, vyrobí náhľad',
        description:
          'Krok 2/2. Bez tohto volania príloha v evidencii nevznikne a objekt ' +
          'v store zostane osirelý.',
        security: [{ bearerAuth: [] }],
        params: AssetIdParamsSchema,
        body: ConfirmUploadBodySchema,
      },
    },
    async (request, reply) => {
      const tenantId = String(request.currentUser.organisationId);
      const actorId = String(request.currentUser._id);
      const { id } = request.params;
      const { pathname, originalFilename, caption } = request.body;

      const asset = await assetsRepo.findById(tenantId, id);
      if (!asset) throw new NotFoundError('Asset', id);

      // Cesta musí patriť TOMUTO tenantovi a TOMUTO majetku. Bez tejto
      // kontroly by stačilo poslať cudziu cestu a príloha by sa naviazala
      // na vlastný majetok — obsah by pritom patril niekomu inému.
      const expectedPrefix = attachmentPathnamePrefix(tenantId, id);
      if (!pathname.startsWith(expectedPrefix)) {
        throw new BadRequestError('Cesta k objektu nepatrí tomuto majetku.');
      }

      const stored = await fastify.objectStorage.head(pathname);
      if (!stored) {
        throw new BadRequestError(
          'Objekt v úložisku neexistuje. Nahral sa súbor na podpísanú URL?',
        );
      }
      if (stored.sizeBytes > ORIGINAL_MAX_BYTES) {
        // Objekt necháme tak, nech sa dá zistiť, čo sa stalo; upratovanie
        // osirelých objektov je vec retenčného jobu, nie tejto cesty.
        throw new HttpError(413, `Súbor je príliš veľký (max ${ORIGINAL_MAX_BYTES} B).`);
      }

      const raw = await fastify.objectStorage.get(pathname);

      const detected = detectFileType(raw);
      if (!detected) {
        throw new BadRequestError('Nepodporovaný typ súboru (povolené: PNG, JPEG, WEBP, PDF).');
      }

      const cleaned = detected.kind === 'image' ? stripImageMetadata(raw, detected.ext) : raw;

      // Prepíšeme aj vtedy, keď sa obsah nezmenil: `contentType` v store
      // pochádza z klientovho tvrdenia a tu ho opravujeme na zistený.
      // Cesta, na ktorú objekt naozaj skončil. Prepis vracia `pathname` zo
      // store a ten je jediný, za ktorým sa dá objekt neskôr prečítať.
      const { pathname: storedPathname } = await fastify.objectStorage.put({
        pathname,
        body: cleaned,
        contentType: detected.contentType,
      });

      const thumbnail = await tryCreateThumbnail(
        { data: cleaned, mimeType: detected.contentType },
        request.log,
      );

      const sha256 = createHash('sha256').update(cleaned).digest('hex');
      const now = new Date().toISOString();

      const doc: Omit<Attachment, '_id'> = {
        organisationId: tenantId,
        originalFilename: originalFilename || `${Date.now()}.${detected.ext}`,
        // storageKey nesie historicky celú URL. Pri privátnych objektoch
        // žiadna trvalá URL neexistuje (podpis expiruje), tak sem ide cesta.
        storageKey: storedPathname,
        storagePathname: storedPathname,
        storageAccess: 'PRIVATE',
        thumbnail,
        mimeType: detected.contentType,
        sizeBytes: cleaned.byteLength,
        sha256,
        attachmentType: detected.kind === 'image' ? 'ASSET_PHOTO' : 'ASSET_DOCUMENT',
        linkedTo: { entityType: 'Asset', entityId: id },
        caption: caption ?? null,
        imageDimensions: thumbnail ? { width: thumbnail.width, height: thumbnail.height } : null,
        isPublic: false,
        isPrimary: false,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
        deletedAt: null,
        deletedBy: null,
      };

      const inserted = await attachmentsRepo.insert(doc);

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
            storageAccess: doc.storageAccess,
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

  // --- GET /v1/attachments/:id/download ------------------------------------
  //
  // Vráti podpísanú GET URL, nie samotný súbor. Originál tak nikdy neprechádza
  // funkciou a 4,5 MB strop odpovede nehrá rolu.
  //
  // Podpísaná URL je do expirácie PRENOSNÁ — kto ju získa, súbor si stiahne.
  // Preto krátke TTL a preto sa NIKDY neloguje celá (`lib/storage`).
  app.get(
    '/v1/attachments/:id/download',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canRead],
      schema: {
        tags: ['Attachments'],
        summary: 'Podpísaná URL na stiahnutie originálu',
        security: [{ bearerAuth: [] }],
        params: AttachmentIdParamsSchema,
        response: { 200: DownloadResponseSchema },
      },
    },
    async (request, reply) => {
      const tenantId = String(request.currentUser.organisationId);
      const { id } = request.params;

      const attachment = await attachmentsRepo.findById(tenantId, id);
      if (!attachment) throw new NotFoundError('Attachment', id);

      // Staré prílohy ležia vo verejnom store a podpisovať sa nedajú —
      // `storageKey` je pri nich rovno verejná URL. Rozlíšenie drží
      // `storageAccess`, aby sa staré a nové dali servírovať súbežne.
      if (attachment.storageAccess !== 'PRIVATE' || !attachment.storagePathname) {
        return reply.send({ url: attachment.storageKey, expiresAt: null });
      }

      const signed = await fastify.objectStorage.presignDownload(attachment.storagePathname);
      return reply.send({ url: signed.url, expiresAt: signed.expiresAt });
    },
  );
};

export default attachmentsRoutes;

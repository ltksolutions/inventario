// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Prenos príloh a lôg zo starého PUBLIC Blobu na novú cestu (ADR-0037).
 *
 * Čo robí
 * -------
 *   prílohy — stiahne originál z verejnej URL, uloží ho do PRIVATE storu,
 *             vyrobí náhľad do BinData a prepne `storageAccess` na
 *             `PRIVATE`; `storageKey` odvtedy nesie cestu v store, nie URL
 *             (rovnaká konvencia ako pri novom uploade — viď `toApiShape`)
 *   logá    — stiahne, uloží do `brandKit.logo` ako BinData a `logoUrl`
 *             prepíše na verejný endpoint `/v1/public/organisations/:slug/logo`
 *
 * Staré objekty v Blobe NEMAŽE. Kým sa nová cesta neoverí v prevádzke, sú
 * to jediné existujúce kópie; zmazať sa dajú neskôr samostatne.
 *
 * Idempotentná dvojako: filter preskočí, čo je už prenesené, a cesta v store
 * sa odvodzuje od `_id` prílohy (nie z náhodného UUID), takže opakovaný beh
 * prepíše ten istý objekt namiesto vytvárania duplikátu.
 *
 * Čiastočné zlyhanie
 * ------------------
 * Migrácia robí sieťové volania — sťahuje z Blobu a nahráva do storu. Jedna
 * nedostupná položka preto nesmie zhodiť celý beh: chyba sa zaloguje a ide
 * sa ďalej. Na konci, ak niečo zostalo, migrácia hodí výnimku, takže sa
 * NEOZNAČÍ ako dokončená a pri ďalšom deployi sa dobehne zvyšok (hotové
 * položky filter preskočí).
 *
 * Beží deploy-time cez `POST /v1/system/migrations/run`, nie pri štarte API
 * (viď `runner.ts`) — zlyhanie teda zčervená workflow, appku nezhodí. Staré
 * prílohy zostávajú medzitým čitateľné cez pôvodné verejné URL.
 */

import { detectFileType } from '../lib/file-type.js';
import { selectObjectStorage } from '../lib/storage/index.js';
import { stripImageMetadata } from '../lib/strip-image-metadata.js';
import { canRenderThumbnail, createThumbnail } from '../lib/thumbnail.js';

import type { StoredImage } from '@inventario/shared-types';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

/** Strop na jednu položku. Väčšiu do pamäte funkcie neťaháme. */
const MAX_FETCH_BYTES = 25 * 1024 * 1024;

async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} pri sťahovaní objektu`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_FETCH_BYTES) {
    throw new Error(`Objekt má ${buf.byteLength} B, strop je ${MAX_FETCH_BYTES} B`);
  }
  return buf;
}

export async function migrate_2026_09_02_attachments_to_private_blob(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const storage = selectObjectStorage({
    logger,
    token: process.env['BLOB_PRIVATE_READ_WRITE_TOKEN'],
    storeId: process.env['BLOB_PRIVATE_STORE_ID'],
    nodeEnv: (process.env['NODE_ENV'] ?? 'development') as 'development' | 'test' | 'production',
  });

  // Bez privátneho storu by sa prílohy „preniesli" do pamäte procesu a
  // v DB by zostali cesty, za ktorými nič nie je. Radšej neurobiť nič.
  if (storage.name === 'stub') {
    logger.warn(
      { storage: storage.name },
      'Private store nie je nakonfigurovaný — prenos preskočený, migrácia sa nedokončí.',
    );
    throw new Error('BLOB_PRIVATE_READ_WRITE_TOKEN nie je nastavený — prenos sa nedá vykonať.');
  }

  const publicApiBaseUrl = (process.env['PUBLIC_API_BASE_URL'] ?? '').replace(/\/+$/, '');

  // --- prílohy -------------------------------------------------------------
  //
  // `storageAccess` staré dokumenty nemajú vôbec (pole pribudlo 2026-09-02),
  // takže filter musí počítať aj s jeho neprítomnosťou — `$ne` to spĺňa.
  const attachments = await db
    .collection('attachments')
    .find({ storageAccess: { $ne: 'PRIVATE' }, storageKey: { $regex: '^https://' } })
    .toArray();

  let attachmentsDone = 0;
  let attachmentsFailed = 0;

  for (const doc of attachments) {
    const id = String(doc['_id']);
    try {
      const url = String(doc['storageKey']);
      const organisationId = String(doc['organisationId']);
      const linkedTo = doc['linkedTo'] as { entityId?: unknown } | undefined;
      const entityId = String(linkedTo?.entityId ?? id);

      const bytes = await fetchBytes(url);

      // Typ z magic bytes, nie z uloženého `mimeType`: ten pochádza
      // z pôvodného uploadu a nemusí sedieť s tým, čo v Blobe reálne leží.
      const detected = detectFileType(bytes);
      if (!detected) {
        throw new Error('Obsah sa nepodarilo rozpoznať (nie je PNG/JPEG/WEBP/PDF)');
      }

      const pathname = `attachments/${organisationId}/${entityId}/${id}.${detected.ext}`;
      await storage.put({ pathname, body: bytes, contentType: detected.contentType });

      let thumbnail: StoredImage | null = null;
      if (canRenderThumbnail(detected.contentType)) {
        try {
          thumbnail = await createThumbnail({ data: bytes, mimeType: detected.contentType });
        } catch (err) {
          logger.warn({ err, id }, 'Náhľad pre prílohu sa nepodarilo vyrobiť');
        }
      }

      await db.collection('attachments').updateOne(
        { _id: doc['_id'] },
        {
          $set: {
            storageKey: pathname,
            storagePathname: pathname,
            storageAccess: 'PRIVATE',
            mimeType: detected.contentType,
            isPublic: false,
            thumbnail,
          },
        },
      );

      attachmentsDone += 1;
    } catch (err) {
      attachmentsFailed += 1;
      logger.error({ err, id }, 'Prílohu sa nepodarilo preniesť — zostáva vo verejnom store');
    }
  }

  // --- logá ----------------------------------------------------------------
  //
  // Bez `PUBLIC_API_BASE_URL` by `logoUrl` ukazovala na endpoint bez hostu.
  // Vtedy logá radšej neprenášame; prílohy vyššie na tejto premennej nezávisia.
  const organisations = publicApiBaseUrl
    ? await db
        .collection('organisations')
        .find({
          'brandKit.logoUrl': { $regex: '\\.public\\.blob\\.vercel-storage\\.com/' },
          'brandKit.logo': null,
        })
        .toArray()
    : [];

  if (!publicApiBaseUrl) {
    logger.warn('PUBLIC_API_BASE_URL nie je nastavená — prenos lôg preskočený.');
  }

  let logosDone = 0;
  let logosFailed = 0;

  for (const org of organisations) {
    const id = String(org['_id']);
    try {
      const brandKit = (org['brandKit'] ?? {}) as Record<string, unknown>;
      const url = String(brandKit['logoUrl']);
      const slug = String(org['slug']);

      const raw = await fetchBytes(url);
      const detected = detectFileType(raw);
      if (!detected || detected.kind !== 'image') {
        throw new Error('Logo nie je rozpoznateľný obrázok');
      }

      // Rovnaký postup ako pri uploade loga (organisations.routes.ts):
      // odstrániť EXIF/XMP a rozmery si vypýtať cez `createThumbnail` —
      // logo je malé, takže sa nezmenšuje a dostaneme len jeho rozmery.
      const storedBuffer = stripImageMetadata(raw, detected.ext);
      const rendered = await createThumbnail({
        data: storedBuffer,
        mimeType: detected.contentType,
      });

      const now = new Date().toISOString();
      const logoUrl = `${publicApiBaseUrl}/v1/public/organisations/${slug}/logo?v=${encodeURIComponent(now)}`;

      await db.collection('organisations').updateOne(
        { _id: org['_id'] },
        {
          $set: {
            'brandKit.logo': {
              data: storedBuffer,
              mimeType: detected.contentType,
              width: rendered.width,
              height: rendered.height,
              sizeBytes: storedBuffer.byteLength,
            },
            'brandKit.logoUrl': logoUrl,
          },
        },
      );

      logosDone += 1;
    } catch (err) {
      logosFailed += 1;
      logger.error({ err, id }, 'Logo sa nepodarilo preniesť — zostáva vo verejnom store');
    }
  }

  logger.info(
    { attachmentsDone, attachmentsFailed, logosDone, logosFailed, storage: storage.name },
    'Prenos do private storu dokončený (staré objekty v Blobe zostávajú)',
  );

  if (attachmentsFailed > 0 || logosFailed > 0) {
    throw new Error(
      `Nepreniesli sa všetky položky (prílohy: ${attachmentsFailed}, logá: ${logosFailed}). ` +
        'Migrácia zostáva nedokončená a pri ďalšom behu sa dobehne zvyšok.',
    );
  }
}

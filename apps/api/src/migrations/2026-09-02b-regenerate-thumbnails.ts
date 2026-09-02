// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Prerobenie náhľadov po oprave JPEG kvality.
 *
 * `toBuffer` v `@napi-rs/canvas` berie kvalitu na škále 0–100, nie 0–1.
 * Hodnota `0.8` sa neodmietla, len znamenala kvalitu ≈1: každý náhľad
 * vyrobený do 2026-09-02 je rozpadnutý na bloky a má rádovo kilobajty.
 * Nové náhľady sú už v poriadku, staré treba prerobiť.
 *
 * Regeneruje sa BEZ podmienky na obsah — ktoré náhľady sú pokazené sa
 * z dokumentu spoľahlivo zistiť nedá a rozhodovať podľa `sizeBytes` by
 * bola veštba. Že migrácia prebehne raz, drží `runner.ts` a kolekcia
 * `migrations`; opakovaný beh by len znovu vyrobil to isté.
 *
 * Berie len prílohy z privátneho úložiska: staré verejné (`PUBLIC_LEGACY`)
 * náhľad nikdy nemali. Originál sa musí stiahnuť — náhľad sa z náhľadu
 * prerobiť nedá.
 *
 * Chyba jednej položky sa zaloguje a beh pokračuje; na konci migrácia hodí
 * výnimku, takže sa neoznačí ako dokončená a pri ďalšom deployi sa dobehne
 * zvyšok. Rovnaký vzor ako `2026-09-02-attachments-to-private-blob`.
 *
 * VÝNIMKA: nečitateľný originál (404 v store) migráciu NEZASTAVÍ. Prerobenie
 * náhľadu ho späť nedostane, takže opakovaný beh by len večne červenal deploy.
 * Loguje sa ako `warn` a počíta samostatne, aby sa nestratil — je to vec
 * na vyšetrenie, nie na retry.
 *
 * Berie len NEZMAZANÉ prílohy. Mazanie odstraňuje aj objekt z úložiska, takže
 * u zmazanej prílohy originál chýbať MÁ.
 */

import { selectObjectStorage } from '../lib/storage/index.js';
import { canRenderThumbnail, createThumbnail } from '../lib/thumbnail.js';

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

export async function migrate_2026_09_02b_regenerate_thumbnails(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const storage = selectObjectStorage({
    logger,
    token: process.env['BLOB_PRIVATE_READ_WRITE_TOKEN'],
    storeId: process.env['BLOB_PRIVATE_STORE_ID'],
    nodeEnv: (process.env['NODE_ENV'] ?? 'development') as 'development' | 'test' | 'production',
  });

  if (storage.name === 'stub') {
    throw new Error('BLOB_PRIVATE_READ_WRITE_TOKEN nie je nastavený — originály sa nedajú čítať.');
  }

  const attachments = await db
    .collection('attachments')
    .find(
      // `deletedAt: null` je podstatné, nie kozmetika: mazanie prílohy
      // odstraňuje aj objekt z úložiska, takže u zmazanej prílohy originál
      // legitímne neexistuje. Bez tohto filtra migrácia hlásila „originál
      // v úložisku nie je" na dokumente, ktorý používateľ zmazal minútu po
      // nahraní — a hodinu sme hľadali chybu v uploade, ktorá tam nebola.
      { deletedAt: null, storageAccess: 'PRIVATE', storagePathname: { $ne: null } },
      { projection: { storagePathname: 1, mimeType: 1 } },
    )
    .toArray();

  let done = 0;
  let skipped = 0;
  let unreadable = 0;
  let failed = 0;

  for (const doc of attachments) {
    const id = String(doc['_id']);
    try {
      const mimeType = String(doc['mimeType'] ?? '');
      if (!canRenderThumbnail(mimeType)) {
        // PDF a iné dokumenty náhľad nemajú a mať nemajú.
        skipped += 1;
        continue;
      }

      const pathname = String(doc['storagePathname']);

      const stored = await storage.head(pathname);
      if (!stored) {
        unreadable += 1;
        logger.warn(
          { id, pathname },
          'Originál v úložisku na uloženej ceste nie je — náhľad zostáva pôvodný',
        );
        continue;
      }

      const bytes = await storage.get(pathname);
      const thumbnail = await createThumbnail({ data: bytes, mimeType });

      await db.collection('attachments').updateOne({ _id: doc['_id'] }, { $set: { thumbnail } });

      done += 1;
    } catch (err) {
      failed += 1;
      logger.error({ err, id }, 'Náhľad sa nepodarilo prerobiť — zostáva pôvodný');
    }
  }

  logger.info({ done, skipped, unreadable, failed }, 'Náhľady prerobené po oprave JPEG kvality');

  if (failed > 0) {
    throw new Error(
      `Nepodarilo sa prerobiť ${failed} náhľadov. Migrácia zostáva nedokončená ` +
        'a pri ďalšom behu sa dobehne zvyšok.',
    );
  }
}

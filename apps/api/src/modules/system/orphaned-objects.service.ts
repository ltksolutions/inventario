// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Osirelé objekty v úložisku — nájdenie a zmazanie (ADR-0039).
 *
 * Osirelý objekt je súbor v private store, na ktorý neukazuje žiadna
 * príloha v evidencii. Vzniká, keď prehliadač dokončí podpísaný PUT, ale
 * krok `confirm` už nie — stačí zavrieť kartu alebo stratiť signál.
 *
 * Prečo to nie je len otázka miesta na disku: osirelý objekt je mimo
 * evidencie, takže sa naň nevzťahuje soft-delete ani `del()` podľa
 * `docs/compliance/data-retention-schedule.md`, nefiguruje v žiadnom
 * výpise, a pri žiadosti o výmaz by ho nikto nenašiel. Navyše EXIF sa
 * strháva až v `confirm`, takže osirelá fotka si drží pôvodné metadáta
 * vrátane GPS.
 *
 * BEZPEČNOSTNÉ PRAVIDLÁ TEJTO SLUŽBY
 * -----------------------------------
 * 1. Dotaz na referencie NIE JE tenant-scoped. Store je spoločný pre
 *    všetkých tenantov; keby sa referencie čítali len pre jedného,
 *    objekty ostatných by sa javili ako osirelé a zmazali by sa. Toto je
 *    najzradnejšia chyba, aká sa tu dá spraviť.
 * 2. Do množiny referencií idú `storagePathname` AJ `storageKey`. Pri
 *    privátnych prílohách nesú tú istú hodnotu, takže je to nadbytočné —
 *    a presne preto to tam je. Nadbytočná referencia znamená
 *    nezmazaný objekt; chýbajúca znamená stratené dáta.
 * 3. Vekový odklad. Objekt mladší než `ORPHAN_MIN_AGE_HOURS` sa
 *    nepovažuje za osirelý ani keď naň nič neukazuje — mohol práve teraz
 *    prejsť PUT-om a `confirm` beží.
 * 4. Referencie sa čítajú AŽ PO vymenovaní storu. Keby sa čítali skôr,
 *    príloha vzniknutá medzitým by nebola v množine a jej objekt by sa
 *    zmazal. V tomto poradí je najhoršie, čo sa stane, nezmazaný objekt.
 */

import { ATTACHMENTS_ROOT } from '../../lib/storage/pathnames.js';

import type { ListedObject, ObjectStorage } from '../../lib/storage/types.js';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

/**
 * Ako staré musí byť, aby to bolo osirelé. `confirm` beží sekundy po
 * PUT-e, takže 24 hodín je obrovská rezerva — a súčasne krátke okno,
 * v ktorom nespracovaná fotka drží GPS.
 */
export const ORPHAN_MIN_AGE_HOURS = 24;

/** Strop na počet stránok. Poistka proti nekonečnému cyklu, nie limit dát. */
const MAX_PAGES = 100;

export interface OrphanScanResult {
  orphans: ListedObject[];
  /** Koľko objektov store pod prefixom vôbec má — na kontext v logu. */
  scanned: number;
  /** `true`, keď sa vyčerpal strop stránok a obraz je NEÚPLNÝ. */
  truncated: boolean;
}

/**
 * Vymenuje celý store pod `attachments/` a nechá len tie objekty, na
 * ktoré neukazuje žiadna nezmazaná príloha a sú starší než odklad.
 *
 * Prílohy so `deletedAt` sa za referenciu NEPOVAŽUJÚ — zmazaná príloha má
 * podľa retenčného rozvrhu mať zmazaný aj objekt. Čistič tým dobehne aj
 * zlyhané best-effort mazania z `DELETE /v1/attachments/:id`. Obnovenie
 * prílohy neexistuje, takže sa tým nič nestráca.
 */
export async function scanOrphanedObjects(
  db: Db,
  storage: ObjectStorage,
  logger: FastifyBaseLogger,
  now: Date = new Date(),
): Promise<OrphanScanResult> {
  // --- 1. celý store pod prefixom, po stránkach ---
  const stored: ListedObject[] = [];
  let cursor: string | undefined;
  let pages = 0;
  let truncated = false;

  for (;;) {
    const page = await storage.list({ prefix: ATTACHMENTS_ROOT, cursor });
    stored.push(...page.objects);
    pages += 1;

    if (page.cursor === null) break;
    if (pages >= MAX_PAGES) {
      truncated = true;
      logger.warn(
        { pages, scanned: stored.length },
        '[orphans] strop stránok vyčerpaný — obraz storu je neúplný, mazanie sa preskočí',
      );
      break;
    }
    cursor = page.cursor;
  }

  // --- 2. referencie z evidencie, AŽ TERAZ a NAPRIEČ VŠETKÝMI tenantmi ---
  const referenced = new Set<string>();
  const cursorDb = db
    .collection('attachments')
    .find({ deletedAt: null }, { projection: { storagePathname: 1, storageKey: 1 } });

  for await (const doc of cursorDb) {
    const pathname = doc['storagePathname'];
    const key = doc['storageKey'];
    if (typeof pathname === 'string' && pathname.length > 0) referenced.add(pathname);
    if (typeof key === 'string' && key.length > 0) referenced.add(key);
  }

  // --- 3. osirelé = bez referencie a starší než odklad ---
  const cutoff = now.getTime() - ORPHAN_MIN_AGE_HOURS * 60 * 60 * 1000;
  const orphans = stored.filter(
    (object) => !referenced.has(object.pathname) && new Date(object.uploadedAt).getTime() < cutoff,
  );

  logger.info(
    { scanned: stored.length, referenced: referenced.size, orphans: orphans.length, truncated },
    '[orphans] kontrola úložiska dokončená',
  );

  return { orphans, scanned: stored.length, truncated };
}

export interface OrphanPurgeResult {
  deleted: number;
  failed: number;
  freedBytes: number;
  scanned: number;
  /** `true`, keď sa mazanie preskočilo, lebo obraz storu bol neúplný. */
  skipped: boolean;
}

/**
 * Zmaže osirelé objekty. Pri neúplnom obraze storu NEMAŽE NIČ — mazať na
 * základe polovičného výpisu je horšie než nemazať vôbec.
 */
export async function purgeOrphanedObjects(
  db: Db,
  storage: ObjectStorage,
  logger: FastifyBaseLogger,
  now: Date = new Date(),
): Promise<OrphanPurgeResult> {
  const scan = await scanOrphanedObjects(db, storage, logger, now);

  if (scan.truncated) {
    return { deleted: 0, failed: 0, freedBytes: 0, scanned: scan.scanned, skipped: true };
  }

  let deleted = 0;
  let failed = 0;
  let freedBytes = 0;

  for (const object of scan.orphans) {
    try {
      await storage.remove(object.pathname);
      deleted += 1;
      freedBytes += object.sizeBytes;
      logger.info(
        { pathname: object.pathname, sizeBytes: object.sizeBytes, uploadedAt: object.uploadedAt },
        '[orphans] osirelý objekt zmazaný',
      );
    } catch (err) {
      failed += 1;
      logger.error({ err, pathname: object.pathname }, '[orphans] objekt sa nepodarilo zmazať');
    }
  }

  return { deleted, failed, freedBytes, scanned: scan.scanned, skipped: false };
}

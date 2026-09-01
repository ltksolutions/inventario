// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-09-01 — odstránenie „sfz" z hodnôt v databáze.
 *
 * Kontext: „sfz" (Slovenský futbalový zväz) je názov pilotného zákazníka,
 * nie produktu. V kóde a v schémach po ňom zostali dve hodnoty, ktoré sa
 * reálne zapisujú do dokumentov:
 *
 *   1. `attachments.bucket` — enum `'sfz-asset-attachments' |
 *      'sfz-asset-protocols'`. Pole ide von úplne: Vercel Blob buckety
 *      nemá, hodnota sa zapisovala natvrdo a nikto ju nikdy nečítal.
 *      `'sfz-asset-protocols'` sa nezapísalo ani raz — PDF protokoly sa
 *      generujú a hneď streamujú, neukladajú sa (protocols.routes.ts).
 *
 *   2. `affiliation.type` v `memberships` a `users` — hodnota
 *      `'SFZ_DEPARTMENT'` → `'ORG_DEPARTMENT'`. V produkcii ju
 *      2026-09-01 nemal ani jeden dokument (affiliation je prázdna),
 *      ale migrácia je tu pre istotu — dev a demo prostredia môžu mať
 *      dáta, ktoré nikto nezmeral.
 *
 * Rozhodnutie a kontext: `docs/decisions/0037-object-storage-bindata-plus-tenant-s3.md`,
 * session log `docs/sessions/2026-09-01-sfz-naming-a-limit-uploadu.md`.
 *
 * Idempotentné: `$unset` na neexistujúcom poli aj `updateMany` s filtrom na
 * starú hodnotu sú pri druhom behu no-op (0 modifikovaných dokumentov).
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

export async function migrate_2026_09_01_drop_sfz_naming(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  // ----- 1. attachments.bucket — pole von -----
  const bucketResult = await db
    .collection('attachments')
    .updateMany({ bucket: { $exists: true } }, { $unset: { bucket: '' } });

  logger.info(
    { modified: bucketResult.modifiedCount },
    '[2026-09-01] attachments.bucket odstránený',
  );

  // ----- 2. affiliation.type: SFZ_DEPARTMENT -> ORG_DEPARTMENT -----
  for (const collection of ['memberships', 'users'] as const) {
    const result = await db
      .collection(collection)
      .updateMany(
        { 'affiliation.type': 'SFZ_DEPARTMENT' },
        { $set: { 'affiliation.type': 'ORG_DEPARTMENT' } },
      );

    logger.info(
      { collection, modified: result.modifiedCount },
      '[2026-09-01] affiliation.type SFZ_DEPARTMENT -> ORG_DEPARTMENT',
    );
  }

  logger.info({}, 'Migration 2026-09-01 complete: „sfz" hodnoty odstránené z databázy');
}

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Protocol number generator — transakčný, race-safe (ADR-0022 K3).
 *
 * Formát: `PROT-YYYY-NNNNNN` (regex schémy: `^PROT-\d{4}-\d{6}$`)
 *
 * Counter je scoped na `(organisationId, year)` — každý tenant má
 * vlastnú sekvenciu, každý rok štartuje od 1.
 *
 * Implementácia:
 *   - `counters` collection, dokument `{ _id: "prot:ORG_ID:YYYY", seq: N }`
 *   - `findOneAndUpdate` s `$inc: { seq: 1 }` + `upsert: true` + `returnDocument: 'after'`
 *   - Atomická operácia — bezpečná pri súbežných transakciách
 *   - Volaná VNÚTRI existujúcej Mongo transakcie (session je povinný)
 *
 * Race guard:
 *   - Unique index `(organisationId, protocolNumber)` na `loan_protocols` collection
 *     (ensureIndexes v LoanProtocolsRepository, K4) je posledná línia obrany.
 *   - `$inc` + `upsert` na counters je atomický aj bez transakcie, ale
 *     odovzdávame session, aby bol counter a insert protokolu v jednej transakcii.
 */

import type { ClientSession, Db } from 'mongodb';

// ---------------------------------------------------------------------------
// Counter document shape
// ---------------------------------------------------------------------------

interface ProtocolCounter {
  _id: string; // "prot:ORG_ID:YYYY"
  seq: number;
}

// ---------------------------------------------------------------------------
// Hlavná exportovaná funkcia
// ---------------------------------------------------------------------------

/**
 * Vygeneruje ďalšie `protocolNumber` pre daný tenant a rok.
 *
 * MUSÍ byť volaná vnútri Mongo transakcie — `session` je povinný.
 *
 * @param db - Tenant database handle (fastify.mongo.db — NIE mongoClient.db()).
 * @param organisationId - Tenant ID (string).
 * @param session - Aktívna Mongo ClientSession (transakcia).
 * @param year - Rok protokolu. Default: UTC rok z `new Date()` (K4 predáva `issuedAt` rok).
 * @returns Číslo protokolu v tvare `PROT-2026-000042`.
 */
export async function generateProtocolNumber(
  db: Db,
  organisationId: string,
  session: ClientSession,
  year?: number,
): Promise<string> {
  const protocolYear = year ?? new Date().getUTCFullYear();
  const counterId = `prot:${organisationId}:${protocolYear}`;

  const countersCol = db.collection<ProtocolCounter>('counters');

  const result = await countersCol.findOneAndUpdate(
    { _id: counterId },
    { $inc: { seq: 1 } },
    {
      upsert: true,
      returnDocument: 'after',
      session,
    },
  );

  if (!result) {
    throw new Error(`generateProtocolNumber: counter upsert failed for ${counterId}`);
  }

  const seq = result.seq;
  const paddedSeq = String(seq).padStart(6, '0');

  return `PROT-${protocolYear}-${paddedSeq}`;
}

/**
 * Zabezpečí index na `counters` collection.
 * Idempotentné — bezpečné volať pri každom štarte.
 * Volá ho K4 LoanProtocolsRepository.ensureIndexes().
 */
export async function ensureCounterIndex(db: Db): Promise<void> {
  const countersCol = db.collection<ProtocolCounter>('counters');
  // _id je primárny kľúč — MongoDB ho indexuje automaticky.
  // Explicitný index tu nie je potrebný, ale voláme createIndex
  // na iných fields ak by sme potrebovali TTL alebo compound index v budúcnosti.
  // Zatiaľ no-op — ponechaný pre konzistenciu s ensureIndexes() pattern.
  await countersCol.createIndex({ _id: 1 }, { name: 'counters_id' });
}

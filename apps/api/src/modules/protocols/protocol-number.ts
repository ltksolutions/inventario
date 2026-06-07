// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Protocol number generator — transakčný, race-safe (ADR-0022 K3).
 *
 * Formát: `{prefix}-YYYY-{seq.padStart(padding, '0')}`, napr. `PROT-2026-000001`.
 * Default: prefix `PROT`, padding 6, initialSeq 1.
 *
 * Counter je scoped na `(organisationId, year)` — každý tenant má
 * vlastnú sekvenciu, každý rok štartuje od initialSeq (default 1).
 *
 * Implementácia:
 *   - `counters` collection, dokument `{ _id: "prot:ORG_ID:YYYY", seq: N }`
 *   - Inicializácia: `updateOne` s `$setOnInsert: { seq: initialSeq - 1 }` (upsert)
 *   - Inkrementácia: `findOneAndUpdate` s `$inc: { seq: 1 }`, returnDocument: 'after'
 *   - Atomická dvojica v rámci jednej transakcie → bezpečná pri súbežných requestoch
 *   - Volaná VNÚTRI existujúcej Mongo transakcie (session je povinný)
 *
 * Race guard:
 *   - Unique index `(organisationId, protocolNumber)` na `loan_protocols` collection
 *     (ensureIndexes v LoanProtocolsRepository, K4) je posledná línia obrany.
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
// Format config type (mirrors ProtocolNumberFormatSchema from shared-types)
// ---------------------------------------------------------------------------

export interface ProtocolNumberFormatConfig {
  prefix: string;
  padding: number;
  initialSeq: number;
}

const DEFAULT_FORMAT: ProtocolNumberFormatConfig = {
  prefix: 'PROT',
  padding: 6,
  initialSeq: 1,
};

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
 * @param year - Rok protokolu. Default: UTC rok z `new Date()`.
 * @param numberFormat - Per-tenant formát číselného radu. Null = systémový default.
 * @returns Číslo protokolu v tvare `PROT-2026-000001`.
 */
export async function generateProtocolNumber(
  db: Db,
  organisationId: string,
  session: ClientSession,
  year?: number,
  numberFormat?: ProtocolNumberFormatConfig | null,
): Promise<string> {
  const protocolYear = year ?? new Date().getUTCFullYear();
  const fmt = numberFormat ?? DEFAULT_FORMAT;
  const counterId = `prot:${organisationId}:${protocolYear}`;

  const countersCol = db.collection<ProtocolCounter>('counters');

  // Inicializácia countera: ak counter ešte neexistuje, nastaví seq = initialSeq - 1
  // tak, aby prvý $inc vrátil initialSeq. Ak counter existuje, $setOnInsert sa preskočí.
  await countersCol.updateOne(
    { _id: counterId },
    { $setOnInsert: { seq: fmt.initialSeq - 1 } },
    { upsert: true, session },
  );

  // Atómický inkrements — vždy vracia novú hodnotu.
  const result = await countersCol.findOneAndUpdate(
    { _id: counterId },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', session },
  );

  if (!result) {
    throw new Error(`generateProtocolNumber: counter update failed for ${counterId}`);
  }

  const seq = result.seq;
  const paddedSeq = String(seq).padStart(fmt.padding, '0');

  return `${fmt.prefix}-${protocolYear}-${paddedSeq}`;
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

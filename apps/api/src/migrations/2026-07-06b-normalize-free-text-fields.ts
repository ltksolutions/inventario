// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-07-06b — normalizácia voľného textu v existujúcich dátach.
 *
 * Kontext: `freeText()` (packages/shared-types/src/schemas/common.ts) odteraz
 * normalizuje voľné textové polia (Popis, Účel, Poznámka, Dôvod zamietnutia...)
 * pri KAŽDOM uložení — rieši rozbité zalomenia riadkov a neviditeľné znaky
 * z textu vloženého (copy-paste) z webových stránok/dokumentov, ktoré kazili
 * layout aj tlač (protokoly, PDF). Pozri `normalizeFreeText` pre presné
 * pravidlá (NBSP → medzera, CRLF → LF, orezanie trailing whitespace na
 * riadkoch, 3+ prázdne riadky → max 2, trim).
 *
 * Táto normalizácia sa (podobne ako pri TagSchema, migrácia 2026-07-06 tagov)
 * vzťahuje len na NOVÉ zápisy cez API. Táto migrácia dorovnáva existujúce
 * dokumenty, aby aj staré dáta (vrátane tých vložených copy-paste pred touto
 * zmenou) mali rovnaký normalizovaný formát.
 *
 * Polia a kolekcie:
 *   assets.description
 *   categories.description
 *   locations.description
 *   loan_requests.purpose, loan_requests.rejectionReason,
 *     loan_requests.items[].note, loan_requests.approvers[].note
 *   loans.purpose, loans.notes,
 *     loans.items[].condition.atPickup.note, loans.items[].condition.atReturn.note
 *   stock_movements.reason, stock_movements.note
 *
 * Idempotentné: pre každý dokument sa nová hodnota porovná so starou, update
 * sa zapíše len ak sa reálne líšia (druhý beh = 0 modifikovaných dokumentov).
 */

import { normalizeFreeText } from '@inventario/shared-types';

import type { FastifyBaseLogger } from 'fastify';
import type { AnyBulkWriteOperation, Db, Document } from 'mongodb';

/**
 * Normalizuje jedno top-level string pole naprieč kolekciou.
 * Nedotýka sa dokumentov, kde pole chýba alebo nie je string (napr. null).
 */
async function normalizeTopLevelField(
  db: Db,
  logger: FastifyBaseLogger,
  collectionName: string,
  field: string,
): Promise<void> {
  const collection = db.collection(collectionName);
  const cursor = collection.find({ [field]: { $type: 'string' } }, { projection: { [field]: 1 } });

  const ops: AnyBulkWriteOperation<Document>[] = [];
  for await (const doc of cursor) {
    const original = doc[field] as string;
    const normalized = normalizeFreeText(original);
    if (normalized !== original) {
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { [field]: normalized } },
        },
      });
    }
  }

  if (ops.length > 0) {
    const result = await collection.bulkWrite(ops);
    logger.info(
      { collection: collectionName, field, modified: result.modifiedCount },
      `Migration 2026-07-06b: normalized ${result.modifiedCount} '${field}' value(s) in '${collectionName}'`,
    );
  } else {
    logger.info(
      { collection: collectionName, field },
      `Migration 2026-07-06b: no changes needed for '${field}' in '${collectionName}'`,
    );
  }
}

/** loan_requests.items[].note + loan_requests.approvers[].note (nested arrays). */
async function normalizeLoanRequestArrays(db: Db, logger: FastifyBaseLogger): Promise<void> {
  const collection = db.collection('loan_requests');
  const cursor = collection.find({}, { projection: { items: 1, approvers: 1 } });

  const ops: AnyBulkWriteOperation<Document>[] = [];
  for await (const doc of cursor) {
    const update: Record<string, unknown> = {};

    const items: Document[] = Array.isArray(doc.items) ? doc.items : [];
    const normalizedItems = items.map((item) =>
      typeof item.note === 'string' ? { ...item, note: normalizeFreeText(item.note) } : item,
    );
    if (JSON.stringify(normalizedItems) !== JSON.stringify(items)) {
      update.items = normalizedItems;
    }

    const approvers: Document[] = Array.isArray(doc.approvers) ? doc.approvers : [];
    const normalizedApprovers = approvers.map((a) =>
      typeof a.note === 'string' ? { ...a, note: normalizeFreeText(a.note) } : a,
    );
    if (JSON.stringify(normalizedApprovers) !== JSON.stringify(approvers)) {
      update.approvers = normalizedApprovers;
    }

    if (Object.keys(update).length > 0) {
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: update } } });
    }
  }

  if (ops.length > 0) {
    const result = await collection.bulkWrite(ops);
    logger.info(
      { modified: result.modifiedCount },
      `Migration 2026-07-06b: normalized ${result.modifiedCount} 'loan_requests' items/approvers note(s)`,
    );
  } else {
    logger.info(
      {},
      `Migration 2026-07-06b: no changes needed for 'loan_requests' items/approvers notes`,
    );
  }
}

/** loans.items[].condition.atPickup.note + loans.items[].condition.atReturn.note. */
async function normalizeLoanItemConditionNotes(db: Db, logger: FastifyBaseLogger): Promise<void> {
  const collection = db.collection('loans');
  const cursor = collection.find({}, { projection: { items: 1 } });

  const ops: AnyBulkWriteOperation<Document>[] = [];
  for await (const doc of cursor) {
    const items: Document[] = Array.isArray(doc.items) ? doc.items : [];
    const normalizedItems = items.map((item) => {
      const condition = (item.condition ?? {}) as Document;
      const atPickup = condition.atPickup as Document | undefined;
      const atReturn = condition.atReturn as Document | null | undefined;

      const newAtPickup =
        atPickup && typeof atPickup.note === 'string'
          ? { ...atPickup, note: normalizeFreeText(atPickup.note) }
          : atPickup;

      const newAtReturn =
        atReturn && typeof atReturn.note === 'string'
          ? { ...atReturn, note: normalizeFreeText(atReturn.note) }
          : atReturn;

      if (newAtPickup === atPickup && newAtReturn === atReturn) {
        return item;
      }
      return {
        ...item,
        condition: { ...condition, atPickup: newAtPickup, atReturn: newAtReturn },
      };
    });

    if (JSON.stringify(normalizedItems) !== JSON.stringify(items)) {
      ops.push({
        updateOne: { filter: { _id: doc._id }, update: { $set: { items: normalizedItems } } },
      });
    }
  }

  if (ops.length > 0) {
    const result = await collection.bulkWrite(ops);
    logger.info(
      { modified: result.modifiedCount },
      `Migration 2026-07-06b: normalized ${result.modifiedCount} 'loans.items[].condition.*.note'`,
    );
  } else {
    logger.info(
      {},
      `Migration 2026-07-06b: no changes needed for 'loans.items[].condition.*.note'`,
    );
  }
}

export async function migrate_2026_07_06b_normalize_free_text_fields(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  await normalizeTopLevelField(db, logger, 'assets', 'description');
  await normalizeTopLevelField(db, logger, 'categories', 'description');
  await normalizeTopLevelField(db, logger, 'locations', 'description');

  await normalizeTopLevelField(db, logger, 'loan_requests', 'purpose');
  await normalizeTopLevelField(db, logger, 'loan_requests', 'rejectionReason');
  await normalizeLoanRequestArrays(db, logger);

  await normalizeTopLevelField(db, logger, 'loans', 'purpose');
  await normalizeTopLevelField(db, logger, 'loans', 'notes');
  await normalizeLoanItemConditionNotes(db, logger);

  await normalizeTopLevelField(db, logger, 'stock_movements', 'reason');
  await normalizeTopLevelField(db, logger, 'stock_movements', 'note');

  logger.info(
    {},
    'Migration 2026-07-06b complete: normalized free-text fields across assets/categories/locations/loan_requests/loans/stock_movements',
  );
}

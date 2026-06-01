// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-06-01-asset-public-token
 *
 * ADR-0021: Dogeneruje `publicToken` všetkým existujúcim assetom,
 * ktoré ho ešte nemajú (publicToken === undefined alebo null).
 *
 * Bezpečnosť:
 *   - Idempotentná — assety s existujúcim publicToken sa preskočia.
 *   - CSPRNG (crypto.randomBytes) — rovnaký generátor ako v service.
 *   - Nepoužíva transakcie (bulkWrite bez multi-doc transaction) —
 *     operácia je idempotentná, pri reštarte sa dobehnú zvyšné assety.
 *
 * Index:
 *   - `publicToken_unique_partial` index existuje v AssetsRepository.ensureIndexes().
 *     Ten sa volá pri štarte servera (pred migráciami), takže index je zaručene
 *     prítomný keď táto migrácia beží.
 */

import { randomBytes } from 'node:crypto';

import { base32Encode } from '../lib/base32.js';

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

export async function migrate_2026_06_01_asset_public_token(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const assetsCollection = db.collection('assets');

  // Nájdi všetky assety bez publicToken (pred-migrácia alebo null z iného dôvodu).
  const cursor = assetsCollection.find({
    $or: [{ publicToken: { $exists: false } }, { publicToken: null }],
  });

  let updated = 0;
  let skipped = 0;

  for await (const asset of cursor) {
    const publicToken = base32Encode(randomBytes(20));

    const result = await assetsCollection.updateOne(
      {
        _id: asset._id,
        // Double-check: preskočiť ak medzitým dostal token (race v unlikely scenári)
        $or: [{ publicToken: { $exists: false } }, { publicToken: null }],
      },
      { $set: { publicToken } },
    );

    if (result.modifiedCount > 0) {
      updated++;
    } else {
      skipped++;
    }
  }

  logger.info(
    { updated, skipped },
    'ADR-0021 migration: publicToken dogenerovaný pre existujúce assety',
  );
}

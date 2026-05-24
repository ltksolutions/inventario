// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-05-25 — fix organisations.customDomain index.
 *
 * Problem: the index `customDomain_unique_sparse` was created without
 * the `sparse: true` option, so it treats all `customDomain: null`
 * documents as duplicates. Any second organisation registration fails
 * with E11000.
 *
 * Fix: drop the broken index, recreate with sparse: true.
 * sparse: true means documents with null/missing customDomain are
 * excluded from the index entirely — allowing unlimited null values.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

export async function migrate_2026_05_25_fix_org_custom_domain_index(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const orgsCol = db.collection('organisations');

  // 1. Drop the broken non-sparse index (ignore error if it doesn't exist)
  try {
    await orgsCol.dropIndex('customDomain_unique_sparse');
    logger.info('Dropped broken customDomain_unique_sparse index');
  } catch {
    logger.info('customDomain_unique_sparse index not found — skipping drop');
  }

  // Also try the default auto-generated name if it was created differently
  try {
    await orgsCol.dropIndex('customDomain_1');
    logger.info('Dropped customDomain_1 index');
  } catch {
    // Not present, that's fine
  }

  // 2. Recreate with sparse: true — null values are excluded from the index
  await orgsCol.createIndex(
    { customDomain: 1 },
    {
      unique: true,
      sparse: true, // ← key fix: null/missing values are not indexed
      name: 'customDomain_unique_sparse',
    },
  );

  logger.info('Recreated customDomain_unique_sparse index with sparse: true');
}

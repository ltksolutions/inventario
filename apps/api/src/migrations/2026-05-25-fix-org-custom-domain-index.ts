// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-05-25 — fix organisations.customDomain index.
 *
 * Problem: the index `customDomain_unique_sparse` was created without
 * the correct options. MongoDB's sparse:true does NOT exclude documents
 * where the field exists but is explicitly null — it only excludes
 * documents where the field is completely missing. Since our schema
 * always stores customDomain: null explicitly, the sparse index still
 * indexes null values and causes E11000 on the second registration.
 *
 * Fix: drop the broken index, ensure the correct partial-filter index
 * `customDomain_unique_partial` exists. partialFilterExpression with
 * {$type: 'string'} only indexes documents where customDomain IS a
 * string — null values are completely excluded.
 *
 * This is the same approach already used for entraTenantId_unique_partial
 * and documented in OrganisationsRepository.ensureIndexes().
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

export async function migrate_2026_05_25_fix_org_custom_domain_index(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const orgsCol = db.collection('organisations');

  // 1. Drop all broken customDomain indexes (ignore errors if not present)
  for (const name of [
    'customDomain_unique_sparse',
    'customDomain_1',
    'customDomain_unique_partial',
  ]) {
    try {
      await orgsCol.dropIndex(name);
      logger.info({ index: name }, 'Dropped customDomain index');
    } catch {
      // Not present — fine
    }
  }

  // 2. Recreate with partialFilterExpression — only string customDomain values
  //    are indexed. Documents with customDomain: null are EXCLUDED entirely.
  //    NOTE: sparse:true does NOT work here — MongoDB sparse indexes still
  //    index documents where the field exists but is explicitly null.
  //    Only partialFilterExpression correctly excludes null values.
  await orgsCol.createIndex(
    { customDomain: 1 },
    {
      unique: true,
      partialFilterExpression: { customDomain: { $type: 'string' } },
      name: 'customDomain_unique_partial',
    },
  );

  logger.info('Created customDomain_unique_partial index with partialFilterExpression');
}

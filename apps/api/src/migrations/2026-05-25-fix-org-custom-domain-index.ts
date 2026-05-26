// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-05-25 — fix organisations indexes.
 *
 * Problem: Multiple indexes on organisations collection were created with
 * sparse:true instead of partialFilterExpression. MongoDB sparse:true does
 * NOT exclude documents where the field exists but is explicitly null —
 * it only excludes documents where the field is completely missing.
 * Since our schema always stores entraTenantId:null and customDomain:null
 * explicitly, sparse indexes cause E11000 on the second registration.
 *
 * Fix: drop all broken sparse indexes, ensure correct partial-filter
 * indexes exist via OrganisationsRepository.ensureIndexes() which runs
 * on every cold start automatically.
 *
 * The correct indexes use partialFilterExpression: { field: { $type: 'string' } }
 * which ONLY indexes documents where the field is actually a string value.
 * Documents with null are completely excluded from the index.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

export async function migrate_2026_05_25_fix_org_custom_domain_index(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const orgsCol = db.collection('organisations');

  // Drop all broken sparse indexes (ignore errors if not present)
  const indexesToDrop = [
    'customDomain_unique_sparse',
    'customDomain_1',
    'entraTenantId_unique_sparse',
  ];

  for (const name of indexesToDrop) {
    try {
      await orgsCol.dropIndex(name);
      logger.info({ index: name }, 'Dropped broken sparse index on organisations');
    } catch {
      // Not present — fine, idempotent
    }
  }

  // Recreate correct indexes with partialFilterExpression
  // (same as OrganisationsRepository.ensureIndexes() — idempotent)
  await orgsCol.createIndex(
    { entraTenantId: 1 },
    {
      unique: true,
      partialFilterExpression: { entraTenantId: { $type: 'string' } },
      name: 'entraTenantId_unique_partial',
    },
  );
  logger.info('Created entraTenantId_unique_partial index');

  await orgsCol.createIndex(
    { customDomain: 1 },
    {
      unique: true,
      partialFilterExpression: { customDomain: { $type: 'string' } },
      name: 'customDomain_unique_partial',
    },
  );
  logger.info('Created customDomain_unique_partial index');
}

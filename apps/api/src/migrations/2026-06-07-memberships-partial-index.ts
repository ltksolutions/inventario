// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-06-07 — recreate memberships unique index with partial filter.
 *
 * Background: the `memberships_userId_organisationId_unique` index was created
 * WITHOUT a `partialFilterExpression`, meaning soft-deleted documents
 * (deletedAt != null) counted toward the uniqueness constraint. This blocked
 * the rejoin flow — a user who left and tried to rejoin an org would hit E11000
 * on their soft-deleted (historical) membership record.
 *
 * Fix: drop the existing index and recreate it with
 * `partialFilterExpression: { deletedAt: null }` so only active (non-deleted)
 * memberships are considered for uniqueness. Soft-deleted historical records are
 * excluded, allowing multiple soft-deleted docs for the same {userId, organisationId}
 * pair (history is preserved) while still preventing duplicate ACTIVE memberships.
 *
 * `reactivate()` in MembershipsRepository already handles the case of multiple
 * soft-deleted docs (sorts by `deletedAt: -1` to pick the most recent one).
 *
 * Idempotent:
 *   - If the index already has the partialFilterExpression, MongoDB treats
 *     `createIndex` with the same spec as a no-op (returns the existing index name).
 *   - The dropIndex call ignores NamespaceNotFound / IndexNotFound errors.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

const INDEX_NAME = 'memberships_userId_organisationId_unique';

export async function migrate_2026_06_07_memberships_partial_index(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const col = db.collection('memberships');

  // Step 1: drop the existing index (may not exist on fresh installs).
  try {
    await col.dropIndex(INDEX_NAME);
    logger.info({ index: INDEX_NAME }, 'Dropped old memberships unique index (no partial filter)');
  } catch (err) {
    const code =
      (err as { codeName?: string; code?: number }).codeName ?? (err as { code?: number }).code;
    // 27 = IndexNotFound, 26 = NamespaceNotFound — both are safe to ignore
    if (code === 'IndexNotFound' || code === 27 || code === 26) {
      logger.info({ index: INDEX_NAME }, 'Index not found — nothing to drop, continuing');
    } else {
      throw err;
    }
  }

  // Step 2: recreate with partialFilterExpression so soft-deleted docs are
  // excluded from the uniqueness constraint.
  await col.createIndex(
    { userId: 1, organisationId: 1 },
    {
      unique: true,
      partialFilterExpression: { deletedAt: null },
      name: INDEX_NAME,
    },
  );

  logger.info(
    { index: INDEX_NAME },
    'Migration 2026-06-07 complete: memberships unique index recreated with partialFilterExpression: { deletedAt: null }',
  );
}

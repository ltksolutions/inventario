// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-05-29c — drop legacy global email_unique index on users.
 *
 * Problem: Before ADR-0015 (multi-tenant memberships), the users collection
 * had a global unique index on `email`. This blocks two users from different
 * organisations from sharing the same email address — which is a valid
 * multi-tenant scenario (e.g. admin@company.sk in org A and org B).
 *
 * Fix: Drop the old global `email_1` / `email_unique` index if it exists.
 * The correct per-tenant uniqueness is already enforced by the composite
 * index `organisationId_email_unique` ({ organisationId: 1, email: 1 })
 * created by UsersRepository.ensureIndexes().
 *
 * This migration is idempotent — dropping a non-existent index is a no-op.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

export async function migrate_2026_05_29c_fix_email_unique_index(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const usersCol = db.collection('users');

  // Drop any variant of the legacy global email unique index.
  const legacyIndexNames = ['email_unique', 'email_1', 'users_email_unique'];

  for (const name of legacyIndexNames) {
    try {
      await usersCol.dropIndex(name);
      logger.info({ index: name }, 'Dropped legacy global email unique index on users');
    } catch {
      // Index does not exist — fine, migration is idempotent
    }
  }

  logger.info('Migration 2026-05-29c complete: legacy email_unique index removed (if present)');
}

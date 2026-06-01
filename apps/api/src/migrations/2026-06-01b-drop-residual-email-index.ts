// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-06-01b — drop residual global email unique index on users.
 *
 * Background: migration 2026-05-29c tried to drop the legacy global
 * `{ email: 1 }` unique index, but only matched a fixed list of index
 * names (`email_unique`, `email_1`, `users_email_unique`). On production
 * the index was actually named `users_email_global_unique`, so the drop
 * silently missed it and 2026-05-29c recorded itself as completed.
 *
 * A residual global email-unique index blocks the valid multi-tenant
 * scenario of the same email existing in two different organisations
 * (e.g. admin@company.sk in org A and org B) — it would raise E11000 on
 * the second tenant's JIT provisioning. This must be cleared BEFORE
 * onboarding a second tenant (SFZ pilot).
 *
 * This migration drops ANY single-field unique index on `email` regardless
 * of its name, by inspecting the live index list rather than guessing
 * names. The correct per-tenant uniqueness lives on the composite index
 * `organisationId_email_unique` ({ organisationId: 1, email: 1 }), which
 * this migration leaves untouched.
 *
 * Idempotent: if no matching index exists, it is a no-op.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

export async function migrate_2026_06_01b_drop_residual_email_index(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const usersCol = db.collection('users');

  const indexes = await usersCol.indexes();

  for (const idx of indexes) {
    const key = idx.key as Record<string, unknown>;
    const keyFields = Object.keys(key);

    // Match a SINGLE-field index on exactly `email` (not the composite
    // { organisationId, email } index, which has two fields). Only drop
    // it if it is unique — a non-unique email index would be harmless,
    // but in practice the only single-field email index we ever created
    // was the legacy global unique one.
    const isSingleEmailIndex = keyFields.length === 1 && keyFields[0] === 'email';
    const isUnique = idx.unique === true;

    if (isSingleEmailIndex && isUnique && idx.name) {
      try {
        await usersCol.dropIndex(idx.name);
        logger.info(
          { index: idx.name },
          'Dropped residual global email unique index on users (multi-tenant fix)',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { index: idx.name, error: msg },
          'Failed to drop residual email index — continuing',
        );
      }
    }
  }

  logger.info(
    'Migration 2026-06-01b complete: residual global email unique index removed (if present)',
  );
}

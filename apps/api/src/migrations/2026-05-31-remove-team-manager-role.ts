// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-05-31 — remove TEAM_MANAGER role (ADR-0024).
 *
 * Problem: ADR-0024 removes the `TEAM_MANAGER` value from the `UserRole`
 * enum. The beneficiary model (ADR-0023) makes the role obsolete — "loaning
 * on behalf of others" is now a general capability of every user, gated by
 * the asset manager at approval, not a dedicated role.
 *
 * Any `Membership.roles[]` (or legacy `User.roles[]`) still containing
 * `TEAM_MANAGER` would fail Zod / `$jsonSchema` validation once the enum no
 * longer includes it. This migration strips the value from both collections.
 *
 * Rules:
 *   - `$pull` 'TEAM_MANAGER' from `roles`.
 *   - If pulling would leave `roles` empty (schema requires `.min(1)`),
 *     set it to ['EMPLOYEE'] as the safe minimal fallback.
 *
 * NOTE: This touches the system-level `UserRole`. It does NOT touch
 * `Membership.teams[].role` / `User.teams[].role` ('MEMBER' | 'MANAGER' |
 * 'COACH' | 'ASSISTANT'), which is a per-team role and unrelated.
 *
 * Idempotent — re-running after the value is gone is a no-op.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

const LEGACY_ROLE = 'TEAM_MANAGER';

export async function migrate_2026_05_31_remove_team_manager_role(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  for (const collectionName of ['memberships', 'users']) {
    const col = db.collection(collectionName);

    // Step 1: pull TEAM_MANAGER from every roles[] that contains it.
    const pullResult = await col.updateMany({ roles: LEGACY_ROLE }, {
      $pull: { roles: LEGACY_ROLE },
    } as never);

    // Step 2: any document whose roles[] is now empty gets the minimal
    // fallback. Schema requires roles.min(1) on Membership; users may have
    // an empty array post-pull. Safe default = EMPLOYEE.
    const fallbackResult = await col.updateMany(
      { roles: { $size: 0 } },
      { $set: { roles: ['EMPLOYEE'] } },
    );

    logger.info(
      {
        collection: collectionName,
        pulled: pullResult.modifiedCount,
        backfilledEmployee: fallbackResult.modifiedCount,
      },
      `Removed ${LEGACY_ROLE} from ${collectionName}.roles`,
    );
  }

  logger.info('Migration 2026-05-31 complete: TEAM_MANAGER role removed (if present)');
}

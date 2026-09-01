// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-07-06 — backfill legacy User.roles: null → [].
 *
 * `User.roles` je od ADR-0029 (2026-06-03-single-role) deprecated legacy
 * pole — appka ho nepoužíva pre RBAC (autorita je `Membership.role`), Zod
 * schéma má `.default([])`. Časť dokumentov mala reálne `roles: null`, čo
 * je nekonzistentné so schémou (mala by tam byť aspoň prázdny array).
 *
 * Priamy dopad, ktorý na to upozornil: `isManagerOrAdmin()` v
 * protocols.routes.ts robil `actor.roles.includes(...)` bez null-guardu →
 * TypeError, rozbité GET /v1/protocols, /v1/dashboard/summary a
 * /v1/loans/:id/protocols pre postihnutých userov (napr. ASSET_MANAGER v
 * druhej organizácii). Tá logická chyba je opravená samostatne — `actor.role`
 * (autoritatívne z Membership) cez `roleSatisfies`. Táto migrácia je už len
 * dátové upratanie na zosúladenie so schémou; nič v aplikácii nezávisí na
 * reálnej hodnote `User.roles`.
 *
 * Idempotentné: query cieli len na `roles: null`, po prvom behu 0 dokumentov.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

export async function migrate_2026_07_06_backfill_null_user_roles(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const result = await db.collection('users').updateMany({ roles: null }, { $set: { roles: [] } });

  logger.info(
    { matched: result.matchedCount, modified: result.modifiedCount },
    'Migration 2026-07-06 complete: backfilled legacy User.roles null → []',
  );
}

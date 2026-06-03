// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-06-03 — single hierarchical role (ADR-0029).
 *
 * Prechod z `roles: UserRole[]` na `role: UserRole` (jedna hodnota) na
 * kolekciách `memberships` a `invitations`.
 *
 * Pravidlo odvodenia (highestRole):
 *   - z poľa rolí sa vyberie tá s najvyššou úrovňou (ADMIN > ASSET_MANAGER
 *     > EMPLOYEE/EXTERNAL).
 *   - pri zhode úrovní (EMPLOYEE vs EXTERNAL, oba level 1) vyhráva EMPLOYEE.
 *   - prázdne / chýbajúce pole → EMPLOYEE.
 *
 * Pre každý dokument:
 *   $set role = highestRole(roles)
 *   $unset roles
 *
 * `User.roles` ostáva NEZMENENÉ — je to legacy pole, ktoré sa nepoužíva pre
 * RBAC (autorita = Membership.role). ADR-0029 ho zámerne ponecháva.
 *
 * Idempotentné: dokument, ktorý už má `role` a nemá `roles`, sa preskočí.
 *
 * Beží PO 2026-05-31-remove-team-manager-role (tá už odstránila TEAM_MANAGER
 * z roles[]), takže polia obsahujú len platné hodnoty enumu.
 */

import { highestRole, type UserRole } from '@inventario/shared-types';

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

interface RawWithRoles {
  _id: unknown;
  roles?: string[];
  role?: string;
}

export async function migrate_2026_06_03_single_role(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  for (const collectionName of ['memberships', 'invitations']) {
    const col = db.collection<RawWithRoles>(collectionName);

    // Dokumenty, ktoré ešte majú legacy `roles` pole (a teda neboli migrované).
    const docs = await col.find({ roles: { $exists: true } } as never).toArray();

    let migrated = 0;
    const skipped = 0;

    for (const doc of docs) {
      // Idempotencia: ak už má `role` a `roles` je len reziduum, aj tak ho
      // zjednotíme — ale ak `role` chýba, odvodíme ho z poľa.
      const derived: UserRole = doc.role
        ? (doc.role as UserRole)
        : highestRole((doc.roles ?? []) as UserRole[]);

      await col.updateOne(
        { _id: doc._id } as never,
        {
          $set: { role: derived },
          $unset: { roles: '' },
        } as never,
      );
      migrated++;
    }

    logger.info(
      { collection: collectionName, migrated, skipped },
      `Single-role migration: roles[] → role on ${collectionName}`,
    );
  }

  logger.info('Migration 2026-06-03 complete: single hierarchical role (ADR-0029)');
}

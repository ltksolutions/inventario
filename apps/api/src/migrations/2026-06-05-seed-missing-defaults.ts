// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-06-05-seed-missing-defaults
 *
 * Backfill: seed default číselníky (asset_types, asset_conditions, categories)
 * pre tenantov, ktorým chýbajú — napr. SFZ org vytvorená manuálne cez Atlas
 * alebo cez SSO self-serve registráciu pred opravou (seedTenantDefaults
 * chýbalo v oauth.routes.ts).
 *
 * Idempotentná: seedTenantDefaults používa $setOnInsert upsert na slug,
 * takže opakované spustenie nič nezduplikuje ani neprepíše existujúce hodnoty.
 *
 * Logika: pre každý aktívny tenant skontroluje či má aspoň jeden asset_type.
 * Ak nie → zavolá seedTenantDefaults. Tenanti s existujúcimi číselníkmi sú
 * preskočení bez DB zápisu.
 */

import { seedTenantDefaults } from '../lib/seed-tenant-defaults.js';

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

export async function migrate_2026_06_05_seed_missing_defaults(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const orgsCol = db.collection('organisations');
  const typesCol = db.collection('asset_types');

  const orgs = await orgsCol
    .find({ deletedAt: null, status: 'ACTIVE' })
    .project({ _id: 1, displayName: 1 })
    .toArray();

  logger.info({ orgCount: orgs.length }, 'seed-missing-defaults: checking tenants');

  let seeded = 0;
  let skipped = 0;

  for (const org of orgs) {
    const orgId = String(org._id);
    const hasTypes = await typesCol.findOne({ organisationId: orgId, deletedAt: null });

    if (hasTypes) {
      skipped++;
      continue;
    }

    const result = await seedTenantDefaults(db, orgId, 'SYSTEM');
    logger.info(
      {
        orgId,
        displayName: org['displayName'],
        conditionsInserted: result.conditionsInserted,
        categoriesInserted: result.categoriesInserted,
      },
      'seed-missing-defaults: seeded tenant',
    );
    seeded++;
  }

  logger.info({ seeded, skipped }, 'seed-missing-defaults: done');
}

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-05-29-asset-type-condition-collections
 *
 * K3: Migruje `asset.type` a `asset.condition` z enum hodnôt na slugs
 * zodpovedajúce novým per-tenant kolekciám `asset_types` a `asset_conditions`.
 *
 * Čo robí:
 *   1. Pre každý aktívny tenant (organisation) seeduje `asset_types`
 *      a `asset_conditions` z default hodnôt (idempotentne — skipuje existujúce slugs).
 *   2. Pre každý asset namapuje starú enum hodnotu na nový slug
 *      (napr. "SPORTS_GEAR" → "sportova-vystroj", "NEW" → "nove").
 *      Aktualizuje len assety s hodnotami ktoré sú v mapping tabulke.
 *
 * Bezpečnosť:
 *   - Idempotentná — ak sa spustí viackrát, nič nerozbije
 *   - Ak asset má hodnotu ktorá nie je v mapping tabulke, ponechá ju tak
 *     (nemalo by nastať pre čisté dáta, ale robustnosť je dôležitá)
 *   - Nepoužíva transakcie (bulkWrite nepodporuje multi-doc transactions
 *     na Flex clustri), ale operácie sú idempotentné
 */

import { seedTenantDefaults } from '../lib/seed-tenant-defaults.js';

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

// ---------------------------------------------------------------------------
// Mapping tables: old enum value → new slug
// ---------------------------------------------------------------------------

const TYPE_SLUG_MAP: Record<string, string> = {
  IT: 'it-majetok',
  SPORTS_GEAR: 'sportova-vystroj',
  TRAINING_EQUIPMENT: 'treningove-vybavenie',
  OFFICE_EQUIPMENT: 'kancelarske-vybavenie',
  MEDIA: 'media-a-video',
  COMMUNICATION: 'komunikacia',
  OTHER: 'ine',
};

const CONDITION_SLUG_MAP: Record<string, string> = {
  NEW: 'nove',
  EXCELLENT: 'vynikajuce',
  GOOD: 'dobre',
  FAIR: 'pouzitelne',
  POOR: 'opotrebovane',
  UNUSABLE: 'nepouzitelne',
};

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export async function migrate_2026_05_29_asset_type_condition_collections(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const orgsCollection = db.collection<{ _id: unknown; name?: string }>('organisations');
  const assetsCollection = db.collection('assets');

  // Step 1: Load all tenants (non-deleted)
  const orgs = await orgsCollection
    .find({ deletedAt: null })
    .project({ _id: 1, name: 1 })
    .toArray();

  logger.info(
    { orgCount: orgs.length },
    'K3 migration: seeding asset_types + asset_conditions per tenant',
  );

  // Step 2: Seed defaults per tenant via the shared helper (single source
  // of truth in @inventario/shared-types). Idempotent upsert on slug.
  for (const org of orgs) {
    const orgId = String(org._id);
    const { conditionsInserted, categoriesInserted } = await seedTenantDefaults(
      db,
      orgId,
      'SYSTEM',
    );
    logger.info(
      { orgId, name: org.name, conditionsInserted, categoriesInserted },
      'Seeded conditions + categories for tenant',
    );
  }

  // Step 4: Migrate asset.type enum → slug (all tenants at once, bulkWrite)
  logger.info('K3 migration: migrating asset.type enum values → slugs');

  for (const [enumValue, slug] of Object.entries(TYPE_SLUG_MAP)) {
    const result = await assetsCollection.updateMany({ type: enumValue }, { $set: { type: slug } });
    if (result.modifiedCount > 0) {
      logger.info({ enumValue, slug, modifiedCount: result.modifiedCount }, 'Migrated asset.type');
    }
  }

  // Step 5: Migrate asset.condition enum → slug
  logger.info('K3 migration: migrating asset.condition enum values → slugs');

  for (const [enumValue, slug] of Object.entries(CONDITION_SLUG_MAP)) {
    const result = await assetsCollection.updateMany(
      { condition: enumValue },
      { $set: { condition: slug } },
    );
    if (result.modifiedCount > 0) {
      logger.info(
        { enumValue, slug, modifiedCount: result.modifiedCount },
        'Migrated asset.condition',
      );
    }
  }

  logger.info('K3 migration: asset_types + asset_conditions seeded, assets migrated');
}

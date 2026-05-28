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

// Default seeds — must match DEFAULT_ASSET_TYPES / DEFAULT_ASSET_CONDITIONS in services
const DEFAULT_TYPES = [
  { name: 'IT majetok', slug: 'it-majetok', sortOrder: 0 },
  { name: 'Športová výstroj', slug: 'sportova-vystroj', sortOrder: 1 },
  { name: 'Tréningové vybavenie', slug: 'treningove-vybavenie', sortOrder: 2 },
  { name: 'Kancelárske vybavenie', slug: 'kancelarske-vybavenie', sortOrder: 3 },
  { name: 'Médiá a video', slug: 'media-a-video', sortOrder: 4 },
  { name: 'Komunikácia', slug: 'komunikacia', sortOrder: 5 },
  { name: 'Iné', slug: 'ine', sortOrder: 6 },
];

const DEFAULT_CONDITIONS = [
  { name: 'Nové', slug: 'nove', sortOrder: 0 },
  { name: 'Vynikajúce', slug: 'vynikajuce', sortOrder: 1 },
  { name: 'Dobré', slug: 'dobre', sortOrder: 2 },
  { name: 'Použiteľné', slug: 'pouzitelne', sortOrder: 3 },
  { name: 'Opotrebované', slug: 'opotrebovane', sortOrder: 4 },
  { name: 'Nepoužiteľné', slug: 'nepouzitelne', sortOrder: 5 },
];

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export async function migrate_2026_05_29_asset_type_condition_collections(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const orgsCollection = db.collection<{ _id: unknown; name?: string }>('organisations');
  const assetTypesCollection = db.collection('asset_types');
  const assetConditionsCollection = db.collection('asset_conditions');
  const assetsCollection = db.collection('assets');

  // Step 1: Ensure indexes on new collections (idempotent)
  await Promise.all([
    assetTypesCollection.createIndex(
      { organisationId: 1, slug: 1 },
      { unique: true, name: 'asset_types_organisationId_slug_unique' },
    ),
    assetConditionsCollection.createIndex(
      { organisationId: 1, slug: 1 },
      { unique: true, name: 'asset_conditions_organisationId_slug_unique' },
    ),
  ]);

  // Step 2: Load all tenants (non-deleted)
  const orgs = await orgsCollection
    .find({ deletedAt: null })
    .project({ _id: 1, name: 1 })
    .toArray();

  logger.info(
    { orgCount: orgs.length },
    'K3 migration: seeding asset_types + asset_conditions per tenant',
  );

  const now = new Date().toISOString();

  for (const org of orgs) {
    const orgId = String(org._id);
    logger.info({ orgId, name: org.name }, 'Seeding types + conditions for tenant');

    // Step 3a: Seed asset_types (idempotent — upsert on slug per tenant)
    for (const def of DEFAULT_TYPES) {
      await assetTypesCollection.updateOne(
        { organisationId: orgId, slug: def.slug },
        {
          $setOnInsert: {
            organisationId: orgId,
            name: def.name,
            slug: def.slug,
            icon: null,
            color: null,
            isActive: true,
            sortOrder: def.sortOrder,
            createdAt: now,
            updatedAt: now,
            createdBy: 'SYSTEM',
            updatedBy: 'SYSTEM',
            deletedAt: null,
            deletedBy: null,
          },
        },
        { upsert: true },
      );
    }

    // Step 3b: Seed asset_conditions (idempotent)
    for (const def of DEFAULT_CONDITIONS) {
      await assetConditionsCollection.updateOne(
        { organisationId: orgId, slug: def.slug },
        {
          $setOnInsert: {
            organisationId: orgId,
            name: def.name,
            slug: def.slug,
            icon: null,
            color: null,
            isActive: true,
            sortOrder: def.sortOrder,
            createdAt: now,
            updatedAt: now,
            createdBy: 'SYSTEM',
            updatedBy: 'SYSTEM',
            deletedAt: null,
            deletedBy: null,
          },
        },
        { upsert: true },
      );
    }
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

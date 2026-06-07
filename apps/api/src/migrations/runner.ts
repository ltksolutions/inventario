// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration runner — runs pending migrations in order on startup.
 *
 * Migrations are tracked via a `migrations` collection in MongoDB.
 * Each migration has a unique `key` and is only run once (idempotent via
 * the `completedAt` flag check before running).
 *
 * Usage:
 *   import { runPendingMigrations } from './migrations/runner.js';
 *   await runPendingMigrations(db, logger);
 *
 * This is called from apps/api/src/index.ts (and the Vercel edge function)
 * BEFORE the Fastify server starts accepting requests.
 */

import { migrate_2026_05_23_memberships } from './2026-05-23-memberships.js';
import { migrate_2026_05_25_fix_org_custom_domain_index } from './2026-05-25-fix-org-custom-domain-index.js';
import { migrate_2026_05_29_asset_type_condition_collections } from './2026-05-29-asset-type-condition-collections.js';
import { migrate_2026_05_29b_seed_default_categories } from './2026-05-29b-seed-default-categories.js';
import { migrate_2026_05_29c_fix_email_unique_index } from './2026-05-29c-fix-email-unique-index.js';
import { migrate_2026_05_31_remove_team_manager_role } from './2026-05-31-remove-team-manager-role.js';
import { migrate_2026_05_31b_loan_request_beneficiary } from './2026-05-31b-loan-request-beneficiary.js';
import { migrate_2026_06_01_asset_public_token } from './2026-06-01-asset-public-token.js';
import { migrate_2026_06_01b_drop_residual_email_index } from './2026-06-01b-drop-residual-email-index.js';
import { migrate_2026_06_03_single_role } from './2026-06-03-single-role.js';
import { migrate_2026_06_05_seed_missing_defaults } from './2026-06-05-seed-missing-defaults.js';
import { migrate_2026_06_05b_location_type_enum_expand } from './2026-06-05b-location-type-enum-expand.js';
import { migrate_2026_06_07_memberships_partial_index } from './2026-06-07-memberships-partial-index.js';
import { migrate_2026_06_08_category_asset_type_slug } from './2026-06-08-category-asset-type-slug.js';
import { migrate_2026_06_08b_merge_asset_types_into_categories } from './2026-06-08b-merge-asset-types-into-categories.js';

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

// ---------------------------------------------------------------------------
// Migration registry — add new migrations here in chronological order
// ---------------------------------------------------------------------------

interface MigrationDefinition {
  key: string;
  description: string;
  run: (db: Db, logger: FastifyBaseLogger) => Promise<void>;
}

const MIGRATIONS: MigrationDefinition[] = [
  {
    key: '2026-05-23-memberships',
    description: 'ADR-0015: Split User into global identity + Membership. Move per-tenant fields.',
    run: migrate_2026_05_23_memberships,
  },
  {
    key: '2026-05-25-fix-org-custom-domain-index',
    description:
      'Fix organisations.customDomain index — recreate with sparse: true to allow multiple null values.',
    run: migrate_2026_05_25_fix_org_custom_domain_index,
  },
  {
    key: '2026-05-29-asset-type-condition-collections',
    description:
      'K3: Seed asset_types + asset_conditions per tenant, migrate asset.type/condition enum → slug.',
    run: migrate_2026_05_29_asset_type_condition_collections,
  },
  {
    key: '2026-05-29b-seed-default-categories',
    description: 'Backfill default hierarchical categories for every existing tenant.',
    run: migrate_2026_05_29b_seed_default_categories,
  },
  {
    key: '2026-05-29c-fix-email-unique-index',
    description:
      'Drop legacy global email_unique index on users — multi-tenant allows same email in different orgs.',
    run: migrate_2026_05_29c_fix_email_unique_index,
  },
  {
    key: '2026-05-31-remove-team-manager-role',
    description:
      'ADR-0024: Remove TEAM_MANAGER from roles[] on memberships + users; backfill EMPLOYEE if emptied.',
    run: migrate_2026_05_31_remove_team_manager_role,
  },
  {
    key: '2026-05-31b-loan-request-beneficiary',
    description:
      'ADR-0023: Backfill beneficiaryId = requesterId on existing loan_requests (loan for self).',
    run: migrate_2026_05_31b_loan_request_beneficiary,
  },
  {
    key: '2026-06-01-asset-public-token',
    description: 'ADR-0021: Dogeneruj publicToken pre existujúce assety (CSPRNG, base32).',
    run: migrate_2026_06_01_asset_public_token,
  },
  {
    key: '2026-06-01b-drop-residual-email-index',
    description:
      'Drop residual global email unique index on users (2026-05-29c missed the actual name).',
    run: migrate_2026_06_01b_drop_residual_email_index,
  },
  {
    key: '2026-06-03-single-role',
    description:
      'ADR-0029: Convert memberships + invitations roles[] → single role (highestRole). User.roles left as legacy.',
    run: migrate_2026_06_03_single_role,
  },
  {
    key: '2026-06-05-seed-missing-defaults',
    description:
      'Backfill default číselníky (asset_types, asset_conditions, categories) pre tenantov bez nich (napr. SFZ org vytvorená manuálne).',
    run: migrate_2026_06_05_seed_missing_defaults,
  },
  {
    key: '2026-06-05b-location-type-enum-expand',
    description:
      'Expand LocationType enum with HEADQUARTERS and BRANCH — no DB data changes needed, enum is additive.',
    run: migrate_2026_06_05b_location_type_enum_expand,
  },
  {
    key: '2026-06-07-memberships-partial-index',
    description:
      'ADR-0029: Recreate memberships_userId_organisationId_unique with partialFilterExpression: { deletedAt: null } so soft-deleted records do not block rejoins.',
    run: migrate_2026_06_07_memberships_partial_index,
  },
  {
    key: '2026-06-08-category-asset-type-slug',
    description:
      'Kategórie: statický enum assetType → assetTypeSlug (referencia na per-tenant asset_types). Remap, doseed typov, vynútenie dedenia, drop starého indexu.',
    run: migrate_2026_06_08_category_asset_type_slug,
  },
  {
    key: '2026-06-08b-merge-asset-types-into-categories',
    description:
      'Zlúčenie číselníkov: asset_types → root kategórie (typy = root úroveň stromu), reparent starých roots, $unset categories.assetTypeSlug + assets.type.',
    run: migrate_2026_06_08b_merge_asset_types_into_categories,
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runPendingMigrations(db: Db, logger: FastifyBaseLogger): Promise<void> {
  const migrationsCollection = db.collection<MigrationRecord>('migrations');

  // Ensure the tracking collection has a unique index on `key`.
  await migrationsCollection.createIndex({ key: 1 }, { unique: true, name: 'migrations_key' });

  for (const migration of MIGRATIONS) {
    const existing = await migrationsCollection.findOne({ key: migration.key });

    if (existing?.completedAt) {
      logger.info(
        { key: migration.key, completedAt: existing.completedAt },
        `Migration already completed — skipping`,
      );
      continue;
    }

    logger.info({ key: migration.key }, `Running migration: ${migration.description}`);
    const startedAt = new Date().toISOString();

    try {
      await migration.run(db, logger);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ key: migration.key, error: msg }, `Migration FAILED`);
      throw new Error(`Migration '${migration.key}' failed: ${msg}`);
    }

    const completedAt = new Date().toISOString();

    // Upsert the completion record (idempotent if runner is restarted
    // after the migration ran but before this write).
    await migrationsCollection.updateOne(
      { key: migration.key },
      {
        $set: {
          key: migration.key,
          description: migration.description,
          startedAt,
          completedAt,
        },
      },
      { upsert: true },
    );

    logger.info({ key: migration.key, completedAt }, `Migration completed`);
  }

  logger.info('All pending migrations completed.');
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface MigrationRecord {
  key: string;
  description: string;
  startedAt: string;
  completedAt: string;
}

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-05-29b-seed-default-categories
 *
 * Backfill default hierarchical categories for every existing tenant.
 *
 * Why a separate migration (not folded into 2026-05-29):
 *   The earlier migration may already be marked `completed` on some
 *   environments (it seeded types + conditions). Migrations run once per
 *   key, so adding categories to the old migration would NOT re-run it.
 *   A new key guarantees the category seed runs everywhere exactly once.
 *
 * Idempotent: delegates to seedTenantDefaults, which find-or-inserts by
 * slug. Re-running never duplicates and never reparents user-moved
 * categories. (It also re-touches types/conditions, but those are
 * already-present no-ops.)
 */

import { seedTenantDefaults } from '../lib/seed-tenant-defaults.js';

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

export async function migrate_2026_05_29b_seed_default_categories(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const orgsCollection = db.collection<{ _id: unknown; name?: string }>('organisations');

  const orgs = await orgsCollection
    .find({ deletedAt: null })
    .project({ _id: 1, name: 1 })
    .toArray();

  logger.info({ orgCount: orgs.length }, 'Seeding default categories per tenant');

  for (const org of orgs) {
    const orgId = String(org._id);
    const { categoriesInserted } = await seedTenantDefaults(db, orgId, 'SYSTEM');
    logger.info({ orgId, name: org.name, categoriesInserted }, 'Seeded categories for tenant');
  }

  logger.info('Default categories seeded for all tenants.');
}

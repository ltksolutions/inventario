// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * seedTenantDefaults — zoseeduje default číselníky (typy + stavy) pre tenanta.
 *
 * JEDEN ZDROJ PRAVDY pre onboarding nového tenanta. Volaný z:
 *   - JIT provisioning (organisations.service — prvý SSO login)
 *   - admin create (organisations.service — vytvorenie tenanta vopred)
 *   - migrácia 2026-05-29 (backfill existujúcich tenantov)
 *
 * Defaulty pochádzajú z @inventario/shared-types (DEFAULT_ASSET_TYPES,
 * DEFAULT_ASSET_CONDITIONS) — fork ich prepíše tam a každý nový tenant
 * automaticky dostane prispôsobené číselníky.
 *
 * Pracuje priamo s `Db` (nie cez service vrstvu), aby fungoval rovnako
 * v onboardingu aj v migrácii bez závislosti na audit/transaction wiringu.
 *
 * Idempotentné: upsert na `{ organisationId, slug }` cez `$setOnInsert`,
 * takže opakované volanie nič nezduplikuje ani neprepíše existujúce
 * (napr. premenované) hodnoty.
 *
 * NEseeduje kategórie ani lokality — tie sú organisation-specific a tenant
 * si ich tvorí sám (cez Číselníky stránku alebo Combobox).
 */

import { DEFAULT_ASSET_CONDITIONS, DEFAULT_ASSET_TYPES } from '@inventario/shared-types';

import type { TaxonomyDefault } from '@inventario/shared-types';
import type { Db } from 'mongodb';

interface SeedResult {
  typesInserted: number;
  conditionsInserted: number;
}

/**
 * Seed default asset types + conditions for one tenant.
 *
 * @param db              Mongo database handle
 * @param organisationId  Tenant id (string form, matches stored docs)
 * @param createdBy        Audit stamp for seeded rows (default 'SYSTEM')
 */
export async function seedTenantDefaults(
  db: Db,
  organisationId: string,
  createdBy = 'SYSTEM',
): Promise<SeedResult> {
  const now = new Date().toISOString();

  const typesInserted = await seedCollection(
    db,
    'asset_types',
    DEFAULT_ASSET_TYPES,
    organisationId,
    createdBy,
    now,
  );
  const conditionsInserted = await seedCollection(
    db,
    'asset_conditions',
    DEFAULT_ASSET_CONDITIONS,
    organisationId,
    createdBy,
    now,
  );

  return { typesInserted, conditionsInserted };
}

async function seedCollection(
  db: Db,
  collectionName: string,
  defaults: readonly TaxonomyDefault[],
  organisationId: string,
  createdBy: string,
  now: string,
): Promise<number> {
  const collection = db.collection(collectionName);
  let inserted = 0;

  for (const def of defaults) {
    const result = await collection.updateOne(
      { organisationId, slug: def.slug },
      {
        $setOnInsert: {
          organisationId,
          name: def.name,
          slug: def.slug,
          icon: null,
          color: null,
          isActive: true,
          sortOrder: def.sortOrder,
          createdAt: now,
          updatedAt: now,
          createdBy,
          updatedBy: createdBy,
          deletedAt: null,
          deletedBy: null,
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount > 0) inserted++;
  }

  return inserted;
}

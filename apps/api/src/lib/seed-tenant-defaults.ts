// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * seedTenantDefaults — zoseeduje default číselníky pre tenanta.
 *
 * JEDEN ZDROJ PRAVDY pre onboarding nového tenanta. Volaný z:
 *   - JIT provisioning (organisations.service — prvý SSO login)
 *   - admin create (organisations.service — vytvorenie tenanta vopred)
 *   - migrácie (backfill existujúcich tenantov)
 *
 * Defaulty pochádzajú z @inventario/shared-types (DEFAULT_ASSET_CONDITIONS,
 * DEFAULT_CATEGORIES) — fork ich prepíše tam a každý nový tenant
 * automaticky dostane prispôsobené číselníky.
 *
 * Zlúčený číselník (2026-06-08): "typy majetku" už nie sú samostatná
 * kolekcia — root kategórie v strome DEFAULT_CATEGORIES plnia ich rolu.
 *
 * Pracuje priamo s `Db` (nie cez service vrstvu), aby fungoval rovnako
 * v onboardingu aj v migrácii bez závislosti na audit/transaction wiringu.
 *
 * Idempotentné: upsert na `{ organisationId, slug }` cez `$setOnInsert`,
 * takže opakované volanie nič nezduplikuje ani neprepíše existujúce
 * (napr. premenované) hodnoty.
 *
 * Seeduje stavy (flat) a kategórie (hierarchické). NEseeduje lokality —
 * tie sú organisation-specific (fyzické miesta) a tenant si ich tvorí
 * sám (cez Číselníky stránku alebo Combobox).
 */

import { DEFAULT_ASSET_CONDITIONS, DEFAULT_CATEGORIES } from '@inventario/shared-types';

import type { CategoryDefaultNode, TaxonomyDefault } from '@inventario/shared-types';
import type { Db } from 'mongodb';

interface SeedResult {
  conditionsInserted: number;
  categoriesInserted: number;
}

/**
 * Seed default asset conditions + categories for one tenant.
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

  const conditionsInserted = await seedCollection(
    db,
    'asset_conditions',
    DEFAULT_ASSET_CONDITIONS,
    organisationId,
    createdBy,
    now,
  );
  const categoriesInserted = await seedCategories(
    db,
    DEFAULT_CATEGORIES,
    organisationId,
    createdBy,
    now,
  );

  return { conditionsInserted, categoriesInserted };
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

/**
 * Seed hierarchical default categories. Two-phase per node: ensure the
 * parent exists (find-or-insert by slug), capture its _id, then ensure
 * each child with `parentId` set to the parent's _id.
 *
 * Idempotent: find-by-slug first; only insert when missing. Re-running
 * never duplicates and never reparents an existing (possibly user-moved)
 * category.
 *
 * Categories carry more required fields than types/conditions
 * (approverIds, requiresApprovalByDefault, maxLoanDays, description) so
 * we build the full document shape here rather than reusing seedCollection.
 */
async function seedCategories(
  db: Db,
  nodes: readonly CategoryDefaultNode[],
  organisationId: string,
  createdBy: string,
  now: string,
): Promise<number> {
  const categories = db.collection('categories');
  let inserted = 0;

  const ensureCategory = async (
    node: CategoryDefaultNode,
    parentId: string | null,
  ): Promise<string> => {
    const existing = await categories.findOne({ organisationId, slug: node.slug });
    if (existing) return String(existing['_id']);

    const result = await categories.insertOne({
      organisationId,
      name: node.name,
      slug: node.slug,
      parentId,
      description: null,
      icon: null,
      color: null,
      approverIds: [],
      requiresApprovalByDefault: true,
      maxLoanDays: null,
      isActive: true,
      sortOrder: node.sortOrder,
      createdAt: now,
      updatedAt: now,
      createdBy,
      updatedBy: createdBy,
      deletedAt: null,
      deletedBy: null,
    });
    inserted++;
    return String(result.insertedId);
  };

  for (const root of nodes) {
    const parentId = await ensureCategory(root, null);
    for (const child of root.children ?? []) {
      await ensureCategory(child, parentId);
    }
  }

  return inserted;
}

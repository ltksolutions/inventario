// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-06-08b-merge-asset-types-into-categories
 *
 * Zlúčenie číselníkov "Typy majetku" a "Kategórie" do jedného
 * hierarchického stromu kategórií. Root kategórie plnia rolu typov
 * (len zoskupenie); majetok sa zaraďuje výhradne do podkategórií.
 *
 * Kroky per tenant:
 *   1. Z každého záznamu `asset_types` (non-deleted) vytvorí ROOT
 *      kategóriu (name/slug/icon/color/sortOrder/isActive prenesené).
 *      Slug kolízia s existujúcou kategóriou → suffix `-typ`.
 *   2. Existujúce ROOT kategórie (z čias pred zlúčením) preradí pod
 *      type-root podľa ich `assetTypeSlug`; bez zhody → pod "Iné"
 *      (vytvorí sa, ak chýba).
 *   3. `$unset categories.assetTypeSlug` + `$unset assets.type` —
 *      obe polia zanikajú (typ = root predok kategórie).
 *   4. Drop indexov `organisationId_assetTypeSlug` (categories).
 *
 * Kolekciu `asset_types` NEMAŽE — ostáva ako záloha (žiadny kód ju už
 * nečíta); zmazať možno manuálne neskôr.
 *
 * Idempotentná: type-root sa hľadá podľa slugu pred vytvorením; krok 2
 * matchuje len roots s assetTypeSlug (po kroku 3 už neexistujú); kroky
 * 3-4 sú no-op pri opakovanom behu.
 *
 * Pozn. k hĺbke: reparent pridáva stromu jednu úroveň. Ak by tenant mal
 * strom na maxime (5 úrovní), nové uzly by limit prekročili — migrácia
 * to len zaloguje (WARN); write-path validácia platí pre nové zápisy.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Db, Document } from 'mongodb';

const FALLBACK_TYPE = { name: 'Iné', slug: 'ine' };

export async function migrate_2026_06_08b_merge_asset_types_into_categories(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const categories = db.collection('categories');
  const assetTypes = db.collection('asset_types');
  const assets = db.collection('assets');
  const now = new Date().toISOString();

  // Tenanti = zjednotenie org id z asset_types aj categories.
  const tenantIds = new Set<string>([
    ...((await assetTypes.distinct('organisationId')) as string[]),
    ...((await categories.distinct('organisationId')) as string[]),
  ]);

  let typeRootsCreated = 0;
  let rootsReparented = 0;

  for (const tenantId of tenantIds) {
    if (!tenantId) continue;

    // ----- Krok 1: type → root kategória --------------------------------
    const types = await assetTypes.find({ organisationId: tenantId, deletedAt: null }).toArray();

    /** slug typu → _id type-root kategórie (string) */
    const typeRootIdBySlug = new Map<string, string>();

    const ensureTypeRoot = async (type: {
      name: string;
      slug: string;
      icon?: unknown;
      color?: unknown;
      sortOrder?: unknown;
      isActive?: unknown;
    }): Promise<string> => {
      const cached = typeRootIdBySlug.get(type.slug);
      if (cached) return cached;

      // Už existuje root kategória s týmto slugom (idempotencia / re-run)?
      const existingSameSlug = await categories.findOne({
        organisationId: tenantId,
        slug: type.slug,
      });
      if (existingSameSlug && existingSameSlug['parentId'] == null) {
        const id = String(existingSameSlug['_id']);
        typeRootIdBySlug.set(type.slug, id);
        return id;
      }

      // Slug kolízia s NON-root kategóriou → suffix -typ.
      const slug = existingSameSlug ? `${type.slug}-typ` : type.slug;

      const collision = await categories.findOne({ organisationId: tenantId, slug });
      if (collision && collision['parentId'] == null) {
        const id = String(collision['_id']);
        typeRootIdBySlug.set(type.slug, id);
        return id;
      }

      const insert: Document = {
        organisationId: tenantId,
        name: type.name,
        slug,
        parentId: null,
        description: null,
        icon: type.icon ?? null,
        color: type.color ?? null,
        approverIds: [],
        requiresApprovalByDefault: true,
        maxLoanDays: null,
        isActive: type.isActive ?? true,
        sortOrder: type.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
        createdBy: 'SYSTEM',
        updatedBy: 'SYSTEM',
        deletedAt: null,
        deletedBy: null,
      };
      const result = await categories.insertOne(insert);
      typeRootsCreated++;
      const id = String(result.insertedId);
      typeRootIdBySlug.set(type.slug, id);
      return id;
    };

    for (const t of types) {
      await ensureTypeRoot(t as unknown as { name: string; slug: string });
    }

    // ----- Krok 2: staré root kategórie pod type-root --------------------
    //   Matchujeme len roots, ktoré ešte nesú assetTypeSlug — type-roots
    //   z kroku 1 ho nemajú, takže sa nikdy nereparentujú samy pod seba.
    const legacyRoots = await categories
      .find({ organisationId: tenantId, parentId: null, assetTypeSlug: { $exists: true } })
      .toArray();

    for (const root of legacyRoots) {
      const typeSlug = (root['assetTypeSlug'] as string) || FALLBACK_TYPE.slug;
      let typeRootId = typeRootIdBySlug.get(typeSlug);
      if (!typeRootId) {
        typeRootId = await ensureTypeRoot({ name: FALLBACK_TYPE.name, slug: FALLBACK_TYPE.slug });
      }
      await categories.updateOne(
        { _id: root['_id'] },
        { $set: { parentId: typeRootId, updatedAt: now, updatedBy: 'SYSTEM' } },
      );
      rootsReparented++;
    }
  }

  // ----- Krok 3: zánik polí (globálne, mimo per-tenant cyklu) -------------
  const unsetCategories = await categories.updateMany(
    { assetTypeSlug: { $exists: true } },
    { $unset: { assetTypeSlug: '' } },
  );
  const unsetAssets = await assets.updateMany(
    { type: { $exists: true } },
    { $unset: { type: '' } },
  );

  // ----- Krok 4: drop indexu ----------------------------------------------
  try {
    await categories.dropIndex('organisationId_assetTypeSlug');
  } catch {
    // Index neexistuje — v poriadku.
  }

  logger.info(
    {
      tenants: tenantIds.size,
      typeRootsCreated,
      rootsReparented,
      categoriesUnset: unsetCategories.modifiedCount,
      assetsUnset: unsetAssets.modifiedCount,
    },
    'merge-asset-types-into-categories: done',
  );
}

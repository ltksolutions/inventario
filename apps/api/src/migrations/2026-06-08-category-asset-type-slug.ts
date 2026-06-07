// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-06-08-category-asset-type-slug
 *
 * Kategórie prechádzajú zo statického enumu `assetType` (IT, SPORTS_GEAR,
 * ...) na `assetTypeSlug` — referenciu na per-tenant číselník `asset_types`
 * (rovnaký mechanizmus ako `asset.type` po K3 migrácii 2026-05-29).
 *
 * Kroky per tenant:
 *   1. Premapuje `categories.assetType` (enum) → `assetTypeSlug` podľa
 *      ENUM_TO_SLUG mapy; pole `assetType` odstráni ($unset).
 *      Neznáme/chýbajúce hodnoty → 'ine'.
 *   2. Doseeduje chýbajúce typy z DEFAULT_ASSET_TYPES, ak na ne nejaká
 *      kategória ukazuje (idempotentný $setOnInsert upsert na slug).
 *   3. Vynúti invariant dedenia: deti dostanú assetTypeSlug svojho root
 *      predka (typ sa riadi root úrovňou stromu).
 *   4. Dropne starý index organisationId_assetType (nový
 *      organisationId_assetTypeSlug vytvorí ensureIndexes pri starte).
 *
 * Idempotentná: krok 1 matchuje len dokumenty s existujúcim poľom
 * `assetType`; kroky 2-3 sú no-op pri opakovanom behu.
 */

import { DEFAULT_ASSET_TYPES } from '@inventario/shared-types';

import type { FastifyBaseLogger } from 'fastify';
import type { Db, Document } from 'mongodb';

/** Mapa starého enumu na slugy default typov (DEFAULT_ASSET_TYPES). */
const ENUM_TO_SLUG: Record<string, string> = {
  IT: 'it-majetok',
  SPORTS_GEAR: 'sportova-vystroj',
  TRAINING_EQUIPMENT: 'treningove-vybavenie',
  OFFICE_EQUIPMENT: 'kancelarske-vybavenie',
  MEDIA: 'media-a-video',
  COMMUNICATION: 'komunikacia',
  OTHER: 'ine',
};

const FALLBACK_SLUG = 'ine';

export async function migrate_2026_06_08_category_asset_type_slug(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const categories = db.collection('categories');
  const assetTypes = db.collection('asset_types');
  const now = new Date().toISOString();

  // ----- Krok 1: enum → slug remap + $unset starého poľa --------------------
  let remapped = 0;
  for (const [enumValue, slug] of Object.entries(ENUM_TO_SLUG)) {
    const result = await categories.updateMany(
      { assetType: enumValue },
      {
        $set: { assetTypeSlug: slug, updatedAt: now, updatedBy: 'SYSTEM' },
        $unset: { assetType: '' },
      },
    );
    remapped += result.modifiedCount;
  }

  // Kategórie s neznámou enum hodnotou alebo bez typu → fallback 'ine'.
  const fallbackResult = await categories.updateMany(
    {
      $or: [{ assetType: { $exists: true } }, { assetTypeSlug: { $exists: false } }],
    },
    {
      $set: { assetTypeSlug: FALLBACK_SLUG, updatedAt: now, updatedBy: 'SYSTEM' },
      $unset: { assetType: '' },
    },
  );
  logger.info(
    { remapped, fallback: fallbackResult.modifiedCount },
    'category-asset-type-slug: enum → slug remap done',
  );

  // ----- Krok 2: doseeduj typy, na ktoré kategórie ukazujú -------------------
  const referenced = (await categories
    .aggregate([
      { $match: { deletedAt: null } },
      { $group: { _id: { organisationId: '$organisationId', slug: '$assetTypeSlug' } } },
    ])
    .toArray()) as Array<{ _id: { organisationId: string; slug: string } }>;

  const defaultsBySlug = new Map(DEFAULT_ASSET_TYPES.map((d) => [d.slug, d]));
  let typesSeeded = 0;

  for (const ref of referenced) {
    const { organisationId, slug } = ref._id;
    if (!organisationId || !slug) continue;

    const def = defaultsBySlug.get(slug);
    const insertDoc: Document = {
      organisationId,
      name: def?.name ?? slug,
      slug,
      icon: null,
      color: null,
      isActive: true,
      sortOrder: def?.sortOrder ?? 99,
      createdAt: now,
      updatedAt: now,
      createdBy: 'SYSTEM',
      updatedBy: 'SYSTEM',
      deletedAt: null,
      deletedBy: null,
    };

    const result = await assetTypes.updateOne(
      { organisationId, slug },
      { $setOnInsert: insertDoc },
      { upsert: true },
    );
    if (result.upsertedCount > 0) typesSeeded++;
  }
  logger.info({ typesSeeded }, 'category-asset-type-slug: missing asset types seeded');

  // ----- Krok 3: dedenie — deti preberú slug root predka ---------------------
  // Per tenant in-memory prechod stromom (kategórií sú max stovky/tenant).
  const tenantIds = (await categories.distinct('organisationId', { deletedAt: null })) as string[];
  let inherited = 0;

  for (const tenantId of tenantIds) {
    const docs = await categories
      .find({ organisationId: tenantId, deletedAt: null })
      .project({ _id: 1, parentId: 1, assetTypeSlug: 1 })
      .toArray();

    const byId = new Map(docs.map((d) => [String(d['_id']), d]));

    const resolveRootSlug = (doc: Document): string => {
      let current: Document | undefined = doc;
      const seen = new Set<string>();
      while (current && current['parentId'] != null) {
        const currentId = String(current['_id']);
        if (seen.has(currentId)) break; // corrupt tree — keep own slug
        seen.add(currentId);
        const parent = byId.get(String(current['parentId']));
        if (!parent) break;
        current = parent;
      }
      return (current?.['assetTypeSlug'] as string) ?? FALLBACK_SLUG;
    };

    for (const doc of docs) {
      if (doc['parentId'] == null) continue;
      const rootSlug = resolveRootSlug(doc);
      if (doc['assetTypeSlug'] !== rootSlug) {
        await categories.updateOne(
          { _id: doc['_id'] },
          { $set: { assetTypeSlug: rootSlug, updatedAt: now, updatedBy: 'SYSTEM' } },
        );
        inherited++;
      }
    }
  }
  logger.info(
    { tenants: tenantIds.length, inherited },
    'category-asset-type-slug: inheritance enforced',
  );

  // ----- Krok 4: drop starého indexu -----------------------------------------
  try {
    await categories.dropIndex('organisationId_assetType');
    logger.info('category-asset-type-slug: dropped index organisationId_assetType');
  } catch {
    // Index neexistuje (čerstvá DB) — v poriadku.
  }
}

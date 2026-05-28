// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Default taxonomy values seeded for every new tenant.
 *
 * SINGLE SOURCE OF TRUTH — used by:
 *   - apps/api asset-types / asset-conditions services (`seedDefaults`)
 *   - apps/api tenant onboarding (JIT provisioning + admin create)
 *   - apps/api migration that backfills existing tenants
 *
 * FORK CUSTOMIZATION:
 *   A fork that wants different out-of-the-box types/conditions (e.g. a
 *   municipality vs a sports club) just edits these two arrays. Every
 *   new tenant on that fork then gets the customized defaults
 *   automatically — no other code changes needed.
 *
 * Constraints:
 *   - `slug` must be a valid slug (lowercase, hyphens, no diacritics).
 *   - `slug` must be unique within each array.
 *   - `sortOrder` controls display order in the Combobox + Číselníky page.
 *
 * Note: only TYPES and CONDITIONS are seeded as flat lists. CATEGORIES
 * are seeded as a hierarchy (see DEFAULT_CATEGORIES). Locations are
 * intentionally left empty — they are organisation-specific (physical
 * places) and the tenant builds them itself.
 */

export interface TaxonomyDefault {
  name: string;
  slug: string;
  sortOrder: number;
}

/** Default asset types seeded for every new tenant. */
export const DEFAULT_ASSET_TYPES: readonly TaxonomyDefault[] = [
  { name: 'IT majetok', slug: 'it-majetok', sortOrder: 0 },
  { name: 'Športová výstroj', slug: 'sportova-vystroj', sortOrder: 1 },
  { name: 'Tréningové vybavenie', slug: 'treningove-vybavenie', sortOrder: 2 },
  { name: 'Kancelárske vybavenie', slug: 'kancelarske-vybavenie', sortOrder: 3 },
  { name: 'Médiá a video', slug: 'media-a-video', sortOrder: 4 },
  { name: 'Komunikácia', slug: 'komunikacia', sortOrder: 5 },
  { name: 'Iné', slug: 'ine', sortOrder: 6 },
] as const;

/** Default asset conditions (physical condition) seeded for every new tenant. */
export const DEFAULT_ASSET_CONDITIONS: readonly TaxonomyDefault[] = [
  { name: 'Nové', slug: 'nove', sortOrder: 0 },
  { name: 'Vynikajúce', slug: 'vynikajuce', sortOrder: 1 },
  { name: 'Dobré', slug: 'dobre', sortOrder: 2 },
  { name: 'Použiteľné', slug: 'pouzitelne', sortOrder: 3 },
  { name: 'Opotrebované', slug: 'opotrebovane', sortOrder: 4 },
  { name: 'Nepoužiteľné', slug: 'nepouzitelne', sortOrder: 5 },
] as const;

/**
 * Default category seed — hierarchical (parent → children) so a new
 * tenant immediately sees that categories can nest. Each node carries
 * an `assetType` (the bucket it belongs to) which drives which `specs`
 * fields apply to assets in that category.
 *
 * `assetType` values must be valid AssetType enum members:
 *   IT, SPORTS_GEAR, TRAINING_EQUIPMENT, OFFICE_EQUIPMENT,
 *   MEDIA, COMMUNICATION, OTHER
 *
 * Kept deliberately generic + universal (works for a federation, a
 * municipality, a club, or a school) — a fork tailors these freely.
 * The tenant can rename, reparent, or delete any of them.
 *
 * Slugs must be unique across the WHOLE tree (not just per level),
 * because slug uniqueness in the categories collection is per-tenant,
 * not per-parent.
 */
export interface CategoryDefaultNode {
  name: string;
  slug: string;
  assetType: string;
  sortOrder: number;
  children?: readonly CategoryDefaultNode[];
}

export const DEFAULT_CATEGORIES: readonly CategoryDefaultNode[] = [
  {
    name: 'IT a výpočtová technika',
    slug: 'it-a-vypoctova-technika',
    assetType: 'IT',
    sortOrder: 0,
    children: [
      { name: 'Notebooky', slug: 'notebooky', assetType: 'IT', sortOrder: 0 },
      { name: 'Stolné počítače', slug: 'stolne-pocitace', assetType: 'IT', sortOrder: 1 },
      { name: 'Monitory a periférie', slug: 'monitory-a-periferie', assetType: 'IT', sortOrder: 2 },
    ],
  },
  {
    name: 'Mobilné zariadenia',
    slug: 'mobilne-zariadenia',
    assetType: 'COMMUNICATION',
    sortOrder: 1,
    children: [
      {
        name: 'Mobilné telefóny',
        slug: 'mobilne-telefony',
        assetType: 'COMMUNICATION',
        sortOrder: 0,
      },
      { name: 'Tablety', slug: 'tablety', assetType: 'COMMUNICATION', sortOrder: 1 },
    ],
  },
  {
    name: 'Audio a video technika',
    slug: 'audio-a-video-technika',
    assetType: 'MEDIA',
    sortOrder: 2,
    children: [
      { name: 'Kamery', slug: 'kamery', assetType: 'MEDIA', sortOrder: 0 },
      { name: 'Projektory', slug: 'projektory', assetType: 'MEDIA', sortOrder: 1 },
    ],
  },
  {
    name: 'Kancelárske vybavenie',
    slug: 'kancelarske-vybavenie-kat',
    assetType: 'OFFICE_EQUIPMENT',
    sortOrder: 3,
  },
  {
    name: 'Športové potreby',
    slug: 'sportove-potreby',
    assetType: 'SPORTS_GEAR',
    sortOrder: 4,
  },
  {
    name: 'Ostatné',
    slug: 'ostatne',
    assetType: 'OTHER',
    sortOrder: 5,
  },
] as const;

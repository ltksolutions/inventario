// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Default taxonomy values seeded for every new tenant.
 *
 * SINGLE SOURCE OF TRUTH — used by:
 *   - apps/api asset-conditions service (`seedDefaults`)
 *   - apps/api tenant onboarding (JIT provisioning + admin create)
 *   - apps/api migrations that backfill existing tenants
 *
 * FORK CUSTOMIZATION:
 *   A fork that wants different out-of-the-box conditions/categories
 *   (e.g. a municipality vs a sports club) just edits these arrays.
 *   Every new tenant on that fork then gets the customized defaults
 *   automatically — no other code changes needed.
 *
 * Constraints:
 *   - `slug` must be a valid slug (lowercase, hyphens, no diacritics).
 *   - `slug` must be unique within each array.
 *   - `sortOrder` controls display order in the Combobox + Číselníky page.
 *
 * Note: CONDITIONS are seeded as a flat list. CATEGORIES are seeded as
 * a hierarchy (see DEFAULT_CATEGORIES) — roots play the role of "asset
 * types". Locations are intentionally left empty — they are
 * organisation-specific (physical places) and the tenant builds them
 * itself.
 */

export interface TaxonomyDefault {
  name: string;
  slug: string;
  sortOrder: number;
}

/**
 * @deprecated Typy majetku boli zlúčené do stromu kategórií (root
 * kategórie = typy, 2026-06-08). Toto pole ostáva LEN pre historické
 * migrácie (2026-05-29, 2026-06-08) — nič nové ho nesmie používať.
 */
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
 * Default category seed — ONE hierarchical tree (zlúčený číselník,
 * 2026-06-08). ROOT nodes play the role of former "asset types" and
 * serve as grouping only; assets are placed exclusively into child
 * nodes (AssetsService enforces non-root categoryId). Every root MUST
 * therefore ship with at least one child.
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
  sortOrder: number;
  children?: readonly CategoryDefaultNode[];
}

export const DEFAULT_CATEGORIES: readonly CategoryDefaultNode[] = [
  {
    name: 'IT majetok',
    slug: 'it-majetok',
    sortOrder: 0,
    children: [
      { name: 'Notebooky', slug: 'notebooky', sortOrder: 0 },
      { name: 'Stolné počítače', slug: 'stolne-pocitace', sortOrder: 1 },
      { name: 'Monitory a periférie', slug: 'monitory-a-periferie', sortOrder: 2 },
      { name: 'Mobilné telefóny', slug: 'mobilne-telefony', sortOrder: 3 },
      { name: 'Tablety', slug: 'tablety', sortOrder: 4 },
    ],
  },
  {
    name: 'Športová výstroj',
    slug: 'sportova-vystroj',
    sortOrder: 1,
    children: [
      { name: 'Dresy a oblečenie', slug: 'dresy-a-oblecenie', sortOrder: 0 },
      { name: 'Lopty', slug: 'lopty', sortOrder: 1 },
      { name: 'Ostatná výstroj', slug: 'ostatna-vystroj', sortOrder: 2 },
    ],
  },
  {
    name: 'Tréningové vybavenie',
    slug: 'treningove-vybavenie',
    sortOrder: 2,
    children: [
      { name: 'Tréningové pomôcky', slug: 'treningove-pomocky', sortOrder: 0 },
      { name: 'Brány a siete', slug: 'brany-a-siete', sortOrder: 1 },
    ],
  },
  {
    name: 'Kancelárske vybavenie',
    slug: 'kancelarske-vybavenie',
    sortOrder: 3,
    children: [
      { name: 'Nábytok', slug: 'nabytok', sortOrder: 0 },
      { name: 'Tlačiarne a technika', slug: 'tlaciarne-a-technika', sortOrder: 1 },
    ],
  },
  {
    name: 'Médiá a video',
    slug: 'media-a-video',
    sortOrder: 4,
    children: [
      { name: 'Kamery', slug: 'kamery', sortOrder: 0 },
      { name: 'Projektory', slug: 'projektory', sortOrder: 1 },
    ],
  },
  {
    name: 'Komunikácia',
    slug: 'komunikacia',
    sortOrder: 5,
    children: [{ name: 'Rádiostanice a headsety', slug: 'radiostanice-a-headsety', sortOrder: 0 }],
  },
  {
    name: 'Iné',
    slug: 'ine',
    sortOrder: 6,
    children: [{ name: 'Ostatné', slug: 'ostatne', sortOrder: 0 }],
  },
] as const;

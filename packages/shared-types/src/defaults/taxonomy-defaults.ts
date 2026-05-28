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
 * Note: only TYPES and CONDITIONS are seeded. Categories and locations
 * are intentionally left empty — they are organisation-specific and the
 * tenant builds them itself (via the Číselníky page or the Combobox).
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

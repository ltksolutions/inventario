// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Filter pre fulltextové vyhľadávanie v zozname majetku (`GET /v1/assets?q=`).
 *
 * Hľadá sa podreťazec bez ohľadu na veľkosť písmen naprieč identifikačnými
 * a popisnými poľami. Vstup sa escapuje, takže regex metaznaky (`.`, `*`,
 * `(` …) sa berú doslovne — používateľ píše sériové čísla ako `A.B-12`.
 *
 * Nekotvený `$regex` nevyužije index. Pri dnešných objemoch tenantov je
 * to v poriadku; pri raste pozri NEXT.md (text index / Atlas Search).
 */

import type { Asset } from '@inventario/shared-types';
import type { Filter } from 'mongodb';

export const ASSET_SEARCH_FIELDS = [
  'inventoryNumber',
  'name',
  'serialNumber',
  'manufacturer',
  'model',
  'description',
] as const;

export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Vráti `$or` filter, alebo `{}` pre prázdny / chýbajúci výraz. */
export function buildAssetSearchFilter(q: string | undefined): Filter<Asset> {
  const term = q?.trim();
  if (!term) return {};
  const re = { $regex: escapeRegex(term), $options: 'i' };
  return { $or: ASSET_SEARCH_FIELDS.map((field) => ({ [field]: re })) } as Filter<Asset>;
}

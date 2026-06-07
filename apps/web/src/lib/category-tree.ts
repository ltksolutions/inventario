// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Pomocníci pre zlúčený číselník kategórií (2026-06-08).
 *
 * Kategórie tvoria jeden strom: ROOT uzly plnia rolu bývalých "typov
 * majetku" a slúžia len na zoskupenie; majetok sa zaraďuje výhradne do
 * podkategórií. Formuláre preto ponúkajú len non-root uzly, s labelom
 * obsahujúcim cestu od rootu (napr. "IT majetok › Notebooky").
 */

import type { CategorySummary } from './api-hooks';

export interface CategoryOption {
  id: string;
  /** Celá cesta od rootu, napr. "IT majetok › Notebooky". */
  label: string;
}

/** Oddeľovač úrovní v labeli. */
export const CATEGORY_PATH_SEPARATOR = ' › ';

/**
 * Zostaví cestu (root → uzol) pre danú kategóriu. Defenzívne voči
 * chýbajúcim rodičom a cyklom (zastaví sa po MAX 10 krokoch).
 */
export function categoryPath(
  category: CategorySummary,
  byId: ReadonlyMap<string, CategorySummary>,
): string {
  const parts: string[] = [category.name];
  let current = category;
  for (let i = 0; i < 10 && current.parentId != null; i++) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    parts.unshift(parent.name);
    current = parent;
  }
  return parts.join(CATEGORY_PATH_SEPARATOR);
}

/**
 * Možnosti pre výber kategórie majetku: len NON-ROOT uzly (root = typ,
 * len zoskupuje), zoradené podľa cesty, s hierarchickým labelom.
 */
export function buildCategoryOptions(categories: readonly CategorySummary[]): CategoryOption[] {
  const byId = new Map(categories.map((c) => [c._id, c]));
  return categories
    .filter((c) => c.parentId != null)
    .map((c) => ({ id: c._id, label: categoryPath(c, byId) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'sk'));
}

/** Root predok kategórie (alebo kategória sama, ak je root). */
export function rootCategoryOf(
  category: CategorySummary,
  byId: ReadonlyMap<string, CategorySummary>,
): CategorySummary {
  let current = category;
  for (let i = 0; i < 10 && current.parentId != null; i++) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

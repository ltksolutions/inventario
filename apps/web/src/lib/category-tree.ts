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

/**
 * Možnosti pre výber kategórie zoskupené podľa ROOT kategórie — pre
 * `<Combobox groupOf={…}>`. Na rozdiel od `buildCategoryOptions` má položka
 * label len vlastný názov (root je hlavička skupiny, nie súčasť labelu).
 *
 * Pravidlá (zhodné naprieč formulármi — žiadosť aj majetok):
 *   - vyberateľné sú LEN podkategórie (majetok/žiadosť → podkategória),
 *   - root bez podkategórií ostáva vyberateľný (aby sa nič nestratilo),
 *   - osamotené podkategórie (rodič nie je v zozname) → skupina „Ostatné",
 *   - skupiny aj položky zoradené podľa názvu (sk collator).
 *
 * Caller filtruje vstup (napr. len `isActive`) podľa potreby — helper
 * zoskupí to, čo dostane.
 */
export interface GroupedCategoryOptions {
  /** Položky zoradené skupina-po-skupine (poradie = poradie hlavičiek). */
  options: CategoryOption[];
  /** Mapovanie id položky → názov skupiny (root). */
  groupById: Record<string, string>;
}

export function buildGroupedCategoryOptions(
  categories: readonly CategorySummary[],
): GroupedCategoryOptions {
  const collator = new Intl.Collator('sk', { sensitivity: 'base' });
  const byName = (a: CategorySummary, b: CategorySummary): number =>
    collator.compare(a.name, b.name);

  const roots = categories.filter((c) => c.parentId == null).sort(byName);
  const childrenByParent = new Map<string, CategorySummary[]>();
  for (const c of categories) {
    if (c.parentId != null) {
      const arr = childrenByParent.get(c.parentId) ?? [];
      arr.push(c);
      childrenByParent.set(c.parentId, arr);
    }
  }

  const options: CategoryOption[] = [];
  const groupById: Record<string, string> = {};

  for (const root of roots) {
    const kids = (childrenByParent.get(root._id) ?? []).slice().sort(byName);
    if (kids.length > 0) {
      for (const kid of kids) {
        options.push({ id: kid._id, label: kid.name });
        groupById[kid._id] = root.name;
      }
    } else {
      options.push({ id: root._id, label: root.name });
      groupById[root._id] = root.name;
    }
  }

  const rootIds = new Set(roots.map((r) => r._id));
  for (const c of categories) {
    if (c.parentId != null && !rootIds.has(c.parentId) && !(c._id in groupById)) {
      options.push({ id: c._id, label: c.name });
      groupById[c._id] = 'Ostatné';
    }
  }

  return { options, groupById };
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

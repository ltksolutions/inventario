// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-06-09-flatten-categories-to-two-levels
 *
 * Sploštenie číselníka kategórií zo stromu (do 5 úrovní) na presne 2
 * úrovne: ROOT (parentId = null) a jeho priame deti = HODNOTY. Vnuci a
 * hlbšie uzly sa zrušia spolu s medzivrstvami.
 *
 * Rozhodnutie (Janika, 2026-06-09): „Zrušiť medzivrstvu, hodnoty pod
 * root." — listové hodnoty sa presunú priamo pod svoj ROOT predok,
 * prázdne medzivrstvy sa soft-zmažú.
 *
 * Kroky per tenant:
 *   1. Pre každú kategóriu hlbšiu ako úroveň 1 (jej rodič NIE je root)
 *      nájde ROOT predka a presmeruje ju priamo pod root.
 *   2. Medzivrstvy (uzly na úrovni 1, ktoré PÔVODNE mali deti) sa po
 *      presune detí stanú prázdnymi → soft-zmažú sa. Bezpečné: overené,
 *      že na medzivrstvy nevisí žiadny majetok (assets.categoryId).
 *   3. Oprava dátového bugu: názvy obsahujúce oddeľovač cesty „ › "
 *      (cesta omylom zapísaná do názvu) sa orežú na posledný segment,
 *      napr. „IT majetok › Monitory a periférie" → „Monitory a periférie".
 *
 * Idempotentná:
 *   - Po prvom behu už neexistuje uzol hlbší ako úroveň 1 (krok 1 = no-op).
 *   - Medzivrstvy sú soft-zmazané (krok 2 ich už nenájde — filter na
 *     deletedAt: null).
 *   - Názvy už neobsahujú „ › " (krok 3 = no-op).
 *
 * Pozn.: hodnoty na úrovni 1 BEZ detí (napr. „Elektro", „Ostatné") sú
 * legitímne hodnoty a ostávajú nedotknuté.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Db, Document, ObjectId } from 'mongodb';

const PATH_SEPARATOR = ' › ';

interface CategoryDoc extends Document {
  _id: ObjectId;
  organisationId: string;
  name: string;
  parentId: ObjectId | string | null;
  deletedAt: string | null;
}

export async function migrate_2026_06_09_flatten_categories_to_two_levels(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const categories = db.collection<CategoryDoc>('categories');
  const now = new Date().toISOString();

  const tenantIds = (await categories.distinct('organisationId')) as string[];

  let reparented = 0;
  let middleDeleted = 0;
  let namesFixed = 0;

  for (const tenantId of tenantIds) {
    if (!tenantId) continue;

    const all = await categories.find({ organisationId: tenantId, deletedAt: null }).toArray();

    // Index podľa _id (string) → doc. parentId normalizujeme na string.
    const byId = new Map<string, CategoryDoc>();
    for (const c of all) byId.set(String(c._id), c);

    const parentIdOf = (c: CategoryDoc): string | null =>
      c.parentId == null ? null : String(c.parentId);

    /** Vráti ROOT predka (alebo uzol sám, ak je root). Defenzívne voči cyklom. */
    const rootOf = (c: CategoryDoc): CategoryDoc => {
      let current = c;
      for (let i = 0; i < 10; i++) {
        const pid = parentIdOf(current);
        if (pid == null) break;
        const parent = byId.get(pid);
        if (!parent) break;
        current = parent;
      }
      return current;
    };

    /** Uzly, ktoré pôvodne mali aspoň jedno (non-deleted) dieťa. */
    const hadChildren = new Set<string>();
    for (const c of all) {
      const pid = parentIdOf(c);
      if (pid != null) hadChildren.add(pid);
    }

    // ----- Krok 1: presun hlbších uzlov priamo pod root -----------------
    for (const c of all) {
      const pid = parentIdOf(c);
      if (pid == null) continue; // root — nerieši sa
      const parent = byId.get(pid);
      if (!parent) continue; // sirota — ne/ existujúci rodič
      if (parentIdOf(parent) == null) continue; // už úroveň 1 (rodič je root)

      const root = rootOf(c);
      if (String(root._id) === String(c._id)) continue; // istota proti cyklu
      await categories.updateOne(
        { _id: c._id },
        { $set: { parentId: root._id, updatedAt: now, updatedBy: 'SYSTEM' } },
      );
      reparented++;
    }

    // ----- Krok 2: soft-delete prázdnych medzivrstiev --------------------
    //   Medzivrstva = uzol na úrovni 1 (rodič = root), ktorý PÔVODNE mal
    //   deti. Po kroku 1 sú jeho deti presunuté pod root → je prázdny.
    for (const c of all) {
      const pid = parentIdOf(c);
      if (pid == null) continue; // root
      const parent = byId.get(pid);
      if (!parent || parentIdOf(parent) != null) continue; // len úroveň 1
      if (!hadChildren.has(String(c._id))) continue; // bez detí = hodnota, ponechať

      await categories.updateOne(
        { _id: c._id, deletedAt: null },
        { $set: { deletedAt: now, deletedBy: 'SYSTEM', updatedAt: now, updatedBy: 'SYSTEM' } },
      );
      middleDeleted++;
    }

    // ----- Krok 3: oprava názvov s cestou v názve ------------------------
    for (const c of all) {
      if (typeof c.name === 'string' && c.name.includes(PATH_SEPARATOR)) {
        const segments = c.name.split(PATH_SEPARATOR);
        const fixed = segments[segments.length - 1]!.trim();
        if (fixed && fixed !== c.name) {
          await categories.updateOne(
            { _id: c._id },
            { $set: { name: fixed, updatedAt: now, updatedBy: 'SYSTEM' } },
          );
          namesFixed++;
        }
      }
    }
  }

  logger.info(
    {
      tenants: tenantIds.length,
      reparented,
      middleDeleted,
      namesFixed,
    },
    'flatten-categories-to-two-levels: done',
  );
}

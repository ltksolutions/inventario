// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Zobrazovacia úprava tagu — veľké prvé písmeno prvého slova.
 *
 * Dáta sa v databáze ukladajú vždy lowercase (pozri `TagSchema` v
 * packages/shared-types/src/schemas/common.ts) kvôli deduplikácii —
 * "Futbal" a "futbal" musia byť ten istý tag. Táto funkcia je čisto
 * kozmetická úprava pre zobrazenie v UI: mení sa iba to, čo vidí
 * používateľ, nie uložené dáta ani API kontrakt.
 */
export function displayTag(tag: string): string {
  if (!tag) return tag;
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

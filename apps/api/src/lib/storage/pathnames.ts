// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Cesty v object storage — JEDNA definícia (ADR-0037).
 *
 * Prefix príloh bol do 2026-09-02 zadrôtovaný v `modules/attachments`.
 * Odkedy existuje čistič osirelých objektov, potrebujú ho dva moduly:
 * upload ho skladá, čistič podľa neho vymenúva store. Dve definície tej
 * istej cesty by znamenali, že čistič hľadá inde, než upload ukladá —
 * a to pri mazaní nie je nepresnosť, to je strata dát.
 */

/** Koreň, pod ktorým ležia VŠETKY prílohy všetkých tenantov. */
export const ATTACHMENTS_ROOT = 'attachments/';

/**
 * Prefix pre prílohy jedného majetku: `attachments/<tenantId>/<assetId>/`.
 *
 * Tenant a asset sú v ceste zapečené zámerne — krok `confirm` si podľa
 * toho overuje, že klient neposlal cestu iného tenanta.
 */
export function attachmentPathnamePrefix(tenantId: string, assetId: string): string {
  return `${ATTACHMENTS_ROOT}${tenantId}/${assetId}/`;
}

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Auto-join podľa firemnej domény (memberJoinPolicy = DOMAIN_RESTRICTED).
 *
 * Čistá, testovateľná logika výberu organizácie pre používateľa, ktorý sa
 * prihlasuje cez OAuth a nemá pozvánku. Rozhoduje LEN o tom, do ktorej org
 * (ak vôbec) sa má auto-joinnúť — samotné založenie používateľa/členstva
 * rieši volajúci (oauth.routes.ts), aby DB efekty ostali mimo tejto funkcie.
 *
 * Pravidlá (dohodnuté 2026-06-09):
 *   - kandidát = ACTIVE org s politikou DOMAIN_RESTRICTED, ktorej
 *     autoJoinDomains obsahuje doménu e-mailu (case-insensitive),
 *   - práve 1 kandidát → auto-join,
 *   - 0 kandidátov → žiadny auto-join (volajúci vráti invite_required),
 *   - 2+ kandidátov → nejednoznačné → žiadny auto-join (späť na pozvánku),
 *   - Microsoft: ak org má entraTenantId a token nesie `tid`, musí sedieť —
 *     inak auto-join nepovolíme (nepripájame účet z cudzieho adresára).
 */

import { MemberJoinPolicy } from '@inventario/shared-types';

/** Minimálny tvar org dokumentu potrebný pre rozhodnutie. */
export interface AutoJoinOrgCandidate {
  memberJoinPolicy?: string | null;
  autoJoinDomains?: readonly string[] | null;
  entraTenantId?: string | null;
  status?: string | null;
}

export type AutoJoinSelection<T> =
  | { kind: 'ok'; org: T }
  | { kind: 'none' }
  | { kind: 'ambiguous'; count: number }
  | { kind: 'tenant_mismatch' };

/**
 * Vyberie org pre auto-join. Pozri pravidlá v hlavičke modulu.
 *
 * @param orgs       kandidáti (typicky orgy, ktoré majú doménu v autoJoinDomains)
 * @param emailDomain doména z e-mailu používateľa (časť za @)
 * @param provider   'microsoft' | 'google'
 * @param entraTid   `tid` z Microsoft id_tokenu (null/undefined pre Google)
 */
export function selectAutoJoinOrg<T extends AutoJoinOrgCandidate>(
  orgs: readonly T[],
  emailDomain: string,
  provider: 'google' | 'microsoft',
  entraTid: string | null | undefined,
): AutoJoinSelection<T> {
  const domain = emailDomain.trim().toLowerCase();
  if (!domain) return { kind: 'none' };

  const matches = orgs.filter(
    (o) =>
      o.status === 'ACTIVE' &&
      o.memberJoinPolicy === MemberJoinPolicy.DOMAIN_RESTRICTED &&
      (o.autoJoinDomains ?? []).some((d) => d.trim().toLowerCase() === domain),
  );

  if (matches.length === 0) return { kind: 'none' };
  if (matches.length > 1) return { kind: 'ambiguous', count: matches.length };

  const org = matches[0]!;

  if (provider === 'microsoft' && org.entraTenantId && entraTid && entraTid !== org.entraTenantId) {
    return { kind: 'tenant_mismatch' };
  }

  return { kind: 'ok', org };
}

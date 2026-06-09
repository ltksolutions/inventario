// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Rozlíšenie základnej URL aplikácie pre QR kódy a `/scan/` odkazy (ADR-0021).
 *
 * Poradie priority:
 *   1. `organisation.appBaseUrl` — per-tenant override (najvyššia priorita).
 *   2. `process.env.APP_BASE_URL` — default na úrovni deploymentu (fork si
 *      nastaví vlastnú doménu cez env, NIKDY sa neberie z `Host` hlavičky).
 *   3. Hardcoded fallback `https://app.inventario.estate` — aby QR/štítky
 *      fungovali out-of-the-box bez ručnej konfigurácie.
 *
 * Týmto sa zachováva bezpečnostný invariant ADR-0021 (doména z konfigurácie,
 * nie z requestu) a zároveň sa odstraňuje 409, ktorý blokoval QR/štítky keď
 * tenant nemal `appBaseUrl` vyplnený.
 */

const DEFAULT_APP_BASE_URL = 'https://app.inventario.estate';

export function resolveAppBaseUrl(orgAppBaseUrl: string | null | undefined): string {
  const env = process.env['APP_BASE_URL'];
  const base =
    (orgAppBaseUrl && orgAppBaseUrl.trim()) || (env && env.trim()) || DEFAULT_APP_BASE_URL;
  // Orež koncové lomky, aby `${base}/scan/...` nemalo dvojité „//".
  return base.replace(/\/+$/, '');
}

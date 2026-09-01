// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { JSX } from 'react';

import { OrgAwareLoginForm } from '@/components/OrgAwareLoginForm';
import { LOGIN_ERROR_MESSAGES } from '@/lib/loginErrorMessages';
import { useOrgAwareLogin } from '@/lib/useOrgAwareLogin';

const CANONICAL_APP_URL =
  process.env['NEXT_PUBLIC_CANONICAL_APP_URL'] ?? 'https://app.inventario.estate';

/**
 * /tenant-login page — ADR-0035 Fáza 2 (F6).
 *
 * Vykresľuje sa len na vlastnej doméne organizácie (napr.
 * majetok.firma.sk) po rewrite z `apps/web/middleware.ts` (F4). Zdieľa
 * branding/filtrovanie/auth logiku s globálnou `/login` cez
 * `useOrgAwareLogin` + `OrgAwareLoginForm` (F6), parametrizovanú `domain`
 * namiesto `slug`.
 *
 * DÔLEŽITÉ (fix 2026-07-16, F6e): middleware do rewritnutej URL dopĺňa
 * `?domain=<hostname>`, ale toto je pre klienta neviditeľné — `rewrite`
 * nemení URL v adresnom riadku prehliadača, a `useSearchParams()` po
 * hydratácii číta z `window.location`, nie z internej (server-side)
 * rewritnutej URL. Výsledok: `domain` bol vždy prázdny, `loginContext` sa
 * nikdy nenačítal a formulár ticho spadol na bezpečný default "zobraz
 * všetky metódy" — teda aj tie, ktoré organizácia nepovolila. Namiesto
 * spoliehania na query param čítame priamo `window.location.hostname`
 * (vždy zodpovedá skutočnej doméne v adresnom riadku, rewrite ju nemení).
 * `?domain=` query param necháme ako fallback pre manuálne lokálne
 * testovanie (napr. `localhost:3001/tenant-login?domain=majetok.firma.sk`
 * bez potreby úpravy `/etc/hosts`).
 *
 * Appka sa pod vlastnou doménou nikdy nevykresľuje priamo (cookie je
 * scoped na `.inventario.estate`, middleware iné cesty presmeruje na
 * canonical appku) — po úspešnom prihlásení preto vždy plná navigácia
 * (`window.location.href`) na `app.inventario.estate`, nikdy `router.push`.
 *
 * `?error=` banner je tu len pre konzistenciu/priamy odkaz — OAuth
 * callback (`oauth.routes.ts`) vždy presmeruje na canonical
 * `FRONTEND_BASE_URL/login?error=...`, nikdy sem.
 */
export function TenantLoginPage(): JSX.Element {
  const params = useSearchParams();

  // Prázdny počiatočný stav — `window` nie je dostupný pri build-time
  // prerenderi (stránka je statická, "○" v build outpute); doplní sa
  // efektom hneď po mounte na klientovi, bez hydratačného mismatchu.
  const [hostname, setHostname] = useState('');
  useEffect(() => {
    setHostname(window.location.hostname);
  }, []);

  const domainParam = params.get('domain') ?? '';
  const domain = domainParam || hostname;
  const nextUrl = params.get('next') ?? '';
  const errorKey = params.get('error') ?? '';

  const login = useOrgAwareLogin({
    orgHint: domain ? { kind: 'domain', value: domain } : null,
    redirectAfterLogin: (path) => {
      window.location.href = `${CANONICAL_APP_URL}${path}`;
    },
    nextUrl,
  });

  return (
    <OrgAwareLoginForm
      login={login}
      showRegisterLink={false}
      heroBranding
      banners={
        errorKey ? (
          <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
            {LOGIN_ERROR_MESSAGES[errorKey] ?? 'Nastala chyba. Skúste znova.'}
          </div>
        ) : null
      }
    />
  );
}

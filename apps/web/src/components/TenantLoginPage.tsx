// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { useSearchParams } from 'next/navigation';

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
 * majetok.futbalsfz.sk) po rewrite z `apps/web/middleware.ts` (F4), ktorý
 * doplní `?domain=<hostname>` do URL. Zdieľa branding/filtrovanie/auth
 * logiku s globálnou `/login` cez `useOrgAwareLogin` + `OrgAwareLoginForm`
 * (F6), parametrizovanú `domain` namiesto `slug`.
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

  const domain = params.get('domain') ?? '';
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
      showTagline
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

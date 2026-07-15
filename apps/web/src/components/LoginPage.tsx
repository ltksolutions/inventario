// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import type { JSX } from 'react';

import { OrgAwareLoginForm } from '@/components/OrgAwareLoginForm';
import { LOGIN_ERROR_MESSAGES } from '@/lib/loginErrorMessages';
import { useOrgAwareLogin } from '@/lib/useOrgAwareLogin';

/**
 * /login page — Slice #6b K12.
 *
 * Supports:
 *   - Email + heslo (POST /v1/auth/login/email)
 *   - SSO Google / Microsoft (POST /v1/auth/register → redirect authUrl)
 *   - ?error=  banner z OAuth callbackov
 *   - ?verified=true banner po potvrdení e-mailu
 *   - ?org=<slug> org-aware branding/filtrovanie (ADR-0035 F2)
 *
 * Branding/filtrovanie/auth logika je od ADR-0035 F6 zdieľaná s
 * `/tenant-login` cez `useOrgAwareLogin` hook + `OrgAwareLoginForm`
 * komponentu — táto stránka je už len tenký wrapper nad nimi.
 */
export function LoginPage(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();

  const errorKey = params.get('error') ?? '';
  const verified = params.get('verified') === 'true';
  const passwordReset = params.get('passwordReset') === 'true';
  const nextUrl = params.get('next') ?? '';
  // ADR-0035 F2 — org hint z URL (?org=<slug>). Bez neho sa stránka spáva
  // presne ako doteraz (všetky metódy, generé Inventario branding).
  const orgSlug = params.get('org') ?? '';

  const login = useOrgAwareLogin({
    orgHint: orgSlug ? { kind: 'slug', value: orgSlug } : null,
    // Same-origin SPA navigácia — /login je vždy na canonical appke.
    redirectAfterLogin: (path) => router.push(path),
    nextUrl,
  });

  return (
    <OrgAwareLoginForm
      login={login}
      banners={
        <>
          {verified && (
            <div className="mt-3 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
              E-mail bol potvrdený. Môžete sa prihlásiť.
            </div>
          )}
          {passwordReset && (
            <div className="mt-3 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
              Heslo bolo úspešne zmenené. Prihláste sa novým heslom.
            </div>
          )}
          {errorKey && (
            <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
              {LOGIN_ERROR_MESSAGES[errorKey] ?? 'Nastala chyba. Skúste znova.'}
            </div>
          )}
        </>
      }
    />
  );
}

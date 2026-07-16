// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { Layers, Loader2 } from 'lucide-react';
import Link from 'next/link';

import type { UseOrgAwareLoginResult } from '@/lib/useOrgAwareLogin';
import type { ReactNode, JSX } from 'react';

/**
 * Zdieľaná prezentačná časť org-aware prihlásenia — vytiahnutá z pôvodnej
 * `LoginPage.tsx` (ADR-0035 F2) pri stavbe `/tenant-login` (F6), aby obe
 * stránky (globálna `/login` aj vlastná doména) vykresľovali identický
 * branding/filtrovaný formulár nad rovnakým `useOrgAwareLogin` hookom.
 *
 * `showRegisterLink` je vypnuté na `/tenant-login` — registrácia novej
 * organizácie nemá vzťah k tomu, na akej vlastnej doméne práve stojíme.
 *
 * `heroBranding` je zapnuté len na `/tenant-login` (vlastná doména) —
 * návštevník, ktorý pristál na neznámej doméne organizácie, potrebuje
 * hneď vidieť, o akú organizáciu a akú službu ide, ešte pred prihlásením
 * (väčšie logo + názov ako samostatná sekcia nad kartou + krátky popis
 * Inventaria). Na globálnej `/login` (kde je user typicky už oboznámený)
 * ostáva len kompaktné logo+názov v riadku, presne ako doteraz.
 */
export function OrgAwareLoginForm({
  login,
  banners,
  showRegisterLink = true,
  heroBranding = false,
}: {
  login: UseOrgAwareLoginResult;
  banners?: ReactNode;
  showRegisterLink?: boolean;
  heroBranding?: boolean;
}): JSX.Element {
  const {
    loginContext,
    email,
    setEmail,
    password,
    setPassword,
    submitting,
    ssoLoading,
    formError,
    passkeySupported,
    passkeyLoading,
    showEmail,
    showGoogle,
    showMicrosoft,
    showSso,
    handleEmailLogin,
    handlePasskeyLogin,
    handleSso,
  } = login;

  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-surface-page px-4">
      <div className="w-full max-w-sm text-center">
        {/* Hero branding (/tenant-login) — väčšie logo + názov organizácie
            ako samostatná sekcia NAD kartou, nech je hneď na prvý pohľad
            jasné, o akú organizáciu a akú službu ide. */}
        {heroBranding && (
          <div className="mb-6 flex flex-col items-center gap-3">
            {loginContext?.logoUrl ? (
              <img
                src={loginContext.logoUrl}
                alt={loginContext.displayName}
                className="h-16 w-auto"
              />
            ) : (
              <Layers aria-hidden="true" className="h-16 w-16 text-brand-primary" />
            )}
            <h1 className="text-2xl font-bold text-text-primary">
              {loginContext?.displayName ?? 'Inventario'}
            </h1>
            <p className="text-sm text-text-muted">
              Evidenčný systém pre správu a vypožičiavanie majetku.
            </p>
          </div>
        )}

        <div className="rounded-xl border border-border-subtle bg-surface-card p-8 shadow-md">
          {/* Kompaktné logo + názov v riadku — len keď hero sekcia vyššie
              nie je zapnutá (globálna /login, org branding ADR-0035 F2). */}
          {!heroBranding && (
            <div className="mb-6 flex items-center justify-center gap-2 text-brand-primary">
              {loginContext?.logoUrl ? (
                // Bežné <img>, nie next/image — externé per-tenant URL nie je
                // v next/image domains allowliste (rovnaký vzor ako AppShell logo).
                <img
                  src={loginContext.logoUrl}
                  alt={loginContext.displayName}
                  className="h-7 w-auto"
                />
              ) : (
                <Layers aria-hidden="true" className="h-7 w-7" />
              )}
              <span className="text-xl font-bold">{loginContext?.displayName ?? 'Inventario'}</span>
            </div>
          )}

          <h1 className="text-lg font-semibold text-text-primary">Prihlásenie</h1>

          {banners}

          {formError && (
            <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
              {formError}
            </div>
          )}

          {/* Email form — skryté ak organizácia (ADR-0035 F2) nepovoľuje EMAIL */}
          {showEmail && (
            <form onSubmit={(e) => void handleEmailLogin(e)} className="mt-5 space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-text-primary">
                  E-mail
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                  placeholder="vas@email.sk"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-text-primary">
                  Heslo
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                  placeholder="••••••••••••"
                />
                <div className="mt-1 text-center">
                  <Link
                    href="/forgot-password"
                    className="text-xs text-text-muted hover:text-text-primary"
                  >
                    Zabudli ste heslo?
                  </Link>
                </div>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                {submitting && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                Prihlásiť sa
              </button>
            </form>
          )}

          {/* Passkey button — zobrazí sa len ak browser podporuje A organizácia
              povoľuje EMAIL (passkey je alternatíva k heslu pre LOCAL účty) */}
          {passkeySupported && showEmail && (
            <button
              type="button"
              onClick={() => void handlePasskeyLogin()}
              disabled={passkeyLoading}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-subtle px-4 py-2.5 text-sm font-medium text-text-primary transition hover:bg-surface-card disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              {passkeyLoading ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <PasskeyIcon />
              )}
              Prihlásiť sa cez passkey
            </button>
          )}

          {/* Divider — zobrazený len ak je aspoň jedna SSO možnosť aj nižšie
              niečo iné (email/passkey) nad ním; bez hintu vždy true. */}
          {showSso && (showEmail || passkeySupported) && (
            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-border-subtle" />
              <span className="text-xs text-text-muted">alebo</span>
              <div className="h-px flex-1 bg-border-subtle" />
            </div>
          )}

          {/* SSO buttons — filtrované podľa allowedAuthProviders (ADR-0035 F2) */}
          {showSso && (
            <div className="space-y-3">
              {showGoogle && (
                <SsoButton
                  provider="google"
                  label="Pokračovať s Google"
                  loading={ssoLoading === 'google'}
                  onClick={() => void handleSso('google')}
                />
              )}
              {showMicrosoft && (
                <SsoButton
                  provider="microsoft"
                  label="Pokračovať s Microsoft"
                  loading={ssoLoading === 'microsoft'}
                  onClick={() => void handleSso('microsoft')}
                />
              )}
            </div>
          )}

          {/* Register link — len na globálnej /login, nie na vlastnej doméne */}
          {showRegisterLink && (
            <p className="mt-6 text-center text-xs text-text-muted">
              Nemáte účet?{' '}
              <Link href="/register" className="font-medium text-brand-accent hover:underline">
                Zaregistrovať organizáciu
              </Link>
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

function SsoButton({
  provider,
  label,
  loading,
  onClick,
}: {
  provider: 'google' | 'microsoft';
  label: string;
  loading: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-card px-4 py-2.5 text-sm font-medium text-text-primary transition hover:bg-surface-subtle disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
    >
      {loading ? (
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
      ) : (
        <ProviderIcon provider={provider} />
      )}
      {label}
    </button>
  );
}

function ProviderIcon({ provider }: { provider: 'google' | 'microsoft' }): JSX.Element {
  if (provider === 'google') {
    return (
      <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.4 24H0V12.6L11.4 24zm1.2 0H24V12.6L12.6 24zM0 11.4V0h11.4L0 11.4zm24 0V0H12.6L24 11.4z" />
    </svg>
  );
}

function PasskeyIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="4" />
      <path d="M12 8h8M16 8v4" />
      <path d="M2 20v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1" />
    </svg>
  );
}

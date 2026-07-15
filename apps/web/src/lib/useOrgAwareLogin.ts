// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { useEffect, useRef, useState } from 'react';

import type { FormEvent } from 'react';

import { useAuth } from '@/lib/auth-context';
import { buildBrandStyle } from '@/lib/BrandProvider';
import {
  authenticateWithPasskey,
  isConditionalUISupported,
  isPasskeysSupported,
  webauthnErrorMessage,
} from '@/lib/webauthn';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

/**
 * Odpoveď GET /v1/public/organisations/login-context (ADR-0035 F1, `slug`
 * doplnené v F6 — potrebné pre OAuth `?org=` hint z `/tenant-login`, kde
 * poznáme len vlastnú doménu, nie slug, kým login-context neodpovie).
 */
export interface LoginContext {
  slug: string;
  displayName: string;
  logoUrl: string | null;
  brandColors: {
    primary: string | null;
    primaryFg: string | null;
    accent: string | null;
    accentFg: string | null;
  } | null;
  allowedAuthProviders: string[];
  hasEntraRestriction: boolean;
}

/** Ktorým parametrom sa má login-context dotazovať — presne jeden z oboch. */
export type OrgHint = { kind: 'slug'; value: string } | { kind: 'domain'; value: string } | null;

const LOGIN_CONTEXT_STYLE_ID = 'inv-login-context-brand';

export interface UseOrgAwareLoginOptions {
  orgHint: OrgHint;
  /**
   * Kam presmerovať po úspešnom email/heslo alebo passkey prihlásení.
   * `/login` (globálna, canonical appka): `router.push` — same-origin SPA
   * navigácia. `/tenant-login` (vlastná doména, ADR-0035 F6): plná
   * navigácia (`window.location.href`) na `app.inventario.estate` — appka
   * sa pod cudzou doménou nikdy priamo nevykresľuje (viď middleware.ts).
   */
  redirectAfterLogin: (path: string) => void;
  /** `?next=` query param — kam presmerovať po prihlásení (default '/'). */
  nextUrl?: string;
}

export interface UseOrgAwareLoginResult {
  loginContext: LoginContext | null;
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  submitting: boolean;
  ssoLoading: 'google' | 'microsoft' | null;
  formError: string;
  setFormError: (v: string) => void;
  passkeySupported: boolean;
  passkeyLoading: boolean;
  showEmail: boolean;
  showGoogle: boolean;
  showMicrosoft: boolean;
  showSso: boolean;
  handleEmailLogin: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  handlePasskeyLogin: () => Promise<void>;
  handleSso: (provider: 'google' | 'microsoft') => Promise<void>;
}

/**
 * Zdieľaná org-aware login logika — extrahovaná z `LoginPage.tsx` (ADR-0035
 * F2) pri stavbe `/tenant-login` (F6), aby obe stránky používali presne tú
 * istú branding/filtrovanie/auth logiku nad `login-context` endpointom,
 * parametrizovanú buď slugom (`?org=`) alebo vlastnou doménou (`?domain=`).
 *
 * Zlyhanie/chýbajúci `orgHint` sa vždy ticho ignoruje — bezpečný default
 * je zobraziť všetky metódy prihlásenia (rovnaké správanie ako pred F2),
 * nikdy nikoho nezamkáva von.
 */
export function useOrgAwareLogin({
  orgHint,
  redirectAfterLogin,
  nextUrl = '',
}: UseOrgAwareLoginOptions): UseOrgAwareLoginResult {
  const { refresh } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ssoLoading, setSsoLoading] = useState<'google' | 'microsoft' | null>(null);
  const [formError, setFormError] = useState('');
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [loginContext, setLoginContext] = useState<LoginContext | null>(null);
  const conditionalAbortRef = useRef<AbortController | null>(null);

  const hintKey = orgHint ? `${orgHint.kind}:${orgHint.value}` : '';

  // Načítaj org-aware login-context, ak máme hint (slug alebo domain).
  // Zlyhanie (404/sieť) sa ticho ignoruje — stránka ostane pri bezpečnom
  // default stave (všetky metódy zobrazené).
  useEffect(() => {
    if (!orgHint) {
      setLoginContext(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const query = `${orgHint.kind}=${encodeURIComponent(orgHint.value)}`;
        const res = await fetch(`${API_BASE}/v1/public/organisations/login-context?${query}`);
        if (!res.ok) return;
        const body = (await res.json()) as LoginContext;
        if (!cancelled) setLoginContext(body);
      } catch {
        // Sieťová chyba — ticho ignorovať, fallback na všetky metódy.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hintKey]);

  // Ak org-context nesie brand farby, vlož rovnaký `:root[data-tenant=...]`
  // override ako BrandProvider (ADR-0028) — existujúce bg-brand-primary/
  // text-brand-primary-fg triedy na stránke tak automaticky použijú farby
  // organizácie namiesto Inventario default.
  useEffect(() => {
    const root = document.documentElement;
    const tenantKey = loginContext?.slug ?? hintKey;

    if (!loginContext?.brandColors) {
      root.removeAttribute('data-tenant');
      const existing = document.getElementById(LOGIN_CONTEXT_STYLE_ID);
      if (existing) existing.textContent = '';
      return;
    }

    const css = buildBrandStyle(tenantKey, {
      ...loginContext.brandColors,
      logoDot: null,
      fontFamilySans: null,
    });
    root.setAttribute('data-tenant', tenantKey);

    let styleEl = document.getElementById(LOGIN_CONTEXT_STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = LOGIN_CONTEXT_STYLE_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;

    return () => {
      root.removeAttribute('data-tenant');
      const existing = document.getElementById(LOGIN_CONTEXT_STYLE_ID);
      if (existing) existing.textContent = '';
    };
  }, [loginContext, hintKey]);

  // Filtrovanie tlačidiel/formulára podľa allowedAuthProviders. Bez
  // načítaného org-contextu (žiadny hint alebo zlyhanie fetchu) sa všetko
  // zobrazí presne ako doteraz — bezpečný default, žiadna regresia.
  const showEmail = !loginContext || loginContext.allowedAuthProviders.includes('EMAIL');
  const showGoogle = !loginContext || loginContext.allowedAuthProviders.includes('GOOGLE');
  const showMicrosoft = !loginContext || loginContext.allowedAuthProviders.includes('MICROSOFT');
  const showSso = showGoogle || showMicrosoft;

  // Detect passkey support + start conditional UI on mount
  useEffect(() => {
    if (!isPasskeysSupported()) return;
    setPasskeySupported(true);

    void (async () => {
      const conditionalOk = await isConditionalUISupported();
      if (!conditionalOk) return;
      // Start conditional (autofill) flow in background
      const controller = new AbortController();
      conditionalAbortRef.current = controller;
      try {
        await authenticateWithPasskey(undefined, 'conditional');
        await refresh();
        redirectAfterLogin('/');
      } catch {
        // Silently ignore — user chose password or cancelled
      }
    })();

    return () => {
      conditionalAbortRef.current?.abort();
    };
    // redirectAfterLogin/refresh sa zvyčajne nemenia medzi rendermi (definované
    // v rodičovi bez memoizácie by ale teoreticky mohli — v praxi rovnaký
    // vzor ako pôvodný LoginPage.tsx, kde tento efekt tiež bežal len na mount.
  }, []);

  const handleEmailLogin = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);

    try {
      const res = await fetch(`${API_BASE}/v1/auth/login/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        await refresh();
        redirectAfterLogin(nextUrl || '/');
        return;
      }

      // MFA required
      if (res.status === 202) {
        const body = (await res.json()) as {
          mfaRequired?: boolean;
          mfaSetupRequired?: boolean;
          mfaSessionToken?: string;
          mfaSetupToken?: string;
        };
        if (body.mfaRequired && body.mfaSessionToken) {
          sessionStorage.setItem('mfa_session_token', body.mfaSessionToken);
          window.location.href = '/login/mfa';
          return;
        }
        if (body.mfaSetupRequired && body.mfaSetupToken) {
          sessionStorage.setItem('mfa_setup_token', body.mfaSetupToken);
          window.location.href = '/login/mfa-setup';
          return;
        }
      }

      const body = (await res.json()) as { message?: string };
      const msg = body.message ?? '';

      // Špeciálny prípad: user nemá membership (čaká na pozvánku)
      // ale next= smeruje na accept-invite — presmeruj tam priamo
      if (
        (res.status === 401 || res.status === 403) &&
        msg.toLowerCase().includes('organizácia') &&
        nextUrl.includes('/accept-invite')
      ) {
        window.location.href = nextUrl;
        return;
      }

      setFormError(msg || 'Nesprávny e-mail alebo heslo.');
    } catch {
      setFormError('Sieťová chyba. Skúste znova.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasskeyLogin = async (): Promise<void> => {
    setFormError('');
    setPasskeyLoading(true);
    try {
      await authenticateWithPasskey(email || undefined);
      await refresh();
      redirectAfterLogin('/');
    } catch (err) {
      setFormError(webauthnErrorMessage(err));
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleSso = async (provider: 'google' | 'microsoft'): Promise<void> => {
    setSsoLoading(provider);
    setFormError('');

    try {
      // Pre SSO login presmerujeme prehliadač priamo na backend endpoint.
      // GET /v1/auth/login/:provider redirectuje na OAuth provider (Google/Microsoft).
      // Callback spracuje autentifikáciu a presmeruje späť na frontend.
      // ?org= hint (ADR-0031 E4) — vždy slug z login-contextu (aj keď sme sa
      // dotazovali cez ?domain=, F6 doplnilo `slug` do response presne pre
      // tento účel), aby sa použili jej per-tenant OAuth credentials.
      const orgQuery = loginContext?.slug ? `?org=${encodeURIComponent(loginContext.slug)}` : '';
      window.location.href = `${API_BASE}/v1/auth/login/${provider}${orgQuery}`;
    } catch {
      setFormError('Sieťová chyba. Skúste znova.');
      setSsoLoading(null);
    }
  };

  return {
    loginContext,
    email,
    setEmail,
    password,
    setPassword,
    submitting,
    ssoLoading,
    formError,
    setFormError,
    passkeySupported,
    passkeyLoading,
    showEmail,
    showGoogle,
    showMicrosoft,
    showSso,
    handleEmailLogin,
    handlePasskeyLogin,
    handleSso,
  };
}

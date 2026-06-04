// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * /accept-invite — Slice #6c K18.5
 *
 * Public page. Reads ?token= from URL, fetches invite preview from
 * GET /v1/auth/invitations/:token, and lets the invitee set up their
 * account via password or OAuth (Google / Microsoft).
 *
 * States:
 *   loading      — fetching preview
 *   invalid      — 410 / network error (expired or already used)
 *   ready        — show preview + form/OAuth buttons
 *   submitting   — password form in flight
 *   success      — redirect to /dashboard?invited=accepted
 *   error        — password accept failed, allow retry
 */

import { Layers, Loader2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { FormEvent, JSX } from 'react';

import { useAuth } from '@/lib/auth-context';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InvitePreview {
  email: string;
  role: string;
  firstName: string | null;
  lastName: string | null;
  organisation: {
    displayName: string;
    slug: string;
  };
  inviter: {
    displayName: string;
  };
  expiresAt: string;
  acceptMode: 'new-user' | 'existing-user';
  existingUserPreview: {
    displayName: string;
    authProviders: string[];
  } | null;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrátor',
  ASSET_MANAGER: 'Správca majetku',
  EMPLOYEE: 'Zamestnanec',
  EXTERNAL: 'Externý používateľ',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AcceptInvitePage(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const { user, isAuthenticated, refresh: refreshAuth } = useAuth();

  const [state, setState] = useState<
    'loading' | 'invalid' | 'ready' | 'submitting' | 'confirming' | 'error'
  >('loading');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [invalidMsg, setInvalidMsg] = useState('');

  // Form fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [formError, setFormError] = useState('');

  // SSO loading
  const [ssoLoading, setSsoLoading] = useState<'google' | 'microsoft' | null>(null);

  // -------------------------------------------------------------------------
  // Load invite preview on mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!token) {
      setInvalidMsg('Chýba token. Skontrolujte odkaz v e-maile.');
      setState('invalid');
      return;
    }

    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/auth/invitations/${token}`);

        if (res.status === 410 || res.status === 404) {
          setInvalidMsg(
            'Táto pozvánka je neplatná alebo vypršala. Požiadajte správcu o novú pozvánku.',
          );
          setState('invalid');
          return;
        }

        if (!res.ok) {
          setInvalidMsg('Nastala sieťová chyba. Skúste znova neskôr.');
          setState('invalid');
          return;
        }

        const data = (await res.json()) as InvitePreview;
        setPreview(data);
        // Pre-fill name if backend provided it
        if (data.firstName) setFirstName(data.firstName);
        if (data.lastName) setLastName(data.lastName);
        setState('ready');
      } catch {
        setInvalidMsg('Nastala sieťová chyba. Skúste znova neskôr.');
        setState('invalid');
      }
    })();
  }, [token]);

  // -------------------------------------------------------------------------
  // Existing-user accept handler (K20)
  // -------------------------------------------------------------------------
  const handleExistingUserAccept = async (): Promise<void> => {
    setState('confirming');
    try {
      const res = await fetch(`${API_BASE}/v1/auth/accept-invitation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        await refreshAuth();
        router.push('/?invited=accepted');
        return;
      }
      const body = (await res.json()) as { message?: string };
      setFormError(body.message ?? 'Nastala chyba. Skúste znova.');
      setState('error');
    } catch {
      setFormError('Sieťová chyba. Skúste znova.');
      setState('error');
    }
  };

  // -------------------------------------------------------------------------
  // Password accept handler
  // -------------------------------------------------------------------------
  const handlePasswordAccept = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setFormError('');

    if (password.length < 12) {
      setFormError('Heslo musí mať aspoň 12 znakov.');
      return;
    }
    if (password !== confirm) {
      setFormError('Heslá sa nezhodujú.');
      return;
    }

    setState('submitting');

    try {
      const res = await fetch(`${API_BASE}/v1/auth/accept-invitation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, password, firstName, lastName }),
      });

      if (res.ok) {
        router.push('/?invited=accepted');
        return;
      }

      const body = (await res.json()) as { message?: string };
      setFormError(body.message ?? 'Nastala chyba. Skúste znova.');
      setState('error');
    } catch {
      setFormError('Sieťová chyba. Skúste znova.');
      setState('error');
    }
  };

  // -------------------------------------------------------------------------
  // OAuth accept handler (K18.3)
  // -------------------------------------------------------------------------
  const handleSso = (provider: 'google' | 'microsoft'): void => {
    setSsoLoading(provider);
    setFormError('');

    // Redirect directly to the OAuth login endpoint with invitationToken as
    // a query param. The backend embeds it in the signed state cookie and
    // the callback accepts the pending invite automatically — no POST needed.
    // ADR-0031 E4: add org slug so callback builds provider from tenant credentials.
    const loginUrl = new URL(`${API_BASE}/v1/auth/login/${provider}`);
    loginUrl.searchParams.set('invitationToken', token);
    if (preview?.organisation.slug) {
      loginUrl.searchParams.set('org', preview.organisation.slug);
    }
    window.location.href = loginUrl.toString();
  };

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const roleLabel = preview?.role ? (ROLE_LABELS[preview.role] ?? preview.role) : '';

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------
  if (state === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-page px-4">
        <div className="flex flex-col items-center gap-3 text-text-secondary">
          <Loader2 className="h-8 w-8 animate-spin text-brand-primary" aria-hidden="true" />
          <p className="text-sm">Overujem pozvánku…</p>
        </div>
      </main>
    );
  }

  // -------------------------------------------------------------------------
  // Invalid / expired state
  // -------------------------------------------------------------------------
  if (state === 'invalid') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-page px-4">
        <div className="w-full max-w-sm">
          <div className="rounded-xl border border-border-subtle bg-surface-card p-8 shadow-md text-center">
            <div className="mb-4 flex items-center justify-center gap-2 text-brand-primary">
              <Layers aria-hidden="true" className="h-7 w-7" />
              <span className="text-xl font-bold">Inventario</span>
            </div>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
              <span className="text-2xl" role="img" aria-label="Chyba">
                ✕
              </span>
            </div>
            <h1 className="text-base font-semibold text-text-primary">Neplatná pozvánka</h1>
            <p className="mt-2 text-sm text-text-secondary">{invalidMsg}</p>
            <Link
              href="/login"
              className="mt-5 inline-block text-sm font-medium text-brand-accent hover:underline"
            >
              Prejsť na prihlásenie
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // -------------------------------------------------------------------------
  // Ready / submitting / error states — show the accept form
  // -------------------------------------------------------------------------
  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-surface-page px-4">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-border-subtle bg-surface-card p-8 shadow-md">
          {/* Logo */}
          <div className="mb-5 flex items-center gap-2 text-brand-primary">
            <Layers aria-hidden="true" className="h-7 w-7" />
            <span className="text-xl font-bold">Inventario</span>
          </div>

          {/* Invite preview */}
          {preview && (
            <div className="mb-6 rounded-lg border border-border-subtle bg-surface-subtle p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck
                  className="mt-0.5 h-5 w-5 flex-shrink-0 text-brand-accent"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary">
                    <span className="font-semibold">{preview.inviter.displayName}</span> vás
                    pozval/a do organizácie{' '}
                    <span className="font-semibold">{preview.organisation.displayName}</span>.
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    Rola: <span className="font-medium">{roleLabel}</span>
                  </p>
                  <p className="text-xs text-text-muted">Pozvánka pre: {preview.email}</p>
                </div>
              </div>
            </div>
          )}

          {/* Error banner */}
          {formError && (
            <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
              {formError}
            </div>
          )}

          {/* === Existing-user path (K20) === */}
          {preview?.acceptMode === 'existing-user' ? (
            <div className="mt-5 space-y-4">
              <h1 className="text-base font-semibold text-text-primary">Pridať organizáciu</h1>
              <p className="text-sm text-text-secondary">
                Táto pozvánka je určená pre existujúceho používateľa.
              </p>
              {isAuthenticated && user ? (
                <>
                  <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 text-sm">
                    <p className="font-medium text-text-primary">
                      Prihlásený ako: {user.displayName}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">{user.email}</p>
                  </div>
                  {user.email.toLowerCase() === preview.email.toLowerCase() ? (
                    <button
                      type="button"
                      onClick={() => void handleExistingUserAccept()}
                      disabled={state === 'confirming'}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                    >
                      {state === 'confirming' && (
                        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                      )}
                      Prijať pozvánku
                    </button>
                  ) : (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-medium text-amber-900">Nesprávny účet</p>
                      <p className="mt-1 text-xs text-amber-800">
                        Táto pozvánka je pre <strong>{preview.email}</strong>, ale ste prihlásený
                        ako <strong>{user.email}</strong>. Odhláste sa a prihláste sa správnym
                        účtom.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          void fetch(`${API_BASE}/v1/auth/logout`, {
                            method: 'POST',
                            credentials: 'include',
                          }).finally(() => {
                            window.location.href = `/login?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`;
                          });
                        }}
                        className="mt-3 inline-block rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                      >
                        Odhlásiť sa a pokračovať
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4">
                  <p className="text-sm font-medium text-text-primary">Najprv sa prihlás</p>
                  <p className="mt-1 text-xs text-text-secondary">
                    Prihláste sa ako{' '}
                    <strong>{preview.existingUserPreview?.displayName ?? preview.email}</strong> a
                    pozvánka sa automaticky potvrdí.
                  </p>
                  <Link
                    href={`/login?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`}
                    className="mt-3 inline-block rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-brand-primary-fg transition hover:opacity-90"
                  >
                    Prihlásiť sa
                  </Link>
                </div>
              )}
            </div>
          ) : (
            /* === New-user path: password form + SSO === */
            <>
              <h1 className="mt-4 text-base font-semibold text-text-primary">Nastavte si účet</h1>
              <p className="mt-0.5 text-sm text-text-secondary">Vyplňte údaje alebo použite SSO.</p>

              <form onSubmit={(e) => void handlePasswordAccept(e)} className="mt-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="firstName"
                      className="block text-sm font-medium text-text-primary"
                    >
                      Meno
                    </label>
                    <input
                      id="firstName"
                      type="text"
                      autoComplete="given-name"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Ján"
                      className="mt-1 block w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="lastName"
                      className="block text-sm font-medium text-text-primary"
                    >
                      Priezvisko
                    </label>
                    <input
                      id="lastName"
                      type="text"
                      autoComplete="family-name"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Novák"
                      className="mt-1 block w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-text-primary">
                    Heslo
                  </label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="min. 12 znakov"
                    className="mt-1 block w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                  />
                  <PasswordStrengthBar password={password} />
                </div>

                <div>
                  <label htmlFor="confirm" className="block text-sm font-medium text-text-primary">
                    Potvrdiť heslo
                  </label>
                  <input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••••••"
                    className="mt-1 block w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                  />
                </div>

                <button
                  type="submit"
                  disabled={state === 'submitting'}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                >
                  {state === 'submitting' && (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  )}
                  Prijať pozvánku a nastaviť heslo
                </button>
              </form>

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-border-subtle" />
                <span className="text-xs text-text-muted">alebo</span>
                <div className="h-px flex-1 bg-border-subtle" />
              </div>

              <div className="space-y-3">
                <SsoButton
                  provider="google"
                  label="Prijať s Google"
                  loading={ssoLoading === 'google'}
                  onClick={() => handleSso('google')}
                  disabled={state === 'submitting'}
                />
                <SsoButton
                  provider="microsoft"
                  label="Prijať s Microsoft"
                  loading={ssoLoading === 'microsoft'}
                  onClick={() => handleSso('microsoft')}
                  disabled={state === 'submitting'}
                />
              </div>
            </>
          )}

          <p className="mt-5 text-center text-xs text-text-muted">
            Prijatím pozvánky súhlasíte s podmienkami používania Inventario.
          </p>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Password strength indicator
// ---------------------------------------------------------------------------

function getStrength(pwd: string): { score: number; label: string; color: string } {
  if (pwd.length === 0) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pwd.length >= 12) score++;
  if (pwd.length >= 16) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;

  if (score <= 1) return { score: 1, label: 'Slabé', color: 'bg-red-400' };
  if (score <= 2) return { score: 2, label: 'Primerané', color: 'bg-yellow-400' };
  if (score <= 3) return { score: 3, label: 'Dobré', color: 'bg-blue-400' };
  return { score: 4, label: 'Silné', color: 'bg-green-500' };
}

function PasswordStrengthBar({ password }: { password: string }): JSX.Element | null {
  const { score, label, color } = getStrength(password);
  if (!password) return null;

  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= score ? color : 'bg-border-subtle'
            }`}
          />
        ))}
      </div>
      <p className="mt-0.5 text-xs text-text-muted">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SSO button
// ---------------------------------------------------------------------------

function SsoButton({
  provider,
  label,
  loading,
  disabled,
  onClick,
}: {
  provider: 'google' | 'microsoft';
  label: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
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

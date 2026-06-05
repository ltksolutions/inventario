// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { Layers, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import type { FormEvent, JSX } from 'react';

import { useAuth } from '@/lib/auth-context';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

/**
 * /link-account page — Account Provider Linking.
 *
 * Two modes based on query params:
 *
 *   Password path: ?token=<link_token>&hint=<masked_email>
 *     User enters their existing account password to confirm linking.
 *     POST /v1/auth/link-provider/confirm { link_token, password }
 *
 *   Magic-link path: ?method=email&hint=<masked_email>
 *     Email with magic link was already sent by the backend.
 *     This page just shows a "check your email" message.
 *     The actual linking happens when user clicks the email link
 *     (GET /v1/auth/link-provider/verify → sets cookies → redirects /dashboard).
 */
export function LinkAccountPage(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useAuth();

  const token = params.get('token') ?? '';
  const method = params.get('method') ?? '';
  const hint = params.get('hint') ?? '';
  const error = params.get('error') ?? '';

  const isMagicLink = method === 'email';
  const isPasswordPath = Boolean(token) && !isMagicLink;

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [linked, setLinked] = useState(false);

  const ERROR_MESSAGES: Record<string, string> = {
    invalid_magic_token: 'Odkaz na prepojenie je neplatný.',
    magic_token_expired:
      'Odkaz na prepojenie vypršal. Prihláste sa znova cez Microsoft alebo Google.',
    user_not_found: 'Účet nebol nájdený.',
    membership_not_found: 'Aktívne členstvo nenájdené. Kontaktujte správcu.',
    org_not_found: 'Organizácia nenájdená. Kontaktujte správcu.',
  };

  const handleConfirm = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);

    try {
      const res = await fetch(`${API_BASE}/v1/auth/link-provider/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ link_token: token, password }),
      });

      if (res.ok) {
        setLinked(true);
        await refresh();
        router.push('/dashboard?linked=true');
        return;
      }

      const body = (await res.json()) as { message?: string };
      if (res.status === 400 || res.status === 401) {
        setFormError(body.message ?? 'Nesprávne heslo alebo vypršaný odkaz.');
      } else {
        setFormError('Nastala chyba. Skúste sa prihlásiť znova.');
      }
    } catch {
      setFormError('Sieťová chyba. Skúste znova.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-surface-page px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-border-subtle bg-surface-card p-8 shadow-md">
          {/* Logo */}
          <div className="mb-6 flex items-center gap-2 text-brand-primary">
            <Layers aria-hidden="true" className="h-7 w-7" />
            <span className="text-xl font-bold">Inventario</span>
          </div>

          <h1 className="text-lg font-semibold text-text-primary">Prepojenie účtu</h1>

          {/* Error from magic-link verify redirect */}
          {error && (
            <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
              {ERROR_MESSAGES[error] ?? 'Nastala chyba. Skúste sa prihlásiť znova.'}
            </div>
          )}

          {/* Magic-link path — email sent */}
          {isMagicLink && !error && (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg bg-blue-50 px-4 py-4 text-sm text-blue-800">
                <p className="font-medium">Skontrolujte e-mail</p>
                <p className="mt-1 text-blue-700">
                  Odoslali sme odkaz na prepojenie účtu na adresu <strong>{hint}</strong>. Kliknite
                  naň do 30 minút.
                </p>
              </div>
              <p className="text-xs text-text-muted">
                Nenašli ste e-mail? Skontrolujte priečinok spam, alebo sa skúste prihlásiť znova.
              </p>
              <button
                type="button"
                onClick={() => router.push('/login')}
                className="w-full rounded-lg border border-border-default bg-surface-subtle px-4 py-2.5 text-sm font-medium text-text-primary transition hover:bg-surface-card"
              >
                Späť na prihlásenie
              </button>
            </div>
          )}

          {/* Password path */}
          {isPasswordPath && !linked && (
            <>
              <p className="mt-3 text-sm text-text-muted">
                Váš e-mail {hint && <strong className="text-text-primary">{hint}</strong>} je
                priradený k existujúcemu účtu. Zadajte heslo pre potvrdenie prepojenia.
              </p>

              {formError && (
                <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
                  {formError}
                </div>
              )}

              <form onSubmit={(e) => void handleConfirm(e)} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-text-primary">
                    Heslo k existujúcemu účtu
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
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60"
                >
                  {submitting && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                  Prepojiť účty
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/login')}
                  className="w-full rounded-lg border border-border-default bg-surface-subtle px-4 py-2.5 text-sm font-medium text-text-primary transition hover:bg-surface-card"
                >
                  Zrušiť
                </button>
              </form>
            </>
          )}

          {/* Fallback — no valid params */}
          {!isMagicLink && !isPasswordPath && !error && (
            <div className="mt-4 space-y-4">
              <p className="text-sm text-text-muted">
                Táto stránka vyžaduje platný odkaz na prepojenie účtu.
              </p>
              <button
                type="button"
                onClick={() => router.push('/login')}
                className="w-full rounded-lg border border-border-default bg-surface-subtle px-4 py-2.5 text-sm font-medium text-text-primary transition hover:bg-surface-card"
              >
                Späť na prihlásenie
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

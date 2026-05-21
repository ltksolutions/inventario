// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * /login/mfa — MFA challenge page (Slice #7 K7.7).
 *
 * Shown after successful email+password login when the user has MFA
 * enabled. Reads `mfaSessionToken` from sessionStorage (stored there
 * by LoginPage on 202 response). Submits TOTP code or recovery code
 * to POST /v1/auth/mfa/challenge. On success, auth cookies are set
 * by the backend and the user is redirected to the dashboard.
 *
 * Session storage key: `mfa_session_token` — cleared after use.
 */

import { Layers, Loader2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { FormEvent, JSX } from 'react';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

export function MfaChallengePage(): JSX.Element {
  const router = useRouter();

  const [mfaSessionToken, setMfaSessionToken] = useState<string | null>(null);
  const [tokenMissing, setTokenMissing] = useState(false);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Read token from sessionStorage on mount
  useEffect(() => {
    const token = sessionStorage.getItem('mfa_session_token');
    if (!token) {
      setTokenMissing(true);
    } else {
      setMfaSessionToken(token);
    }
    // Focus the input for fast keyboard entry
    inputRef.current?.focus();
  }, []);

  // Auto-submit when 6 digits entered (TOTP mode)
  useEffect(() => {
    if (!useRecovery && /^\d{6}$/.test(code) && mfaSessionToken) {
      void submit(code);
    }
    // code + useRecovery intentionally omitted — submit is stable, token checked inside
  }, [code, useRecovery]);

  const submit = async (submittedCode: string): Promise<void> => {
    if (!mfaSessionToken) return;
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/v1/auth/mfa/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mfaSessionToken, code: submittedCode }),
      });

      if (res.ok) {
        // Token consumed — clear from sessionStorage
        sessionStorage.removeItem('mfa_session_token');
        router.push('/');
        return;
      }

      const body = (await res.json()) as { message?: string };
      setError(body.message ?? 'Neplatný kód. Skúste znova.');
      setCode('');
      inputRef.current?.focus();
    } catch {
      setError('Sieťová chyba. Skúste znova.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    await submit(code);
  };

  // Token missing — user navigated directly without going through login
  if (tokenMissing) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-page px-4">
        <div className="w-full max-w-sm rounded-xl border border-border-subtle bg-surface-card p-8 shadow-md text-center">
          <div className="mb-4 flex items-center justify-center gap-2 text-brand-primary">
            <Layers aria-hidden="true" className="h-7 w-7" />
            <span className="text-xl font-bold">Inventario</span>
          </div>
          <p className="text-sm text-text-secondary">
            Platnosť prihlásenia vypršala.{' '}
            <Link href="/login" className="font-medium text-brand-accent hover:underline">
              Prihláste sa znova.
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-surface-page px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-border-subtle bg-surface-card p-8 shadow-md">
          {/* Logo */}
          <div className="mb-5 flex items-center gap-2 text-brand-primary">
            <Layers aria-hidden="true" className="h-7 w-7" />
            <span className="text-xl font-bold">Inventario</span>
          </div>

          {/* Header */}
          <div className="mb-5 flex items-center gap-3">
            <ShieldCheck aria-hidden="true" className="h-8 w-8 flex-shrink-0 text-brand-accent" />
            <div>
              <h1 className="text-base font-semibold text-text-primary">
                {useRecovery ? 'Záložný kód' : 'Overenie prihlásenia'}
              </h1>
              <p className="text-xs text-text-secondary">
                {useRecovery
                  ? 'Zadajte jeden zo záložných kódov'
                  : 'Zadajte 6-miestny kód z aplikácie'}
              </p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
          )}

          {/* Form */}
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            {useRecovery ? (
              <div>
                <label
                  htmlFor="recovery-code"
                  className="block text-sm font-medium text-text-primary"
                >
                  Záložný kód
                </label>
                <input
                  id="recovery-code"
                  ref={inputRef}
                  type="text"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX"
                  maxLength={9}
                  className="mt-1 block w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 text-center font-mono text-sm tracking-widest text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
              </div>
            ) : (
              <div>
                <label htmlFor="totp-code" className="block text-sm font-medium text-text-primary">
                  Kód z aplikácie
                </label>
                <input
                  id="totp-code"
                  ref={inputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  required
                  minLength={6}
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="mt-1 block w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 text-center font-mono text-2xl tracking-[0.5em] text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
                <p className="mt-1 text-xs text-text-muted">
                  Kód sa automaticky odošle po zadaní 6 číslic.
                </p>
              </div>
            )}

            {useRecovery && (
              <button
                type="submit"
                disabled={loading || code.length < 8}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                {loading && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                Overiť záložný kód
              </button>
            )}

            {loading && !useRecovery && (
              <div className="flex justify-center py-2">
                <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-brand-accent" />
              </div>
            )}
          </form>

          {/* Toggle between TOTP and recovery code */}
          <div className="mt-5 border-t border-border-subtle pt-4 text-center">
            <button
              type="button"
              onClick={() => {
                setUseRecovery((v) => !v);
                setCode('');
                setError('');
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
              className="text-xs text-text-muted hover:text-text-primary hover:underline"
            >
              {useRecovery
                ? '← Späť na kód z aplikácie'
                : 'Nemám prístup k aplikácii — použiť záložný kód'}
            </button>
          </div>

          <div className="mt-3 text-center">
            <Link
              href="/login"
              className="text-xs text-text-muted hover:text-text-primary hover:underline"
            >
              Zrušiť a prihlásiť sa znova
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

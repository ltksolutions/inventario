// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { Layers, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import type { FormEvent, JSX } from 'react';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

/**
 * /reset-password — K20.
 *
 * Gets ?token= from URL. Sends POST /v1/auth/reset-password { token, password }.
 * On success redirects to /login?passwordReset=true.
 * On failure (expired/invalid token) shows error with link to /forgot-password.
 */
export function ResetPasswordPage(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-page px-4">
        <div className="w-full max-w-sm rounded-xl border border-border-subtle bg-surface-card p-8 shadow-md text-center">
          <p className="text-sm text-text-secondary">
            Neplatný odkaz. Požiadajte o{' '}
            <a href="/forgot-password" className="underline hover:text-text-primary">
              nový odkaz na obnovenie hesla
            </a>
            .
          </p>
        </div>
      </main>
    );
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Heslá sa nezhodujú.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      if (res.ok) {
        router.push('/login?passwordReset=true');
        return;
      }

      const body = (await res.json()) as { message?: string };
      setError(body.message ?? 'Odkaz je neplatný alebo vypršal. Požiadajte o nový.');
    } catch {
      setError('Sieťová chyba. Skúste znova.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-surface-page px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-border-subtle bg-surface-card p-8 shadow-md">
          <div className="mb-5 flex items-center gap-2 text-brand-primary">
            <Layers aria-hidden="true" className="h-7 w-7" />
            <span className="text-xl font-bold">Inventario</span>
          </div>

          <h1 className="text-lg font-semibold text-text-primary">Nastaviť nové heslo</h1>
          <p className="mt-1 text-sm text-text-secondary">Minimálne 12 znakov.</p>

          {error && (
            <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}{' '}
              {error.includes('vypršal') && (
                <a href="/forgot-password" className="underline">
                  Požiadať o nový odkaz
                </a>
              )}
            </div>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-text-primary">
                Nové heslo
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="mt-1 block w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
              />
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
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              {loading && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              Nastaviť heslo
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

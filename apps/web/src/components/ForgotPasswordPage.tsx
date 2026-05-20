// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { Layers, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import type { FormEvent, JSX } from 'react';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

/**
 * /forgot-password — K20.
 *
 * POST /v1/auth/forgot-password always returns 204 regardless of
 * whether the email exists (prevents email enumeration). We always
 * show the success message after submit.
 */
export function ForgotPasswordPage(): JSX.Element {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch(`${API_BASE}/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Ignore network errors — always show success to prevent enumeration.
    } finally {
      setLoading(false);
      setSubmitted(true);
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

          {submitted ? (
            <>
              <h1 className="text-lg font-semibold text-text-primary">Skontrolujte e-mail</h1>
              <p className="mt-2 text-sm text-text-secondary">
                Ak je e-mail <span className="font-medium text-text-primary">{email}</span>{' '}
                zaregistrovaný, do 5 minút dostanete odkaz na obnovenie hesla.
              </p>
              <p className="mt-3 text-xs text-text-muted">
                Neklikajte na podozrivé odkazy. Odkaz je platný <strong>1 hodinu</strong>.
              </p>
              <Link
                href="/login"
                className="mt-6 block text-center text-sm font-medium text-brand-accent hover:underline"
              >
                Späť na prihlásenie
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-text-primary">Obnovenie hesla</h1>
              <p className="mt-1 text-sm text-text-secondary">
                Zadajte svoj e-mail a pošleme vám odkaz na nastavenie nového hesla.
              </p>

              <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-4">
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
                    placeholder="vas@email.sk"
                    className="mt-1 block w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                >
                  {loading && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                  Odoslať odkaz
                </button>
              </form>

              <Link
                href="/login"
                className="mt-4 block text-center text-sm text-text-muted hover:text-text-primary"
              >
                Späť na prihlásenie
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

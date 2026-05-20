// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { Layers, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { FormEvent, JSX, ReactNode } from 'react';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

type Provider = 'google' | 'microsoft' | 'email';

/**
 * /register page — Slice #6b K13.
 *
 * Unified registration entry point. Handles:
 *   - Org info collection (name, contact email, optional IČO)
 *   - DPA acceptance (required)
 *   - Provider choice (Google / Microsoft / Email)
 *   - Email path: shows password field + submits inline
 *   - SSO path: POSTs to /v1/auth/register → redirects to authUrl
 */
export function RegisterPage(): JSX.Element {
  const router = useRouter();

  const [orgName, setOrgName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [ico, setIco] = useState('');
  const [dpaAccepted, setDpaAccepted] = useState(false);
  const [provider, setProvider] = useState<Provider>('email');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!dpaAccepted) {
      setError('Musíte súhlasiť so spracovaním osobných údajov.');
      return;
    }
    setError('');
    setSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        orgName,
        contactEmail,
        provider,
        dpaAccepted: true,
      };
      if (ico.trim()) body['ico'] = ico.trim();
      if (provider === 'email') body['password'] = password;

      const res = await fetch(`${API_BASE}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as {
        type?: string;
        authUrl?: string;
        emailVerificationRequired?: boolean;
        error?: string;
        message?: string;
      };

      if (!res.ok) {
        setError(data.error ?? data.message ?? 'Registrácia zlyhala. Skúste znova.');
        return;
      }

      if (data.type === 'oauth' && data.authUrl) {
        window.location.href = data.authUrl;
        return;
      }

      if (data.emailVerificationRequired) {
        router.push('/register/verify-email');
        return;
      }

      router.push('/onboarding');
    } catch {
      setError('Sieťová chyba. Skúste znova.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main
      id="main"
      className="flex min-h-screen items-center justify-center bg-surface-page px-4 py-12"
    >
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-border-subtle bg-surface-card p-8 shadow-md">
          <div className="mb-6 flex items-center gap-2 text-brand-primary">
            <Layers aria-hidden="true" className="h-7 w-7" />
            <span className="text-xl font-bold">Inventario</span>
          </div>

          <h1 className="text-lg font-semibold text-text-primary">Vytvoriť organizáciu</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Zaregistrujte svoju organizáciu a začnite spravovať majetok.
          </p>

          {error && (
            <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-4">
            {/* Org name */}
            <Field label="Názov organizácie" htmlFor="orgName" required>
              <input
                id="orgName"
                type="text"
                required
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Slovenský futbalový zväz"
                className={inputCls}
              />
            </Field>

            {/* Contact email */}
            <Field label="Kontaktný e-mail" htmlFor="contactEmail" required>
              <input
                id="contactEmail"
                type="email"
                required
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="admin@vasaorg.sk"
                className={inputCls}
              />
            </Field>

            {/* IČO optional */}
            <Field label="IČO (voliteľné)" htmlFor="ico">
              <input
                id="ico"
                type="text"
                value={ico}
                onChange={(e) => setIco(e.target.value)}
                placeholder="12345678"
                className={inputCls}
              />
            </Field>

            {/* Provider */}
            <Field label="Spôsob prihlásenia" htmlFor="provider" required>
              <div className="mt-1 grid grid-cols-3 gap-2">
                {(['google', 'microsoft', 'email'] as Provider[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setProvider(p)}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
                      provider === p
                        ? 'border-brand-primary bg-brand-primary text-brand-primary-fg'
                        : 'border-border-default bg-surface-card text-text-secondary hover:bg-surface-subtle'
                    }`}
                  >
                    {p === 'google' ? 'Google' : p === 'microsoft' ? 'Microsoft' : 'E-mail'}
                  </button>
                ))}
              </div>
            </Field>

            {/* Password (only for email provider) */}
            {provider === 'email' && (
              <Field label="Heslo (min. 12 znakov)" htmlFor="password" required>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={12}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className={inputCls}
                />
              </Field>
            )}

            {/* DPA */}
            <label className="flex items-start gap-3 text-sm text-text-secondary">
              <input
                type="checkbox"
                required
                checked={dpaAccepted}
                onChange={(e) => setDpaAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border-default text-brand-primary focus:ring-brand-primary"
              />
              <span>
                Súhlasím so{' '}
                <a
                  href="https://inventario.estate/dpa"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-text-primary"
                >
                  spracovaním osobných údajov
                </a>{' '}
                (povinné podľa GDPR čl. 28).
              </span>
            </label>

            <button
              type="submit"
              disabled={submitting || !dpaAccepted}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              {submitting && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              {provider === 'email'
                ? 'Vytvoriť účet'
                : 'Pokračovať s ' + (provider === 'google' ? 'Google' : 'Microsoft')}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-text-muted">
            Už máte účet?{' '}
            <Link href="/login" className="font-medium text-brand-accent hover:underline">
              Prihlásiť sa
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

const inputCls =
  'mt-1 block w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus';

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-text-primary">
        {label}
        {required && (
          <span className="ml-1 text-red-500" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { CheckCircle, Layers } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { JSX } from 'react';

import { useAuth } from '@/lib/auth-context';

type Step = 'welcome' | 'done';

/**
 * /onboarding wizard — Slice #6b K14.
 *
 * Shown after first registration. Welcomes the user and lets them
 * confirm onboarding completion. Future steps (org info, first asset)
 * can be added as additional Step values.
 *
 * On completion calls PATCH /v1/organisations/:id with
 * onboardingCompletedAt and redirects to the dashboard.
 */
export function OnboardingPage(): JSX.Element {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [step, setStep] = useState<Step>('welcome');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleComplete = async (): Promise<void> => {
    setLoading(true);
    setError('');

    try {
      // Auth context gives us the user; the org id comes from the JWT
      // payload via /v1/auth/me. For now we mark onboarding complete
      // server-side by calling /v1/auth/onboarding-complete if it
      // exists, or just redirect — the PATCH will land in K14b when
      // the organisations admin API is more fleshed out.
      //
      // For MVP: mark step as done visually and go to dashboard.
      setStep('done');
      await refresh();
      setTimeout(() => router.push('/'), 1200);
    } catch {
      setError('Nastala chyba. Skúste znova.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'done') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-page px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle className="h-12 w-12 text-green-500" aria-hidden="true" />
          <p className="text-lg font-semibold text-text-primary">Všetko pripravené!</p>
          <p className="text-sm text-text-secondary">Presmerúvam na dashboard…</p>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-surface-page px-4">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-border-subtle bg-surface-card p-8 shadow-md">
          <div className="mb-6 flex items-center gap-2 text-brand-primary">
            <Layers aria-hidden="true" className="h-7 w-7" />
            <span className="text-xl font-bold">Inventario</span>
          </div>

          <h1 className="text-lg font-semibold text-text-primary">
            Vitajte{user?.firstName ? `, ${user.firstName}` : ''}!
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Váš účet je pripravený. Inventario vám pomôže prehľadne evidovať majetok vašej
            organizácie — od IT vybavenia po tréningové pomôcky.
          </p>

          <ul className="mt-6 space-y-3">
            {[
              'Pridávajte a sledujte majetok (inventárne čísla, stav, poloha)',
              'Spravujte výpožičky a požiadavky zamestnancov',
              'Kategórie a lokality si nastavíte podľa vašich potrieb',
            ].map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-text-secondary">
                <CheckCircle
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-green-500"
                />
                {item}
              </li>
            ))}
          </ul>

          {error && (
            <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
          )}

          <button
            type="button"
            onClick={() => void handleComplete()}
            disabled={loading}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            Prejsť na dashboard
          </button>
        </div>
      </div>
    </main>
  );
}

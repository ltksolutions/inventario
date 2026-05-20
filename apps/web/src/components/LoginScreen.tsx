// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { Layers, Mail, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import Link from 'next/link';

import type { JSX, ReactNode } from 'react';

/**
 * Pre-login landing screen — Slice #6b.
 *
 * Shown by AuthGate when there is no active session. Directs users to
 * /login (email + SSO) or /register (new organisation).
 */
export function LoginScreen(): JSX.Element {
  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-surface-page px-4">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-border-subtle bg-surface-card p-8 shadow-md sm:p-10">
          <div className="mb-6 flex items-center gap-3 text-brand-primary">
            <Layers aria-hidden="true" className="h-9 w-9" />
            <span className="text-2xl font-bold">Inventario</span>
          </div>

          <h1 className="text-xl font-semibold text-text-primary">Vitajte späť</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Prihláste sa do svojej organizácie alebo si vytvorte nový účet.
          </p>

          <div className="mt-6 flex flex-col gap-3">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-5 py-3 text-base font-semibold text-brand-primary-fg shadow-cta transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page"
            >
              <Mail aria-hidden="true" className="h-5 w-5" />
              Prihlásiť sa
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-card px-5 py-3 text-base font-semibold text-text-primary transition hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              Vytvoriť novú organizáciu
            </Link>
          </div>

          <ul className="mt-8 space-y-3 border-t border-border-subtle pt-6">
            <Feature
              icon={<ShieldCheck aria-hidden="true" className="h-4 w-4" />}
              text="Single sign-on cez Google alebo Microsoft"
            />
            <Feature
              icon={<Zap aria-hidden="true" className="h-4 w-4" />}
              text="Alebo e-mail + heslo — žiadne záväzky"
            />
            <Feature
              icon={<Sparkles aria-hidden="true" className="h-4 w-4" />}
              text="Inventár pripravený do pár sekúnd"
            />
          </ul>
        </div>

        <p className="mt-6 text-center text-xs text-text-muted">
          Problémy s prihlásením? Kontaktujte svojho správcu alebo{' '}
          <a href="mailto:support@inventario.estate" className="underline hover:text-text-primary">
            support@inventario.estate
          </a>
          .
        </p>
      </div>
    </main>
  );
}

function Feature({ icon, text }: { icon: ReactNode; text: string }): JSX.Element {
  return (
    <li className="flex items-center gap-3 text-sm text-text-secondary">
      <span className="text-brand-accent">{icon}</span>
      {text}
    </li>
  );
}

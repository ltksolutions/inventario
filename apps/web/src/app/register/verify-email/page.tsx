// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { Layers, Mail } from 'lucide-react';
import Link from 'next/link';

import type { Metadata } from 'next';
import type { JSX } from 'react';

export const metadata: Metadata = { title: 'Potvrďte e-mail' };

/**
 * /register/verify-email — K20.
 *
 * Shown after email registration. Tells the user to check their inbox
 * and click the verification link. The link itself goes to the backend
 * GET /v1/auth/verify-email?token=... which verifies and redirects to
 * /login?verified=true — no further frontend page is needed for that step.
 */
export default function VerifyEmailPage(): JSX.Element {
  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-surface-page px-4">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-border-subtle bg-surface-card p-8 shadow-md text-center">
          <div className="mb-4 flex justify-center text-brand-primary">
            <Layers aria-hidden="true" className="h-8 w-8" />
          </div>

          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-primary/10">
            <Mail aria-hidden="true" className="h-7 w-7 text-brand-primary" />
          </div>

          <h1 className="text-xl font-semibold text-text-primary">
            Skontrolujte svoju doručenú poštu
          </h1>
          <p className="mt-3 text-sm text-text-secondary">
            Poslali sme vám e-mail s odkazom na potvrdenie. Kliknite na odkaz a váš účet bude
            aktivovaný.
          </p>

          <div className="mt-4 rounded-lg bg-surface-subtle px-4 py-3 text-xs text-text-muted">
            Odkaz je platný <strong>24 hodín</strong>. Ak ste e-mail nedostali, skontrolujte
            priečinok s nevyžiadanou poštou.
          </div>

          <p className="mt-6 text-xs text-text-muted">
            Máte účet?{' '}
            <Link href="/login" className="font-medium text-brand-accent hover:underline">
              Prihlásiť sa
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

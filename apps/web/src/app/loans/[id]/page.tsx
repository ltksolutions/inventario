// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { JSX } from 'react';

import { AuthGate } from '@/components/AuthGate';
import { LoanDetailContent } from '@/components/LoanDetailContent';

/**
 * /loans/[id] — detail jednej výpožičky (Loan, nie LoanRequest).
 *
 * Server component v štýle /assets/[id]: rozparsovať URL segment,
 * odovzdať id klientskému komponentu, zabaliť do AuthGate.
 *
 * Pozn.: statický segment /loans/request má v Next.js prednosť pred
 * dynamickým [id], takže kolízia nehrozí (id je 24-hex ObjectId).
 *
 * V Next.js 15 sú dynamic route params Promise — treba await.
 */
export default async function LoanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  return (
    <AuthGate>
      <LoanDetailContent loanId={id} />
    </AuthGate>
  );
}

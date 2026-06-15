// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { JSX } from 'react';

import { AuthGate } from '@/components/AuthGate';
import { LoanRequestDetailContent } from '@/components/LoanRequestDetailContent';

/**
 * /loans/request/[id] — detail jednej žiadosti o výpožičku (LoanRequest).
 *
 * Statický segment /loans/request (formulár novej žiadosti) má vlastný
 * page.tsx; tento dynamický [id] pod ním obsluhuje detail konkrétnej žiadosti.
 *
 * V Next.js 15 sú dynamic route params Promise — treba await.
 */
export default async function LoanRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  return (
    <AuthGate>
      <LoanRequestDetailContent requestId={id} />
    </AuthGate>
  );
}

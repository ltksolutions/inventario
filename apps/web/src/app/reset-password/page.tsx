// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { Suspense } from 'react';

import type { Metadata } from 'next';
import type { JSX } from 'react';

import { ResetPasswordPage } from '@/components/ResetPasswordPage';

export const metadata: Metadata = { title: 'Nastaviť nové heslo' };

// useSearchParams() requires Suspense in Next.js App Router
export default function Page(): JSX.Element {
  return (
    <Suspense>
      <ResetPasswordPage />
    </Suspense>
  );
}

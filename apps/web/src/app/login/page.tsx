// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { Suspense } from 'react';

import type { Metadata } from 'next';
import type { JSX } from 'react';

import { LoginPage } from '@/components/LoginPage';

export const metadata: Metadata = { title: 'Prihlásenie' };

export default function Page(): JSX.Element {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  );
}

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { Suspense } from 'react';

import type { Metadata } from 'next';
import type { JSX } from 'react';

import { TenantLoginPage } from '@/components/TenantLoginPage';

export const metadata: Metadata = { title: 'Prihlásenie' };

export default function Page(): JSX.Element {
  return (
    <Suspense>
      <TenantLoginPage />
    </Suspense>
  );
}

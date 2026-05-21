// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { Suspense } from 'react';

import type { Metadata } from 'next';
import type { JSX } from 'react';

import { MfaChallengePage } from '@/components/MfaChallengePage';

export const metadata: Metadata = { title: 'Overenie prihlásenia' };

export default function Page(): JSX.Element {
  return (
    <Suspense>
      <MfaChallengePage />
    </Suspense>
  );
}

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { JSX } from 'react';

import { AuthGate } from '@/components/AuthGate';
import { MyLoansContent } from '@/components/MyLoansContent';

/**
 * /my-loans — current user's active and historical loans.
 * Available to all authenticated users (EMPLOYEE+).
 */
export default function MyLoansPage(): JSX.Element {
  return (
    <AuthGate>
      <MyLoansContent />
    </AuthGate>
  );
}

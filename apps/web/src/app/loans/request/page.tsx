// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { JSX } from 'react';

import { AuthGate } from '@/components/AuthGate';
import { LoanRequestContent } from '@/components/LoanRequestContent';

/**
 * /loans/request — new loan request form.
 * Available to all authenticated users (EMPLOYEE+).
 */
export default function LoanRequestPage(): JSX.Element {
  return (
    <AuthGate>
      <LoanRequestContent />
    </AuthGate>
  );
}

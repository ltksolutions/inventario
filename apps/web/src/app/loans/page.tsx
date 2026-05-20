// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { JSX } from 'react';

import { AuthGate } from '@/components/AuthGate';
import { LoansContent } from '@/components/LoansContent';

/**
 * /loans — loan requests list.
 * EMPLOYEE sees own requests; ASSET_MANAGER + ADMIN see all tenant requests.
 */
export default function LoansPage(): JSX.Element {
  return (
    <AuthGate>
      <LoansContent />
    </AuthGate>
  );
}

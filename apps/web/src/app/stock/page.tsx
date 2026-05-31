// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { JSX } from 'react';

import { AuthGate } from '@/components/AuthGate';
import { StockOverviewContent } from '@/components/StockOverviewContent';

/**
 * /stock — prehľad skladu (BULK položky s indikátormi zásob).
 * ASSET_MANAGER + ADMIN.
 */
export default function StockPage(): JSX.Element {
  return (
    <AuthGate>
      <StockOverviewContent />
    </AuthGate>
  );
}

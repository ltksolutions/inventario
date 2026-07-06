// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { JSX } from 'react';

import { AuditLogContent } from '@/components/AuditLogContent';
import { AuthGate } from '@/components/AuthGate';

/**
 * /audit-log — kompletný, prehľadávateľný audit log aktívneho tenanta
 * (2026-07-07). Pozri AuditLogContent pre RBAC gate (ASSET_MANAGER +
 * ADMIN) a dáta/filtre.
 */
export default function AuditLogPage(): JSX.Element {
  return (
    <AuthGate>
      <AuditLogContent />
    </AuthGate>
  );
}

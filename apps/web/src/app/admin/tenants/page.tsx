// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { JSX } from 'react';

import { AuthGate } from '@/components/AuthGate';
import { TenantsContent } from '@/components/TenantsContent';

/**
 * /admin/tenants — platform admin panel for managing all organisations.
 *
 * RBAC: ADMIN only (platform operator). Backend enforces this on all
 * /v1/organisations endpoints. In practice only LTK Solutions has ADMIN.
 *
 * Features: list all tenants, create new tenant, edit plan/status,
 * soft-delete (archive).
 */
export default function TenantsPage(): JSX.Element {
  return (
    <AuthGate>
      <TenantsContent />
    </AuthGate>
  );
}

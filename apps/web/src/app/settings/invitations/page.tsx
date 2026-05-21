// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { JSX } from 'react';

import { AuthGate } from '@/components/AuthGate';
import { InvitationsContent } from '@/components/InvitationsContent';

/**
 * /settings/invitations — správa pozvaniek pre aktuálny tenant.
 *
 * RBAC:
 *   - GET /v1/invitations      ADMIN + ASSET_MANAGER
 *   - POST /v1/invitations     ADMIN + ASSET_MANAGER
 *   - DELETE /v1/invitations/:id ADMIN + ASSET_MANAGER
 *
 * InvitationsContent zobrazuje AccessDenied pre EMPLOYEE a EXTERNAL.
 */
export default function InvitationsPage(): JSX.Element {
  return (
    <AuthGate>
      <InvitationsContent />
    </AuthGate>
  );
}

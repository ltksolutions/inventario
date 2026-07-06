// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { JSX } from 'react';

import { AuthGate } from '@/components/AuthGate';
import { PersonsContent } from '@/components/PersonsContent';

/**
 * /persons — "Osoby" module list. See PersonsContent for the RBAC
 * gate (ASSET_MANAGER + ADMIN) and data-fetching details.
 */
export default function PersonsPage(): JSX.Element {
  return (
    <AuthGate>
      <PersonsContent />
    </AuthGate>
  );
}

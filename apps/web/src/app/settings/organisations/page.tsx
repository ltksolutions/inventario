// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type React from 'react';

import { AuthGate } from '@/components/AuthGate';
import { OrganisationsContent } from '@/components/OrganisationsContent';

export default function OrganisationsPage(): React.JSX.Element {
  return (
    <AuthGate>
      <OrganisationsContent />
    </AuthGate>
  );
}

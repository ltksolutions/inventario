// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type React from 'react';

import { AuthGate } from '@/components/AuthGate';
import { OrganisationSettingsContent } from '@/components/OrganisationSettingsContent';

export default function OrganisationSettingsPage(): React.JSX.Element {
  return (
    <AuthGate>
      <OrganisationSettingsContent />
    </AuthGate>
  );
}

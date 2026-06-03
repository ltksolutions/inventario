// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { JSX } from 'react';

import { AuthGate } from '@/components/AuthGate';
import { AuthSettingsContent } from '@/components/AuthSettingsContent';

export default function AuthSettingsPage(): JSX.Element {
  return (
    <AuthGate>
      <AuthSettingsContent />
    </AuthGate>
  );
}

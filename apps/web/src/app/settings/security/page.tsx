// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { JSX } from 'react';

import { AuthGate } from '@/components/AuthGate';
import { SecurityContent } from '@/components/SecurityContent';

export default function SecurityPage(): JSX.Element {
  return (
    <AuthGate>
      <SecurityContent />
    </AuthGate>
  );
}

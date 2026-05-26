// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type React from 'react';

import { AuthGate } from '@/components/AuthGate';
import { MembersContent } from '@/components/MembersContent';

export default function MembersPage(): React.JSX.Element {
  return (
    <AuthGate>
      <MembersContent />
    </AuthGate>
  );
}

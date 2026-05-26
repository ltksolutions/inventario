// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { JSX } from 'react';

import { AssetCreateContent } from '@/components/AssetCreateContent';
import { AuthGate } from '@/components/AuthGate';

export default function AssetNewPage(): JSX.Element {
  return (
    <AuthGate>
      <AssetCreateContent />
    </AuthGate>
  );
}

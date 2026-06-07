// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { JSX } from 'react';

import { AuthGate } from '@/components/AuthGate';
import { ProtocolsContent } from '@/components/ProtocolsContent';

/**
 * /protocols — zoznam preberacích protokolov (ADR-0022).
 *
 * Menu položka je managerOnly; backend pre prípadný priamy prístup
 * EMPLOYEE vynúti filter na protokoly, kde je účastníkom.
 */
export default function ProtocolsPage(): JSX.Element {
  return (
    <AuthGate>
      <ProtocolsContent />
    </AuthGate>
  );
}

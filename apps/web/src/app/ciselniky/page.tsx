// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { JSX } from 'react';

import { AuthGate } from '@/components/AuthGate';
import { CiselnikyContent } from '@/components/CiselnikyContent';

/**
 * /ciselniky — zjednotená správa taxonómie (kategórie, lokality,
 * typy majetku, stavy) na jednej stránke so 4 záložkami.
 *
 * Nahrádza pôvodné samostatné /categories a /locations stránky.
 * Combobox v asset formulári rieši rýchle pridanie za behu; táto
 * stránka slúži na správu (prehľad, premenovanie, mazanie).
 *
 * RBAC:
 *   - Zobrazenie: všetci prihlásení
 *   - Pridať / premenovať: ASSET_MANAGER + ADMIN
 *   - Zmazať: ADMIN only (backend FK protection)
 */
export default function CiselnikyPage(): JSX.Element {
  return (
    <AuthGate>
      <CiselnikyContent />
    </AuthGate>
  );
}

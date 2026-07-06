// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * Zdieľaný resolver pre zobrazenie kondície majetku (Asset.condition,
 * LoanItemCondition.condition, ProtocolItem.condition).
 *
 * Kondícia je od zavedenia číselníka "Stavy" (/ciselniky, AssetCondition
 * kolekcia) dynamická per-tenant hodnota — uložený `condition` na majetku/
 * položke je slug (napr. "dobre"), nie pevný enum. Predtým bola kondícia
 * fixný enum (NEW/EXCELLENT/GOOD/FAIR/POOR/UNUSABLE) a UI komponenty mali
 * na 4 miestach duplikovanú hardcoded `CONDITION_LABELS` mapu pre tieto
 * staré kľúče — pri custom slugoch z číselníka Stavy (napr. "dobre") mapa
 * nič nenašla a používateľ videl surový slug namiesto názvu ("Dobré").
 *
 * `useConditionLabel()` vráti resolver funkciu: skús live číselník Stavy
 * (slug → name), potom legacy enum mapu (staré dáta pred migráciou na
 * číselník), inak surová hodnota (nikdy nezlyhá na neznámej hodnote).
 */

import { useMemo } from 'react';

import { useAssetConditions } from './api-hooks';

/** Fallback pre dáta z obdobia pred číselníkom Stavy (pevný enum). */
const LEGACY_CONDITION_LABELS: Record<string, string> = {
  NEW: 'Nové',
  EXCELLENT: 'Vynikajúce',
  GOOD: 'Dobré',
  FAIR: 'Použiteľné',
  POOR: 'Opotrebované',
  UNUSABLE: 'Nepoužiteľné',
};

export function useConditionLabel(): (condition: string) => string {
  const conditionsQuery = useAssetConditions();

  const bySlug = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of conditionsQuery.data?.data ?? []) {
      map[c.slug] = c.name;
    }
    return map;
  }, [conditionsQuery.data]);

  return (condition: string) =>
    bySlug[condition] ?? LEGACY_CONDITION_LABELS[condition] ?? condition;
}

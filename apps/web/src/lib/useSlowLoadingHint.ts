// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { useEffect, useState } from 'react';

/**
 * useSlowLoadingHint — po zadanom čase načítavania vráti `true`.
 *
 * Načítanie dashboardu trvá po dlhšej prestávke niekoľko sekúnd (studená
 * serverless inštancia + prvé spojenie na Atlas). Skeleton sám o sebe
 * používateľovi nepovie, či appka pracuje, alebo je pokazená — po pár
 * sekundách čakania predpokladá to druhé. Tento hook je spínač pre
 * doplňujúcu vetu, ktorá sa objaví, až keď čakanie prekročí bežnú dĺžku;
 * pri rýchlom načítaní sa nezobrazí vôbec a nerobí zbytočný šum.
 *
 * Prah 3 s je zvolený tak, aby bežné teplé načítanie (namerané ~1–3 s)
 * hint nespustilo, ale používateľ ho uvidel skôr, než začne appku
 * považovať za zamrznutú.
 */
export function useSlowLoadingHint(isLoading: boolean, delayMs = 3000): boolean {
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setIsSlow(false);
      return;
    }
    const timer = setTimeout(() => {
      setIsSlow(true);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [isLoading, delayMs]);

  return isSlow;
}

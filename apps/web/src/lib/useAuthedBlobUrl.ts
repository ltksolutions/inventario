// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { useEffect, useState } from 'react';

/**
 * Načíta chránený obrázok cez `fetch` s cookie a vráti blob URL.
 *
 * PREČO NIE `<img src>` PRIAMO: API beží na inej doméne než web
 * (`api.inventario.estate` vs. appka), takže požiadavka z `<img>` je
 * cross-origin a prehliadač k nej auth cookie nepripojí — endpoint by
 * odpovedal 401. `crossOrigin="use-credentials"` by v produkcii prešlo
 * (cookie je SameSite=None), ale lokálne nie: tam je cookie `lax` a
 * localhost:3000 vs. :3001 sú rôzne originy. Fetch s
 * `credentials: 'include'` funguje v oboch prostrediach rovnako.
 *
 * Rovnaký prístup používa QR náhľad v `AssetDetailContent`.
 *
 * Blob URL sa pri odmontovaní alebo zmene adresy uvoľní — bez toho by
 * pri listovaní galérie ostávali v pamäti karty všetky stiahnuté obrázky.
 *
 * @param url adresa chráneného obrázka, alebo `null` (vtedy sa nefetchuje)
 * @returns `objectUrl` — blob URL, kým sa načítava `null`;
 *          `failed` — `true`, ak požiadavka zlyhala (napr. 404 pri prílohe
 *          bez náhľadu), aby si volajúci vedel zobraziť náhradu
 */
export function useAuthedBlobUrl(url: string | null): {
  objectUrl: string | null;
  failed: boolean;
} {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setObjectUrl(null);
    setFailed(false);

    if (!url) {
      return;
    }

    let created: string | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  return { objectUrl, failed };
}

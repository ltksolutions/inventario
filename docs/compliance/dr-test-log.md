<!--
SPDX-FileCopyrightText: 2026 LTK Solutions, s.r.o.
SPDX-License-Identifier: CC-BY-4.0
-->

# DR Test Log — Inventario

Záznamy všetkých Disaster Recovery testov platformy Inventario.
Povinné pred go-live a následne štvrťročne (viď `disaster-recovery-plan.md` sekcia 5).

---

## DR Test #1 — 2026-05-23 (pred go-live)

| Parameter          | Hodnota                                                                             |
| ------------------ | ----------------------------------------------------------------------------------- |
| **Dátum**          | 23. máj 2026                                                                        |
| **Vykonával**      | Ing. Ján Letko, LTK Solutions, s.r.o.                                               |
| **Typ testu**      | Point-in-time snapshot restore + smoke testy                                        |
| **Scenár**         | Scenár C — obnova dát zo zálohy                                                     |
| **Snapshot**       | 05/22/2026 – 12:32 AM (~201 MB, MongoDB 8.0.23)                                     |
| **Zdroj**          | `sfz-asset-mgmt-prod` (produkčný cluster)                                           |
| **Cieľ**           | `sfz-asset-mgmt-dev` (dev cluster — Flex tier neumožňuje restore do nového clustra) |
| **Čas začiatku**   | ~10:28 (Atlas restore spustený)                                                     |
| **Čas dokončenia** | ~10:29 (< 1 minúta)                                                                 |
| **Smoke testy**    | 53/53 passed (3 test files, 6.83s)                                                  |
| **Výsledok**       | ✅ PASS                                                                             |

### Smoke testy

```
Test Files  3 passed (3)
Tests       53 passed (53)
Start at    11:00:42
Duration    6.83s
```

Pokryté endpointy:

- `assets-post.test.ts` — POST /v1/assets (CRUD write + FK validácia)
- `users-list.test.ts` — GET /v1/users (admin list + pagination + filtre)
- `categories-post.test.ts` — POST /v1/categories (slug derivácia + hierarchy)

### RTO / RPO overenie

| Metrika | Cieľ (DRP) | Namerané                                            | Výsledok |
| ------- | ---------- | --------------------------------------------------- | -------- |
| **RPO** | ≤ 24 hodín | ~23 hodín (snapshot z predchádzajúceho dna)         | ✅ PASS  |
| **RTO** | ≤ 8 hodín  | < 1 minúta (snapshot restore na existujúci cluster) | ✅ PASS  |

### Poznámky

- Atlas **Flex tier** neumožňuje restore do nového clustra — len do existujúcich. Restore bol preto vykonaný do `sfz-asset-mgmt-dev` (nie do produkcie).
- Pre produkčný restore v prípade reálnej havárie: Atlas podporuje restore do existujúceho clustra alebo DOWNLOAD snapshot + manuálny `mongorestore`. Postup DRP sekcia 4, Scenár E bude upresnený pri prechode na dedikovaný cluster.
- CI testy (`cleanTestDatabase`) obnovia dev cluster do čistého stavu pred každým testovacím behom — žiadna ďalšia akcia potrebná.
- `close timed out after 30000ms` — kozmetický Vitest warning, nie chyba.

### Odporúčania

- Pri Atlas cluster rename (`sfz-asset-mgmt-*` → `inventario-*`) zároveň zvážiť upgrade na M10+ tier, ktorý umožňuje restore do nového clustra
- Alternatívne: pravidelne testovať aj DOWNLOAD + `mongorestore` cestu (nezávislá od Atlas tier)

---

## Plánované ďalšie testy

| #   | Plánovaný dátum   | Typ                                        |
| --- | ----------------- | ------------------------------------------ |
| 2   | Q3 2026 (~august) | Štvrťročný restore test                    |
| 3   | Q4 2026           | Tabletop exercise (scenáre A–D)            |
| 4   | Q1 2027           | Penetration test (pred 1. výročím go-live) |

---

**Posledná aktualizácia:** 2026-05-23

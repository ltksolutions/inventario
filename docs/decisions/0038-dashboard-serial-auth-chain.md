<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0038. Sériová auth reťaz na dashboarde zostáva

|                   |                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Accepted                                                                                                      |
| **Dátum**         | 2026-09-02                                                                                                       |
| **Autori**        | Ján Letko                                                                                                        |
| **Súvisiace ADR** | session log [`2026-08-31-pomale-nacitanie-dashboardu.md`](../sessions/2026-08-31-pomale-nacitanie-dashboardu.md) |

## Kontext

Dashboard sa načíta v ~1,84 s. Nie preto, že by boli dotazy pomalé, ale
preto, že sa **nespustia naraz**: každý dátový hook v `apps/web/src/lib/api-hooks.ts`
má `enabled: isAuthenticated`, a `isAuthenticated` je `user !== null`
z `auth-context.tsx`, ktorý ho zistí až po odpovedi `/v1/auth/me`.

Vznikne teda reťaz: `/v1/auth/me` → až potom assets, loans, kategórie,
lokality. Meraný zisk zo súbežného spustenia je **~0,6 s** (1,84 → ~1,2 s).

Prečo je tam tá podmienka: bez nej by neprihlásený návštevník poslal
päť requestov, ktoré všetky vrátia 401. To nie je len kozmetika —
`/v1/auth/me` je jediné miesto, kde sa dnes rieši obnova vypršaného
tokenu, a päť paralelných 401 by znamenalo päť paralelných pokusov
o refresh.

## Možnosti

### Možnosť A: Nechať sériovú reťaz (zvolené)

- Plus: auth cesta zostáva jednoduchá a má jedno miesto, kde sa rozhoduje
  o prihlásení aj o obnove tokenu.
- Plus: žiadny nový stav, ktorý sa môže rozjsť s realitou.
- Mínus: dashboard je o ~0,6 s pomalší, než by musel byť.

### Možnosť B: Hint cookie + centrálny 401 → refresh → retry

Pri prihlásení sa nastaví nesenzitívna `inv_session` cookie (čitateľná
z JS, teda **nie** `httpOnly`), dátové queries sa spustia podľa nej
súbežne s `/v1/auth/me`, a 401 z ktoréhokoľvek z nich prejde jedným
zdieľaným refresh-om s deduplikáciou.

- Plus: reálny zisk ~0,6 s pri každom otvorení dashboardu.
- Mínus: dva zdroje pravdy o tom, či je používateľ prihlásený. Cookie
  môže prežiť odhlásenie v inej karte alebo zneplatnenie session na
  serveri; vtedy appka vystrelí dotazy, ktoré padnú na 401.
- Mínus: refresh sa musí deduplikovať, inak päť paralelných 401 spustí
  päť refreshov. To je nová vetva presne v tej časti, kde chyba znamená
  odhlásenie používateľa alebo cyklus.
- Mínus: `inv_session` nie je `httpOnly`, teda je čitateľná pre XSS. Sama
  neobsahuje nič citlivé, ale rozširuje povrch, na ktorom sa dá klamať.

### Možnosť C: Agregovaný endpoint pre dashboard

Jeden `/v1/dashboard/summary`, ktorý vráti všetko naraz.

- Plus: menej round-tripov po `/v1/auth/me`.
- Mínus: **sériový krok neodstráni** — stále sa čaká na `/v1/auth/me`.
- Mínus: nový endpoint, ktorý duplikuje agregácie a musí sa udržiavať
  v zhode s piatimi existujúcimi.

## Rozhodnutie

**Zvolená možnosť A — reťaz zostáva sériová.**

0,6 s nie je nič, ale cena je nová vetva v auth ceste a druhý zdroj
pravdy o prihlásení. Chyba v auth ceste sa neprejaví ako pomalšie
načítanie, ale ako odhlásený používateľ alebo refresh cyklus — a to je
horšia trieda problému než pol sekundy.

Toto rozhodnutie sa má prehodnotiť, keď platí aspoň jedno:

- dashboard sa načítava nad **3 s** (teda pribudli ďalšie dotazy alebo
  sa spomalili),
- refresh tokenu sa aj tak presúva do centrálneho interceptora z iného
  dôvodu — vtedy je most z možnosti B postavený a zisk je zadarmo,
- používatelia sa na rýchlosť dashboardu sťažujú (dnes nie).

## Dôsledky

- `enabled: isAuthenticated` v `api-hooks.ts` zostáva ako je a je to
  **zámer**, nie nedopatrenie. Kto ho ide odstraňovať, nech si prečíta
  toto ADR.
- Optimalizácie dashboardu sa majú hľadať za `/v1/auth/me`, nie pred ním:
  indexy, projekcie, veľkosti odpovedí. Tam je priestor bez rizika.
- Ak sa niekedy zavedie hint cookie, musí ísť spolu s deduplikovaným
  refreshom — nie samostatne.

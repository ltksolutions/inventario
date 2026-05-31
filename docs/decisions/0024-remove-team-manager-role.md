<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0024. Odstránenie role TEAM_MANAGER z UserRole

|                   |                                                                                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | Proposed                                                                                                                                                                                                                                                                              |
| **Dátum**         | 2026-05-31                                                                                                                                                                                                                                                                            |
| **Autori**        | Ján Letko, Claude Opus 4.8 (LTK Solutions)                                                                                                                                                                                                                                            |
| **Súvisiace ADR** | [0023 Beneficiary + priamy loan](0023-loan-beneficiary-and-direct-loan.md) (beneficiary nahrádza dôvod existencie TEAM_MANAGER), [0015 Cross-tenant memberships](0015-cross-tenant-memberships.md) (roly žijú na Membership), [0012 Loans state machine](0012-loans-state-machine.md) |

## Kontext

`UserRole` enum dnes obsahuje päť rolí: `EMPLOYEE`, `TEAM_MANAGER`, `ASSET_MANAGER`,
`ADMIN`, `EXTERNAL`. Rola **`TEAM_MANAGER`** má v kóde popis „Tréner/Team Manager — môže
vybavovať zápožičky pre celý tím". Je to pozostatok pôvodného **SFZ-špecifického** modelu,
kde tréner národného tímu vybavoval výstroj za hráčov.

[ADR-0023](0023-loan-beneficiary-and-direct-loan.md) zaviedol **beneficiary model**: žiadosť
(`LoanRequest`) môže podať ktokoľvek (EMPLOYEE+) v mene inej osoby (`beneficiaryId`), a priamu
výpožičku vydáva správca (`POST /v1/loans`). Tým **zaniká dôvod existencie** samostatnej role
`TEAM_MANAGER` — „vybavovanie zápožičiek za iných" už nie je viazané na rolu, ale je to
všeobecná schopnosť dostupná všetkým, s gatekeepingom na strane správcu.

`TEAM_MANAGER` tak ostáva v systéme ako:

- **rola bez vlastného oprávnenia** — nikde nemá špecifické privilégium, ktoré by nemali aj
  ostatné roly (v loans `canRead` guardoch je len súčasťou EMPLOYEE+ množiny, v `canWrite`
  nie je vôbec),
- **mŕtvy koncept** — žiadny tok ju reálne nevyužíva; tímové žiadosti (`teamId`, scoping na
  členov tímu) sú aj tak odložené až po `Team` entitu ([ADR-0012](0012-loans-state-machine.md)).

Mŕtva rola je horšia než žiadna: zavádza pri onboardingu („koho mám označiť ako TEAM_MANAGER?"),
rozširuje RBAC povrch o vetvu, ktorá sa nikdy netestuje reálnym tokom, a vytvára falošný dojem,
že existuje tímové vybavovanie, ktoré v skutočnosti neexistuje.

### Dôležité rozlíšenie — čo NIE je predmetom tohto ADR

V `Membership.teams[]` aj (deprecated) `User.teams[]` existuje pole `role: 'MEMBER' | 'MANAGER'
| 'COACH' | 'ASSISTANT'`. To je **rola v rámci konkrétneho tímu**, nie systémová `UserRole`.
**Toto ADR sa jej netýka** — `team.role: 'MANAGER'` ostáva nezmenené. Mažeme výlučne hodnotu
`TEAM_MANAGER` zo systémového `UserRole` enumu.

### Obmedzenia

- **Schémy sú zdroj pravdy** (Zod → TS → JSON Schema → Mongo `$jsonSchema` → OpenAPI). Odstránenie
  hodnoty z enumu mení `USER_ROLE_VALUES`, čo prefiltruje cez `Membership.roles`, `User.roles`
  (deprecated) a všetky RBAC guardy. Regen JSON Schema + OpenAPI + `apps/web/api-types.ts`.
- **Existujúce dáta.** Ak by mal ktorýkoľvek `Membership` (alebo nemigrovaný `User`) v `roles[]`
  hodnotu `TEAM_MANAGER`, po odstránení z enumu by Zod validácia takého dokumentu **zlyhala**.
  Treba migráciu, ktorá hodnotu z poľa odstráni (a doplní `EMPLOYEE`, ak by tým pole ostalo prázdne
  — `roles` má `.min(1)`).
- **Pred pilotom.** Reálne dáta zatiaľ nie sú produkčne kritické; čistejšie odstrániť teraz než
  po onboardingu tenantov, keď by migrácia bola rizikovejšia.
- **SFZ repo.** `shared-types` je zdieľaný princíp medzi Inventario a SFZ Asset-Management. Zmena
  enumu sa prejaví aj v SFZ — treba overiť, či tam `TEAM_MANAGER` nemá živé použitie (SFZ je
  upstream precursor, pravdepodobne ho dedí rovnako nečinné). Riešiť pri implementácii.

## Možnosti

### Možnosť A: Úplne odstrániť z enumu aj kódu (zvolené)

Vymazať `TEAM_MANAGER` z `UserRole`, prečistiť všetky výskyty (RBAC guardy, prípadné mapy/popisy),
migrovať existujúce dáta.

- Plus: čistý model bez mŕtveho konceptu; menší RBAC povrch; žiadny zavádzajúci onboarding;
  jeden zdroj pravdy pre „vybavovanie za iných" = beneficiary ([ADR-0023](0023-loan-beneficiary-and-direct-loan.md)).
- Mínus: jednorazová migrácia dát + regen artefaktov; dotkne sa SFZ repa.

### Možnosť B: Označiť ako deprecated, nechať v enume

Pridať `@deprecated` komentár, prestať ju prideľovať, ale ponechať hodnotu.

- Plus: žiadna migrácia, žiadne riziko zlyhania validácie.
- Mínus: mŕtvy koncept ostáva v API/OpenAPI/UI; deprecated enum hodnota mätie rovnako ako živá;
  „dočasné" deprecated polia majú tendenciu zostať navždy. Pre pred-pilotnú fázu zbytočný dlh.

### Možnosť C: Premenovať/reusovať na niečo iné

Napr. preznačiť `TEAM_MANAGER` na budúcu zmysluplnú rolu.

- Plus: zachová enum slot.
- Mínus: žiadna konkrétna potreba takej role teraz; špekulatívne; reuse enum hodnoty s inou
  sémantikou je zdroj zmätku v dátach. Zamietnuté.

## Rozhodnutie

Zvolená **Možnosť A — úplné odstránenie**.

### 1. Enum

Odstrániť `TEAM_MANAGER` z `UserRole` v `packages/shared-types/src/enums/user-role.ts`. Výsledné
roly: `EMPLOYEE`, `ASSET_MANAGER`, `ADMIN`, `EXTERNAL`. `USER_ROLE_VALUES` sa prepočíta automaticky.

### 2. RBAC guardy

Odstrániť `'TEAM_MANAGER'` zo všetkých `requireRole([...])` zoznamov. Konkrétne v loans routes
(`loan-requests.routes.ts`, `loans.routes.ts`) je `TEAM_MANAGER` súčasťou `canRead` množiny
`['EMPLOYEE', 'TEAM_MANAGER', 'ASSET_MANAGER', 'ADMIN', 'EXTERNAL']` → po zmene
`['EMPLOYEE', 'ASSET_MANAGER', 'ADMIN', 'EXTERNAL']`. **Žiadna zmena oprávnení** pre nikoho —
nikto dnes `TEAM_MANAGER` nemá ako jedinú rolu závislú na prístupe, a guard ho nikde nepoužíva
samostatne. (Pri implementácii prejsť všetky výskyty, nie len loans — grep `TEAM_MANAGER` cez
oba repo.)

### 3. Migrácia dát

Migračný skript (rovnaký pattern ako existujúce v `apps/api/src/migrations/`):

- `Membership.roles`: `$pull` hodnoty `TEAM_MANAGER`; ak by tým pole ostalo prázdne, `$set`
  `['EMPLOYEE']` (rešpektuje `roles.min(1)`).
- (Deprecated) `User.roles`: rovnaký `$pull` + fallback, ak migrácia memberships ešte nedobehla.
- Idempotentné, bezpečné spustiť viackrát.

### 4. Regen artefaktov

`pnpm --filter @inventario/shared-types build` (regen JSON Schema), OpenAPI export, regen
`apps/web/api-types.ts`. Overiť, že Mongo `$jsonSchema` validátory (ak sú nasadené) prijmú nový enum.

### 5. SFZ repo

Skontrolovať `Asset-Management` repo na živé použitie `TEAM_MANAGER`. Keďže je to upstream
precursor zdieľajúci patterny, pravdepodobne ho dedí rovnako nečinné. Ak áno, rovnaká zmena

- migrácia; ak má v SFZ špecifické použitie, riešiť samostatne (mimo rozsah tohto ADR, ale
  zaznamenať).

## Dôsledky

### Pozitívne

- Čistý rolový model: 4 roly, každá s jasným, používaným zmyslom.
- Menší RBAC povrch — žiadna netestovaná vetva pre rolu bez vlastného oprávnenia.
- Onboarding bez zavádzajúcej voľby „TEAM_MANAGER".
- Jeden zdroj pravdy pre „vybavovanie za iných" = beneficiary ([ADR-0023](0023-loan-beneficiary-and-direct-loan.md)),
  nie roztrúsené medzi rolu a beneficiary mechanizmus.

### Negatívne / kompromisy

- Jednorazová migrácia `Membership.roles` / `User.roles` + regen artefaktov.
- Zmena zdieľaného `shared-types` sa dotkne aj SFZ repa — treba koordinovať.
- Ak by v budúcnosti vznikla reálna potreba tímového vybavovania (po `Team` entite), rola sa
  bude pridávať nanovo — ale vtedy s konkrétnou sémantikou a tokom, nie špekulatívne.

### Riziká, ktoré treba sledovať

- **Zlyhanie validácie na starých dátach.** Ak migrácia nedobehne pred nasadením nového enumu,
  dokument s `TEAM_MANAGER` v `roles[]` neprejde Zod/`$jsonSchema` validáciou. Mitigácia: migráciu
  spustiť **pred** alebo súčasne s deployom (cez `runPendingMigrations` v `buildServer`), test
  na prázdne `roles` po `$pull`.
- **Prehliadnutý výskyt.** Hardcoded `'TEAM_MANAGER'` string mimo enumu (frontend, testy, seed,
  docs). Mitigácia: grep cez oba repo (`TEAM_MANAGER`), nie len enum; pozor na rozlíšenie od
  `team.role: 'MANAGER'`, ktoré sa NEMÁ meniť.
- **JWT s legacy roles.** `synthesizeMembership` v `auth.ts` číta roly z JWT claims; krátkodobo
  (do expirácie 15-min tokenov) môže prísť token s `TEAM_MANAGER`. Mitigácia: po migrácii sa
  hodnota pri ďalšom čítaní membership odfiltruje; prípadne defenzívne ignorovať neznámu rolu
  pri RBAC porovnaní (neznáma rola = žiadny match, čo je bezpečné).

## Fázovanie

- **K1** — odstrániť `TEAM_MANAGER` z `UserRole` enumu; regen JSON Schema. (Haiku)
- **K2** — prečistiť RBAC guardy a všetky výskyty v `apps/api` + `apps/web` (grep-driven). (Haiku/Sonnet)
- **K3** — migračný skript (`Membership.roles` + `User.roles` `$pull` + `min(1)` fallback),
  zapojiť do `runPendingMigrations`. (Sonnet)
- **K4** — regen OpenAPI + `api-types.ts`; testy (RBAC po zmene, migrácia, prázdne roles fallback). (Sonnet)
- **K5** — overiť a prípadne replikovať do SFZ `Asset-Management` repa. (Sonnet)
- **K6** — milestone/session doc. (Haiku)

## Referencie

- [ADR-0023 Beneficiary + priamy loan](0023-loan-beneficiary-and-direct-loan.md) — beneficiary nahrádza dôvod existencie TEAM_MANAGER
- [ADR-0015 Cross-tenant memberships](0015-cross-tenant-memberships.md) — roly žijú na `Membership.roles`, autoritatívny zdroj pre RBAC
- [ADR-0012 Loans state machine](0012-loans-state-machine.md) — tímové žiadosti (`teamId`) odložené až po `Team` entitu
- [packages/shared-types/src/enums/user-role.ts](../../packages/shared-types/src/enums/user-role.ts) — `UserRole` enum (odstránenie `TEAM_MANAGER`)
- [packages/shared-types/src/schemas/membership.ts](../../packages/shared-types/src/schemas/membership.ts) — `Membership.roles` (migrácia) + `teams[].role` (NEMENÍ sa)
- [packages/shared-types/src/schemas/user.ts](../../packages/shared-types/src/schemas/user.ts) — deprecated `User.roles` (migrácia)
- [apps/api/src/plugins/auth.ts](../../apps/api/src/plugins/auth.ts) — `requireRole` RBAC + `synthesizeMembership` (legacy JWT roly)
- [apps/api/src/modules/loans/loan-requests.routes.ts](../../apps/api/src/modules/loans/loan-requests.routes.ts) — `canRead` guard obsahuje `TEAM_MANAGER`
- [apps/api/src/modules/loans/loans.routes.ts](../../apps/api/src/modules/loans/loans.routes.ts) — `canRead` guard obsahuje `TEAM_MANAGER`

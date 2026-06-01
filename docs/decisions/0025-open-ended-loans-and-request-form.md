<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0025. Výpožičky bez termínu (open-ended) + dotiahnutie formulára žiadosti

|                   |                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Accepted                                                                                                                                                                                                                                                                                                                                                                      |
| **Dátum**         | 2026-06-01                                                                                                                                                                                                                                                                                                                                                                       |
| **Autori**        | Ján Letko, Claude Opus 4.8 (LTK Solutions)                                                                                                                                                                                                                                                                                                                                       |
| **Súvisiace ADR** | [0012 Loans state machine](0012-loans-state-machine.md) (upravuje invariant „loan má vždy termín"), [0023 Beneficiary + priama výpožička](0023-loan-beneficiary-and-direct-loan.md) (dotvára frontend pre beneficiary), [0018 SelectField](0018-select-field-component.md) (komponent pre beneficiary picker), [0010 Multi-tenant white-label](0010-multi-tenant-white-label.md) |

> **Pozn. (2026-06-01):** [ADR-0026](0026-catalog-requests-and-fulfilment.md) prebera
> `plannedTo` (nullable) z tohto ADR ako zelane terminy na ziadosti. Zavazny `dueAt` (nullable)
> sa nastavuje az na vyslednom Loan-e pri vydavani cez `fulfil`, nie na ziadosti.

## Kontext

Pri prvom reálnom prechode formulárom **„Nová žiadosť o výpožičku"** (`/loans/request`,
`LoanRequestContent.tsx`) na produkcii vyšli najavo dva nesúlady medzi tým, čo backend
už podporuje, a tým, čo formulár v skutočnosti ponúka — plus jeden chýbajúci biznis prípad.

### 1. Termín vrátenia („Do") je dnes vždy povinný — ale nie vždy ho poznáme

ADR-0012 aj ADR-0023 postavili model na predpoklade, že **každá výpožička má dohodnutý termín
vrátenia**: `LoanRequest.plannedTo` aj `Loan.dueAt` sú povinné (`TimestampSchema`, nie nullable),
formulár má pole „Do" označené `*`, a `OVERDUE` sa odvodzuje porovnaním `now() > dueAt`.

To presne sedí na **krátkodobé výpožičky** (projektor na 2 týždne, dron na víkendový turnaj).
Nesedí to ale na **trvalé prideleenie pracovného nástroja**: keď zamestnanec dostane pridelený
notebook, telefón alebo prístupovú kartu, vo vopred nevieme, dokedy ich bude mať — drží ich,
kým u nás pracuje. Vynútiť pri takom pridelení dátum „Do" znamená, že obsluha vymyslí umelý
termín (napr. „o rok"), čím sa znehodnotí celý zmysel poľa: po termíne to vyzerá ako po
termíne (`OVERDUE`), hoci nejde o žiadne meškanie.

### 2. Pole „pre koho" (beneficiary) chýba vo formulári

ADR-0023 zaviedol `LoanRequest.beneficiaryId` (žiadosť za inú osobu, `borrowerId = beneficiaryId`
pri schválení) a je **plne implementovaný na backende** — schéma, service validácia, read-RBAC.
Frontend formulár `LoanRequestContent.tsx` ho však **vôbec nezobrazuje ani neposiela**, takže
funkcia „žiadať v mene niekoho iného" je dostupná len cez priame volanie API. Pritom práve
najčastejší prípad — _správca prideľuje notebook novému zamestnancovi_ — je žiadosť za inú
osobu. Toto je medzera „nemám polia ako sme sa dohodli".

### Obmedzenia

- **Schémy sú zdroj pravdy** (Zod → TS → JSON Schema → Mongo `$jsonSchema` → OpenAPI →
  `apps/web/api-types.ts`). Akákoľvek zmena tvaru ide cez Zod a regeneruje sa nadol.
- **Forward / spätná kompatibilita.** ADR-0012/0023 nechali schémy bohaté a doplnenie poľa
  nesmie rozbiť existujúce dáta (pilotné). Nulovateľnosť `plannedTo`/`dueAt` musí vedieť
  prečítať aj starý záznam, kde termín existuje.
- **`OVERDUE` invariant.** ADR-0012 definuje `OVERDUE` ako _odvodené_ pole
  (`isOverdue = status === 'ACTIVE' && now() > dueAt`), nie persistentný stav. Open-ended
  výpožička termín nemá → `isOverdue` musí byť pre ňu vždy `false`, nie chyba pri porovnaní `null`.
- **Audit + GDPR.** Snapshoty v audit logu (`plannedTo`, `dueAt`) a e-mailové notifikácie
  formátujú termín — musia ošetriť `null` (napr. „bez termínu").
- **Žiadny nový enum stavu.** Nezavádzame `LoanType` ani podobný stav navyše — „open-ended"
  sa odvodzuje výhradne z toho, či je `plannedTo`/`dueAt` `null`. Jediný zdroj pravdy, žiadny
  duplicitný stav (rovnaký princíp ako parametrický `inventoryNumberFormat` v ADR-0021).

## Možnosti

### A. Ako reprezentovať „bez termínu"

#### A1: `plannedTo` / `dueAt` nullable; `null` = bez termínu (zvolené)

Termín sa stane voliteľný. `null` jednoznačne znamená „do odvolania". UI to navodí explicitným
prepínačom (nie prázdnym poľom — viď C1), takže `null` je vždy zámer, nikdy nedopatrenie.

- Plus: minimálna zmena dátového modelu; žiadny nový enum; `OVERDUE` logika sa upraví na
  jednom mieste; spätne kompatibilné (existujúce termíny ostávajú ne-null).
- Mínus: každé čítanie `dueAt`/`plannedTo` ako istého stringu (audit snapshot, email, UI,
  budúce reporty) treba ošetriť na `null`.

#### A2: Samostatný `loanType: 'FIXED' | 'OPEN_ENDED'` enum + termín stále povinný pre FIXED

- Plus: explicitný typ v dátach.
- Mínus: duplicitný stav — `loanType` aj prítomnosť `plannedTo` hovoria to isté a môžu sa
  rozísť (FIXED bez termínu? OPEN_ENDED s termínom?); viac validácie; nepotrebné. Zamietnuté.

#### A3: Sentinel dátum „ďaleko v budúcnosti" (napr. 9999-12-31)

- Plus: žiadna zmena nulovateľnosti.
- Mínus: magická hodnota, ktorá presakuje do UI, reportov, OVERDUE porovnania; klasický
  anti-pattern. Zamietnuté.

### B. Či obmedziť „bez termínu" len na niektoré kategórie

#### B1: Globálne povolené pre MVP, kategóriové obmedzenie odložené (zvolené)

Open-ended je povolené pre akýkoľvek majetok; jemnejšie pravidlo („notebook áno, projektor nie")
sa necháva na neskôr cez prípadné `Category.allowOpenEnded`.

- Plus: jednoduché; pilot ukáže, či je obmedzenie vôbec potrebné.
- Mínus: obsluha si teoreticky zvolí „do odvolania" aj pri projektore. Akceptované pre MVP —
  gatekeeperom je správca pri schvaľovaní.

#### B2: `Category.allowOpenEnded` hneď teraz

- Plus: presnejšie.
- Mínus: predčasné modelovanie bez reálnych dát; ďalšie pole, migrácia, UI v Číselníkoch.
  Odložené (viď „Fázovanie / odložené").

### C. Ako to navodiť vo formulári

#### C1: Segment „Na dobu určitú" / „Do odvolania" (zvolené)

Dve prepínateľné možnosti. „Na dobu určitú" odkryje pole **Do** (povinné v tomto režime),
„Do odvolania" pole skryje a pošle `plannedTo = null`.

- Plus: odstraňuje nejednoznačnosť „zabudol vs. zámerne nechal prázdne"; jasné UX; dátovo
  čisté (jediný zdroj `plannedTo`); prepínač je čisto UI vrstva.
- Mínus: o jeden ovládací prvok viac.

#### C2: Len nepovinné prázdne pole „Do"

- Plus: najmenej UI.
- Mínus: prázdne pole je nejednoznačné — nevieš, či používateľ termín zabudol, alebo chce
  open-ended; horšia chybovosť. Zamietnuté.

### D. Beneficiary picker vo formulári

#### D1: Vždy viditeľný `SelectField`, default = prihlásený používateľ (zvolené)

Pole „Pre koho" je vždy zobrazené, predvyplnené na seba; kto žiada pre iného, prepíše.

- Plus: zrkadlí backend model z ADR-0023 (default = requester, žiadať smie EMPLOYEE+);
  najčastejší prípad (pridelenie inému) nie je skrytý; žiadny extra klik pre „pre seba";
  využíva existujúci `SelectField` ([ADR-0018](0018-select-field-component.md)).
- Mínus: zaberá miesto aj pri „pre seba". Mitigácia: dobrý default + decentný label.

#### D2: Skryté za prepínač „žiadať pre inú osobu"

- Plus: kompaktnejšie pre „pre seba".
- Mínus: skrýva najčastejší tok (pridelenie inému), horšia objaviteľnosť, pridáva UI stav,
  ktorý dátovo nič nereprezentuje. Zamietnuté po diskusii (pôvodne preferované, prehodnotené).

## Rozhodnutie

### 1. `plannedTo` a `dueAt` sa stanú nullable (A1)

- **`LoanRequestSchema.plannedTo`** → `TimestampSchema.nullable().default(null)`.
- **`LoanSchema.dueAt`** → `TimestampSchema.nullable().default(null)`.
- **`CreateDirectLoanSchema.dueAt`** → `TimestampSchema.nullable().default(null)` (priama
  výpožička môže byť tiež trvalé pridelenie — notebook vydaný cez pult bez žiadosti).
- `null` ⇒ výpožička **bez termínu** („do odvolania"). Akákoľvek ne-null hodnota ⇒ pevný termín.
- **Žiadny nový enum.** Príznak „open-ended" sa nikam neukladá — odvodzuje sa z `null`.

### 2. `OVERDUE` rešpektuje chýbajúci termín

`loanToApiShape` v `loans.service.ts` (a kdekoľvek inde, kde sa `OVERDUE` počíta) sa upraví na:

```ts
const isOverdue =
  doc.status === 'ACTIVE' &&
  doc.dueAt != null &&
  new Date().toISOString() > doc.dueAt;
```

Open-ended výpožička (`dueAt === null`) tak **nikdy nie je `OVERDUE`** — čo je presne správanie,
ktoré chceme: trvalé pridelenie nemôže „meškať". Stavový automat `Loan` z ADR-0012 sa inak nemení;
mení sa len strážna podmienka odvodeného `isOverdue`.

### 3. Audit snapshoty a e-maily ošetria `null`

- Audit snapshoty (`LOAN_REQUEST_CREATED`, `LOAN_PICKED_UP`, `LOAN_CREATED_DIRECT`) zapisujú
  `plannedTo` / `dueAt` ako `null`, keď chýba — bez zmeny tvaru, len povolená hodnota.
- E-mailové notifikácie (`notifyManagersNewRequest`, `notifyRequesterApproved`) zobrazia pri
  chýbajúcom termíne čitateľný text typu „bez termínu / do odvolania" namiesto prázdneho /
  `null` reťazca. (Slovné znenie je vec šablóny e-mailu.)

### 4. Formulár žiadosti — segment doba určitá/neurčitá (C1)

`LoanRequestContent.tsx`:

- Pribudne prepínač (dve možnosti, napr. radio/segmented): **„Na dobu určitú"** | **„Do odvolania"**.
- **Na dobu určitú** (default): pole **Do** je viditeľné a **povinné** v tomto režime;
  validácia `plannedFrom <= plannedTo` platí.
- **Do odvolania**: pole **Do** sa skryje; do API ide `plannedTo: null`. Pole **Od** ostáva
  povinné (vieme, odkedy pridelenie platí).
- Hvezdička `*` pri „Do" sa zobrazuje len v režime „na dobu určitú".
- `canSubmit` / `handleSubmit` validácia sa upraví: pri „do odvolania" sa kontrola
  `plannedFrom <= plannedTo` preskočí.

### 5. Formulár žiadosti — beneficiary picker (D1)

`LoanRequestContent.tsx`:

- Pribudne pole **„Pre koho"** ako `SelectField` ([ADR-0018](0018-select-field-component.md))
  so zoznamom aktívnych používateľov tenanta, **predvyplnené na prihláseného používateľa**.
- Odoslanie pridá `beneficiaryId` do tela `POST /v1/loan-requests` (pri „pre seba" sa môže
  poslať vlastné id alebo vynechať — server doplní default; obe sú validné per ADR-0023).
- Label naznačí default, napr. „Pre koho — predvolene vy", aby pole nerušilo bežný prípad.
- Zoznam používateľov: použiť existujúci users hook/endpoint (EMPLOYEE+ smie žiadať za hocikoho
  v tenante — read zoznamu členov pre tento účel je v poriadku; ak by current users endpoint
  vyžadoval vyššiu rolu, pri implementácii sa to overí a prípadne sa pridá ľahký „members for
  picker" zdroj).

### Dotknuté miesta (sumár pre implementáciu)

| Vrstva     | Súbor                                            | Zmena                                                                               |
| ---------- | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Schéma     | `packages/shared-types/src/schemas/loan.ts`      | `plannedTo`, `dueAt`, `CreateDirectLoanSchema.dueAt` → `.nullable().default(null)`  |
| Service    | `apps/api/src/modules/loans/loans.service.ts`    | `loanToApiShape` OVERDUE guard na `dueAt != null`; audit snapshot + email null-safe |
| Generované | `openapi.json`, `apps/web/api-types.ts`          | regen po zmene schémy                                                               |
| Frontend   | `apps/web/src/components/LoanRequestContent.tsx` | segment doba určitá/neurčitá + `plannedTo` voliteľné + beneficiary `SelectField`    |
| Migrácia   | žiadna potrebná                                  | existujúce ne-null termíny ostávajú platné; nullable je rozšírenie, nie zúženie     |

> **Migrácia nie je potrebná.** Pole sa rozširuje z „povinné" na „voliteľné" — všetky existujúce
> dokumenty s vyplneným termínom zostávajú validné. (Na rozdiel od ADR-0023, kde sa `beneficiaryId`
> _dopĺňalo_, tu sa nič nedopĺňa.)

## Dôsledky

### Pozitívne

- Model konečne pokrýva oba reálne prípady: krátkodobá výpožička s termínom aj trvalé pridelenie
  pracovného nástroja bez termínu.
- `OVERDUE` prestane byť zavádzajúce pri trvalých prideleniach (notebook nie je „po termíne").
- Formulár sprístupní beneficiary funkciu, ktorá už na backende existuje — najčastejší tok
  (správca prideľuje inému) prestane byť skrytý.
- Žiadny nový enum ani migrácia → malý, čistý a spätne kompatibilný zásah.

### Negatívne / kompromisy

- `dueAt`/`plannedTo` ako `null` musí ošetriť každý čítateľ termínu (audit, email, UI, budúce
  reporty „do kedy"). Vedome akceptované; vrstvy sú vymenované vyššie.
- Bez kategóriového obmedzenia si obsluha môže zvoliť „do odvolania" aj tam, kde to nedáva
  zmysel (projektor). Gatekeeperom je správca pri schvaľovaní; presnejšie pravidlo odložené.
- Beneficiary picker zaberá miesto aj pri „pre seba" — mitigované defaultom a labelom.

### Riziká, ktoré treba sledovať

- **Open-ended bez notifikácie navždy.** Trvalé pridelenie nikdy nevygeneruje „po termíne"
  pripomienku. To je zámer, ale znamená, že na evidenciu „kto čo dlhodobo drží" budeme potrebovať
  iný pohľad (zoznam aktívnych open-ended výpožičiek) — kandidát na dashboard/report v ďalšom slice.
- **Picker zoznam používateľov.** Ak je zdroj zoznamu členov za vyššou rolou než EMPLOYEE,
  bežný zamestnanec by nevedel vybrať beneficiára. Pri implementácii overiť a prípadne pridať
  ľahký endpoint/scope pre members-picker (bez citlivých polí — len id + displayName).
- **Predĺženie pri open-ended.** Budúci „extend loan" (#5b) nemá pri `dueAt === null` čo
  predlžovať — logika predĺženia musí tento prípad ošetriť (no-op alebo skryté tlačidlo).

## Fázovanie / odložené

Implementácia (čítať spolu s [ADR-0012](0012-loans-state-machine.md) a
[ADR-0023](0023-loan-beneficiary-and-direct-loan.md)). Odporúčaný model: **Sonnet 4.6**
(schéma + service guard + frontend + testy); toto ADR navrhnuté na Opuse.

- **K1** — schéma: `plannedTo`, `dueAt`, `CreateDirectLoanSchema.dueAt` → nullable; regen
  JSON Schema + OpenAPI + `api-types.ts`. (Sonnet)
- **K2** — service: OVERDUE guard `dueAt != null`; audit snapshot + email null-safe. (Sonnet)
- **K3** — frontend: segment doba určitá/neurčitá + `plannedTo` voliteľné. (Sonnet)
- **K4** — frontend: beneficiary `SelectField` (default self) + `beneficiaryId` v submit. (Sonnet)
- **K5** — testy: open-ended request happy-path, open-ended loan nikdy `isOverdue`, fixed-term
  stále `OVERDUE` po termíne, direct loan bez termínu, beneficiary submit cez formulár (ak je
  pokrytý), backend OVERDUE guard unit/integration. Existujúce testy musia ostať zelené. (Sonnet)
- **K6** — session/devlog + prípadný milestone update. (Haiku)

**Odložené (Fáza 2, po pilote):**

- `Category.allowOpenEnded` — kategóriové obmedzenie, ktoré kategórie smú „do odvolania".
- Dashboard/report aktívnych open-ended výpožičiek (kto dlhodobo drží čo).
- Vetvenie „extend loan" pre open-ended (#5b).

## Referencie

- [ADR-0012 Loans state machine + Slice #5 MVP](0012-loans-state-machine.md) — pôvodný invariant „loan má vždy termín", OVERDUE ako odvodené pole
- [ADR-0023 Beneficiary + priama výpožička](0023-loan-beneficiary-and-direct-loan.md) — `beneficiaryId` model, ktorý tento frontend dotvára
- [ADR-0018 SelectField komponent](0018-select-field-component.md) — komponent pre beneficiary picker
- [ADR-0010 Multi-tenant white-label](0010-multi-tenant-white-label.md) — beneficiary musí byť v tom istom tenante
- [packages/shared-types/src/schemas/loan.ts](../../packages/shared-types/src/schemas/loan.ts) — `plannedTo`, `dueAt`, `CreateDirectLoanSchema`
- [apps/api/src/modules/loans/loans.service.ts](../../apps/api/src/modules/loans/loans.service.ts) — `loanToApiShape` OVERDUE výpočet, audit/email
- [apps/web/src/components/LoanRequestContent.tsx](../../apps/web/src/components/LoanRequestContent.tsx) — formulár žiadosti

<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-06-01 — ADR-0025: open-ended výpožičky + dotiahnutie formulára žiadosti

| Atribút        | Hodnota                                                    |
| -------------- | ---------------------------------------------------------- |
| **Dátum**      | 2026-06-01                                                 |
| **Modely**     | Opus 4.8 (ADR + návrh), Sonnet 4.6 (implementácia K1–K6)   |
| **Východisko** | Production smoke test formulára „Nová žiadosť o výpožičku" |
| **Výsledok**   | ✅ Implementované, všetky testy zelené                     |

---

## Kontext — čo to spustilo

Pri prvom reálnom prechode formulárom `/loans/request` na produkcii vyšli najavo dva
nesúlady medzi backendom a UI, plus jeden chýbajúci biznis prípad:

1. **Pole „Do" (termín vrátenia) bolo vždy povinné.** Sedí na krátkodobé výpožičky
   (projektor na 2 týždne), ale nie na **trvalé pridelenie pracovného nástroja** —
   keď zamestnanec dostane notebook/telefón, vopred nevieme, dokedy ich bude mať.
2. **Pole „pre koho" (beneficiary) chýbalo vo formulári úplne** — hoci backend ho
   plne podporuje od ADR-0023. Funkcia „žiadať v mene niekoho iného" bola dostupná
   len cez priame API volanie, pričom najčastejší tok (správca prideľuje notebook
   novému zamestnancovi) je práve žiadosť za inú osobu.

## Rozhodnutie — ADR-0025 (Proposed)

Napísané na Opuse ako dodatok k ADR-0012/0023. Kľúčové body:

- **`plannedTo` / `dueAt` nullable** (`null` = „do odvolania"). Žiadny nový enum, žiadna
  migrácia — pole sa len rozširuje z povinného na voliteľné, existujúce dáta ostávajú platné.
- **OVERDUE rešpektuje chýbajúci termín** — `isOverdue = status === 'ACTIVE' && dueAt != null
&& now() > dueAt`. Open-ended výpožička nikdy nie je „po termíne".
- **Formulár: segment „Na dobu určitú / Do odvolania"** — odstraňuje nejednoznačnosť
  „zabudol vs. zámerne nechal prázdne". Pole Do je viditeľné a povinné len v režime „na dobu určitú".
- **Formulár: beneficiary `SelectField`, vždy viditeľný, default = ja** (preklopené z pôvodne
  zvažovaného prepínača — prepínač skrýval najčastejší tok a pridával UI stav bez dátového prínosu).
- **Kategóriové obmedzenie** (`Category.allowOpenEnded`) a report aktívnych open-ended výpožičiek
  vedome **odložené** do Fázy 2 (po pilote).

ADR: `docs/decisions/0025-open-ended-loans-and-request-form.md`.

## Vykonané zmeny (K1–K6)

### K1 — schéma (`packages/shared-types/src/schemas/loan.ts`)

- `LoanRequestSchema.plannedTo` → `.nullable().default(null)`
- `LoanSchema.dueAt` → `.nullable().default(null)`
- `CreateDirectLoanSchema.dueAt` → `.nullable().default(null)`

### K2 — service + routes + email

- `loans.service.ts` — `loanToApiShape` OVERDUE guard na `dueAt != null`; `notifyManagersNewRequest`
  - `notifyRequesterApproved` signatúry prijímajú `string | null`
- `loan-requests.routes.ts` — `CreateLoanRequestBodySchema.plannedTo` → `.nullable().optional()`
  - `.refine()` kontrola `plannedFrom <= plannedTo` len keď `plannedTo != null`
- `plugins/email.ts` — `sendLoanApprovedEmail.dueAt` + `sendLoanRequestPendingEmail.plannedTo`
  → `string | null`; `formatDateSk(null)` → vráti „bez termínu"

### K3 — nový endpoint `GET /v1/members` (`memberships.routes.ts`)

ADR-0025 poznámka „pri implementácii overiť a prípadne pridať members-picker zdroj" sa
naplnila — `GET /v1/users` je ADMIN-only, takže bežný EMPLOYEE by nevedel vybrať beneficiára.
Pridaný **`GET /v1/members`**, EMPLOYEE+ RBAC, vracia len picker-safe polia (`_id`, `displayName`,
`firstName`, `lastName`, `roles`, `membershipId`) aktívnych členov tenanta. Filtruje cez
`memberships` (status ACTIVE) + batch lookup do `users` s projekciou (žiadny email/passwordHash).

### K4 — frontend (`LoanRequestContent.tsx` + `api-hooks.ts`)

- `LoanRequestContent.tsx` prepísaný: segment doba určitá/neurčitá (`durationType` state),
  beneficiary `SelectField` (default self, `useMembers` hook), `plannedTo` voliteľné v submit
  - validácia preskočí `plannedFrom <= plannedTo` v režime „do odvolania"
- `api-hooks.ts` — nový `useMembers` hook + `MemberPickerItem` typ; `LoanRequestSummary.plannedTo`,
  `LoanSummary.dueAt` → `string | null`; `CreateLoanRequestInput.plannedTo` voliteľné + `beneficiaryId`
- `LoansContent.tsx` + `MyLoansContent.tsx` — `formatDate(string | null)` → „do odvolania" pre null;
  termín v tabuľke zobrazí „od X · do odvolania" pri open-ended

### K5 — testy (`tests/integration/loans-adr-0025.test.ts`)

13 nových integračných testov:

- POST /v1/loan-requests bez plannedTo / s plannedTo null → 201
- POST /v1/loan-requests plannedFrom > plannedTo → 400
- POST /v1/loans (direct) bez dueAt → 201, isOverdue false
- isOverdue guard: open-ended false vždy / fixed po termíne true / pred termínom false / RETURNED false
- GET /v1/members: EMPLOYEE+ vidí, picker-safe polia (žiadny email), self + iní členovia, 401 neautentif.

Fixture rozšírenia (`test-fixtures.ts`): `insertTestLoan.dueAt?: string | null`,
nový `insertTestMembership` helper.

### K6 — regenerácia

- `openapi.json` refreshnutý (`openapi:export:offline`)
- `apps/web/api-types.ts` regenerovaný (pretypecheck hook)

## Stav na koniec session

| Oblasť            | Status                                              |
| ----------------- | --------------------------------------------------- |
| **Backend testy** | ✅ všetky zelené (680, +13)                         |
| **Typecheck**     | ✅ celý monorepo zelený                             |
| **CI**            | ✅ (po push)                                        |
| **Production**    | Nasadiť po commite                                  |
| **ADR-0025**      | Proposed — pred ďalším rozvojom povýšiť na Accepted |

## Otvorené / nadväzujúce

- **Po deployi:** smoke test formulára — segment doba určitá/neurčitá, beneficiary picker,
  open-ended výpožička sa zobrazí ako „do odvolania" bez „Po termíne" badge
- **ADR-0025 → Accepted** po overení na produkcii
- **Fáza 2 (po pilote):** `Category.allowOpenEnded`, dashboard/report aktívnych open-ended
  výpožičiek, vetvenie „extend loan" pre open-ended

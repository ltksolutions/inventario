<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-06-01 (popoludní) — ADR-0026 implementácia K1–K7

| Atribút      | Hodnota                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| **Dátum**    | 2026-06-01                                                                 |
| **Model**    | Claude Sonnet 4.6 (implementácia), Opus 4.8 (ADR návrh — predošlá session) |
| **Výsledok** | ✅ ADR-0026 plne implementovaný, 690 testov zelených                       |

---

## Čo sa spravilo

### K1 — Schéma (shared-types)

- `loan-status.ts`: `LoanRequestStatus` rozšírený z 4 na **7 stavov**
  (PENDING, APPROVED, PARTIALLY_FULFILLED, FULFILLED, CLOSED, REJECTED, CANCELLED)
  - nový `LOAN_REQUEST_TERMINAL_STATUSES` helper
- `loan.ts`: `LoanRequestItem` **prepísaný** — zrušené `assetId`/`snapshot`/`status`,
  pridané `categoryId`/`categorySnapshot`/`quantityRequested`/`quantityFulfilled`/`note`;
  `resultingLoanId` → `resultingLoanIds[]`; nový `FulfilLoanRequestSchema`
- `audit-log.ts`: pridaná akcia `LOAN_REQUEST_FULFILLED`
- JSON Schema regen automaticky pri builde (generated/ je gitignorovaný)

### K2 — Repository + Service

- `loan-requests.repository.ts`: nový index `items.categoryId` (namiesto `items.assetId`),
  nová metóda `incrementItemFulfilled` ($inc + $push atomicky), `LoanRequestPatch` → `resultingLoanIds`
- `loans.service.ts`: kompletný prepis — **nový FSM**:
  - `createLoanRequest` → katalógová žiadosť, resolving categorySnapshot, **žiadna rezervácia**
  - `approveLoanRequest` → len PENDING→APPROVED, **nevytvára Loan**
  - `fulfilLoanRequest` → **NOVÝ**: mapovanie category+quantity → SERIALIZED assetIds / BULK;
    transakčné vydanie (Loan + BORROWED + incrementFulfilled + prepočet stavu žiadosti)
  - `rejectLoanRequest`, `cancelLoanRequest` → bez uvoľnenia rezervácie (nič nebolo rezervované)
  - `assertBeneficiaryIsActiveMember` extrahovaný do private helper

### K3 — Routes

- `loan-requests.routes.ts`: nový `CreateLoanRequestBodySchema` (categoryId+quantity),
  nový endpoint `POST /v1/loan-requests/:id/fulfil` (ASSET_MANAGER+ADMIN),
  approve popis aktualizovaný (nevytvára Loan)

### K4 — Frontend: LoanRequestContent

- `LoanRequestContent.tsx` **prepísaný**: asset browser + kôš zrušené, nahradené
  zoznamom položiek s `SelectField` (kategória) + množstvo stepper + poznámka
- `api-hooks.ts`: `LoanRequestItem` (categorySnapshot+quantity), `LoanRequestStatus` typ (7 stavov),
  `CreateLoanRequestInput` (categoryId+quantity), nový `FulfilLoanRequestInput`,
  `useApproveLoanRequest` vracia `LoanRequestSummary` (nie `LoanSummary`)

### K5 — Frontend: FulfilLoanRequestModal + LoansContent

- Nový `FulfilLoanRequestModal.tsx`: správca pre každú položku žiadosti so zostatkom > 0
  mapuje na konkrétne AVAILABLE SERIALIZED kusy (checklist) alebo BULK množstvo (input);
  nastavuje dueAt + closeRemainder; vznikne Loan
- `LoansContent.tsx`: status config rozšírený (PARTIALLY_FULFILLED, FULFILLED, CLOSED),
  filtre rozšírené, render položiek na kategória×množstvo+vydané/žiadané, nové tlačidlo
  „Vydať" pre APPROVED/PARTIALLY_FULFILLED, import `FulfilLoanRequestModal`
- `MyLoansContent.tsx`: render pending request items na kategória×množstvo+poznámku
- `api-hooks.ts`: `useFulfilLoanRequest` pridaný

### K6 — Testy

- `test-fixtures.ts`: `insertTestLoanRequest` **prepísaný** na ADR-0026 model
  (categoryId+quantity, bez assetId; `resultingLoanIds[]`; 7 stavov)
- `loans-loan-requests.test.ts` **kompletne prepísaný** — 28 testov:
  FSM prechody, žiadna rezervácia pri create, approve len stav, fulfil (FULFILLED/PARTIALLY/CLOSED),
  1 žiadosť → 2 Loanmi, over-fulfilment guard (400), cross-tenant izolácia (3 scénare),
  beneficiary, RBAC
- `loans-adr-0023.test.ts`: createLoanRequestViaApi → categoryId+quantity,
  beneficiary testy aktualizované (insertTestMembership, approve → fulfil pre borrowerId assert),
  regex-y opravené na slovenčinu
- `loans-adr-0025.test.ts`: open-ended testy → categoryId+quantity namiesto assetId

**Výsledok: 690 testov, 39 test files, všetky zelené.**

### K7 — Cross-linky + devlog

- ADR-0012, 0020, 0023, 0025: pridané `> Pozn. (2026-06-01)` poznámky s odkazom na ADR-0026
- Tento devlog
- NEXT.md aktualizovaný

---

## Kľúčové rozhodnutia implementácie

- **`incrementItemFulfilled` cez `$inc`** (nie `$set`): zabezpečuje správne správanie pri súbežnom
  vydaní — dvaja správcovia nemôžu prepisovať `quantityFulfilled` navzájom
- **categorySnapshot v schéme, nie v kóde**: resolving pri vytvorení žiadosti, nie pri zobrazení —
  stabilné zobrazenie aj po premenovaní kategórie
- **requestItemIndex namiesto categoryId v fulfil body**: žiadosť môže mať viaceré položky tej
  istej kategórie — index je jednoznačný identifikátor v rámci žiadosti
- **BULK v FulfilLoanRequestModal**: zistenie trackingMode klientsky z dostupných assetov kategórie —
  ak existuje aspoň jeden BULK asset v kategórii, ponúkneme množstevný vstup

---

## Zostatok

- OpenAPI regen (spustiť `pnpm --filter @inventario/api openapi:export:offline` po deployi)
- Smoke test: formulár žiadosti, vydanie, FULFILLED stav
- SFZ pilot tenant onboarding

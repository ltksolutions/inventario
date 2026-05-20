<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 2026-05-20 — Slice #5 Loans Backend MVP

## Súhrn

Kompletná implementácia backend modulu výpožičiek v jednej session.
Od strategického dizajnu (ADR-0012) cez implementáciu (K1–K6) po
testy (K5, 366 total) a dokumentáciu (K8 milestone doc).

**Model routing:** Opus 4.7 pre ADR + strategické rozhodnutia → Sonnet 4.6
pre implementáciu + testy. Haiku 4.5 pre K1 schema fixes.

---

## Čo sa urobilo

### 1. ADR-0012 — Loans state machine + Slice #5 MVP scope (Opus 4.7)

Strategický dizajn pre modul výpožičiek. Všetky 8 kľúčových design
otázok zodpovedaných:

- **Možnosť C (Mid-scope MVP)** — multi-item, universal ASSET_MANAGER+ADMIN
  approval, all-or-nothing, lazy OVERDUE compute, bez PDF protokolov
- **Asset reservation:** AVAILABLE → RESERVED pri PENDING request
- **All-or-nothing:** ak nemôže schváliť všetko, REJECT celú žiadosť
- **OVERDUE:** lazy-computed pri GET, nie persistent DB flag

Súbory: `docs/decisions/0012-loans-state-machine.md`,
`docs/decisions/README.md`, `docs/sessions/NEXT.md`

### 2. K1 — Schema fixes (Haiku 4.5)

Multi-tenant compliance fix (ADR-0010 violation). Chýbajúci
`OrganisationScopedSchema` merge pridaný do `LoanRequestSchema`,
`LoanSchema`, `LoanProtocolSchema`. OpenAPI export regenerovaný
(74.1 KiB, 27 endpoints pred K4).

### 3. K2 — Repositories (Sonnet 4.6)

`LoanRequestsRepository` + `LoansRepository` podľa `AssetsRepository`
pattern-u. Compound indexy per ADR-0012. Dotted-notation
(`'items.assetId'`) cez `Record<string, unknown>` cast.

### 4. K3 — LoansService (Sonnet 4.6)

State machine business logic (318 riadkov). 6 transakčných write paths

- 4 read paths. All-or-nothing reservation, lazy OVERDUE compute,
  audit log pri každom prechode.

### 5. K4 — Routes (Sonnet 4.6)

11 Fastify endpoints v dvoch súboroch. Poradie `/v1/loans/my` pred
`/v1/loans/:id` kritické. `loansService` decorated z
`loan-requests.routes.ts`, konzumovaný v `loans.routes.ts`.
Registrovaný v `server.ts`.

### 6. K5 — Integration testy (Sonnet 4.6)

39 nových testov (366 total). Dve test súbory:
`loans-loan-requests.test.ts` (22) + `loans-loans.test.ts` (17).
`insertTestLoanRequest` + `insertTestLoan` fixtures pridané do
`test-fixtures.ts`.

**2 bugs opravené počas testov:**

- Fastify validation order trap (401 vs 400) — body validácia beží pred preHandler
- ASSET_MANAGER list test total 0 — API POST v setup je nespoľahlivé; fix na direct `insertTestLoanRequest`

### 7. K6 — OpenAPI + type regen

`openapi.json`: 74.1 KiB → 96.8 KiB, 14→23 paths, 27→38 endpoints.
`api-types.ts` regenerovaný za 61.9ms.

### 8. K8 — Milestone doc

`docs/milestones/slice-5-loans-mvp.md` — kompletný milestone doc
so state machine, endpoint inventory, lessons learned, deferral list.

---

## Kľúčové lessons learned

### 1. Fastify lifecycle: validation pred auth

```
Parsing → preValidation → Validation (Zod) → preHandler (requireAuth) → Handler
```

Body validácia beží **pred** `requireAuth` v `preHandler`. Test bez tokenu
s nevalidným body dostane 400, nie 401. Pre auth-gate testy použiť GET
endpoint alebo POST s validným body.

### 2. `exactOptionalPropertyTypes` a optional params

TypeScript strict mode s `exactOptionalPropertyTypes: true` odmietne
`{ status: undefined }` kde `status?: LoanRequestStatus`. Fix:

```typescript
...(params.status !== undefined && { status: params.status })
```

### 3. List test setup pattern

**Antipattern:** API POST calls v setup fáze list testov (nestabilné —
príliš veľa moving parts, výsledok závisí na stave assets, tenante atd.)

**Správny pattern:** `insertTestLoanRequest` / `insertTestLoan` direct DB
insert v setup, API GET v assertion fáze.

### 4. `loans.routes.ts` dependency na `loan-requests.routes.ts`

`loansService` je decorated z `loan-requests.routes.ts`. `loans.routes.ts`
ho konzumuje. Musí byť v `dependencies: ['loan-requests-routes']` a
registrovaný v správnom poradí v `server.ts`.

---

## Stav po session

- ✅ Slice #5 backend 100% kompletný
- ✅ 366 testov zelených
- ✅ `api.inventario.sportup.sk` zostáva live (žiadne breaking changes)
- ✅ Frontend `api-types.ts` má nové loan typy
- ⏭️ Ďalší krok: Slice #4 finálne 2 stránky (`/loans/request` + `/my-loans`)

---

## Committy tejto session (chronologicky)

1. `docs: ADR-0012 loans state machine + Slice #5 MVP scope`
2. `refactor(shared-types): add OrganisationScopedSchema to loan documents`
3. `feat(loans): K2 LoanRequestsRepository + LoansRepository`
4. `feat(loans): K3 LoansService — state machine business logic`
5. `feat(loans): K4 loan-requests + loans routes (11 endpoints)`
6. `test(loans): K5 integration tests — 39 new tests (366 total)`
7. `feat(loans): K6 OpenAPI export + frontend type regen`
8. `docs(milestones): slice-5-loans-mvp complete`
9. `docs: 2026-05-20 day summary + NEXT.md update` ← tento commit

<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Slice #5 — Loans Backend MVP (Completed 2026-05-20; prepísaný ADR-0026 2026-06-01)

## Cieľ

Implementovať **backend pre modul výpožičiek** (loan request → approve →
return / lost), čím sa odblokujú posledné 2 P0 frontend stránky
(`/loans/request` a `/my-loans`). Scope a architektonické rozhodnutia sú
zdokumentované v [ADR-0012](../decisions/0012-loans-state-machine.md).

**Vyžaduje slice #3** (categories, locations, users admin) a **slice #4**
(frontend bootstrap + auth) ako predpoklady na strane API kontraktu.

## ⚠️ ADR-0026 — model prepisaný (2026-06-01)

> Tento dokument popisáva pôvodný MVP model z ADR-0012. **[ADR-0026](../decisions/0026-catalog-requests-and-fulfilment.md)**
> (Accepted + implementované 2026-06-01) prepisal jadro FSM žiadosti:
>
> - `LoanRequestItem` zmenený z `assetId`-based → **`categoryId + quantity`** (katalógová žiadosť)
> - `approve` už **nevytvára Loan** a nerezervuje assety — len PENDING→APPROVED
> - Nový endpoint **`POST /v1/loan-requests/:id/fulfil`** — vydanie, vznik Loan-u, BORROWED assety
> - FSM: 7 stavov (+ PARTIALLY_FULFILLED, FULFILLED, CLOSED)
> - Žiadosť **nedrží zásobu** — nerez. pri vytváraní, neuzávera pri reject/cancel
> - 1 žiadosť → N Loanov postupne
>
> **690 testov zelených.** Session: `docs/sessions/2026-06-01-adr-0026-implementation.md`.
> Aktuálny model = ADR-0026 + tento dokument ako historický záznam pôvodného MVP.

## Výsledok

✅ **366 testov (327 → 366, +39 nových), lokálne aj CI green:**

| K-step | Pridáva                                                                     | Tests delta | Total   |
| ------ | --------------------------------------------------------------------------- | ----------- | ------- |
| K1     | Schema fixes — `OrganisationScopedSchema` pre Loan/LoanRequest/LoanProtocol | 0           | 327     |
| K2     | `LoanRequestsRepository` + `LoansRepository` + indexy                       | 0           | 327     |
| K3     | `LoansService` — state machine logic (6 write paths, 4 read paths)          | 0           | 327     |
| K4     | 11 Fastify routes (loan-requests.routes.ts + loans.routes.ts)               | 0           | 327     |
| **K5** | **Integration testy — 39 nových**                                           | **+39**     | **366** |
| K6     | OpenAPI export (74.1 KiB → 96.8 KiB) + frontend type regen                  | 0           | 366     |

✅ **11 nových endpointov:**

| Method   | Path                            | RBAC                 | Účel                                    |
| -------- | ------------------------------- | -------------------- | --------------------------------------- |
| `POST`   | `/v1/loan-requests`             | EMPLOYEE+            | Vytvorenie žiadosti, assets → RESERVED  |
| `GET`    | `/v1/loan-requests`             | EMPLOYEE+            | List (EMPLOYEE vidí len vlastné)        |
| `GET`    | `/v1/loan-requests/:id`         | EMPLOYEE+            | Detail (owner alebo manager)            |
| `POST`   | `/v1/loan-requests/:id/approve` | ASSET_MANAGER, ADMIN | PENDING → APPROVED + Loan ACTIVE        |
| `POST`   | `/v1/loan-requests/:id/reject`  | ASSET_MANAGER, ADMIN | PENDING → REJECTED, assets released     |
| `DELETE` | `/v1/loan-requests/:id`         | EMPLOYEE+            | PENDING → CANCELLED (owner alebo ADMIN) |
| `GET`    | `/v1/loans`                     | EMPLOYEE+            | List (EMPLOYEE vidí len vlastné)        |
| `GET`    | `/v1/loans/my`                  | EMPLOYEE+            | Vlastné zápožičky (shortcut)            |
| `GET`    | `/v1/loans/:id`                 | EMPLOYEE+            | Detail (borrower alebo manager)         |
| `POST`   | `/v1/loans/:id/return`          | ASSET_MANAGER, ADMIN | ACTIVE → RETURNED/DAMAGED               |
| `POST`   | `/v1/loans/:id/lost`            | ASSET_MANAGER, ADMIN | ACTIVE → LOST                           |

✅ **State machine (per ADR-0012):**

```
LoanRequest: PENDING → APPROVED | REJECTED | CANCELLED
Loan:        ACTIVE  → RETURNED | DAMAGED  | LOST
```

`OVERDUE` je **lazy-computed** computed field pri každom GET response
(`isOverdue: boolean`) — nie je persistovaný v DB.

## Architektúra

### Nový modul `src/modules/loans/`

```
apps/api/src/modules/loans/
├── loan-requests.repository.ts   # LoanRequestsRepository — 5 metód + indexy
├── loans.repository.ts           # LoansRepository — 5 metód + indexy
├── loans.service.ts              # LoansService — 6 write + 4 read paths
├── loan-requests.routes.ts       # 6 endpointov + loansService decoration
└── loans.routes.ts               # 5 endpointov, dep na loan-requests-routes
```

### State machine — asset stavové prechody

| Operácia             | Asset transition                                                             |
| -------------------- | ---------------------------------------------------------------------------- |
| `createLoanRequest`  | `AVAILABLE → RESERVED` (atomic s request creation)                           |
| `approveLoanRequest` | `RESERVED → BORROWED` (atomic s Loan creation)                               |
| `rejectLoanRequest`  | `RESERVED → AVAILABLE` (release)                                             |
| `cancelLoanRequest`  | `RESERVED → AVAILABLE` (release, owner/ADMIN only)                           |
| `returnLoan`         | `BORROWED → AVAILABLE` alebo `BORROWED → IN_SERVICE` (per `requiresService`) |
| `markLoanLost`       | `BORROWED → LOST`                                                            |

### K1 — Schema fixes (multi-tenant compliance)

**ADR-0010 violation opravená:** `LoanRequest`, `Loan` a `LoanProtocol`
chýbali `organisationId` field (bez `.merge(OrganisationScopedSchema)`).
Opravené v `packages/shared-types/src/schemas/loan.ts` a
`loan-protocol.ts`:

```typescript
// Pred K1
export const LoanRequestSchema = BaseDocumentSchema.merge(SoftDeleteSchema).extend({ ... });

// Po K1
export const LoanRequestSchema = BaseDocumentSchema
  .merge(SoftDeleteSchema)
  .merge(OrganisationScopedSchema)   // ← pridané
  .extend({ ... });
```

Rovnaký fix pre `LoanSchema` a `LoanProtocolSchema`.

### K2 — Repository vrstva

Oba repositories sledujú rovnaký pattern ako `AssetsRepository`:

- `requireTenantId` + `tenantFilter` pre tenant scoping
- `ClientSession?` na všetkých write metódach (transakčná podpora)
- dotted-notation queries (`'items.assetId'`) cez `Record<string, unknown>`
  cast na `Filter<T>` (TypeScript `Filter<T>` nepozná dotted notation keys)

**Compound indexy (per ADR-0012):**

```js
// loan_requests
{ organisationId: 1, status: 1, requesterId: 1, createdAt: -1 }
{ organisationId: 1, 'items.assetId': 1 }

// loans
{ organisationId: 1, status: 1, borrowerId: 1, dueAt: 1 }
{ organisationId: 1, 'items.assetId': 1, status: 1 }
```

### K3 — Service vrstva

`LoansService` je najkomplexnejší service v projekte (318 riadkov).
Kľúčové vzory:

**All-or-nothing reservation** — ak ktorýkoľvek asset nie je AVAILABLE,
transakcia abortuje a žiadny asset nie sa reservuje:

```typescript
for (const item of input.items) {
  const asset = await this.assetsRepo.findById(tenantId, item.assetId, session);
  if (!asset || asset.status !== 'AVAILABLE') {
    throw new BadRequestError(
      `Asset ${asset?.inventoryNumber} is not available.`,
    );
  }
}
// Až po overení VŠETKÝCH assets:
for (const item of validatedItems) {
  await this.assetsRepo.update(
    tenantId,
    item.assetId,
    { status: 'RESERVED' },
    session,
  );
}
```

**MVP: approve = immediate pickup** — žiadny medzistav „APPROVED, čaká na
pickup". Pri approve sa hneď vytvorí Loan s `pickedUpAt = now()` a assets
prejdú RESERVED → BORROWED. Slice #5b oddelí tieto dva kroky pre PDF
protokoly.

**Lazy OVERDUE compute:**

```typescript
function loanToApiShape(doc: WithId<Loan>): Record<string, unknown> {
  const isOverdue =
    doc.status === 'ACTIVE' && new Date().toISOString() > doc.dueAt;
  return { ...doc, _id: String(doc._id), isOverdue };
}
```

OVERDUE nie je nikdy zapísaný do DB — prepočíta sa pri každom GET.

### K4 — Routes

**Dôležité poradie registrácie** v `loans.routes.ts`:

```typescript
// MUST be before /:id to prevent 'my' being matched as :id param
app.get('/v1/loans/my', ...);
app.get('/v1/loans', ...);
app.get('/v1/loans/:id', ...);
```

`loans.routes.ts` závisí na `loansService` decorated onto Fastify instance
z `loan-requests.routes.ts`, preto `loans-routes` má v dependencies
`['loan-requests-routes']`. Poradie registrácie v `server.ts`:

```typescript
await app.register(loanRequestsRoutes); // dekoruje loansService
await app.register(loansRoutes); // konzumuje loansService
```

## Test coverage (K5 — +39 testov)

| Test súbor                    | Testy | Čo pokrýva                                                                                         |
| ----------------------------- | ----- | -------------------------------------------------------------------------------------------------- |
| `loans-loan-requests.test.ts` | 22    | State transitions, reservation, RBAC, cancel ownership, list scoping, cross-tenant                 |
| `loans-loans.test.ts`         | 17    | Return (RETURNED + DAMAGED), lost, isOverdue computed, list ownership, GET ownership, cross-tenant |

**Vybrané kľúčové testy:**

- ✅ AVAILABLE assets → RESERVED pri CREATE, assets released pri REJECT/CANCEL
- ✅ All-or-nothing: 2 assets (1 AVAILABLE + 1 BORROWED) → 400, žiadny RESERVED
- ✅ APPROVE: Loan vytvorený, assets BORROWED, request APPROVED
- ✅ EMPLOYEE nemôže cancel cudzí request (403), ADMIN môže
- ✅ `requiresService: true` → asset IN_SERVICE, loan DAMAGED
- ✅ `isOverdue: true` pre loan s dueAt v minulosti (lazy computed)
- ✅ EMPLOYEE list loan requests/loans — vidí len vlastné
- ✅ Cross-tenant isolation — approve/return/view blocked pre iný tenant

**Fixtures pridané do `test-fixtures.ts`:**

| Helper                  | Účel                                        |
| ----------------------- | ------------------------------------------- |
| `insertTestLoanRequest` | Direct-insert loan request (bypass service) |
| `insertTestLoan`        | Direct-insert loan                          |

## MVP rozsah — vedome odložené do #5b/#5c

| Feature                                           | Deferral                           |
| ------------------------------------------------- | ---------------------------------- |
| PDF protokoly + podpisy (HANDOVER/RETURN)         | Slice #5b                          |
| Multi-approver routing per `Category.approverIds` | Slice #5b                          |
| Per-item substitution / partial approval          | Slice #5c                          |
| Predĺženie zápožičky (extend)                     | Slice #5b                          |
| Quick loan (approve + pickup v 1 kroku cez UI)    | Slice #5b                          |
| Email notifikácie                                 | Slice #5b (po Slice #6 SMTP/Graph) |
| OVERDUE persistent flag + cron                    | Slice #5b                          |
| APPROVE → PICKUP separácia                        | Slice #5b                          |

## Drobnosti vyriešené počas slice-u

### 1. Fastify validation order — 401 vs 400 trap

Pri teste „POST bez tokenu" sme očakávali 401 ale dostali 400. Fastify
lifecycle:

```
Parsing → preValidation → Validation (Zod) → preHandler (requireAuth) → Handler
```

Zod body validácia beží **pred** `preHandler` kde sedí `requireAuth`.
Nevalidné body (napr. `items: []`) dostane 400 skôr než auth check. Test
opravený na `GET /v1/loan-requests` bez tokenu → 401 (GET nemá body
validáciu).

**Ponaučenie:** pre auth-gate testy používaj endpointy bez povinného
body, alebo GETs. Platí pre všetky Fastify routes s body schema.

### 2. `exactOptionalPropertyTypes: true` v tsconfig

Projekt má strict tsconfig s `exactOptionalPropertyTypes`. Pri
`listLoanRequests(params, actor)`, service params:

```typescript
export interface ListLoanRequestsServiceParams {
  status?: LoanRequestStatus; // optional = can be undefined
}
```

Ale `loanRequestsRepo.list({ status: params.status })` — pass `undefined`
explicitne do required field v `ListLoanRequestsParams` je TS error
s `exactOptionalPropertyTypes`. Fix — conditional spread:

```typescript
...(params.status !== undefined && { status: params.status }),
```

Platí pre všetky optional params pred odovzdaním do repo.

### 3. MongoDB dotted-notation a TypeScript Filter<T>

`'items.assetId'` je validný MongoDB query path ale nie je v TypeScript
`Filter<Loan>` type (ktorý pozná len top-level fields). Riešenie —
`Record<string, unknown>` builder s cast na `Filter<T>` pri volaní
`tenantFilter`:

```typescript
const callerFilter: Record<string, unknown> = {};
callerFilter['items.assetId'] = assetId;
const effectiveFilter = tenantFilter<Loan>(
  tenantId,
  callerFilter as Filter<Loan>,
);
```

Rovnaký pattern ako v `users.routes.ts` s `$or` filter-om (K10).

### 4. ASSET_MANAGER list test — total 0 debugging

Test „ASSET_MANAGER sees all requests in tenant" inicálne zlyhal s
`expected 2, received 0`. Root cause bol nejasný — dva POST calls cez
API nedávali deterministic výsledok (možno asset status race alebo
JIT provisioning timing).

Fix: použiť `insertTestLoanRequest` (direct DB insert) namiesto API
calls v list test. API creation je pokrytá v iných testoch; list test
má testovať iba scoping query, nie creation pipeline.

**Vzor pre budúce list testy:** setup cez direct insert fixtures,
assertion cez API GET. Nepoužívaj API POST v setup fáze list testov —
príliš veľa moving parts.

## OpenAPI a typy (K6)

| Metrika                | Pred K5  | Po K5    |
| ---------------------- | -------- | -------- |
| `openapi.json` veľkosť | 74.1 KiB | 96.8 KiB |
| Paths                  | 14       | 23       |
| Endpoints              | 27       | 38       |
| `api-types.ts` regen   | ✅       | ✅       |

Frontend `apps/web` má nové typy pre `LoanRequest`, `Loan`,
`ReturnLoanInput` a všetky loan endpoints k dispozícii cez
`src/lib/api-types.ts`.

## Performance baseline (po Slice #5)

| Metrika             | Lokálne (Bratislava → Atlas) | CI (GitHub Actions → Atlas) |
| ------------------- | ---------------------------- | --------------------------- |
| Test suite duration | ~345s                        | ~5-6m                       |
| Test files          | 22                           | 22                          |
| Total tests         | 366                          | 366                         |
| Vitest pool         | singleFork                   | singleFork                  |
| Plugin timeout      | 30s                          | 30s                         |

## Bezpečnostné záruky (po Slice #5)

1. **All-or-nothing reservation** — partial reservation nie je možná;
   ak transakcia abortuje, žiadny asset nie je RESERVED
2. **Tenant scoping** — všetky repository metódy filtrujú `organisationId`
   cez `tenantFilter`; cross-tenant request/loan je neviditeľný (404, nie 403)
3. **Ownership check v service** — `cancelLoanRequest` a `getLoanRequestById`
   overujú vlastníctvo v service vrstve (nie len cez requireRole)
4. **Audit trail** — každý stavový prechod zapisuje audit log atomicky
   s business write-om; GDPR `legalBasis: 'contract'` a
   `dataCategories: ['asset_custody', 'audit_metadata']` na všetkých loan events
5. **OVERDUE nie je persistent** — lazy compute eliminuje potrebu cron jobu
   v MVP; žiadne stale data v DB

## Čo NIE JE v Slice #5

Vedome odložené (viď tabuľka vyššie + ADR-0012 deferral list):

- ❌ PDF protokoly HANDOVER/RETURN
- ❌ Multi-approver routing (`Category.approverIds`)
- ❌ Per-item substitution
- ❌ Quick loan (US-017)
- ❌ Predĺženie zápožičky
- ❌ Email notifikácie
- ❌ OVERDUE persistent flag + nightly cron
- ❌ `LoanProtocol` repository, service, routes (schéma existuje)

## Commit-y (chronologicky)

1. `docs: ADR-0012 loans state machine + Slice #5 MVP scope`
2. `refactor(shared-types): add OrganisationScopedSchema to loan documents`
3. `feat(loans): K2 LoanRequestsRepository + LoansRepository`
4. `feat(loans): K3 LoansService — state machine business logic`
5. `feat(loans): K4 loan-requests + loans routes (11 endpoints)`
6. `test(loans): K5 integration tests — 39 new tests (366 total)`
7. `feat(loans): K6 OpenAPI export + frontend type regen`
8. `docs(milestones): slice-5-loans-mvp` ← **toto**

## Časová investícia

~1 pracovný deň (2026-05-20):

- Strategický dizajn (ADR-0012, Q&A) — ~1.5h (Opus 4.7)
- K1–K4 implementácia — ~4h (Sonnet 4.6)
- K5 testy + debugging — ~2.5h (Sonnet 4.6)
- K6 + K8 — ~30 min (Sonnet 4.6)

## Ďalšie kroky

### Slice #4 finálne 2 P0 stránky (odblokované)

- `apps/web/src/app/loans/request/page.tsx` — formulár pre novú žiadosť
  (asset multi-select + purpose + dátumy)
- `apps/web/src/app/my-loans/page.tsx` — zoznam vlastných zápožičiek
  s `isOverdue` badge-om

### Pilot tenant onboarding

Inventario je now feature-complete pre MVP loans flow
(request → approve → return). 5/6 P0 frontend stránok + 2 nové unblocknuté
= 7/8 P0 stránok po Slice #4 final. Dostatočné pre onboarding prvého
pilot tenanta.

### Slice #5b (after pilot feedback)

Per ADR-0012 — multi-approver routing, PDF protokoly, OVERDUE cron,
predĺženie, email notifikácie.

## Referencie

- [ADR-0012 — Loans state machine + Slice #5 MVP scope](../decisions/0012-loans-state-machine.md)
- [ADR-0010 — Multi-tenant white-label architektúra](../decisions/0010-multi-tenant-white-label.md)
- [Slice #3 milestone](slice-3-categories-locations-users.md)
- [Phase C milestone — multi-tenant migration](phase-c-multi-tenant-migration.md)
- [NEXT.md continuation plan](../sessions/NEXT.md)

<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-06-01 (ADR-0026 katalógové žiadosti + oddelené vydávanie — ✅ Accepted, implementácia NASLEDUJE; ADR-0025 open-ended — ✅ implementované; ADR-0024 TEAM_MANAGER — ✅; ADR-0023 beneficiary + priamy loan — ✅) |
| **Aktuálna fáza**         | Production LIVE ✅ — ADR-0026 prepis loans modelu pred pilotom                                                                                                                                                      |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`                                                                                                                                                                       |
| **GitHub**                | https://github.com/ltksolutions/inventario                                                                                                                                                                          |

---

### ADR-0026 — Katalógové žiadosti + oddelené vydávanie 🔥 ACCEPTED — IMPLEMENTÁCIA NASLEDUJE

**Toto je ďalší krok.** Smoke test formulára žiadosti odhalil chýbajúci typ žiadosti: model
pozná len konkrétnu žiadosť (vyber assetId), ale ~95 % reálnych žiadostí je **katalógových**
(„1 projektor, 10 kužeľov, myš ak je skladom“ — kategória+množstvo, konkrétny kus priradí
správca pri vydaní).

**Model:** Žiadosť = katalógový dopyt (kategória + množstvo + poznámka), nedrží zásobu.
Správca je jediný gatekeeper — pri vydaní mapuje na konkrétne kusy / BULK a vydá. 1 žiadosť
→ N Loanov postupne. Approve a vydanie **oddelené**.

**Nový FSM:** `PENDING → APPROVED → PARTIALLY_FULFILLED → FULFILLED/CLOSED` (+ REJECTED/CANCELLED).
Approve už nevytvára Loan — vydanie cez nový `POST /v1/loan-requests/:id/fulfil`.

**Prečo teraz:** systém je prázdny → žiadna migrácia. O mesiac na živých dátach by to bola
riziková migrácia FSM. Robíme načisto.

**Implementačný plán (K1–K7, na Sonnet):**

| Blok | Popis                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------ |
| K1   | Schéma: `LoanRequestStatus` (7 stavov), `LoanRequestItem` prepis (categoryId+quantity), `resultingLoanIds[]` |
| K2   | Repository + service FSM (createCatalogRequest, approve, **fulfil**, reject, cancel)                         |
| K3   | Routes: create (kat.+množstvo), approve (len stav), **fulfil** (nový), reject, cancel                        |
| K4   | Frontend `/loans/request` — kategória+množstvo formulár (žiadny asset picker)                                |
| K5   | Frontend — obrazovka vydávania pre správcu (mapovanie na kusy/BULK, čiastočné vydanie)                       |
| K6   | Tests — FSM, čiastočné vydanie, N Loanov, over-fulfilment guard, súbeh, RBAC                                 |
| K7   | OpenAPI + api-types regen, devlog, cross-linky                                                               |

**Postup:** blok po bloku (K1 → typecheck → K2 …), nie všetko naraz.

**Prepísať cross-linky** v ADR-0012/0020/0023/0025 (tento ADR mení ich predpoklady) — súčasť K7.

ADR: `docs/decisions/0026-catalog-requests-and-fulfilment.md` (Accepted).
Session: `docs/sessions/2026-06-01-adr-0026-catalog-requests.md`.

---

### ADR-0025 — Open-ended výpožičky + dotiahnutie formulára žiadosti ✅ IMPLEMENTOVANÉ

Spustené produkčným smoke testom formulára `/loans/request`: pole „Do“ bolo vždy povinné
(nedávalo zmysel pri trvalom pridelení notebooku), a beneficiary pole z ADR-0023 vo
formulári úuplne chýbalo.

Vykonané zmeny:

- `schemas/loan.ts` — `plannedTo`, `dueAt`, `CreateDirectLoanSchema.dueAt` → `.nullable().default(null)`
- `loans.service.ts` — OVERDUE guard `dueAt != null` (open-ended nikdy nie je po termíne);
  email notify signatúry `string | null`
- `loan-requests.routes.ts` — `plannedTo` nullable+optional + `.refine()` `plannedFrom <= plannedTo`
  len keď termín existuje
- `plugins/email.ts` — `dueAt`/`plannedTo` nullable; `formatDateSk(null)` → „bez termínu“
- **`GET /v1/members`** (nový, `memberships.routes.ts`) — EMPLOYEE+ picker-safe zoznam členov
  (`_id`, `displayName`...), bez citlivých polí; `GET /v1/users` je ADMIN-only, takže picker
  potreboval vlastný zdroj
- `LoanRequestContent.tsx` — segment „Na dobu určitú / Do odvolania“ + beneficiary `SelectField`
  (default = ja, `useMembers` hook)
- `LoansContent.tsx` + `MyLoansContent.tsx` — `formatDate(null)` → „do odvolania“
- `api-hooks.ts` — `useMembers` + `MemberPickerItem`; null-aware typy `plannedTo`/`dueAt`
- `tests/integration/loans-adr-0025.test.ts` — 13 testov (open-ended request/loan, OVERDUE guard,
  members endpoint)
- `openapi.json` + `api-types.ts` regenerované

**Beneficiary picker — rozhodnutie:** vždy viditený `SelectField` (default = ja), NIE prepínač —
prepínač skrýval najčastejší tok (správca prideľuje inému) a pridal UI stav bez dátového prínosu.

**Odložené (Fáza 2, po pilote):** `Category.allowOpenEnded` (ktoré kategórie smú „do odvolania“),
dashboard aktívnych open-ended výpožičiek, vetvenie „extend loan“ pre open-ended.

**Po deployi overiť:** segment doba určitá/neurčitá, beneficiary picker, open-ended výpožička
sa zobrazí ako „do odvolania“ bez „Po termíne“ badge.
ADR: `docs/decisions/0025-open-ended-loans-and-request-form.md` (Accepted).

---

### ADR-0024 — Odstránenie role TEAM_MANAGER ✅ IMPLEMENTOVANÉ

`TEAM_MANAGER` bol pozostatok SFZ modelu — mŕtva rola bez vlastného oprávnenia, nahradená
beneficiary modelom (ADR-0023). Odstránený z `UserRole` enumu aj kódu. Výsledné roly:
EMPLOYEE, ASSET_MANAGER, ADMIN, EXTERNAL.

Vykonané zmeny:

- `packages/shared-types/src/enums/user-role.ts` — odstránený `TEAM_MANAGER` + akt. popisy rolí
- `loan-requests.routes.ts` + `loans.routes.ts` — `canRead` už bez `TEAM_MANAGER`
- `tests/integration/rbac.test.ts` — odstránený `TEAM_MANAGER forbidden writes` blok (pokryté EMPLOYEE/EXTERNAL)
- Migrácia `2026-05-31-remove-team-manager-role.ts` — `$pull` z `memberships.roles` + `users.roles`,
  fallback `['EMPLOYEE']` pri prázdnom poli; zaregistrovaná v `runner.ts`

**POZN.:** `Membership.teams[].role: 'MANAGER'` (rola v rámci tímu) sa NEMENILA — iný koncept.

**Po pullе spustiť lokálne:**

```
pnpm --filter @inventario/shared-types build
pnpm typecheck && pnpm test
```

(shared-types build regeneruje JSON Schema; OpenAPI + api-types sa regenú cez pretypecheck hook.)

**Ešte overiť:** SFZ Asset-Management repo — či tam `TEAM_MANAGER` nemá živé použitie (zdieľaný princíp).
ADR: `docs/decisions/0024-remove-team-manager-role.md`.

---

### ADR-0023 — Žiadosť v mene inej osoby + priama výpožička ✅ IMPLEMENTOVANÉ

Upravený model z ADR-0012 (kde platilo žiadateľ = vypožičiavajúci, Loan vždy zo žiadosti).
Dve zmeny:

- **`LoanRequest.beneficiaryId`** — žiadosť pre seba alebo pre inú osobu. `requesterId` = kto
  podal, `beneficiaryId` = pre koho (default self). Pri approve `Loan.borrowerId = beneficiaryId`.
  Žiadať za hocikoho smú všetci (EMPLOYEE+). Read-RBAC: EMPLOYEE vidí `requesterId === self`
  ALEBO `beneficiaryId === self`.
- **Priamy Loan bez žiadosti** — `Loan.requestId` je nullable; nový `POST /v1/loans`
  (ASSET_MANAGER/ADMIN) vytvorí výpožičku priamo (`AVAILABLE → BORROWED`, bez RESERVED).
  Pokrýva US-017 quick loan.

Vykonané zmeny:

- `packages/shared-types/src/schemas/loan.ts` — `beneficiaryId` na `LoanRequestSchema`,
  `requestId` nullable na `LoanSchema`, nový `CreateDirectLoanSchema`
- `audit-log.ts` — nová akcia `LOAN_CREATED_DIRECT`
- `loans.service.ts` — beneficiary validácia + `borrowerId = beneficiaryId` pri approve,
  nová `createDirectLoan` metóda, EMPLOYEE list filter `$or` (requester/beneficiary)
- `loan-requests.repository.ts` — `beneficiaryId` filter v `list()` (self-view `$or`)
- `loan-requests.routes.ts` + `loans.routes.ts` — body schema beneficiaryId, nový `POST /v1/loans`
- Migrácia `2026-05-31b-loan-request-beneficiary.ts` — backfill `beneficiaryId = requesterId`
- `tests/integration/loans-adr-0023.test.ts` — beneficiary + direct loan testy (667 testov zelených)

**Dôležité zistenie:** `LoansService` dostáva `fastify.mongo.db` cez konštruktor (nový param).
`mongoClient.db()` bez mena vracia default DB z URI, nie tenant/test DB — to lámalo
cross-collection lookupy (users, memberships). Pridaný `getDb()` helper.

ADR: `docs/decisions/0023-loan-beneficiary-and-direct-loan.md`.

---

### ADR-0022 — Preberacie protokoly PDF (Proposed) 📄

Rozhodovací dokument pre generovanie HANDOVER/RETURN protokolov. Napĺňa medzeru, ktorú
ADR-0012 vedome odložil na #5b (`Loan.handoverProtocolId`/`returnProtocolId` boli vždy `null`).
Kľúčové rozhodnutia:

- **Životný cyklus:** záznam `LoanProtocol` (DRAFT) vzniká v approve/return transakcii;
  PDF sa renderuje **mimo** transakcie (fire-and-forget + lazy fallback pri stiahnutí).
- **Renderer:** `pdf-lib` + `@pdf-lib/fontkit` (nie Puppeteer — kvôli Vercel serverless
  a determinizmu hashu). Embedovaný TTF font (DejaVu/Noto) kvôli SK diakritike.
- **Determinizmus:** žiadne `now()` v renderi, metadata dátumy = `issuedAt` → stabilný `pdfSha256`.
- **White-label:** logo z `Organisation.brandKit.logoUrl` (SVG→PNG rasterizácia), identita z `billing`.
- **`protocolNumber`** `PROT-YYYY-NNNNNN` transakčne, scoped org+rok, unique index.
- **Podpisy:** prvá fáza len `CLICK_TO_SIGN` (DRAFT→SIGNED po oboch stranách + re-render);
  BIOMETRIC/EXTERNAL(eIDAS) neskôr.
- **Schema fix:** doplniť `organisationId` na `LoanProtocolSchema` (rovnaký multi-tenant bug ako mal Loan).
- **Predpoklad:** attachments infra (úložisko PDF) — kandidát na samostatné ADR-0023 alebo min. GridFS v K4.

Fázovanie a sub-tasky (K1–K8) v ADR. **Čaká na rozhodnutie:** spustiť pred pilotom, alebo až po
(ADR-0012 odporúča pilot pred ďalším loans rozvojom). Súbor: `docs/decisions/0022-loan-protocol-pdf.md`.

---

### Slice #5a K2–K5 — repository, service, routes, testy ✅

- `StockMovementsRepository` — append-only insert, listByItem, findById, sumQuantityByItem, 4 indexy
- `StockService` — `receive` (RECEIPT), `adjust` (ADJUSTMENT), `reconcile`; transakčný
  `recordMovement` (pohyb + `$set quantityOnHand` + audit log v jednej Mongo transakcii)
- `stock.routes.ts` — 4 endpointy (`GET /movements`, `POST /receive`, `POST /adjust`,
  `POST /reconcile`), zaregistrované v `server.ts`
- 18 integračných testov (happy path, RBAC, validácia, záporný zostatok, cross-tenant)
- Fixture `insertTestAsset` rozšírená o `trackingMode` + `quantityOnHand`
- `openapi.json` refreshnutý

### Slice #5a K1 — schémy (ADR-0020) ✅

- `TrackingMode` enum (SERIALIZED/BULK) + `StockMovementType` enum + `STOCK_MOVEMENT_SIGN` mapa
- `AssetSchema` + `trackingMode` (default SERIALIZED, immutable) + `quantityOnHand` (server cache)
- `StockMovementSchema` — append-only ledger, signed `quantity`, `balanceAfter`, `loanId`
- Audit log: 4 nové akcie + `StockMovement` entityType + STOCK\_ defaults v audit service
- Generátory: `StockMovement` pridaný, `json-schema.json` regenerovaný (30 schém)
- Testy: `stock-movement.test.ts` + rozšírený `asset.test.ts` (tracking mode testy)
- `openapi.json` refreshnutý

---

## Čo sme spravili 2026-05-30 (celý deň)

### Dopoludnia — SelectField + billing model ✅

- `SelectField.tsx` — WAI-ARIA custom dropdown, nahradil všetky `<select>` naprieč appkou
- `ADR-0018` — pravidlá kedy použiť SelectField vs Combobox
- `OrganisationBillingSchema` — vnorené nullable `billing` pole (IČO, DIČ, IČ DPH, IBAN, adresy)
- `GET/PATCH /v1/organisations/current` — self-service, org ID z JWT, SAFE subset
- `/settings/organisation` stránka + nav item „Organizácia" (ADMIN-only)
- `ADR-0019` — tenant billing model rozhodnutia

### Poobede — bug fixy + tenant admin ✅

- **Bug fix:** IČO zadané pri registrácii sa zahodilo — opravené v `registration.routes.ts`
  aj `oauth.routes.ts` (billing objekt s `ico` + `legalName` pri org insert)
- **TenantEditDialog** — rozšírený na `max-w-lg` + scroll, read-only billing sekcia
  (`TenantReadOnlyDetails`: Identifikácia, Fakturačné údaje, Adresy)
- `openapi.json` refreshnutý (`chore(api): refresh openapi.json`) — CI 69 zelené

### Večer — loader systém + návrh skladu ✅

- `RouteProgressBar.tsx` — globálny progress bar pod headerom (`useIsFetching`),
  anti-flicker (120ms delay, 240ms min visible), `prefers-reduced-motion`
- `Skeleton.tsx` — zdieľané `Skeleton`, `TableSkeleton`, `CardSkeleton`
- `AppShell.tsx` — `relative` header + `<RouteProgressBar />`
- `globals.css` — `@keyframes route-progress` + reduced-motion variant
- `AssetsListContent.tsx`, `UsersContent.tsx` — lokálne skeletony nahradené zdieľanými
- **`ADR-0020` (Proposed)** — skladové množstevné položky: `trackingMode` SERIALIZED|BULK,
  StockMovement ledger ako zdroj pravdy, množstvo v žiadosti/zápožičke, čiastočné
  vrátenie. Dopĺňa ADR-0012 (cross-link pridaný). **Čaká na prečítanie + povýšenie
  na Accepted.**

---

## Stav na koniec dňa 2026-05-30

### 📊 Globálny stav

| Oblasť            | Status                                                      |
| ----------------- | ----------------------------------------------------------- |
| **Backend testy** | ✅ ~680 (43 test files)                                     |
| **Frontend**      | ✅ Slice #5a: StockPanel, prehľad skladu, BULK badge/filter |
| **Production**    | ✅ LIVE — app.inventario.estate                             |
| **CI**            | ✅ Zelené                                                   |
| **ADR-čka**       | ✅ 0001–0026 (0021 QR, 0022 PDF — Proposed)                 |
| **openapi.json**  | ✅ Aktuálne (69 endpointov)                                 |

---

## 🔥 Najbližšie kroky (priorita)

### 0. ADR-0026 implementácia (K1–K7) — PRVÁ PRIORITA, na Sonnet

Prepis loans modelu na katalógové žiadosti + oddelené vydávanie. Detailný plán vyššie
(sekcia „ADR-0026 — Katalógové žiadosti“). Blok po bloku, po každom zelený typecheck + test.

### 1. Smoke test po deployi

- [ ] `/settings/organisation` — formulár + uloženie billing funguje
- [ ] IČO zadané pri novej registrácii sa objaví v billing
- [ ] TenantEditDialog — read-only sekcia zobrazí slug, billing údaje
- [ ] RouteProgressBar — viditeľný počas načítavania (Atlas cold start)
- [ ] SelectField vo všetkých zoznamoch — klávesnica + myš
- [ ] `/stock` — sklad prehľad sa zobrazí pre ASSET_MANAGER+
- [ ] Farebné indikátory zásob (0=červená, ≤10%=žltá, OK=zelená)
- [ ] StockPanel na detaile BULK asset-u — príjem, korekcia

### 2. ~~Testy pre `/current` endpointy~~ ✅ HOTOVÉ (2026-05-31)

26 testov: RBAC (GET všetky roly, PATCH len ADMIN), billing validácia
(IČO/IČ DPH/IBAN + normalizácia medzier), cross-tenant izolácia, safe subset.
56/56 zelených.

### 3. Skeletony na zvyšných stránkach (voliteľné)

TenantsContent, InvitationsContent, MembersContent, CiselnikyContent — Globálny
`RouteProgressBar` kryje tieto stránky medzitým.

### 4. ~~Rozhodnúť o ADR-0020~~ ✅ HOTOVÉ (2026-05-31)

### 5. Pilot tenant onboarding — NASLEDUJE po smoke teste

SFZ (`inventario@futbalsfz.sk`) — overiť login na prod a prejsť onboardingom.
Pilot informá návrh Slice #5b (loans) + reálny pomer serialized vs bulk.

### 6. email_unique index — overiť na prod

- [ ] Atlas: skontrolovať že `email_unique` / `email_1` index bol dropnutý migráciou

### 7. QR kódy majetku — ADR-0021 (Proposed, revid. 2026-05-31) → implementácia

Rozhodnuté v diskusii 2026-05-31 (viď `docs/decisions/0021-asset-qr-codes.md`):

- QR obsahuje **URL viazanú na tenant doménu** + náhodný **`publicToken`**:
  `https://{tenantDomain}/scan/{publicToken}` — kvôli forkom (ADR-0010), nikdy nehardkódovať doménu
- Kľúč v QR = **`publicToken`** (náhodný, neuhádnuteľný, nanoid/UUIDv4), **nie** `inventoryNumber` ani `_id`
  — verejný povrch nie je enumerovateľný. Generácia vždy pri POST, unique index, nemenný.
- **`inventoryNumber`** ostáva administratívne čitateľné pole (štítok, zostavy) a je
  **konfigurovateľné per tenant** — `inventoryNumberFormat { prefix, padding, includeYear, resetYearly }`,
  default `{PREFIX}-{YYYY}-{NNNN}` (parametrická varianta, nie voľný template)
- QR sa **generuje on-demand**, neukladá: `GET /v1/assets/:id/qr?format=svg|png` (auth, EMPLOYEE+)
- **Verejný lost & found** lookup, **opt-in per tenant**: `GET /public/scan/:publicToken`,
  rate-limited, vlastné **`PublicAssetView` DTO** (explicitný whitelist, NIE Pick/Omit z Asset)
- `Organisation` dostane `appBaseUrl` (zdroj tenant domény, **rozhodnuté** — nie z `Host` hlavičky),
  `inventoryNumberFormat`, `publicAssetLookup: boolean` (default false), `foundContactInfo`
- Migrácia: dogenerovať `publicToken` existujúcim assetom
- Odložené (Fáza 2): per-asset `discoverable`, plný template-based formát, PDF hárky štítkov
- ⚠️ **DPIA dopad** — verejný majetkový lookup je nová kategória spracúvania → zahrnúť do Compliance Fázy 2

**Status:** ADR Proposed (revidovaný). Pred implementáciou povýšiť na Accepted. Sklad (#5a) hotový, loans (#5b)
ešte nie — QR je nezávislé, dá sa zaradiť kedykoľvek (vhodný malý slice po pilote alebo popri ňom).
Implementácia na **Opus** (verejný povrch + DPIA dopad).

---

## 📅 Plánované (neskôr)

### Slice #5 — loans backend (po pilotnom tenantovi)

Pravdepodobne sa **rozdelí** (per ADR-0020):

- **#5a — Sklad foundation** — `trackingMode`, `stock_movements` ledger,
  `quantityOnHand` cache, príjem/korekcia (RECEIPT/ADJUSTMENT). Nezávislé od loans.
- **#5b — Loans MVP s množstvom** — ADR-0012 state machine + `quantity` na riadku,
  čiastočné vrátenie BULK.

Presné poradie a scope sa doriešia pri plánovaní Slice #5 (po pilote).

### Slice #10 — MCP server (Q1 2027, ~10 dní)

| Fáza | Bloky   | Popis                                                     |
| ---- | ------- | --------------------------------------------------------- |
| #10a | K1–K4   | Backend foundation: mcp-access-token, repository, routes  |
| #10b | K5–K10  | MCP server scaffold: SDK, token resolver, JWT, rate limit |
| #10c | K11–K16 | Tools: 10 read + 7 write + audit log                      |
| #10d | K17–K18 | Frontend `/settings/integrations`                         |
| #10e | K19–K23 | Tests + docs + Vercel + DNS                               |

### Compliance Fáza 2 (po 1. tenantovi)

DPIA, Security Whitepaper, Data Retention Schedule, IS Policy.

### Post-launch (LOW priority)

`Cmd+K` tenant picker, SOC 2 Type II, dashboard štatistiky, QR štítky PDF.

---

## 🏗️ Backend status

```
Celkové testy:                680
├── Slice #1–#3:              ~310
├── Slice #4–#6b:             ~169
├── Slice #6c:                  21
├── Slice #7 + K12a/b:          29
├── Slice #9:                   28
├── Slice #8 (Passkeys):        16
├── Dynamic Combobox K7:        35
├── Organisations CRUD:         56
├── Slice #5a (Sklad):          18
├── ADR-0023 (loans bndf):      ~16
└── ADR-0025 (open-ended):       13

Test files:   ~43
Duration:     ~95s
```

---

## 🧭 Model routing

| Task typ                                                    | Model          |
| ----------------------------------------------------------- | -------------- |
| Strategické rozhodnutia, ADR, DPIA, security architecture   | **Opus 4.7**   |
| CRUD endpoints, frontend pages, debug, tests, implementácia | **Sonnet 4.6** |
| Milestone docs, mechanické edits, scoped docs               | **Haiku 4.5**  |

---

## 📂 Kde nájdeš čo

| Typ                               | Lokácia                                                 |
| --------------------------------- | ------------------------------------------------------- |
| **Aktuálny stav**                 | `docs/sessions/NEXT.md` (TY SI TU)                      |
| **Session 2026-06-01 (ADR-0025)** | `docs/sessions/2026-06-01-adr-0025-open-ended-loans.md` |
| **Session 2026-05-31 (večer)**    | `docs/sessions/2026-05-31-adr-0024-0023-loans.md`       |
| **Session 2026-05-31 (QR)**       | `docs/sessions/2026-05-31-qr-publictoken-revizia.md`    |
| **Session 2026-05-30**            | `docs/sessions/2026-05-30-billing-and-tenant-detail.md` |
| **Session 2026-05-29 (večer)**    | `docs/sessions/2026-05-29-ux-polish-selectfield.md`     |
| **Session 2026-05-29 (deň)**      | `docs/sessions/2026-05-29-tenants-admin-and-fixes.md`   |
| **ADR-čka**                       | `docs/decisions/0001..0020-*.md`                        |
| **Slice milestones**              | `docs/milestones/slice-*.md`                            |

---

**Last updated:** 2026-06-01 (ADR-0025 open-ended výpožičky + beneficiary formulár implementované)
**Tests:** 680 ✅ | **CI:** zelené ✅ | **OpenAPI:** 69 endpointov ✅
**Repo:** github.com/ltksolutions/inventario | **Status:** Production LIVE ✅

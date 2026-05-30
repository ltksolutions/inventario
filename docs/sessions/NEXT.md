<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                        |
| ------------------------- | ---------------------------------------------- |
| **Posledná aktualizácia** | 2026-05-30 (Slice #5a K1–K5 ✅)                |
| **Aktuálna fáza**         | Production LIVE ✅ — UX polish + billing model |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`  |
| **GitHub**                | https://github.com/ltksolutions/inventario     |

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

| Oblasť            | Status                                              |
| ----------------- | --------------------------------------------------- |
| **Backend testy** | ✅ ~607 (37 test files)                             |
| **Frontend**      | ✅ billing settings + tenant detail + loader systém |
| **Production**    | ✅ LIVE — app.inventario.estate                     |
| **CI**            | ✅ Zelené (CI 69+)                                  |
| **ADR-čka**       | ✅ 0001–0019, 🟡 0020 (Proposed — sklad)            |
| **openapi.json**  | ✅ Aktuálne (62 endpointov, 37 paths)               |

---

## 🔥 Najbližšie kroky (priorita)

### 1. Smoke test po deployi

- [ ] `/settings/organisation` — formulár + uloženie billing funguje
- [ ] IČO zadané pri novej registrácii sa objaví v billing
- [ ] TenantEditDialog — read-only sekcia zobrazí slug, billing údaje
- [ ] RouteProgressBar — viditeľný počas načítavania (Atlas cold start)
- [ ] SelectField vo všetkých zoznamoch — klávesnica + myš

### 2. Testy pre `/current` endpointy

- [ ] `updateCurrent` RBAC — len ADMIN tenanta (EMPLOYEE/ASSET_MANAGER → 403)
- [ ] billing validácia — IČO 8 číslic, IČ DPH SK+10, IBAN formát
- [ ] cross-tenant izolácia — org ID z JWT, nie z URL
- [ ] `getCurrent` — ktorýkoľvek člen číta vlastnú org

### 3. Skeletony na zvyšných stránkach (voliteľné)

TenantsContent, InvitationsContent, MembersContent, CiselnikyContent — po smoke
teste, ak bude čas. Globálny `RouteProgressBar` kryje tieto stránky medzitým.

### 4. Rozhodnúť o ADR-0020 (sklad) — prečítať + povýšiť

[ADR-0020](../decisions/0020-stock-and-bulk-items.md) je v stave **Proposed**.
Model je odsúhlasený v princípe; prečítať s odstupom a buď povýšiť na Accepted,
alebo doladiť. Otvorená sub-vidlica už rozhodnutá (ledger, nie počítadlo).

### 5. Pilot tenant onboarding (pred Slice #5)

SFZ (`inventario@futbalsfz.sk`) — overiť login na prod a prejsť onboardingom.
Reálne použitie informuje návrh Slice #5 **a pomer serialized vs bulk** (ADR-0020).

### 6. email_unique index — overiť na prod

- [ ] Atlas: skontrolovať že `email_unique` / `email_1` index bol dropnutý migráciou

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
Celkové testy:                ~607
├── Slice #1–#3:              ~310
├── Slice #4–#6b:             ~169
├── Slice #6c:                  21
├── Slice #7 + K12a/b:          29
├── Slice #9:                   28
├── Slice #8 (Passkeys):        16
├── Dynamic Combobox K7:        35
└── Organisations CRUD:         30

Test files:   37
Duration:     ~85s
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

| Typ                            | Lokácia                                                 |
| ------------------------------ | ------------------------------------------------------- |
| **Aktuálny stav**              | `docs/sessions/NEXT.md` (TY SI TU)                      |
| **Session 2026-05-30**         | `docs/sessions/2026-05-30-billing-and-tenant-detail.md` |
| **Session 2026-05-29 (večer)** | `docs/sessions/2026-05-29-ux-polish-selectfield.md`     |
| **Session 2026-05-29 (deň)**   | `docs/sessions/2026-05-29-tenants-admin-and-fixes.md`   |
| **ADR-čka**                    | `docs/decisions/0001..0020-*.md`                        |
| **Slice milestones**           | `docs/milestones/slice-*.md`                            |

---

**Last updated:** 2026-05-30 (koniec dňa)
**Tests:** ~607 ✅ | **CI:** zelené ✅ | **OpenAPI:** 62 endpointov ✅
**Repo:** github.com/ltksolutions/inventario | **Status:** Production LIVE ✅

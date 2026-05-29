<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Slice #4 — Frontend Web App (Completed 2026-05-20, rozšírený 2026-05-29)

## Cieľ

Vybudovať **produkčnú Next.js 15 webovú aplikáciu** (`apps/web`) pre
Inventario — všetkých 7 P0 stránok s MSAL autentifikáciou, RBAC, mobile
responsive layoutom a napojením na produkčné Fastify API.

Deploynuté na `app.inventario.estate` (Vercel, `inventario-app`
projekt, `ltksolutions-projects` team).

## Výsledok

✅ **7/7 P0 stránok LIVE:**

| Stage            | Komponent(y)                                                  | Build size | Commit       |
| ---------------- | ------------------------------------------------------------- | ---------- | ------------ |
| `/` Dashboard    | `DashboardContent` + `StatCard`                               | 5.2 kB     | `77b51e8`    |
| `/assets`        | `AssetsListContent` + `AssetsTable`                           | 6.1 kB     | `a5e8b2e`    |
| `/assets/[id]`   | `AssetDetailContent` + edit form + read view                  | 8.3 kB     | (2026-05-17) |
| `/categories`    | `CategoriesContent` + `CategoryCreateDialog`                  | 4.42 kB    | (2026-05-18) |
| `/locations`     | `LocationsContent` + `LocationCreateDialog`                   | 4.48 kB    | (2026-05-18) |
| `/users`         | `UsersContent` + `UserEditDialog`                             | 5.91 kB    | (2026-05-18) |
| `/loans`         | `LoansContent` — žiadosti + approve/reject/cancel             | ~5 kB      | (2026-05-20) |
| `/loans/request` | `LoanRequestContent` — formulár + asset multi-select          | ~4 kB      | (2026-05-20) |
| `/admin/tenants` | `TenantsContent` — platform admin, list/create/edit/archive   | ~7 kB      | (2026-05-29) |
| `/ciselniky`     | `CiselnikyContent` — 4 záložky: kategórie/lokality/typy/stavy | ~5 kB      | (2026-05-29) |

✅ **Smoke test** 10/10 PASS na `app.inventario.estate`
(Microsoft Entra ID login → JIT provisioning → RBAC → mobile drawer → logout).
Detaily v `docs/sessions/2026-05-18-day-summary.md` sekcia 8.

## Architektúra

### Stack

| Vrstva       | Technológia                                                  |
| ------------ | ------------------------------------------------------------ |
| Framework    | Next.js 15.5 (App Router, Server + Client components)        |
| Auth         | MSAL React (`@azure/msal-react` + `@azure/msal-browser`)     |
| API client   | `openapi-fetch` + generovaný `api-types.ts` z `openapi.json` |
| Server state | TanStack Query v5 (`@tanstack/react-query`)                  |
| Forms        | `react-hook-form` + HTML5 native validation                  |
| Styling      | Tailwind CSS 3 + `@inventario/design-tokens` preset          |
| Icons        | `lucide-react`                                               |
| Monorepo     | pnpm workspace + Turborepo                                   |
| Deploy       | Vercel (Node 22.x, `inventario-app` projekt)                 |

### Komponentová štruktúra

```
apps/web/src/
├── app/                      → Next.js App Router pages (thin server shells)
│   ├── page.tsx              → Dashboard
│   ├── assets/page.tsx
│   ├── assets/[id]/page.tsx
│   ├── categories/page.tsx
│   ├── locations/page.tsx
│   ├── users/page.tsx
│   ├── loans/page.tsx        → Výpožičky (list + approve/reject)
│   ├── loans/request/page.tsx → Nová žiadosť (formulár)
│   └── my-loans/page.tsx     → Moje výpožičky + čakajúce žiadosti
├── components/               → Client components (business logic + UI)
│   ├── AppShell.tsx          → Header + sidebar nav + mobile drawer
│   ├── AuthGate.tsx          → MSAL auth gate (unauthenticated → LoginScreen)
│   ├── DashboardContent.tsx  → 4 stat cards + quick nav grid
│   ├── AssetsListContent.tsx → Paginated list + filter/search
│   ├── AssetsTable.tsx       → Semantic table s FK resolution
│   ├── AssetDetailContent.tsx→ Read/edit toggle + RBAC
│   ├── CategoriesContent.tsx → CRUD + FK protection messaging
│   ├── LocationsContent.tsx  → CRUD + FK protection messaging
│   ├── UsersContent.tsx      → ADMIN-only + guardrails surfacing
│   ├── LoansContent.tsx      → Loan requests list + inline approve/reject/cancel
│   ├── LoanRequestContent.tsx→ Multi-select asset form + date inputs
│   └── MyLoansContent.tsx    → Loans table + pending requests sekcia
- [x] `organisations-hooks.ts` — TanStack Query hooks pre `/v1/organisations`
- [x] `TenantsContent.tsx` — platform admin Tenants page
- [x] `CiselnikyContent.tsx` — unified Číselníky page (4 záložky)
- [x] `Combobox.tsx` + `TagsCombobox.tsx` — Atlas-style typeahead komponenty
```

### Auth flow

```
Browser → /login (LoginScreen) → "Prihlásiť sa cez Microsoft"
  → MSAL redirect → Entra ID consent → redirect back
  → AuthGate mounts → MSAL acquireTokenSilent
  → GET /v1/me (JIT provision + tenant binding)
  → AppShell + page content
```

Token middleware v `api-client.ts` automaticky vkladá `Authorization: Bearer`
do každého API volania. Pri expirácii MSAL silently refreshuje.

### RBAC gating (client-side)

| Hook                     | Kontroluje             | Skrýva                               |
| ------------------------ | ---------------------- | ------------------------------------ |
| `useCanEditAssets()`     | ASSET_MANAGER \| ADMIN | Edit button v /assets/[id]           |
| `useCanManageTaxonomy()` | ASSET_MANAGER \| ADMIN | "+ Pridať" v /categories, /locations |
| `useCanDeleteTaxonomy()` | ADMIN                  | Delete buttons                       |
| `useCanAdminUsers()`     | ADMIN                  | Celú /users stránku                  |
| `useCanManageLoans()`    | ASSET_MANAGER \| ADMIN | Approve/reject v /loans              |

Client-side RBAC je len UX — server enforces vždy (Fastify `requireRole` middleware).

### Loans modul (Slice #4 finálna časť)

Po dokončení Slice #5 loans backendu sú k dispozícii 3 nové stránky:

**`/loans`** (`LoansContent`):

- EMPLOYEE: vidí vlastné žiadosti + cancel button
- ASSET_MANAGER/ADMIN: vidí všetky žiadosti tenantu + inline approve/reject
- Status filter (pill buttons): Všetky / PENDING / APPROVED / REJECTED / CANCELLED
- Reject = inline expandable form s `reason` field (min 5 znakov)
- Optimistic invalidation: po approve/reject/cancel sa refreshnú `loan-requests` + `assets` cache

**`/loans/request`** (`LoanRequestContent`):

- Asset browser s real-time search (filter na `inventoryNumber` + `name`)
- Basket systém (Add/Remove, max 50 položiek, ADR-0012 limit)
- `purpose` textarea + `plannedFrom`/`plannedTo` date inputs (HTML5 native, žiadna knižnica)
- Client-side validácia: `plannedFrom ≥ today`, `plannedFrom ≤ plannedTo`, `basket.length ≥ 1`
- On success: redirect na `/my-loans`
- Error surface: API error message verbatim (vrátane „Asset X nie je dostupný")

**`/my-loans`** (`MyLoansContent`):

- Sekcia **„Čakajúce žiadosti"** (GET `/v1/loan-requests?status=PENDING`) — zobrazí sa
  len keď existujú PENDING žiadosti; každý riadok má Zrušiť button
- Sekcia **„Výpožičky"** (GET `/v1/loans/my`) — tabuľka s isOverdue badge
  (lazy-computed server-side per ADR-0012), status color coding, dueAt highlight
- Empty state s CTA na `/loans/request`

## a11y — WCAG 2.1 AA highlights

- `<main id="main">` landmark vo všetkých stránkach cez AppShell
- `aria-live` regióny pre výsledkové stavy (assets list loading → count)
- `<th scope="col/row">` na všetkých semantických tabuľkách
- `aria-current="page"` na aktívnej nav položke
- `aria-label` na všetkých icon-only buttons (schváliť, zamietnuť, pridať, odstrániť)
- `role="alert"` na error paneloch, `role="status"` na success správach
- Skip link (`#main`) injektovaný cez `shared.js` (marketing site) — v `apps/web` riešené
  priamou landmark štruktúrou
- Keyboard navigation: všetky interaktívne elementy cez Tab, focus ring viditeľný
  (`focus-visible:ring-2 focus-visible:ring-border-focus`)

## Mobile responsive

- AppShell: hamburger `☰` (< md) → slide-in drawer s backdrop, auto-close pri route
  zmene (`usePathname()`), Escape key, backdrop klik
- Tabuľky: obalené v `overflow-x-auto` wrapper-i, horizontálny scroll na úzkych
  viewport-och
- Filter selects: `w-full sm:w-auto` — plná šírka na mobile, auto na desktop
- Pagination: arrow-only `‹ ›` na mobile (skryje number labels)
- Form grids: 2-stĺpcové date inputy sa na mobile stávajú 1-stĺpcovými

## Rozšírenia po 2026-05-20

### Dynamic Combobox + Číselníky (2026-05-29)

- `AssetCreateContent` + `AssetDetailEditForm` — `<select>` nahradené `<Combobox>` pre type/condition/category/location, `<TagsCombobox>` pre tags
- Zjednotená stránka `/ciselniky` so 4 záložkami (Kategórie · Lokality · Typy majetku · Stavy)
- Generická `TaxonomyTable` — inline rename (ceruzka), delete s FK protection

### Platform admin Tenants page (2026-05-29)

- `/admin/tenants` — viditeľná len pre ADMIN (platform operátori)
- List všetkých tenantov naprieč tenant boundary, filter by status/plan, client-side search
- Edit dialog (displayName, plán, status, kontaktný email)
- Create dialog s auto-generovaním slugu
- Soft-delete (archive) s confirm
- `organisations-hooks.ts` — TanStack Query hooks cez native fetch (nie openapi-fetch)
- 30 organisations integration testov

### Bugfixy (2026-05-29)

- MFA sessionStorage: `window.location.href` namiesto `router.push` — garantuje commit pred mountom MfaChallengePage
- Dashboard + login fix: backfill `organisationId` + `roles` v `loadCurrentUser` middleware (ADR-0015 deprecated fields)

## Vercel deploy — kľúčové lekcie

Kompletný battle log v `docs/sessions/2026-05-18-day-summary.md` sekcie 7-8.
Skrátený súhrn:

1. **Monorepo root build** — `vercel.json` musí mať `buildCommand: "cd ../.. && pnpm --filter @inventario/web build"`, nie defaultný framework build z `apps/web/` izolovane
2. **`engines.node` syntax** — v `apps/web/package.json` musí byť `"node": "22.x"`, nie `">=22"` (Vercel parsuje range-y inak ako npm)
3. **Stale UI overrides** — Vercel UI Build/Install Command override `null` neznamená "použiť vercel.json", ale "žiadny command". Explicitne vymaž a ulož
4. **Node.js version selector** — nastaviť na `22.x` v Vercel Project Settings (nie 20.x default)
5. **CORS + Atlas** — backend CORS allowlist musí mať `https://app.inventario.estate`; Atlas Network Access `0.0.0.0/0` (Vercel dynamic egress IPs)

Deploy guide: `infra/vercel/APP-DEPLOYMENT.md`

## CI

`pretypecheck`/`prelint`/`prebuild` lifecycle hooks v `apps/web/package.json`
automaticky regenerujú gitignored `api-types.ts` z `apps/api/openapi.json`.
Tým je `api-types.ts` vždy fresh v CI bez commitu.

Dependabot gating: `test` + `openapi` CI joby sú skipnuté pre dependabot PR-ky
(secrets policy). Quality job (lint/typecheck/build) beží vždy.

## Čo NIE JE v Slice #4

Vedome odložené:

| Feature                                            | Deferral                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Asset detail tabs (história / prílohy / výpožičky) | Až keď prídu audit + loans + attachments API routes                                |
| `/loans/:id` detail stránka                        | Slice #5b (s PDF protokolom)                                                       |
| Return/lost flow UI                                | Manager-initiated cez `/loans` (inline akcie), Slice #5b pre employee self-service |
| Loan extension request                             | Slice #5b                                                                          |
| QR scan pre pridanie asset-u do žiadosti           | Slice #5b                                                                          |
| Tailwind v4 migration                              | Post-pilot (tech debt, dependabot ignore hotový)                                   |

## Commit-y (chronologicky, výber)

| Commit       | Popis                                                    |
| ------------ | -------------------------------------------------------- |
| `0cac2e6`    | MSAL auth shell — AuthGate, AppShell, token middleware   |
| `77b51e8`    | Dashboard — stat cards, greeting, quick nav              |
| `a5e8b2e`    | /assets list page — pagination + filter/search           |
| `8766c93`    | CI infra fix — pretypecheck lifecycle hooks              |
| (2026-05-17) | /assets/[id] — detail + edit toggle + RBAC               |
| (2026-05-18) | /categories — CRUD + FK protection                       |
| (2026-05-18) | /locations — mirror categories patternu                  |
| (2026-05-18) | /users — ADMIN-only + guardrails                         |
| (2026-05-18) | Mobile responsive polish — drawer, tables, pagination    |
| (2026-05-20) | /loans + /loans/request + /my-loans — final 2 P0 stránky |

## Ďalšie kroky

### Pilot tenant onboarding

Inventario je **feature-complete pre MVP** — loans flow end-to-end funguje:
`/loans/request` → ASSET_MANAGER approve v `/loans` → `/my-loans` zobrazí
aktívnu výpožičku s dueAt + isOverdue badge.

Odporúčaný ďalší krok: **Pilot tenant onboarding** (Mesto Pezinok? ŠK Inter?
Stredná škola Kremnica?) per NEXT.md sekcia „Pilot tenant onboarding".

### Slice #5b (po pilot feedback)

- PDF protokoly HANDOVER/RETURN
- Multi-approver routing per `Category.approverIds`
- Predĺženie zápožičky
- OVERDUE cron + persistent flag

## Referencie

- [ADR-0010 — Multi-tenant white-label](../decisions/0010-multi-tenant-white-label.md)
- [ADR-0012 — Loans state machine](../decisions/0012-loans-state-machine.md)
- [Slice #5 milestone — Loans Backend MVP](slice-5-loans-mvp.md)
- [Phase D milestone — EU compliance](phase-d-eu-compliance.md)
- [NEXT.md continuation plan](../sessions/NEXT.md)
- [Vercel app deployment guide](../../infra/vercel/APP-DEPLOYMENT.md)
- [2026-05-18 day summary — deploy battle](../sessions/2026-05-18-day-summary.md)
- [2026-05-20 day summary — Slice #5 loans backend](../sessions/2026-05-20-day-summary.md)

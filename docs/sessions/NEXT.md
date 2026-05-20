<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Inventario · Continuation plan

> **Living document** — vždy aktuálny stav projektu, najbližšie kroky, technical debt.
> Pri novej Claude session si prečítaj **najprv toto**, potom najnovší day-summary.

**Aktualizované**: 2026-05-20 night (Slice #5 loans backend KOMPLETNÝ — 366 testov, 11 endpointov, ADR-0012, milestone doc)

---

## 🎯 Stratégia: B → C → D → E → A

Frontend (Slice #4) je posledný **zámerne**, aby sa minimalizovali prerábky. Logika:

- 🅱 **Design tokens** → definovať vizuálny jazyk **pred** tým, než ho frontend začne používať ✅ **DONE**
- 🅲 **OrganisationId migration** → stabilný API contract s tenant scoping **pred** frontend integráciou ✅ **DONE**
- 🅳 **EU compliance** (OpenAPI export, SBOM, WCAG, GDPR) → fundamenty pre type generation a verejný sektor ✅ **DONE**
- 🅴 **Tech debt cleanup** → posledný refresh pred veľkým kusom ✅ **DONE**
- 🅰 **Slice #4 frontend** → na zelenú lúku s čistým API, tokens, multi-tenancy in place ⬅ **5/6 P0 DONE** (login + dashboard + assets list+detail + categories + locations + users + mobile responsive; iba `/loans/request` + `/my-loans` blocked na Slice #5 backend)

---

## 🌐 Production stav — všetko LIVE

| URL                                        | Stav        | Posledný update | Stack                                          |
| ------------------------------------------ | ----------- | --------------- | ---------------------------------------------- |
| **inventario.sportup.sk**                  | ✅ LIVE     | 2026-05-17      | Static HTML/CSS/JS (Vercel)                    |
| **inventario.sportup.sk/interactive-demo** | ✅ LIVE     | 2026-05-17      | + 6 product mockups v iframe                   |
| **docs.inventario.sportup.sk**             | ✅ LIVE     | 2026-05-16      | Nextra v4.6.0 + Next.js 15.5                   |
| **api.inventario.sportup.sk**              | ✅ **LIVE** | **2026-05-18**  | Fastify + MongoDB Atlas + Vercel (Node 24 LTS) |
| **app.inventario.sportup.sk**              | ✅ **LIVE** | **2026-05-18**  | Next.js 15 + MSAL + Inventario branding        |

**Štyri Vercel projekty v `ltksolutions-projects` team** (všetky LIVE):

1. `inventario-marketing` → marketing site, Root: `docs/marketing-site`
2. `inventario-docs` → docs site, Root: `apps/docs`, custom build+install commands cez UI override
3. `asset-management-api` → backend Fastify, Root: `apps/api`, Node 24 LTS, CORS allowlist hotový
4. `inventario-app` → frontend Next.js 15, Root: `apps/web`, MSAL auth, Pro tier ($20/mes)

---

## 📦 Repo Architecture

```
Asset-Management/                    (root, pnpm monorepo, EUPL-1.2)
├── apps/
│   ├── api/                         → backend Fastify (production-ready, 327 tests)
│   ├── docs/                        → Nextra docs site
│   │   └── content/                 → 7 MDX stránok
│   ├── mcp-server/                  → MCP for AI (future)
│   └── web/                         → frontend Next.js 15 (slice #4 in progress: bootstrap + auth + dashboard + /assets + /assets/[id])
├── packages/
│   ├── design-tokens/               → @inventario/design-tokens (post-pivot v0.2.0)
│   │   ├── tokens.json              → W3C source of truth
│   │   ├── src/index.ts             → TypeScript exports
│   │   ├── src/tokens.css           → CSS vars (--inv-* prefix)
│   │   ├── src/tailwind-preset.js   → Tailwind preset
│   │   └── src/brand-kit.schema.json → per-tenant brand kit schema
│   └── shared-types/                → @inventario/shared-types (28 schém)
├── docs/
│   ├── marketing-site/              → Static HTML marketing (LIVE, WCAG 2.1 AA)
│   │   ├── interactive-demo.html    → 6 mockup viewer + aria-live announcements
│   │   ├── product-screens/         → 6 self-contained mockup HTML súborov
│   │   └── assets/shared.{css,js}   → Nav + footer injected do každej stránky
│   ├── design/screens/              → Design exploration (originály mockupov)
│   ├── decisions/                   → ADRs (0001-0010)
│   ├── compliance/                  → WCAG audit + GDPR Article 30 inventory
│   ├── milestones/                  → Phase + slice complete docs
│   └── sessions/                    → Session notes (toto)
├── infra/vercel/                    → Vercel deployment guides
└── scripts/
    └── copy-product-screens.sh      → Sync mockupy z design/ do marketing-site/
```

---

## ✅ Hotovo (history snapshot)

### Backend (Fastify + MongoDB)

- ✅ **Slice #1**: Bootstrap (Fastify + Mongo + TypeScript + pnpm)
- ✅ **Slice #2**: Microsoft Entra ID auth + JIT provisioning + JWKS
- ✅ **Slice #2b**: Assets CRUD + RBAC + audit + transactions (2026-05-13)
- ✅ **Slice #2c**: Tests + pre-commit + CI (100 testov, 2026-05-14)
- ✅ **Slice #3 K1-K9**: Categories + Locations + FK protection (2026-05-15, 257 testov, ~158s)
- ✅ **Slice #3 K10**: Users admin module — GET /v1/users, GET /:id, PATCH /:id (2026-05-16, +53 testov)
- ✅ **Slice #3 K11**: Milestone doc `slice-3-categories-locations-users.md` (2026-05-16, 310 testov total, ~168s)
- ✅ **Phase C COMPLETE** — Multi-tenant whitelabel backend (5 blokov, 2026-05-16). Milestone doc `docs/milestones/phase-c-multi-tenant-migration.md`. 327 testov green, 17 nových cross-tenant isolation testov, per-tenant unique indexes, JIT tenant provisioning, partial-filter indexes pre Organisation nullable fields
- ✅ **Phase D COMPLETE** — EU compliance foundations (4 bloky, 2026-05-17). Milestone doc `docs/milestones/phase-d-eu-compliance.md`
  - **D1**: OpenAPI 3.1 export + Swagger re-branding (commit `69d2092`)
  - **D2**: CycloneDX SBOM v CI (commit `0dc6ea0`)
  - **D3**: WCAG 2.1 AA baseline audit (commit `0e8ed9a`)
  - **D4**: GDPR Article 30 hardening + audit log polia (commit `d79233f`)
- ✅ **Phase E COMPLETE** — Tech debt cleanup (5 blokov, 2026-05-17). Milestone doc `docs/milestones/phase-e-tech-debt-cleanup.md`
  - **E1**: WCAG P1 marketing fixy (commit `9ed9521`) — `<main>` landmark, aria-hidden na SVG/emoji, `--brand-link` token (4.6:1 contrast), `.sr-only` utility, skip-link injection, broken footer link cleanup
  - **E2**: WCAG P2 marketing fixy (commit `6aeb578`) — `<span lang="en">` na anglické termíny, `aria-live` region v interactive-demo pre tenant/viewport announcements
  - **E3**: Shared-types exports + `isActive` boolean query bug (commit `c8ea924`) — nový `LocationType` enum, `UpdateCategorySchema` + `UpdateLocationSchema` exported, `BooleanQueryParam` helper. JSON schema 26 → 28
  - **E4**: Root metadata cleanup post-pivot (commit `8dffa49`) — package.json: SFZ → Inventario rebrand, MIT → EUPL-1.2, repo URL fix
  - **E5**: `audit.test.ts` flaky timeout (commit `4a98ec4`) — drop redundant `afterEach`, testTimeout 10s → 30s. 327 testov green v 212s

### Design system

- ✅ **Phase B — Design tokens refactor** (2026-05-16) — `@inventario/design-tokens` v0.2.0
  - 3-vrstvová architektúra: Primitive → Semantic → Brand
  - Post-pivot Inventario brand (Navy/Blue/Paper/Steel + status colors)
  - CSS custom properties s `--inv-` prefix
  - Dark mode v1 (opt-in cez `data-theme="dark"`)
  - TypeScript exports s plnou type safety
  - Tailwind preset (`@inventario/design-tokens/tailwind`)
  - JSON schema pre per-tenant brand kit
  - Multi-tenant override pattern `:root[data-tenant='X']`

### Frontend marketing + demo

- ✅ Marketing site (6 stránok) LIVE na inventario.sportup.sk, **WCAG 2.1 AA compliant** po Phase E
- ✅ Interactive demo (6 obrazoviek, 4 tenanty, 3 viewporty, aria-live announcements)
- ✅ Clean URLs (no `.html` suffixes, `/_home` bug fixed)
- ✅ Cache headers správne (5 min revalidate pre `shared.js/css`)
- ✅ Docs site Nextra deployed → `docs.inventario.sportup.sk`
- ✅ "Čoskoro" badge revertovaný — všetky docs linky active

### Slice #4 frontend (apps/web) — in progress

- ✅ **Bootstrap** — Next.js 15 + Tailwind + design tokens preset wired up
- ✅ **MSAL auth shell** (2026-05-17, commit `0cac2e6`) — Entra ID login/logout, openapi-fetch klient s token middleware, AuthGate / AppShell
- ✅ **Dashboard** (2026-05-17, commit `77b51e8`) — personalizovaný greeting z `/v1/me`, 4 stats cards (Majetok/Kategórie/Lokality/Výpožičky), quick navigation grid, TanStack Query api-hooks vrstva (`useMe`, `useAssets`, `useCategories`, `useLocations`)
- ✅ **`/assets` list page** (2026-05-17, commit `a5e8b2e`) — server-side pagination + client-side filter/search (status + free text), FK resolution cez `Map<id, summary>` O(1) lookup, accessible semantic `<table>` so `<th scope>` + `aria-live` výsledkový stav, page sizes 20/50/100, status badge tone mapping
- ✅ **CI infra fix** (2026-05-17, commit `8766c93`) — `pretypecheck`/`prelint`/`prebuild` lifecycle hooks v `apps/web/package.json` automaticky regenerujú gitignored `api-types.ts` z `apps/api/openapi.json`. CI #84 green.
- ✅ **`/assets/[id]` detail page** (2026-05-17) — toggle read/edit mode, react-hook-form s dirty-fields-only PATCH payload, HTML5 validation (shared schema je full `.partial()`, Zod resolver neviem chytiť required-blank), generic specs key-value table s `humanizeKey()`, RBAC cez `useCanEditAssets()` (EMPLOYEE read-only, ASSET_MANAGER+ADMIN môžu edit-ovať). Tabs (história zmien / prílohy / výpožičky) **odložené** kým nemáme audit + loans + attachments API endpointy.
- ✅ **Microsoft Entra ID setup completed** (2026-05-17 evening) — frontend SPA app registration + backend „Expose an API“ konfigurácia + `access_as_user` scope + pre-authorization frontend klienta. Login end-to-end funguje, JIT user + tenant provisioning sa rozbieha pri prvej návšteve.
- ✅ **`/categories` admin page** (2026-05-18) — list + tabuľka, FK protection error messaging surfaced verbatim cez `ConfirmDeleteDialog`, RBAC gating cez `useCanManageTaxonomy()` + `useCanDeleteTaxonomy()`. Build: 4.42 kB.
- ✅ **`/locations` admin page** (2026-05-18) — mirror `/categories` patternu, 6 `LocationType` enum hodnôt (WAREHOUSE/OFFICE/STADIUM/TRAINING_CENTER/EXTERNAL/IN_TRANSIT), rovnaké FK protection messaging. Build: 4.48 kB.
- ✅ **`/users` admin page** (2026-05-18) — ADMIN-only s AccessDenied state, server-side filter (role + isActive + free-text search debounced 300ms) + pagination, 5 ROLE_LABELS, dirty-diff patch, backend guardrails (no-self-demote, no-self-deactivate, last-active-admin) surfaced cez dialog footer. Build: 5.91 kB.
- ✅ **Mobile responsive polish** (2026-05-18) — AppShell hamburger menu + slide-in drawer s backdrop, auto-close cez `usePathname()` + Escape; tables `overflow-x-auto`; filter selects `w-full sm:w-auto`; paginácia arrow-only `<` `>` na mobile. Bonus: removed nested AppShell z `AssetDetailContent.tsx`.
- ✅ **CI dependabot gating** (2026-05-18) — `test` + `openapi` joby skipnuté pre dependabot PR-ky (GitHub bezpečnostná politika neexponuje secrets dependabot bot-im). Quality job (lint/typecheck/build) stále beží.
- ✅ **Dependabot inbox cleanup** (2026-05-18) — 3 PR-ky mergnuté (codeql-action v4, setup-node v6, minor-and-patch group s tsx + turbo + openapi-fetch 0.13.4→0.17.0), 2 PR-ky zatvorené (Tailwind 4 deferred, pnpm/action-setup v6 broken). Ignores pridané v `dependabot.yml`.

### Compliance + brand

- ✅ EUPL-1.2 + CC-BY-4.0 + REUSE 3.3 (272/272 súborov)
- ✅ Brand identity (Navy/Blue/Paper/Poppins), zdieľaná so SportUp ekosystémom
- ✅ ADR-0010 multi-tenant white-label
- ✅ WCAG 2.1 AA audit + remediation
- ✅ GDPR Article 30 inventory
- ✅ OpenAPI 3.1 spec ako repo artifact + CI freshness check
- ✅ CycloneDX SBOM weekly + per-PR

---

## 🎯 Next session — Slice #5 (loans backend) ALEBO pilot tenant onboarding ⬅ **PRÍŠTÍ KROK**

**Inventario je KOMPLETNE LIVE!** Všetky 4 subdomény fungujú v produkcii (marketing, docs, api, app). 10/10 smoke test PASS pre `app.inventario.sportup.sk` cez Microsoft Entra ID login + JIT provisioning + RBAC + mobile drawer + logout flow. ADMIN promote re-test OK (cez Mongo Atlas UI manuálne, kým nemáme prvého ADMIN tenantu).

### Voľba ďalšieho smeru

**A) Slice #5 — loans backend** (~3-5 dní práce)

Unblockne posledné 2 P0 frontend stránky (`/loans/request` + `/my-loans`). Detaily v sekcii "Po milestone doc — Slice #5" nižšie.

**B) Pilot tenant onboarding** (~1-2 týždne práce)

5/6 P0 stránok je dostatočné na onboarding prvého reálneho tenantu (Mesto Pezinok? Stredná škola Kremnica? ŠK Inter?). Loans môžu byť odložené ako Phase 2. Aktivity:

- Vybrať prvý pilot tenant
- Nakonfigurovať ich Entra ID app registration (pre-authorize na náš API)
- DPIA + GDPR Article 30 inventory finalizovať pre municipálny prípad
- Onboarding session (account setup, data import, training)
- Real-world feedback loop

**Odporúčanie:** B prv ako A. Slice #5 backend design (single vs multi-approver, notifikácie, delegácia) sa zlepší s real-world feedback z prvého pilotu. Loans môžu žiť 2-4 týždne ako manual process (Excel + email) v prvom pilote, mezitým build-neme správnu verziu.

**Krok 1-9 hotové (2026-05-18):** Kompletný 3.5-hodinový debug Vercel deploy story v `docs/sessions/2026-05-18-day-summary.md` sekciách 7-8 (Production Override locks, engines.node syntax, stale UI overrides, smoke test PASS).

### Pending — milestone doc Slice #4

Vytvoriť `docs/milestones/slice-4-frontend-web.md` (rovnaký pattern ako `phase-d-eu-compliance.md`) so:

- Zoznam 5 P0 stránok + build sizes + commit references
- Tech stack: Next.js 15, MSAL, openapi-fetch, TanStack Query, react-hook-form, Tailwind + design tokens
- a11y achievements: aria-live regions, semantic table headers, keyboard navigation, role labels
- Mobile responsive notes
- Vercel deploy guide (cross-link na `infra/vercel/APP-DEPLOYMENT.md`)
- Outstanding work: `/loans/request` + `/my-loans` (blocked na Slice #5)
- Vercel deploy battle lessons learned (Node 24 LTS, engines.node syntax, stale UI overrides)
- 10/10 smoke test PASS confirmation (link na day-summary)

Môže byť spravené v ďalšej session (nie kritické).

### Pre-deploy checklist (OLD — historický záznam pre rev-A debt, deploy je COMPLETED)

_Táto sekcia bola pôvodná čerstvá verzia z 2026-05-17 keď sme ešte nemali deploy guide ani vyčistené lekcie z Vercel battle. Zachovaná pre historickú referenciu — deploy bol úspešne dokončený 2026-05-18. Pre kompletný guide pozri `infra/vercel/APP-DEPLOYMENT.md`._

#### 1. `apps/web/vercel.json` config

```jsonc
{
  "framework": "nextjs",
  "buildCommand": "cd ../.. && pnpm --filter @inventario/web build",
  "installCommand": "cd ../.. && pnpm install --frozen-lockfile",
  "outputDirectory": ".next",
}
```

**Prečo monorepo-root build:** Turborepo cache + workspace dependencies (`@inventario/design-tokens`, `@inventario/shared-types`) sa musia vyriešiť z root-u, nie z `apps/web/` izolovane. Rovnaký pattern ako `inventario-docs` projekt.

#### 2. Vercel UI nastavenia (`inventario-app` projekt)

| Setting          | Hodnota                    |
| ---------------- | -------------------------- |
| Project Name     | `inventario-app`           |
| Team             | `ltksolutions-projects`    |
| Framework Preset | Next.js                    |
| Root Directory   | `apps/web`                 |
| Build Command    | (override z `vercel.json`) |
| Install Command  | (override z `vercel.json`) |
| Output Directory | `.next`                    |
| Node.js Version  | 22.x                       |

#### 3. Environment Variables (Production + Preview)

```
NEXT_PUBLIC_API_BASE_URL=https://asset-management-api.vercel.app
NEXT_PUBLIC_ENTRA_CLIENT_ID=<frontend SPA app registration client ID>
NEXT_PUBLIC_ENTRA_TENANT_ID=<organizations | <tenant-uuid>>
NEXT_PUBLIC_ENTRA_API_CLIENT_ID=<backend API app registration client ID>
NEXT_PUBLIC_ENTRA_API_SCOPE=api://<api-client-id>/access_as_user
```

**Pozor:** všetky `NEXT_PUBLIC_*` vars sú **embed-nuté v client bundle** — vidí ich každý kto si stiahne `.js` zo siete. To je OK pre Entra public client IDs (sú navrhnuté pre verejnú expozíciu), ale **žiadne secrets sem nikdy**.

#### 4. DNS — Cloudflare

- CNAME `app.inventario.sportup.sk` → `cname.vercel-dns.com`
- Proxy: **DNS only (sivý cloud)**, nie Cloudflare proxy — MSAL redirect flow nemá rád Cloudflare-mangled headers
- TTL: Auto (300s)

#### 5. Azure Portal — frontend SPA app registration

- **Authentication → Redirect URIs** → pridať: `https://app.inventario.sportup.sk`
- **Authentication → Front-channel logout URL** → `https://app.inventario.sportup.sk` (volitelné, pre clean logout)
- Necháme zachovaný `http://localhost:3001` pre dev work
- **Žiadne zmeny pre backend app registration** (Expose an API už je hotové z 2026-05-17)

#### 6. Backend CORS allowlist update

`apps/api/src/plugins/cors.ts` (alebo kde je `@fastify/cors` registered) musí mať `https://app.inventario.sportup.sk` v allowed origins list. Aktuálne tam pravdepodobne je iba `http://localhost:3001`. Aj `asset-management-api` Vercel projekt potrebuje ENV var update (alebo refactor na multi-tenant origin allowlist).

**Otvorená otázka:** chceme runtime-dynamic CORS (`ALLOWED_ORIGINS=app.inventario.sportup.sk,localhost:3001` env var split by comma) alebo hardcoded production allowlist v kóde? Runtime-dynamic je flexibilnejšie pre multi-tenant white-label (každý pilot môže dostať vlastnú subdoménu).

#### 7. Atlas Network Access

Production Vercel deployments majú **dynamic egress IPs** — nemôžeš whitelistovať. Buď:

- (A) `0.0.0.0/0` na Atlas Network Access (rovnaké ako dev cluster, akceptovateľné s strong auth)
- (B) Vercel Edge Config IP allowlist (Pro plan feature)
- (C) Atlas PrivateLink (Enterprise plan, nadbytočné pre pilot)

Návrh: **A** pre pilot, refactor na **B** ak doraneme na Pro plan.

#### 8. Smoke test po deploy

```
1. https://app.inventario.sportup.sk → vidí Login page
2. „Prihlásiť sa cez Microsoft" → Entra consent → redirect späť
3. /dashboard → vidí stats cards a personalizovaný greeting
4. /assets → list načítaný, paginácia funguje, filter/search funguje
5. /assets/[id] → detail loaded, edit toggle funguje, save patch funguje
6. /categories → list, Pridať dialog otvorí, create funguje
7. /locations → list, Pridať dialog otvorí, create funguje
8. /users → vidí AccessDenied ak nie ADMIN, alebo list ak je ADMIN
9. Mobile (Chrome DevTools narrow) → hamburger → drawer otvorí → navigation → drawer zatvorí
10. Logout → redirect na /login
```

Každý úspešný krok = ✅ commit s screenshot do `docs/sessions/2026-05-19-deploy-day-summary.md`.

### Po deploy — milestone doc

Vytvoriť `docs/milestones/slice-4-frontend-web.md` (rovnaký pattern ako `phase-d-eu-compliance.md`) so:

- Zoznam 5 P0 stránok + build sizes + commit references
- Tech stack: Next.js 15, MSAL, openapi-fetch, TanStack Query, react-hook-form, Tailwind + design tokens
- a11y achievements: aria-live regions, semantic table headers, keyboard navigation, role labels
- Mobile responsive notes
- Vercel deploy guide (cross-link na `infra/vercel/APP-DEPLOYMENT.md`)
- Outstanding work: `/loans/request` + `/my-loans` (blocked na Slice #5)
- Vercel deploy battle lessons learned (Node 24 LTS, engines.node syntax, stale UI overrides)

### Slice #4 finálne 2 P0 stránky — **ODBLOKOVANÉ** ✅

Slice #5 backend je kompletný. Tieto dve stránky sú teraz odblokované:

- **`/loans/request`** — formulár pre novú žiadosť (asset multi-select + purpose + dátumy)
- **`/my-loans`** — zoznam vlastných zápožičiek s `isOverdue` badge-om

Po dokončení je Slice #4 formálne uzavretý (viď `docs/milestones/slice-4-frontend-web.md` pending).

---

## 🐛 Technical debt

Tracked pre eventuálnu cleanup session. Po Phase E je toto už značne zoštíhlený zoznam:

### Z 2026-05-18 night — post-deploy polish

- **MSAL logout flow ukáže Microsoft account picker namiesto rovno redirect na `/login`** — pri kliku "Odhlásiť sa" v aplikácii MSAL pošle `oauth2/v2.0/logout` request, ale Microsoft Entra ID zobrazí intermediate "Vybrať konto · Z ktorého konta sa chcete odhlásiť?" obrazovku namiesto okamžitého redirect-u na `postLogoutRedirectUri`. Toto je MSAL multi-account default behavior. Fix: pridať `logoutHint` parameter do `logoutRedirect()` call-u v `apps/web/src/components/AppShell.tsx` (alebo kde je logout handler):

  ```typescript
  const account = msalInstance.getActiveAccount();
  await msalInstance.logoutRedirect({
    account,
    postLogoutRedirectUri: window.location.origin + '/login',
    logoutHint: account?.idTokenClaims?.login_hint ?? account?.username,
  });
  ```

  `logoutHint` je opaque string ktorý Entra ID povie "odhlasujeme tohto konkrétneho usera" → preskočí account picker → straight redirect na `/login`. Detekovaný v Krok 9 smoke testu 2026-05-18 (sekcia 10 logout). Nie deploy blocker, ale UX rough edge pre pilot tenants. ~10 minút work + commit + Vercel auto-deploy.

### Z 2026-05-18 — strategic deferrals

- **Tailwind v4 migration** ⏰ POST-PILOT — Tailwind 4 je major architektonický shift (CSS `@theme` namiesto JS preset, `@tailwindcss/postcss` premenované, browser support cut na Safari 16.4+ / Chrome 111+ / Firefox 128+ z Mar 2023). Náš `@inventario/design-tokens` v0.2.0 má **62 token mappings** v `src/tailwind-preset.js` a multi-tenant override pattern `:root[data-tenant='X']` priamo závisí od JS preset run-time merge-u. Refactor vyžaduje:
  - [ ] Rewrite 62 mappings do CSS `@theme` block (Primitive → Semantic → Brand)
  - [ ] Migrácia tenant override mechanizmu (zatiaľ nejasné ako to funguje v `@theme`-based world — testovať)
  - [ ] Re-test contrast pre `brand-kit.schema.json` (per-tenant validator)
  - [ ] **Browser support audit pre pilot tenants** — Mesto Pezinok, ŠK Inter, Stredná škola Kremnica — overiť že ich users majú Safari 16.4+ / Chrome 111+ / Firefox 128+. Realisticky public sector môže mať starší legacy stack (IE11 už nie, ale Safari 14 na starých iPad-och, Chrome 100 v Windows 8.1 stations)
  - [ ] Update `@tailwindcss/postcss` plugin v `postcss.config.js` všetkých Next.js apps
  - [ ] Run full visual regression — všetkých 6 product screenov + interactive demo + apps/web

  Dependabot ignore pridaný (`tailwindcss` semver-major + `@tailwindcss/*` ecosystem-wide) v `dependabot.yml`. Tracking commit: `chore(deps): defer Tailwind v4 major bump until post-pilot`.

- **`pnpm/action-setup` v6 bumps** ⏰ INDEFINITE — známe bugy s pnpm version detection (pnpm/action-setup#225, #227, #228) — ignoruje pinned `version: 9.12.0` input, inštaluje pnpm v11, láme `pnpm install --frozen-lockfile` s `ERR_PNPM_BROKEN_LOCKFILE`. Dependabot ignore pridaný (`pnpm/action-setup` semver-major) v `dependabot.yml`. Re-evaluovať pri v7 alebo keď sa upstream issues uzavrú.

- **Mobile-first konvencia v frontend-design** — Slice #4 stránky boli desktop-first, polish refactor 2026-05-18 trval ~2h. Nabudúce: dokumentovať mobile-first patterny do skill-u alebo NEXT.md (např. tabuľky vždy v `overflow-x-auto` wrapper-i, filter selects `w-full sm:w-auto` ako default, pagination arrow-only na mobile).

### Z Phase E — deferred (nie urgentné)

- **`marketing-site/shared.css`** migrate `--brand-*` → `@inventario/design-tokens/tokens.css` — marketing site funguje samostatne so svojimi inline CSS vars; migration na shared package je čistá konsolidácia bez user-facing benefitu. Robí sa keď budeme upravovať tokens.css beztak
- **`AssetUpdatePatch / CategoryUpdatePatch / LocationUpdatePatch types`** type-narrow cez `Pick` — schema layer (Zod) už blokuje mutation `organisationId`, type-level narrowing je estetické vylepšenie pre IDE autocomplete
- **`apps/docs/vercel.json`** UI override migration — **closed/non-issue**: `vercel.json` už obsahuje len headers, žiadny UI override netreba migrovať (Build Command / Install Command pre docs sú prázdne v UI, čo je rovnaké ako neuvedené v vercel.json)

### Z 2026-05-17 Slice #4 launch — defensive coding hardening

- **`auth.ts` `loadCurrentUser` legacy user defense** — keď `findOrProvision` vráti existujúceho usera, jeho `organisationId` field môže byť `undefined` (pre-Phase-C legacy record). Aktuálne sa to silently pretlačí do service vrstvy, ktorá neskôr padne s `Malformed organisationId "undefined"`. Defensive check by mal priísť priamo do `loadCurrentUser`: ak `user.organisationId !== request.organisationId`, vyhodiť `UnauthorizedError('User record is missing tenant binding — re-provision required')`. Chytí legacy records pri zdroji s jasnou message namiesto silent corruption v service layer-i. Detaily v `docs/sessions/2026-05-17-day-summary.md` (Krok 4 večerného debug-u)
- **`db:reset` skript** — dôležitý pre dev workflow po veľkých migration-och. Aktuálne sa legacy records musia mažať manuálne cez Mongo Atlas UI. Pridanie `apps/api/scripts/db-reset.ts` ktorý vymaže user + organisation collections pre dev DB by zlepšilo iteráciu

### Z Phase D — GDPR retention infra (Slice #5)

- **Audit log retention job** — automatická pseudonymizácia po 24/60/84 mesiacoch. Vercel cron entry + script ktorý rewritne `actor.userId/displayName/ipAddress` na `'PSEUDONYMIZED'` placeholder a vyplne `pseudonymizedAt`
- **Audit log read API** — ADMIN-only `/v1/audit-logs` endpoint pre tenant administrátorov. Tenant-scoped (`AuditLogRepository` už nemá read paths, treba doplniť). Filtre na `action`, `severity`, `actor.userId`, time range, `legalBasis`, `dataCategories`
- **DSAR endpointy** — `GET /v1/me/export` (Art. 15 + 20), `DELETE /v1/me` self-service (Art. 17 s 30-day grace period)
- **Audit log backfill skript** — voliteľný, doplne `legalBasis` + `dataCategories` na pred-Phase-D rows. Použije ten istý `defaultLegalBasisFor()` + `defaultDataCategoriesFor()` mapping ako service layer

### Z Phase D — EU compliance docs (post-launch)

- **DPIA template** `docs/compliance/dpia-template.md` pre municipálne tenants pred prvým produkčným launchom
- **Threat model (STRIDE)** `docs/compliance/threat-model.md`
- **Conformity assessment** (CE marking pod CRA) keď zaintegrujeme AI features (MCP server s Claude)

### Pre-Phase-D debt (stále platný, malé)

- **`PENDING_TENANT_ID` placeholder** stále existuje v `lib/organisation-scoping.ts` ako exported konštanta, ale od Phase C Blok 3 sa už nikdy nezapisuje. Po production migration je možné konštantu úplne odstrániť zo `src/lib/` (alebo nechať pre forensic queries — "ktoré rows boli pre-Blok-3")
- **AuditLogRepository nie tenant-scoped** — zámerne nezmenené v Phase C. Read paths zatiaľ nemáme — keď príde admin audit endpoint v Slice #5, vtedy doplne tenant-scoping aj sem

---

## 🔮 Future ideas (long-term)

- **Onboarding wizard** s info iconmi linkujúcimi na docs
- **In-app chatbot** nad docs + MCP server (Claude Code style)
- **Public GitHub repo** (preklopiť z private)
- **Annual contract paperwork** pre verejný sektor (DOCX template + e-podpis)
- **Pilot tenant onboarding** — Mesto Pezinok? Stredná škola Kremnica? ŠK Inter?
- **Founding customer rabat** -25% prvý rok výmenou za case study súhlas

---

## 📚 Kde nájsť konkrétne info

| Téma                             | Súbor                                                    |
| -------------------------------- | -------------------------------------------------------- |
| Multi-tenant architecture        | `docs/decisions/0010-multi-tenant-white-label.md`        |
| Brand identity                   | `BRAND.md` (root)                                        |
| Design tokens package            | `packages/design-tokens/README.md`                       |
| OpenAPI spec                     | `apps/api/openapi.json`                                  |
| WCAG 2.1 AA audit                | `docs/compliance/wcag-2.1-aa-audit.md`                   |
| GDPR Article 30 inventory        | `docs/compliance/gdpr-article-30.md`                     |
| Roadmap                          | `ROADMAP.md` (root)                                      |
| Pricing strategy                 | `docs/sessions/2026-05-15-pricing-strategy.md`           |
| Design pivot history             | `docs/sessions/2026-05-15-design-pivot.md`               |
| Phase C session                  | `docs/sessions/2026-05-16-day-summary.md`                |
| Slice #4 launch + CI debug       | `docs/sessions/2026-05-17-day-summary.md`                |
| Slice #4 dokončenie + dependabot | `docs/sessions/2026-05-18-day-summary.md` ← **NEW**      |
| Vercel docs deploy guide         | `infra/vercel/DOCS-DEPLOYMENT.md`                        |
| All Vercel projects              | `infra/vercel/README.md`                                 |
| Backend slice completion logs    | `docs/milestones/`                                       |
| Latest milestone (Phase E)       | `docs/milestones/phase-e-tech-debt-cleanup.md` ← **NEW** |
| Previous milestone (Phase D)     | `docs/milestones/phase-d-eu-compliance.md`               |
| Phase C milestone                | `docs/milestones/phase-c-multi-tenant-migration.md`      |
| Slice #3 milestone               | `docs/milestones/slice-3-categories-locations-users.md`  |

<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Changelog

Všetky významné zmeny v projekte sú zaznamenané v tomto súbore.

Formát vychádza zo štandardu [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), verziovanie podľa [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Detail majetku — Audit log, Prílohy/foto, QR/štítky (2026-06-10)**:
  - `appBaseUrl` a verejný „lost & found" lookup (`publicAssetLookup`) nastaviteľné v Organizácia → QR kódy a štítky; `resolveAppBaseUrl` fallback (per-tenant → env `APP_BASE_URL` → default) odstránil 409 pri QR/štítkoch.
  - **Audit log** na detaile majetku — `GET /v1/assets/:id/audit` (ASSET_MANAGER/ADMIN) + UI časová os zmien; `AuditLogRepository.findByTarget/countByTarget`.
  - **Prílohy a foto majetku** — nový attachments modul (Vercel Blob): `POST/GET /v1/assets/:id/attachments`, `DELETE /v1/attachments/:id`, `PATCH /v1/attachments/:id/primary`; upload (PNG/JPEG/WEBP/PDF, max 20 MB), galéria, hlavné foto na hero karte (`Attachment.isPrimary`).
  - **Auth-aware QR sken** — prihlásený člen tenanta → interný detail majetku (`GET /v1/assets/by-token/:publicToken`); neprihlásený → verejná stránka len s organizáciou a kontaktom na vrátenie (bez identity majetku).
- **6 P0 design mockupov** (`docs/design/screens/`) — plne interaktívne high-fidelity HTML mockupy všetkých kritických obrazoviek aplikácie:
  - `01-login.html` — multi-tenant login s brand switcher-om a Microsoft SSO
  - `02-dashboard.html` — role-aware dashboard (Employee/Manager/Admin views)
  - `03-assets-list.html` — live search + filtre + grid/table toggle
  - `04-asset-detail.html` — 5 tabs, real QR kód, diff audit log, vertikálna timeline
  - `05-loan-request.html` — 3-step wizard + conflict detection + success state
  - `06-my-loans.html` — user-first tabs (Active/Pending/History) s due date urgency
  - `index.html` — landing page so 6 screen cards pre prezentáciu
- **4 demo tenanti** s vlastnými brand identitámi cez CSS custom properties (Inventario default, ŠK Inter, Mesto Pezinok, SŠ Kremnica), 48 unique demo assets celkovo.
- **Marketingový web** (`docs/marketing-site/`) — 5 stránok pre verejnú prezentáciu projektu:
  - `_home.html` — Hero, Pre koho, Ako to funguje, Prečo Inventario, Možnosti nasadenia, SSO
  - `_use-cases.html` — 6 detailných use cases (zväzy, mestá, VÚC, kluby, školy, NGO)
  - `_pricing.html` — hybrid C pricing (5 tierov + Annual Contract pre verejný sektor)
  - `_technology.html` — tech stack + bezpečnosť + EU compliance
  - `_about.html` — príbeh, timeline, SportUp ekosystém, team
  - `index.html` — demo wrapper s viewport switcher-om (375/768/1280)
- **Shared marketing assets** — `shared.css` (design system, ~430 riadkov), `shared.js` (auto-injekt nav + footer modul s mobile menu).
- **Brand System v1.0**:
  - `BRAND.md` — comprehensive brand guide (~600 riadkov, 11 sekcií: filozofia, logo, palety, typografia, pattern, copywriting, multi-tenant whitelabeling, forks)
  - `docs/assets/brand/inventario/` — 4 SVG varianty (logo, logo-container, logotype, pattern)
  - `docs/marketing-site/assets/favicon.svg` — browser tab icon
  - CSS pattern systeme (`.hero-gradient::after`, `.pattern-bg`, `.pattern-bg.pattern-dark` utility classes)
  - Aktualizovaný `docs/assets/brand/README.md` pre Inventario brand identitu
- **Pricing strategy v1.0**:
  - Hybrid C model implementovaný na webe (Free a Pro Small s konkrétnymi cenami: 0 €, 29 €/mes alebo 290 €/rok)
  - 3 vyššie tieri s indikatívnymi cenami a Kontakt CTA (Pro Standard od 79 €, Pro Plus od 199 €, Enterprise od 4 990 €/rok)
  - **Annual Contract model** pre verejný sektor (Malá 890 €, Stredná 2 490 €, Veľká 5 990 €, XL od 12 000 €/rok)
  - Komplet comparison tabuľka 4 stĺpce
  - 8 FAQ otázok pre verejné prípady
  - **Interný Sales playbook** (`docs/sessions/2026-05-15-pricing-strategy.md`, ~700 riadkov): princípy cenotvorby, sanity check vs konkurencia, námietky a odpovede, 5 case studies (Pezinok, Inter, Kremnica, BSK, mládežnícky futbalový klub)
- **Open Graph + Twitter Card meta tags** v `_home.html` pre social media preview.
- **Favicon link** vo všetkých 6 marketingových HTML súboroch (`<link rel="icon" type="image/svg+xml">`).
- **Session dokumentácia**:
  - `docs/sessions/2026-05-15-day-summary.md` — komplet prečlad celej session s metrikami a lessons learned
  - `docs/sessions/NEXT.md` — continuation plan pre budúce sessions (súčasný stav, najbližšie kroky, long-term ideas, technical debt, EU compliance roadmap)
  - `docs/sessions/2026-05-15-pricing-strategy.md` — interná cenová stratégia (pre Sales)
  - `docs/sessions/README.md` — session index s konvenciami
- **Deploy príprava (A-B-C dokumentácia)**:
  - `docs/marketing-site/og-image.html` — OG image template 1200×630 s hero gradient + brand pattern + logo + tagline + trust badges
  - `docs/marketing-site/assets/README.md` — návod ako vygenerovať `og-image.png` cez Chrome DevTools / Playwright / Puppeteer
  - `infra/vercel/marketing-site.vercel.json` — template config (clean URLs, security headers, cache control)
  - `infra/vercel/DEPLOYMENT.md` — krok-po-kroku deploy guide (Dashboard + CLI variants)
  - `infra/vercel/DNS-SETUP.md` — DNS konfigurácia pre Cloudflare / Webglobe / Websupport / iine providers
  - `infra/vercel/README.md` — index pre `infra/vercel/` priečinok

### Changed

- Verejný open-source release pod názvom **Inventario** — multi-tenant white-label platforma pre športové zväzy, mestá a obce, VÚC, kluby, školy a neziskové organizácie.
- Licencia zmenená z MIT na **EUPL-1.2** (zdrojový kód) + **CC-BY-4.0** (dokumentácia) — pripravené pre EU verejný sektor a EU rozvojové fondy.
- Brand identita prevzatá z [SportUp ekosystému](https://github.com/ltksolutions/sportup.sk) — Navy `#1A2D47`, Blue `#388FC3`, Paper `#F8F6F1`, font Poppins.
- README.md kompletne prepísaný — Inventario branding, link na `BRAND.md`, Founding contributors sekcia.
- `REUSE.toml` rozsírený — `BRAND.md` registrovaný pod CC-BY-4.0, REUSE compliance ostal 100 % (175/175 súborov).
- `docs/assets/brand/README.md` prepísaný — odráža Inventario brand identitu.

### Added (compliance & infrastructure)

- ADR-0010: Multi-tenant white-label architektúra (logical multi-tenancy + open-source fork stratégia).
- ADR-0011: Open-source licensing — EUPL-1.2 + CC-BY-4.0 + REUSE 3.3 compliance.
- `LICENSE-DOCS` (CC-BY-4.0 plný text) pre dokumentáciu.
- `LICENSES/CC-BY-4.0.txt` (REUSE 3.3 konvencia).
- `REUSE.toml` — centrálne licenčné mapovanie podľa REUSE 3.3 špecifikácie.
- `CITATION.cff` — citačné metadata pre verejné a vedecké inštitúcie.
- `CHANGELOG.md` — tento súbor (Keep a Changelog formát).
- `docs/sessions/2026-05-15-design-pivot.md` — plán strategickej design session.

### Fixed

- **Preberací protokol PDF** — `serialNumber` a `category` sa už správne zapisujú do snapshotu (predtým hardcoded `null`/`''`); podpísané protokoly ostávajú nemenné.
- **PDF štítok 500** — `renderLabelSheetPdf` embedoval logo natvrdo `embedPng`; JPEG tenant logo → výnimka. Teraz detekcia magic bytes → `embedJpg`/`embedPng` (rovnaký bug ako kedysi v protokole).
- **Boot 500 `FST_ERR_CTP_ALREADY_PRESENT`** — `@fastify/multipart` registrovaný dvakrát (logo + prílohy); teraz raz globálne v `server.ts`.
- **QR náhľad prázdny** — `<img src>` pri cross-origin neposlal auth cookie; načítava sa cez credentialed fetch (blob URL).
- Marketingová navigation — hamburger menu sa teraz zobrazuje aj na tablete (768 px), nielen na mobile (375 px). Pridané breakpointy: 1100 px (nav-links → hamburger), 700 px (skry nav-right items), 480 px (skry brand tag).
- Nav-links text wrap fix — `white-space: nowrap` aby sa "Pre koho" / "O projekte" nezalamovali na viácero riadkov pri stredných breakpoint-och.
- Logo upgrade — jednoduché písmeno "I" nahradené plnohodnotným SVG (3 horizontálne čiary klesá sa šírkou + modrý accent dot). Použité v nav, footri a favicon.

## [0.3.0] — 2026-05-14 — Slice #3 (čiastočne)

### Added

- **Categories modul** — hierarchická správa kategórií majetku.
  - CRUD endpointy s RBAC (GET pre EMPLOYEE+, POST/PATCH pre ASSET_MANAGER+, DELETE pre ADMIN).
  - Automatické generovanie slug-ov z mien (s podporou slovenčiny — diakritika sa transliteruje).
  - Hierarchia s detekciou cyklov a max hĺbkou 5 úrovní (root + 4 nested).
  - Audit log s typmi CATEGORY_CREATED/UPDATED/DELETED.
- **Locations modul** — hierarchická správa lokácií majetku (rovnaký pattern ako categories).
- **FK protection (K7)** — assets nemôžu byť vytvorené/updatnuté s neexistujúcim `categoryId` alebo `locationId`.
- **FK protection (K9)** — categories/locations nemôžu byť deletnuté ak na nich nezávislé (non-deleted) assets ukazujú.
- **Slugify utility** (`src/lib/slugify.ts`) — Unicode NFD-based transliterácia, dedikované unit testy.
- **Hierarchy utility** (`src/lib/hierarchy.ts`) — cycle detection + max depth check pre CREATE aj PATCH operácie.
- **Test helper `seedAssetFkRefs`** — vytvorí real category + location pre asset testy.
- **257 integration testov** pokrývajúcich celý backend (vrátane FK protection, audit, RBAC).

## [0.2.0] — 2026-05-13 — Slice #2c

### Added

- **CI Atlas** integration tests — testy bežia proti reálnej MongoDB Atlas dev instancii pri každom PR.
- **Pre-commit hooks** — Husky + lint-staged + TypeScript typecheck pred každým commit-om.
- **Atlas dev cluster** (`sfz-asset-mgmt-dev`) + production cluster (`sfz-asset-mgmt-prod`).
- **Milestone dokument** `docs/milestones/slice-2c-tests-and-pre-commit.md`.

## [0.1.5] — 2026-05-12 — Slice #2b

### Added

- **Assets modul** — kompletný CRUD s RBAC, audit log, MongoDB transactions, soft-delete.
- **Inventory number generator** — automatické generovanie sekvenčných čísel `PREFIX-YYYY-NNN`.
- **AuditLogService** — append-only kolekcia s ActorContext, target referencom a JSON diff-om zmien.

## [0.1.0] — 2026-05-10 — Slice #2

### Added

- **Microsoft Entra ID autentifikácia** — JWT verifikácia s JWKS rotáciou.
- **JIT user provisioning** — pri prvom prihlásení sa user automaticky pridá do DB.
- **RBAC matrix** — UserRole enum (EMPLOYEE, ASSET_MANAGER, ADMIN).

## [0.0.1] — 2026-05-09 — Slice #1 (Backend bootstrap)

### Added

- pnpm monorepo s Turborepo (apps/api, apps/web, apps/mcp-server, packages/shared-types, packages/design-tokens).
- Fastify backend skeleton (TypeScript, Vitest, ESLint, Prettier).
- MongoDB Atlas Flex tier setup + Native driver + Zod schema validation.
- Conventional Commits + commitlint + Husky.
- ADR-čká 0001-0005 (monorepo, MongoDB, Entra ID, native driver) + 0009 (Fastify nahrádza NestJS).

---

[Unreleased]: https://github.com/ltksolutions/inventario/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/ltksolutions/inventario/releases/tag/v0.3.0
[0.2.0]: https://github.com/ltksolutions/inventario/releases/tag/v0.2.0
[0.1.5]: https://github.com/ltksolutions/inventario/releases/tag/v0.1.5
[0.1.0]: https://github.com/ltksolutions/inventario/releases/tag/v0.1.0
[0.0.1]: https://github.com/ltksolutions/inventario/releases/tag/v0.0.1

<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Changelog

Všetky významné zmeny v projekte sú zaznamenané v tomto súbore.

Formát vychádza zo štandardu [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), verziovanie podľa [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Prílohy do privátneho úložiska, náhľady a podpísané odkazy (2026-09-02,
  ADR-0037)** — originály príloh idú do private Blob storu
  `inventario-private` (iad1), kde každé čítanie vyžaduje autentifikáciu.
  Session log: `docs/sessions/2026-09-02-object-storage-fazy-2-5.md`.
  - **`GET /v1/attachments/:id/thumbnail`** — náhľad (800 px, JPEG) uložený
    ako BinData v dokumente. Výpis majetku tak nepotrebuje podpísanú URL
    ani plný prenos originálu pri každej fotke. Náhľad sa nikdy nedostane
    do JSON odpovede — vylučuje ho projekcia a stráži samostatný test.
  - **`POST /v1/attachments/:id/download`** — podpísaná URL s krátkou
    expiráciou. Staré prílohy (`storageAccess: PUBLIC_LEGACY`) sa naďalej
    servírujú pôvodnou verejnou URL, obe cesty bežia súbežne.
  - **`POST /v1/assets/:id/attachments/upload-url` + `confirm`** — priamy
    upload do storu mimo funkcie, strop 25 MB namiesto 4 MB. Server pri
    `confirm` overí obsah z magic bytes, odstráni EXIF a vyrobí náhľad.
    Web nahráva touto cestou; keď úložisko beží v stub režime (lokálne bez
    tokenu), padá späť na pôvodnú multipart cestu so stropom 4 MB.
  - **`GET /v1/public/organisations/:slug/logo`** — verejný, CDN-cachovaný
    endpoint. Logo tenanta je teraz BinData v `brandKit.logo`, teda ide do
    zálohy spolu s tenantom; `brandKit.logoUrl` ukazuje sem.
  - **Migrácia `2026-09-02-attachments-to-private-blob`** — prenos
    existujúcich príloh a lôg. Staré objekty v Blobe zostávajú: migrácia
    sa nedá vrátiť, po prepnutí ich starý kód neprečíta.
  - **Nová premenná `PUBLIC_API_BASE_URL`** a druhý Blob token
    `BLOB_PRIVATE_READ_WRITE_TOKEN` (prefix `BLOB_PRIVATE`, aby
    nekolidoval s tokenom starého public storu).

### Fixed

- **Logo sa nezobrazovalo cez `<img>` z inej domény (2026-09-02)** — helmet
  dáva globálne `Cross-Origin-Resource-Policy: same-origin`, takže verejný
  logo endpoint na `api.*` by appka na `app.*` nenačítala. Routa teraz
  posiela `cross-origin`. Pri starých Blob URL to nevadilo, tie CORP
  hlavičku nemali.
- **CI nekontrolovalo `docs/api/openapi.yaml` (2026-09-02)** — pre-commit
  hook regeneroval len `openapi.json` a workflow `docs.yml` sa spúšťa iba
  pri zmene v `docs/**`, takže zmena zdrojáku API nikdy nespustila
  Redocly. Kontrola čerstvosti YAML je teraz v `ci.yml` a hook dopĺňa oba
  súbory.

### Changed

- **Odstránené „sfz" z kódu, schém, infra a testov (2026-09-01)** — „sfz"
  je názov pilotného zákazníka, nie produktu. Migrácia
  `2026-09-01-drop-sfz-naming`. Session log:
  `docs/sessions/2026-09-01-sfz-naming-a-limit-uploadu.md`.
  - **`attachments.bucket` zrušené celé** — Vercel Blob buckety nemá,
    hodnota `'sfz-asset-attachments'` sa zapisovala natvrdo a nikto ju
    nečítal; `'sfz-asset-protocols'` sa nezapísalo ani raz.
  - **`affiliation.type`: `SFZ_DEPARTMENT` → `ORG_DEPARTMENT`**
    v `memberships` a `users` (v produkcii 0 dotknutých dokumentov).
  - **`GET /` vracalo `{ name: '@sfz/api' }`** — verejná odpoveď API,
    teraz `@inventario/api`. Docstringy hovorili `@sfz/shared-types`,
    pričom balík sa volá `@inventario/shared-types`.
  - Príklady v hláškach a placeholderoch neutralizované (prefix `"INV"`,
    domény `firma.sk`), infra kontejnery a volumes na `inventario-*`,
    testovacia DB `inventario_test`, test JWT issuer a kid.
- **Limit uploadu príloh 20 MB → 4 MB (2026-09-01)** — Vercel stráži
  4,5 MB na telo requestu aj odpovede a request nad limit zahodí s 413
  ešte pred funkciou. Overené na produkcii: 6 MB → 413, 1 KB → 401.
  Súbory nad 4,5 MB teda nikdy nefungovali a používateľ dostal hrubú 413
  namiesto našej hlášky. Cesta k väčším súborom je ADR-0037.
- **Konvencie repa a prevádzkové dokumenty (2026-09-01)** — pridané
  `CLAUDE.md` (konvencie repa), `ARCHITECTURE.md` (mapa kódu — hranice
  balíkov, vrstvy API, tok requestu, multi-tenancy) a `RUNBOOK.md` (deploy,
  rollback, cron joby, incidenty). Odkazy doplnené do `README.md`,
  licenčná metadata do `REUSE.toml` (root dokumenty ju majú tam, nie
  inline). Session log: `docs/sessions/2026-09-01-konvencie-a-runbook.md`.
- **`.env.example` zosynchronizovaný s `plugins/config.ts`** — mal
  `API_PORT`, `JWT_SECRET` a `STORAGE_*` (MinIO/Azure/S3), ktoré Zod schéma
  nepozná, a nemal `PORT`, `MIGRATIONS_SECRET`, `CRON_SECRET`,
  `WEBAUTHN_*`, `MFA_*`, `OAUTH_*`, `ENABLE_SWAGGER`, `FRONTEND_BASE_URL`,
  `BLOB_READ_WRITE_TOKEN` ani `NEXT_PUBLIC_*`. Podľa starej verzie sa
  projekt nedal rozbehať. Každý kľúč má teraz označené, či je povinný,
  alebo či bez neho endpoint vracia 503.
- **`NEXT_PUBLIC_*` doplnené do `turbo.json` → `globalEnv` (2026-09-01)** —
  neboli tam ani v `tasks.build.env`, takže po zmene
  `NEXT_PUBLIC_API_BASE_URL` mohlo Turborepo vrátiť cache hit so starou
  hodnotou zapečenou do buildu.
- **MinIO odstránený z lokálnej infraštruktúry (2026-09-01)** — služby
  `minio` a `minio-setup`, volume `sfz-minio-data` a `MINIO_ROOT_*` von.
  Žiadny kód ho nepoužíval, object storage ide cez Vercel Blob (ADR-0028);
  `minio-setup` len pri každom štarte vytváral prázdne buckety. Lokálne
  prostredie je o dva kontejnery menšie.
- **OpenAPI dokument ukazuje na produkčné domény** — `plugins/swagger.ts`
  malo v `servers`, `externalDocs` a `contact` ešte
  `*.inventario.sportup.sk` a popis „Production (planned Q3 2026)".
  Teraz `api.inventario.estate` / `docs.inventario.estate`. Poradie
  serverov je podmienené prostredím: lokálne je prvý `localhost`, aby
  „Try it out" v Swagger UI nemieril na produkciu, v exportovanom
  dokumente je prvá produkcia.

- **Chybové odpovede v OpenAPI a jednotný tvar chybového tela (2026-09-01)** —
  Redocly warningy **103 → 5**, `operation-4xx-response` **95 → 0**,
  operácie bez akejkoľvek 4xx odpovede **97 → 0**. Session log:
  `docs/sessions/2026-09-01-openapi-chybove-odpovede.md`.
  - **Opravené orezané chybové telo na `GET /v1/public/organisations/login-context`.**
    Lokálna schéma `400: z.object({ message })` spôsobovala, že serializér
    (`fastify-type-provider-zod`) z odpovede zahodil `statusCode` aj `error` —
    klient dostal len `{ message }`. Response schéma nie je len dokumentácia,
    Fastify podľa nej odpoveď serializuje.
  - **Jedna zdieľaná schéma chybovej odpovede** (`lib/error-response.ts`,
    OpenAPI komponent `#/components/schemas/ErrorResponse`) nahradila lokálne
    `NotFoundSchema` v `public-assets.routes.ts` a
    `public-login-context.routes.ts`. Obidva endpointy teraz vyhadzujú
    `NotFoundError` / `BadRequestError` a telo skladá centrálny error handler.
    No-oracle chovanie (ADR-0021, ADR-0035) zostáva — obe 404 vetvy vracajú
    identické telo, pokryté testom.
  - **Jednotný tvar aj na `/v1/system`** (`migrations`, `indexes`,
    `retention`) — chybové telá tam nemali `statusCode`.
  - **`error` pri Fastify validačnej chybe** už nie je neinformatívne
    `"Error"`, ale text odvodený zo status kódu (`Bad Request` a spol.).
  - **Spoločné 400/401/403/404/429 sa dopĺňajú pri generovaní dokumentu**
    (`plugins/swagger.ts`, `transform`/`transformObject`) podľa toho, čo
    route naozaj vracia: značky na `preHandler` hookoch (`requireAuth`,
    `loadCurrentUser`, `requireRole`), deklarované `security`, prítomnosť
    vstupnej schémy a parametra v ceste. Nulový vplyv na runtime
    serializáciu a žiadny zásah do 97 rout.
  - **Nový test** `tests/integration/error-shape-consistency.test.ts` overuje
    tvar chybového tela na skutočných odpovediach (1052 → 1059 testov).

- **Rýchlosť prvého načítania dashboardu (2026-08-31)** — cesta k dátam na
  teplej inštancii **4 023 → 1 840 ms** (−54 %), z toho
  `GET /v1/dashboard/summary` **2 872 → 1 122 ms** (−60 %). Merané na
  produkcii cez Resource Timing pred aj po. Session log:
  `docs/sessions/2026-08-31-pomale-nacitanie-dashboardu.md`.
  - **`maxPoolSize` 1 → 10, `maxIdleTimeMS` 10 s → 60 s** (`plugins/mongo.ts`).
    Pool veľkosti 1 serializoval aj `Promise.all` v rámci jedného requestu —
    `GET /v1/dashboard/summary` spúšťa 9 operácií naraz, ale cez jedno spojenie
    išli za sebou (namerané 2,4–2,9 s na **teplej** inštancii). Pôvodné
    odôvodnenie („serverless má 1 invoke = 1 request") prestalo platiť
    zapnutím Fluid Compute.
  - **`ensureIndexes()` mimo produkčného cold-startu** (`lib/ensure-indexes.ts`,
    `modules/system/indexes.routes.ts`). Bolo to 18 sériových round-tripov na
    Atlas pred prvým užitočným requestom. Indexy teraz vytvára deploy-time
    endpoint `POST /v1/system/indexes/ensure`, volaný z workflow po migráciách
    — rovnaký vzor ako pri migráciách. Mimo produkcie sa nič nemení.
  - **`ENABLE_SWAGGER` default odvodený od `NODE_ENV`** (v produkcii `false`).
    Pozor, je to len zmena defaultu: Vercel projekt `inventario-api` má
    premennú nastavenú explicitne, tá prebíja default a `/docs` na
    `api.inventario.estate` funguje ďalej. Ponechané vedome — Swagger stál
    z cold startu ~45 ms, čo je vedľa ušetrených 1,75 s zanedbateľné.
    Nový default slúži ako poistka, keby premennú niekto odstránil.
  - **Inštrumentácia cold startu** (`lib/boot-timing.ts`) — rozpad boot fáz do
    logu, podrobný režim cez `BOOT_TIMING=1`.
  - **UX počas načítavania dashboardu** — `PendingActionsPanel` má skeleton so
    skutočnou štruktúrou panelu namiesto prázdneho obdĺžnika; po 3 s čakania
    pribudne veta o dlhšom prvom načítaní (`lib/useSlowLoadingHint.ts`);
    skeleton v `StatCard` je viditeľný (`border-subtle` namiesto
    `surface-subtle`).

### Fixed

- **`argon2` 0.45.1 — breaking change v typoch (2026-08-31)**: knižnica
  premenovala `Options` na `HashOptions`. `modules/auth/email-auth.routes.ts`
  mal `argon2.Options & { raw?: false }`; s rozpadnutým typom TypeScript vybral
  prvý overload `hash()` (ten s `raw: true`), ktorý vracia `Buffer`, a ten
  neprešiel do `passwordHash: string`. Opravené na `argon2.HashOptions` —
  `& { raw?: false }` netreba, bez `raw` sa trafí overload vracajúci `string`.
  Bump a oprava museli ísť naraz, `HashOptions` v 0.44 neexistuje.

### Added

- **EU compliance — P1/P2/P3 + audit prílohy (2026-06-11)**:
  - **Audit log — `LOAN_PROTOCOL_SIGNED`** (P1): podpis preberacieho protokolu sa loguje (každý podpis zvlášť, cieľ `entityType: 'LoanProtocol'`, `legalBasis: contract`); `LOAN_PROTOCOL_CREATED` aj `LOAN_PROTOCOL_SIGNED` doplnené do retencie (P2).
  - **Audit log — prílohy majetku**: nové akcie `ASSET_ATTACHMENT_ADDED` / `_REMOVED` / `_SET_PRIMARY`; `attachments.routes.ts` loguje upload/delete/set-primary s cieľom `Asset` (zobrazí sa v audit tabe detailu majetku); doplnené do retencie.
  - **REUSE 3.3 compliance** (P2): inline SPDX hlavičky v 114 zdrojových súboroch (EUPL-1.2) + `.reuse/REUSE.toml` pre nekomentovateľné súbory (config = EUPL-1.2, docs/assety = CC-BY-4.0, font = LicenseRef-DejaVu); `reuse lint` 622/622 compliant.
  - **WCAG 2.1 AA marketing site** (P3): uzavreté nálezy #1–#6 — `aria-hidden` na dekoratívne emoji/SVG, `<main>` landmark, `--brand-link` kontrast token, skip-link, `lang="en"`, `aria-live` v interactive demo.

- **Pre-GA kvalita (2026-06-11)**:
  - **EXIF/XMP strip** (`lib/strip-image-metadata.ts`, pure-JS): z nahrávaných obrázkov (prílohy majetku + logo tenanta) sa odstraňujú GPS/zariadenie metadáta pred uložením do Blobu. + unit testy.
  - **REUSE lint v CI** — nový job `reuse` (`fsfe/reuse-action`) v `ci.yml`.
  - **Integračné testy príloh** (`tests/integration/attachments.test.ts`) — upload/RBAC/primary/delete/audit eventy/EXIF/cross-tenant, mock `@vercel/blob`.

- **Compliance Fáza 2 dokumenty (2026-06-11)**:
  - **Data Retention Schedule**, **Information Security Policy**, **Security & Privacy Whitepaper**, **DPIA Reference Pack** (`docs/compliance/`).
  - Verejné stránky https://inventario.estate/security a https://inventario.estate/dpia + odkazy vo footeri.

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

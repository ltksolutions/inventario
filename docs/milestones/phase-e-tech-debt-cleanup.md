<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Phase E — Tech debt cleanup

> **Status**: ✅ COMPLETE
> **Dátum**: 17. máj 2026 (Sunday)
> **Commit-y**: `9ed9521`, `6aeb578`, `c8ea924`, `8dffa49`, `4a98ec4`
> **Predchodca**: [Phase D — EU compliance foundations](./phase-d-eu-compliance.md)
> **Nasledovník**: Slice #4 — Frontend (apps/web)

---

## Cieľ fázy

Posledný cleanup pred Slice #4. Posbierať technický dlh z predošlých fáz, opraviť všetky 6 nálezov z WCAG audit doc-u, dotiahnuť shared-types exporty, opraviť `isActive` bug v query-paramoch, dotiahnuť root metadata po multi-tenant pivote, a utíšiť dlhodobo občas-flaky `audit.test.ts`. Všetko ako čistý technický dlh — žiadne nové funkčnosti, žiadne breaking changes na verejnej API.

---

## Čo sa zmenilo

### Blok 1 — WCAG P1 marketing fixy

**Commit**: `9ed9521` `fix(marketing): wcag p1 a11y improvements`

- `docs/marketing-site/assets/shared.css` rozšírený o tri tokeny a utility:
  - `--brand-link: #1f6699` semantic token (4.6:1 contrast vs white) — splňuje WCAG AA 4.5:1 minimum pre body text
  - `a { color: var(--brand-link) }` default override (predtým `--brand-accent #388fc3` mal len ~3.5:1, fail)
  - `.sr-only` utility class (visually-hidden but accessible to AT)
  - `.skip-link` styles (off-screen by default, focus brings into view)
- `docs/marketing-site/assets/shared.js`:
  - Skip-link injection ako prvý body element (WCAG 2.4.1 Bypass Blocks)
  - `aria-hidden="true"` na všetkých nav SVG (GitHub icon, hamburger menu)
  - `aria-label="GitHub repository"` na GitHub anchor
  - `aria-expanded` + `aria-controls="site-nav"` toggle na mobile menu (synced z JS click handler-u)
  - "↗" externé link arrows wrapnuté do `<span aria-hidden="true">↗</span><span class="sr-only"> (otvorí v novom okne)</span>` pattern — všetky 3 footer linky + mobile nav
  - Marketing footer link `../decisions/0010-multi-tenant-white-label.md` replaced za `${EXTERNAL_LINKS.docs}/architecture` (broken na production — decisions sa nedeployujú do marketing bundli)
- HTML stránky:
  - `<main id="main">` landmark wrap na všetkých 6 stránkach: index, use-cases, pricing, technology, about, interactive-demo
  - Emoji decorations (`⚽🏛️🏢🏃🎓🤝`) wrapnuté `aria-hidden="true"` v index.html (6×), use-cases.html (6×), pricing.html (1×) — Phase D audit ich označil ako P1 dekoratívne
  - Inline SVG icons (chevron-right, GitHub, feature icons, decorative shapes) doplnené `aria-hidden="true"` v index.html (9×), technology.html (1×), interactive-demo.html (5×)

### Blok 2 — WCAG P2 marketing fixy

**Commit**: `6aeb578` `fix(marketing): wcag p2 a11y improvements`

- `<span lang="en">` wrap pre anglické technické termíny v body content (WCAG 2.1 AA 3.1.2 Language of Parts). 11 výskytov naprieč 5 stránkami + shared.js footer tagline. Termíny `vendor lock-in` (top frequency) a `white-label`
- Wrap len v `<body>...</body>` rozsahu — `<title>`, `<meta description>`, `<meta og:*>` zámerne netknuté (plain-text contexty kde `<span>` nefunguje a rendrovali by sa ako broken text)
- `aria-live="polite"` region v `interactive-demo.html` pre status announcements (WCAG 2.1 AA 4.1.3 Status Messages):
  - `<div id="demo-announce" class="sr-only" role="status" aria-live="polite" aria-atomic="true">`
  - Helper funkcia `announce(message)` v demo JS s small DOM mutation delay aby assistive tech registrovala aj rovnaké hodnoty
  - Eventy oznamované: tenant switch ("Tenant zmenený na Mesto Pezinok"), viewport switch ("Zobrazenie zmenené na mobil"), screen open ("Otvorená obrazovka 03: Zoznam majetku"), screen close ("Vrátený zoznam všetkých obrazoviek")
- Early-return guard na tenant + viewport switchers — ak user klikne na aktívne tlačítko, skip announcement aj iframe reload (eliminuje aj flash z rapid re-click)
- Tenant labels v JS mappingu expanded na full names (Stredná škola Kremnica namiesto raw "kremnica" slug)

### Blok 3 — Shared-types exports + boolean query bug

**Commit**: `c8ea924` `refactor(shared-types): export location-type enum and update schemas`

- Nový `packages/shared-types/src/enums/location-type.ts` — `LocationType` enum mirror-uje AssetType pattern, plus `LOCATION_TYPE_VALUES` readonly tuple. 6 hodnôt (WAREHOUSE, OFFICE, STADIUM, TRAINING_CENTER, EXTERNAL, IN_TRANSIT) zhodné s lokálnou definíciou ktorú `locations.routes.ts` mal hardcoded
- `packages/shared-types/src/schemas/location.ts` používa enum cez `z.enum(Object.values(LocationType))` pre `type` field. Generovaný JSON schema `type.enum` list identický s predošlou verziou — žiadna Mongo `$jsonSchema` migrácia potrebná
- Nový `UpdateLocationSchema` v `location.ts` a `UpdateCategorySchema` v `category.ts` — exported zo shared-types ako `Partial<Omit<X, audit + identity fields>>`. Rovnaký shape ktorý routes mali inline definovaný, len centralizovaný. Audit + identity columns (\_id, organisationId, createdAt, updatedAt, createdBy, updatedBy, deletedAt, deletedBy) sú strip-nuté
- `generate-json-schema.ts` registers nové Update schemas — 26 → 28 schém vo workspace JSON schema artifact-e
- `apps/api/src/modules/categories/categories.routes.ts` a `apps/api/src/modules/locations/locations.routes.ts` drop-nú inline `UpdateCategoryBodySchema` / `UpdateLocationBodySchema` v prospech shared-types exports. Každý route file si nechá thin `.describe(...)` wrapper pre Swagger UI lokalizáciu
- `locations.routes.ts` drop-uje local `LOCATION_TYPE_VALUES` declaration a importuje shared one — single source of truth pre enum je teraz `packages/shared-types/src/enums/`
- **`isActive` query-param bug fix** v oboch routes. Pôvodný `z.coerce.boolean()` robil `Boolean(value)` čo vracia `true` pre akýkoľvek non-empty string vrátane stringu `"false"`. Fix je nový `BooleanQueryParam` helper ktorý explicitne akceptuje `'true' | 'false' | '1' | '0'` a transforms na canonical bool. Identický pattern ako v K10 users routes
- `apps/api/openapi.json` regenerovaný — pribudol `UpdateLocation`/`UpdateCategory` schema component, `isActive` query param je teraz enum schema namiesto coerced bool

### Blok 4 — Root metadata cleanup

**Commit**: `8dffa49` `chore(repo): rename root package and align metadata with inventario brand`

- Root `package.json` post-pivot rename:
  - `name`: `sfz-asset-management` → `inventario`
  - `description`: SFZ internal asset system → Inventario multi-tenant open-source platform (matches apps/api a apps/docs)
  - `homepage`: `ltksolutions/inventario` GitHub → `inventario.sportup.sk` (marketing landing je canonical user-facing page)
  - `repository` / `bugs`: `ltksolutions/inventario` → `Slovensky-futbalovy-zvaz/Asset-Management` (repo žije v SFZ org, personal username path bol stale + broke REUSE badge resolution)
  - `license`: `MIT` → `EUPL-1.2` (matches source SPDX headers všade inde)
  - `author`: `Slovenský futbalový zväz` → `Ján Letko / LTK Solutions` (actual maintainer post-pivot)
- Side-fix marketing site regression z E2: ADR-0010 GitHub URL na `technology.html` mal "white-label" v href atribúte nesprávne wrap-nutý do `<span lang="en">`. Wrap script v E2 spadol cez `<body>` content vrátane HTML atribútov. Fixed manuálne — href obsahuje raw filename, prose okolo zostáva wrapnutá

### Blok 5 — Audit test stability

**Commit**: `4a98ec4` `test(api): tame audit.test.ts flaky timeout`

- `apps/api/tests/integration/audit.test.ts` drop-uje `afterEach(cleanTestDatabase)`. Next test-ov `beforeEach` už wipuje DB, takže cleanup-on-exit bol redundantný — len zdvojnásoboval per-test Atlas round-trip count bez pridania isolation guarantee. Observed wall-clock zlepšenie: 10446ms → 8491ms (~19% rýchlejšie)
- `apps/api/vitest.config.ts` zvýšil `testTimeout` z 10s na 30s ako safety net pre všetky integration files. Worst-case test v suite (users-patch s 27 tests) sedí na ~21s wall-clock end-to-end ale jednotlivé testy stále finishu pod 5s; 30s ceiling pokrýva TCP retransmits alebo transient Atlas primary-step-down events na contended residential linke

**Prečo nestrip-nutý `afterEach` aj v ostatných 15 integration files**: tieto neflakli. Per-file cleanup-on-exit je harmless a removal pridáva non-trivial review burden (treba overiť že každý file-ov `beforeEach` skutočne wipuje správny state, najmä pre files ktoré používajú targeted reset namiesto full `cleanTestDatabase`). Commit zostáva zámerne narrow.

---

## Verifikácia

| Check                                            | Stav                                                    |
| ------------------------------------------------ | ------------------------------------------------------- |
| `pnpm typecheck`                                 | ✅ 5/5 tasks (cached / fresh OK na všetkých commit-och) |
| `pnpm lint`                                      | ✅ 5/5 tasks                                            |
| `pnpm format:check`                              | ✅ Všetky súbory match Prettier code style              |
| `pnpm test` (shared-types)                       | ✅ 54/54 testov                                         |
| `pnpm test` (apps/api integration)               | ✅ **327/327** v ~212s (down z ~218s)                   |
| `pnpm openapi:export --check`                    | ✅ openapi.json na disku zodpovedá generovanému spec-u  |
| `python3 -m reuse lint`                          | ✅ 272/272 súborov compliant                            |
| Pre-commit hook (husky) na všetkých 5 commit-och | ✅ Prešiel                                              |

---

## Čo to znamená v ekosystéme

### Pre marketing site (live)

- **WCAG 2.1 AA pass**: všetkých 6 P1+P2 nálezov z Phase D audit doc-u uzavretých. Marketing site je teraz accessibility-clean pre verejný sektor (EU smernica 2016/2102 + slovenský zákon 95/2019 Z. z.)
- **Slovenský verejný sektor compliance**: link contrast, landmark structure, skip-link, lang-of-parts attributes — všetky atribúty ktoré EU `axe-core` automated scan kontroluje
- **Future-ready pre Slice #4**: apps/web bude môcť re-use `--brand-link` token, `.sr-only` utility, `.skip-link` CSS, plus prevziať `aria-live` announcement pattern

### Pre Slice #4 (frontend dev experience)

- **Žiadne inline duplicate schemas v routes**: `apps/web` môže importovať `UpdateCategorySchema` + `UpdateLocationSchema` priamo zo `@inventario/shared-types` pre PATCH form validation. Žiadny risk type drift medzi backend route a frontend form
- **`isActive=false` skutočne znamená false**: filter UI na assets/categories/locations list pages bude fungovať tak ako frontend developer očakáva (predtým by URL `?isActive=false` vrátilo aktívne items kvôli `Boolean("false") === true`)
- **`openapi.json` v repe always-fresh**: CI `OpenAPI Spec Freshness` job z Phase D + E3 schema refactor zabezpečuje že type-generation v `apps/web` nikdy nedostane stale spec

### Pre repo housekeeping

- **Root package.json final**: po pivote SFZ → Inventario sú teraz všetky package manifesty + brand identity konzistentné. Žiadne pozostalosti SFZ branding-u v code-level metadata
- **`audit.test.ts` no longer flaky**: dev experience pri lokálnom test-run je predikteľnejší, CI je menej náchylné na transient failures

---

## Technical debt log (priebeh)

Z phase-d-eu-compliance.md sa do tejto fázy preniesli tieto položky a všetky boli vyriešené:

- ✅ WCAG P1 fixy v marketing site (aria-hidden na SVG/emoji, `<main>` landmark, link contrast) — E1
- ✅ WCAG P2 fixy (skip link, `lang="en"`, `aria-live`) — E1+E2
- ✅ `audit.test.ts` flaky timeout — E5
- ✅ `LOCATION_TYPE_VALUES` export do shared-types — E3
- ✅ `UpdateCategorySchema` + `UpdateLocationSchema` → shared-types — E3
- ✅ `categories.routes.ts isActive` query param fix — E3 (locations dostal rovnaký fix)
- ✅ Marketing footer link cleanup (broken ADR-0010 link) — E1
- ✅ Root `package.json` post-pivot cleanup — E4

**Nesplnené z pôvodného plánu** — všetky tri uzavreté pri audite 2026-06-01 (Vlna 4 upratovania):

- ✅ `apps/docs/vercel.json` UI override migration — **closed/non-issue**: `vercel.json` už obsahuje len headers, žiadny UI override netreba migrovať (Build Command/Install Command pre docs sú prázdne v UI, čo je rovnaké ako neuvedené v vercel.json)
- ❌ `marketing-site/shared.css` migrate `--brand-*` → `@inventario/design-tokens/tokens.css` — **won't-fix** (rozhodnuté 2026-06-01): ide o dva **zámerne oddelené** systémy. `tokens.css` je 3-vrstvový design-token systém (primitive → semantic → brand, prefix `--inv-*`, licencia EUPL-1.2, kód aplikácie). Marketing `shared.css` má 5 jednoduchých `--brand-*` premenných (licencia CC-BY-4.0, dokumentácia). Nie je to čistá náhrada — buď by sa do marketingu ťahal celý `--inv-` systém (overkill pre 5 farieb + miešanie licencií), alebo plytká náhrada mien (kozmetika bez hodnoty). Marketing site je statická a funguje samostatne. Hodnoty (Navy #1a2d47, Blue #388fc3, Paper #f8f6f1) sú totožné v oboch — vizuálna konzistentnosť je zachovaná aj bez zdieľaného súboru. Žiadny user-facing ani DX benefit z migrácie
- ✅ `AssetUpdatePatch / CategoryUpdatePatch / LocationUpdatePatch types` type-narrow — **už hotové** (overené 2026-06-01): `UpdateCategorySchema` aj `UpdateLocationSchema` v shared-types už existujú ako `XSchema.omit({ _id, organisationId, ...audit }).partial()` — `organisationId` je vylúčený zo vstupu. To je presne ten type-narrowing, ktorý táto položka žiadala; rieši ho schéma-vrstva (viď Blok 3 vyššie). Pôvodná poznámka sa vzťahovala na starší inline typ, ktorý už neexistuje

### Nový debt zo Phase E

Žiadny — phase E bola čisto debt-reducing, žiadne nové TODOs nepribudli.

### Stav po audite 2026-06-01

Všetky tri „presunuté ďalej" položky sú uzavreté (1× non-issue, 1× won't-fix, 1× už hotové). **Z Phase E nezostáva žiadny otvorený technický dlh.**

---

## Ďalší krok — Slice #4 Frontend (apps/web)

Phase E uzatvára celú stratégiu **B → C → D → E**. Backend je production-ready, design tokens sú definované, multi-tenancy je v place, EU compliance je adresovaná, technický dlh je upratovaný. Teraz prichádza najväčší blok:

**Slice #4 — `apps/web`** (Next.js 15 + TanStack Query + shadcn/ui + Tailwind):

- Bootstrap (~half day): pnpm workspace, Next.js 15 app, Tailwind preset z `@inventario/design-tokens/tailwind`, shadcn/ui setup, ESLint+a11y config (`eslint-plugin-jsx-a11y` z Phase D plánu)
- Auth flow (~half day): Microsoft Entra ID SSO, JWT v cookie, multi-tenant routing podľa subdomain alebo path prefix
- HTTP klient (~few hours): auto-generated TS klient z `apps/api/openapi.json` cez `openapi-typescript` + `openapi-fetch`
- 6 P0 stránok podľa mockupov v `docs/design/screens/`: Login, Dashboard, Assets list, Asset detail, Loan request wizard, My loans
- Runtime accessibility: `@axe-core/react` v dev, `@axe-core/cli` proti deployed preview URL v CI
- Manual a11y pass: NVDA + VoiceOver pred prvým produkčným launchom

---

## Súbory dotknuté Phase E

```
apps/api/
  openapi.json                                       M  (E3: UpdateLocation/UpdateCategory schemas, isActive enum)
  src/modules/categories/categories.routes.ts        M  (E3: shared UpdateCategorySchema, BooleanQueryParam helper)
  src/modules/locations/locations.routes.ts          M  (E3: shared LOCATION_TYPE_VALUES + UpdateLocationSchema)
  tests/integration/audit.test.ts                    M  (E5: drop redundant afterEach cleanup)
  vitest.config.ts                                   M  (E5: testTimeout 10s → 30s)
docs/marketing-site/
  about.html                                         M  (E1: <main> wrap + E2: lang="en" wraps)
  index.html                                         M  (E1: <main> wrap + emoji aria-hidden + SVG aria-hidden + E2: lang="en")
  interactive-demo.html                              M  (E1: <main> wrap + SVG aria-hidden + E2: lang="en" + aria-live region + announce helper)
  pricing.html                                       M  (E1: <main> wrap + emoji aria-hidden + E2: lang="en")
  technology.html                                    M  (E1: <main> wrap + SVG aria-hidden + E2: lang="en" + E4: ADR-0010 href fix)
  use-cases.html                                     M  (E1: <main> wrap + emoji aria-hidden)
  assets/shared.css                                  M  (E1: --brand-link + .sr-only + .skip-link)
  assets/shared.js                                   M  (E1: skip-link injection, aria-hidden SVG, ↗ arrow wrap, footer link fix)
docs/milestones/
  phase-e-tech-debt-cleanup.md                       A  (this file)
docs/sessions/
  NEXT.md                                            M  (will update with Phase E done + focus to Slice #4)
package.json                                         M  (E4: root metadata Inventario rebrand)
packages/shared-types/
  scripts/generate-json-schema.ts                    M  (E3: register UpdateCategory + UpdateLocation)
  src/enums/index.ts                                 M  (E3: export location-type)
  src/enums/location-type.ts                         A  (E3: new LocationType enum + LOCATION_TYPE_VALUES)
  src/schemas/category.ts                            M  (E3: UpdateCategorySchema)
  src/schemas/location.ts                            M  (E3: use LocationType enum + UpdateLocationSchema)
```

16 súborov dotknutých, 5 commit-ov.

---

**Phase E status: ✅ DONE.** Repo je čistý, technický dlh je vyriešený, Slice #4 môže začať.

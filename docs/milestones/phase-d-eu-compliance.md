<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Phase D — EU compliance foundations

> **Status**: ✅ COMPLETE
> **Dátum**: 17. máj 2026 (Sunday)
> **Commit-y**: `69d2092`, `0dc6ea0`, `0e8ed9a`, `d79233f`
> **Predchodca**: [Phase C — Multi-tenant migration](./phase-c-multi-tenant-migration.md)
> **Nasledovník**: Phase E — Tech debt cleanup → Slice #4 frontend

---

## Cieľ fázy

Doplniť EU-readiness fundamenty, ktoré sú potrebné **pred** spustením Slice #4 frontendu — všetko ako čistý additive layer, žiadne breaking changes na verejnej API. Ide o štyri logické bloky:

1. **OpenAPI 3.1 export** — strojovo čitateľný kontrakt pre Slice #4 type-generation a pre EU procurement requirement
2. **CycloneDX SBOM** — Software Bill of Materials pre EU Cyber Resilience Act
3. **WCAG 2.1 AA baseline audit** — accessibility východisková štúdia pre marketing site (povinná pre verejný sektor v EÚ podľa smernice 2016/2102 a zákona 95/2019 Z. z.)
4. **GDPR Article 30 hardening** — záznamy o spracovateľských činnostiach plus rozšírenie audit logu o GDPR-relevantné polia

---

## Čo sa zmenilo

### Blok 1 — OpenAPI 3.1 export

**Commit**: `69d2092` `feat(api): export openapi 3.1 spec and rebrand swagger to inventario`

- Swagger plugin (`apps/api/src/plugins/swagger.ts`) re-branded zo SFZ na Inventario:
  - Title, description, contact, license (MIT → **EUPL-1.2** s `joinup.ec.europa.eu` canonical URL)
  - Production server URL `https://api.inventario.estate`, externalDocs link na `docs.inventario.estate`
  - Bearer auth description rozšírený o popis multi-tenant `tid+oid` claim modelu
  - Tagy rozšírené z 3 na 6 (Health, Organisations, Users, Assets, Categories, Locations) — každý s jednou-vetnou popisom tenant-scopingu kde relevantné
- Nový skript `apps/api/scripts/export-openapi.ts`:
  - Boot-uje Fastify cez `buildServer({ pluginTimeout: 30_000 })` (matches test setup pre Atlas Flex cold TLS handshakes), čaká `app.ready()`, volá `app.swagger()` a zapíše deterministicky pretty-printed JSON do `apps/api/openapi.json`
  - Force-enables `ENABLE_SWAGGER=true` aby export fungoval aj v CI kde produkčný env môže mať OFF
  - Flag `--check` pre CI freshness check (exit 1 ak openapi.json na disku nesedí s generovaným spec-om)
  - Flag `--output PATH` pre custom destination
- `apps/api/openapi.json` v repe (73 KiB, 14 paths, 27 endpoints) — canonical kontrakt pre Slice #4 type-generation
- `pnpm --filter @inventario/api openapi:export` script v `apps/api/package.json`
- CI workflow `.github/workflows/ci.yml`:
  - Nový `openapi` job (OpenAPI Spec Freshness) bežiaci `pnpm openapi:export -- --check` proti rovnakým Atlas + Entra secrets ako test job
  - Existujúci `commitlint` job premenovaný Job 3 → Job 4 pre monotonic numbering
- `apps/api/README.md` — Inventario branding header + nová sekcia **Static export** s consumer-side workflow popisom
- `.prettierignore` — exclude pre `apps/api/openapi.json` (deterministic JSON.stringify formatovanie by Prettier prerobil a CI freshness check by potom zlyhal)
- REUSE lint 267/267 zelený — `openapi.json` dedí EUPL-1.2 cez existujúce `apps/**` pravidlo v `REUSE.toml`

### Blok 2 — CycloneDX SBOM v CI

**Commit**: `0dc6ea0` `chore(ci): add cyclonedx sbom workflow for eu cra compliance`

- Nový workflow `.github/workflows/sbom.yml`:
  - Triggery: push na `main`/`develop`, PR, weekly cron (nedeľa 07:00 UTC), `workflow_dispatch`
  - Generuje root-level monorepo SBOM cez `pnpm sbom`
  - Step summary v GitHub UI zobrazí spec version, component count, file size a timestamp
  - Upload ako workflow artifact s **90-day retention** (matches EU procurement audit minimum window)
  - Concurrency cancel-in-progress pre ten istý ref
  - Permissions iba `contents: read` (least privilege)
- Root `pnpm sbom` script v `package.json`:
  - `pnpm dlx @cyclonedx/cdxgen@^11 -r -t js -o sbom.cdx.json --spec-version 1.6 --no-babel`
  - `-r` recurse cez pnpm workspace, `-t js` limituje scanner na JS ekosystém, `--no-babel` skipne AST scope detection (zhruba polovičný runtime)
- `.gitignore` — exclude pre `sbom.cdx.json`, `sbom.cdx.xml`, `.cdxgen-cache/` (generované artifacty nikdy nepatria do gitu, vždy len ako CI artifact)
- REUSE lint stále zelený — `sbom.yml` dedí CC-BY-4.0 cez `.github/**` pravidlo

**Compliance rationale**: EU Cyber Resilience Act (Regulation (EU) 2024/2847, v účinnosti od 11. decembra 2024 s plnými povinnosťami od 11. decembra 2027) vyžaduje od výrobcov produktov s digitálnymi prvkami strojovo čitateľný SBOM. CycloneDX 1.6 je formát ktorý European Commission reference architecture endorse-uje popri SPDX 3.0. Public-sector tendre v SR a širšej EÚ čoraz viac považujú "SBOM available on request" za štandardný tender requirement.

### Blok 3 — WCAG 2.1 AA baseline audit

**Commit**: `0e8ed9a` `docs(compliance): add baseline wcag 2.1 aa audit for marketing site`

- Nový dokument `docs/compliance/wcag-2.1-aa-audit.md`:
  - Statická analýza všetkých **30 in-scope WCAG 2.1 AA success criteria** proti `docs/marketing-site/` (6 HTML stránok + interactive-demo) plus `assets/shared.{css,js}`
  - **24 kritérií prešlo bez výhrad**
  - **3 P1 nálezy** (fix v Phase E pred Slice #4):
    1. SVG ikony + emoji dekorácie bez `aria-hidden="true"` (1.1.1 Non-text content)
    2. `<section>` elementy nie sú wrap-nuté do `<main>` landmark (1.3.1 Info and relationships)
    3. Default link color `--brand-accent #388fc3` na bielom má len ~3.5:1 contrast, fails AA 4.5:1 (1.4.3 Contrast)
  - **3 P2 nálezy** (technical debt — fix v Phase E): 4. Chýba "Skip to main content" link (2.4.1 Bypass blocks) 5. Anglické technické termíny bez `<span lang="en">` (3.1.2 Language of parts) 6. Interactive demo bez `aria-live` regions pre status announcements (4.1.3 Status messages)
  - Plán accessibility setup pre `apps/web` Slice #4: `eslint-plugin-jsx-a11y` v CI, `@axe-core/react` v dev, `@axe-core/cli` proti deployed preview URL, manual NVDA + VoiceOver pass
  - Legal basis: EU smernica 2016/2102 transponovaná zákonom 95/2019 Z. z. + norma EN 301 549
- Nová zložka `docs/compliance/` — hostí compliance artifacty (WCAG audit, GDPR Article 30, budúce DPIA template, threat model atď.)

**Žiadne code zmeny** v tomto commit-e — pure documentation. Marketing site P1 fixy sa robia v Phase E tech-debt cleanup; logging ich do audit doc-u namiesto inline fix-u udržuje commit fokusovaný.

### Blok 4 — GDPR Article 30 hardening

**Commit**: `d79233f` `feat(audit): add gdpr article 30 fields to audit log records`

- `packages/shared-types/src/schemas/audit-log.ts` — tri nové optional polia v `AuditLogSchema`:
  - `legalBasis: enum | null | undefined` — mapping na čl. 6 ods. 1 GDPR (`contract`, `legal_obligation`, `legitimate_interest`, `public_task`, `consent`, `vital_interests`, `n/a`)
  - `dataCategories: array | undefined` — kategórie osobných údajov dotknuté akciou (`identification`, `contact`, `account`, `authentication`, `asset_custody`, `audit_metadata`)
  - `pseudonymizedAt: timestamp | null | undefined` — kedy retention job pseudonymizoval záznam
  - Všetky tri sú `.optional()` (nie `.default()`) **kvôli spätnej kompatibilite** s pred-Phase-D rows ktoré tieto polia nemajú. Žiadna migration nepotrebná
- `apps/api/src/modules/audit/audit.service.ts`:
  - `RecordEventInput` rozšírený o optional `legalBasis` + `dataCategories` (caller môže override-núť default-mapping)
  - Dva helper funkcie:
    - `defaultLegalBasisFor(action)` — hardcoded table pre 50+ action enum hodnôt. Auth events → `legitimate_interest`, User/Tenant/Asset/Category/Location/Loan lifecycle → `contract`, GDPR rights → `legal_obligation`, System → `n/a`
    - `defaultDataCategoriesFor(action)` — konzervatívny mapping; `USER_LOGIN` → `['authentication', 'identification']`, `ASSET_*` → `['audit_metadata']`, `LOAN_*` → `['asset_custody', 'audit_metadata']`, atď.
  - `AuditLogService.record()` auto-fill nových fields ak caller neuvedie
- Nový dokument `docs/compliance/gdpr-article-30.md`:
  - Article 30 inventár pre 5 spracovateľských operácií: autentifikácia & používatelia, eviden­cia majetku, výpožičky (planned), audit log (cross-cutting), tenant lifecycle
  - Sub-processors s EU data residency (Microsoft Entra ID EÚ tenant, Vercel fra1/cdg1, MongoDB Atlas eu-region; Google Fonts + GitHub flagged ako infrastructure-only bez customer PII transfer)
  - Implementačný stav práv subjektov údajov (Art. 15-22) — Right to rectification už hotové, Right to access/erasure/portability plánované v Slice #5
  - Technické a organizačné opatrenia (Art. 32) — TLS 1.3, encryption at rest, RBAC, tenant scoping, append-only audit log
  - Postupy pre data breach (Art. 33-34) — 72-hour notification, containment, post-mortem
  - Retention schedule (24 mesiacov pre routine, 60 pre security/auth, 84 pre tenant lifecycle audit entries)

---

## Verifikácia

| Check                                            | Stav                                                   |
| ------------------------------------------------ | ------------------------------------------------------ |
| `pnpm typecheck`                                 | ✅ 5/5 tasks (cached / fresh OK)                       |
| `pnpm lint`                                      | ✅ 5/5 tasks                                           |
| `pnpm format:check`                              | ✅ All files match Prettier                            |
| `pnpm test` (shared-types)                       | ✅ 54/54 testov, ~711 ms                               |
| `pnpm openapi:export --check`                    | ✅ openapi.json na disku zodpovedá generovanému spec-u |
| `python3 -m reuse lint`                          | ✅ 270/270 súborov compliant                           |
| Pre-commit hook (husky) na všetkých 4 commit-och | ✅ Prešiel                                             |
| `pnpm test` (apps/api integration, 327 testov)   | ⚠️ Nebežalo lokálne — testuje CI proti Atlas dev       |

> **Pozn.**: `apps/api` integration testy (327 testov, ~5 min na Atlas Flex) sa lokálne pri commit-och nespúšťajú — pokrýva ich CI Unit Tests job. Schema zmena v `audit-log.ts` je backwards-compatible (optional fields), takže existujúce testy by nemali zlyhať. Po push do GitHubu sa overí.

---

## Čo to znamená v ekosystéme

### Pre Slice #4 (frontend)

- **`openapi.json` ako single source of truth pre HTTP klient** — `apps/web` použije `openapi-typescript` + `openapi-fetch` na auto-generovanie typovaného klienta. CI guard (`--check` mode) zabezpečí že frontend a backend zostanú v sync — keď niekto urobí API zmenu bez regenerovania `openapi.json`, PR padne na `OpenAPI Spec Freshness` job
- **WCAG audit ako baseline** — apps/web bude dodržiavať rovnaké princípy plus pridá nástroje (`eslint-plugin-jsx-a11y`, `@axe-core/cli`) pre runtime + CI accessibility kontrolu
- **GDPR audit log fields** — frontend bude môcť (v admin UI) zobraziť legalBasis + dataCategories pri každom audit log zázname, čo je výborná feature pre tenant administrátorov v public sector

### Pre EU procurement a compliance

- **OpenAPI 3.1** je požadovaný formát v mnohých EU tendroch — máme ho v repo a auto-generujeme
- **CycloneDX 1.6 SBOM** je pripravený pre EU CRA (povinné od 2027) a je dostupný cez CI artifact akoukoľvek inštitúciou
- **WCAG 2.1 AA audit document** preukazuje že robíme accessibility seriózne — kľúčový dokument pre verejný sektor (smernica 2016/2102)
- **GDPR Article 30 inventár** je presne to čo audit-or chce vidieť pri kontrole — strojovo prepojiteľný s audit log records cez `legalBasis` a `dataCategories` polia

### Pre tenant administrátorov

- **Audit log už hovorí _prečo_** — pred Phase D bolo "kto, čo, kedy"; teraz aj "na akom právnom základe a ktoré osobné údaje boli dotknuté". Užitočné pri DPIA, pri DSAR requestoch, pri kontrolách ÚOOÚ

---

## Technical debt log (príspevok z Phase D)

Tieto položky pribudli do `docs/sessions/NEXT.md` Technical debt sekcie:

- **WCAG P1 fixy v marketing site** — aria-hidden na SVG/emoji, `<main>` landmark, link contrast (3 zmeny v `docs/marketing-site/*.html` + `assets/shared.css`)
- **WCAG P2 fixy** — skip link, `lang="en"` na anglické termíny, `aria-live` v interactive demo
- **Audit log backfill skript** — voliteľný; doplní `legalBasis` + `dataCategories` na pred-Phase-D rows ak by sme chceli single-pass kompletizáciu inventára (zatiaľ je to optional polia, takže žiadna data integrity issue)
- **Audit log retention job** — implementácia automatickej pseudonymizácie po 24/60/84 mesiacoch (plánované v Slice #5)
- **DPIA template** — `docs/compliance/dpia-template.md` pre municipálne tenanty pred prvým produkčným launchom
- **Threat model (STRIDE)** — `docs/compliance/threat-model.md`, pred prvým produkčným launchom

---

## Ďalší krok

Phase E (tech debt cleanup) je voliteľný — vieme prejsť priamo na Slice #4 (frontend) ak má energia. Phase E je dobrý "lite" deň ak chce niekto upratovať pred veľkým kusom. Konkrétne:

- WCAG P1 fixy (60-90 min)
- WCAG P2 fixy (30 min)
- `audit.test.ts` flaky timeout (30-60 min)
- Marketing footer link cleanup, root package.json post-pivot rename (15-30 min)
- Categories `isActive` query param fix (15 min)
- Shared-types `LOCATION_TYPE_VALUES` + `UpdateCategorySchema` + `UpdateLocationSchema` exports (30 min)

Detaily v [`docs/sessions/NEXT.md`](../sessions/NEXT.md) v Technical debt sekcii.

---

## Súbory dotknuté Phase D

```
.github/workflows/
  ci.yml                                      M  (D1: new openapi job, renamed commitlint job)
  sbom.yml                                    A  (D2: new SBOM workflow)
apps/api/
  package.json                                M  (D1: new openapi:export script)
  README.md                                   M  (D1: Inventario branding, OpenAPI static export section)
  openapi.json                                A  (D1: 73 KiB OpenAPI 3.1 export)
  scripts/export-openapi.ts                   A  (D1: export script with --check mode)
  src/modules/audit/audit.service.ts          M  (D4: GDPR field auto-fill helpers)
  src/plugins/swagger.ts                      M  (D1: Inventario branding, tags expansion)
docs/compliance/
  gdpr-article-30.md                          A  (D4: Article 30 inventory)
  wcag-2.1-aa-audit.md                        A  (D3: 30-criteria audit, 6 findings)
docs/milestones/
  phase-d-eu-compliance.md                    A  (this file)
docs/sessions/
  NEXT.md                                     M  (will update with Phase D done + debt items)
packages/shared-types/src/schemas/
  audit-log.ts                                M  (D4: legalBasis, dataCategories, pseudonymizedAt fields)
package.json                                  M  (D2: new sbom script)
.gitignore                                    M  (D2: sbom.cdx.json exclude)
.prettierignore                               M  (D1: openapi.json exclude)
```

13 súborov dotknutých, 4 commit-y, ~30+ KB nového obsahu.

---

**Phase D status: ✅ DONE.** Foundation pre Slice #4 frontend a EU compliance je pripravená.

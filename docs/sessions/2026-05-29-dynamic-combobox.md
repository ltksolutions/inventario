<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-05-29 — Dynamic Combobox K1–K6

**Model:** Sonnet 4.6
**Trvanie:** ~5 hodín
**Výsledok:** Dynamic Combobox plne implementovaný, CI green

---

## Čo sme riešili

### K1 — Combobox + TagsCombobox komponenty

Dva nové reusable komponenty:

- `Combobox.tsx` — Atlas-style single-select s typeahead, prvých 10 položiek, hint ak viac, "+ Vytvoriť" row (canCreate), inline rename (canRename), keyboard navigácia (↑↓ Enter ESC)
- `TagsCombobox.tsx` — free-form multi-select pre tags, pills s X, suggestions dropdown, Enter/comma/Tab pridá tag, Backspace odstráni posledný

Počas session opravené: React vs DOM `MouseEvent` konflikty, `jsx-a11y` keyboard handler chyby pre CI.

### K2 — Backend asset_types + asset_conditions

Nové moduly mirrorujúce `categories` vzor:

- `asset-types/` — repository + service + routes (CRUD, seed defaults, FK protection cez slug count)
- `asset-conditions/` — rovnaký vzor
- Seed defaults: 7 types (IT majetok, Športová výstroj...), 6 conditions (Nové, Vynikajúce...)
- Zaregistrované v `server.ts`, audit log rozšírený o nové akcie + entity typy

### K3 — Migrácia enum → per-tenant collections

- `asset.ts` schema: `type` + `condition` zmenené z `z.enum(AssetType)` na `z.string().min(1).max(200)`
- Migration `2026-05-29-asset-type-condition-collections.ts`:
  - Seed `asset_types` + `asset_conditions` pre každý existujúci tenant (idempotentne)
  - `updateMany` na assets: `IT` → `it-majetok`, `NEW` → `nove`, atď.
- Spustí sa automaticky pri ďalšom deployi

### K4+K5 — Frontend integrácia

- `AssetCreateContent.tsx` — `<select>` pre type/condition/category/location nahradené `<Combobox>`, tags nahradené `<TagsCombobox>`, `Controller` z react-hook-form
- `AssetDetailEditForm.tsx` — rovnaké
- Nové hooks v `api-hooks.ts`: `useAssetTypes`, `useAssetConditions`, `useCreateAssetTypes`, `useCreateAssetConditions`, `useRenameAssetType`, `useRenameAssetCondition`, `useRenameCategory`, `useRenameLocation`

### K6 — Slug pri rename

By design: PATCH s `name` neregeneruje `slug` (stabilné URLs). Ak treba slug zmeniť, treba explicitne poslať `slug` v patchi.

### CI opravy

- `openapi.json` refreshnutý (36 paths, 60 endpoints)
- `shared-types/tests/schemas/asset.test.ts` — test pre `type` aktualizovaný (string, nie enum)
- `apps/api/tests/integration/assets-patch.test.ts` — test pre `condition` aktualizovaný

---

## Commity

```
feat(web): K1 Combobox + TagsCombobox — Atlas-style typeahead components
feat(api): K2 asset_types + asset_conditions CRUD modules with seed defaults
feat: K3 asset type+condition enum→slug migration + shared-types update
feat(web): K4 Combobox integration — AssetCreate + AssetEdit forms
fix(web): a11y keyboard handlers on Combobox + TagsCombobox li elements
fix: update asset type/condition tests + refresh openapi.json for K2-K3 routes
fix(api,shared-types): update tests for per-tenant type/condition string schema
docs: poupratuj — session log + NEXT.md update
```

---

## Otvorené položky

1. **K7 backend testy** — chýbajú integration testy pre `asset-types` + `asset-conditions` routes (RBAC, FK protection, slug)
2. **Smoke test formulárov** — overiť na produkcii po deployi že migrácia prebehla a Combobox funguje
3. **Staré SFZ clustre** — manuálne zmazať v Atlas UI
4. **`email_unique` index** — opraviť pred SFZ onboardingom

---

## Pokračovanie session (to isté 2026-05-29)

### K7 — backend testy pre asset-types + asset-conditions ✅

- `asset-types.test.ts` + `asset-conditions.test.ts` — GET/POST/PATCH/DELETE
- RBAC (EMPLOYEE 403 na writes, MANAGER 403 na delete, ADMIN ok), slug uniqueness + auto-gen,
  rename-nemení-slug, FK protection (DELETE blokovaný ak asset referencuje slug), soft-delete
- Helpers v `test-fixtures.ts`: `insertTestAssetType/Condition`, `validCreateAssetType/ConditionBody`
- `InsertTestAssetOptions.condition` zmenené z union na string

### Zjednotená stránka Číselníky ✅

Používateľ si všimol že `/categories` ako samostatná stránka je redundantná ku Comboboxu. Rozhodnutie:
zjednotiť do 1 stránky `/ciselniky` so 4 záložkami.

- `CiselnikyContent.tsx` — 4 taby (Kategórie, Lokality, Typy majetku, Stavy)
- Generická `TaxonomyTable` (názov / extra stĺpec / slug / akcie), inline rename, delete
- `AddInlineDialog` modál. Autofocus cez `ref={(el)=>el?.focus()}` (jsx-a11y/no-autofocus pravidlo
  nie je definované v ich configu — disable-comment aj `autoFocus` atribút padajú)
- `app/ciselniky/page.tsx` route + AppShell menu update (ListChecks ikona)
- Staré `/categories` + `/locations` ostali funkčné, len nie v menu

### Oprava: migration runner sa NIKDY nevolal 🐛✅

Kritický nález pri debugovaní prečo sú Stavy na prode prázdne:

- Atlas prod: `migrations` kolekcia neexistovala, `asset_types`/`asset_conditions` mali indexy ale 0 dok.
- `runPendingMigrations` nebol napojený NIKDE (server.ts, index.ts, ani Vercel `api/index.ts`)
- Indexy vytvorili repository pluginy pri štárte, nie migrácia → odtiaľ rozpor
- **Fix:** napojené do `buildServer()` po mongo plugine; skip v EXPORT_ONLY + test
- Idempotentné (completedAt guard). Tech debt poznámka: pre scale presunúť do deploy-time kroku

### Auto-seed default číselníkov pre každého tenanta + fork ✅

Používateľ chcel aby nový tenant aj fork mali predplnené číselníky (UX + "nech si o nás nemyslia
budúci používatelia že nevieme čo je vhodné").

- **Jeden zdroj pravdy:** `packages/shared-types/src/defaults/taxonomy-defaults.ts`
  - `DEFAULT_ASSET_TYPES`, `DEFAULT_ASSET_CONDITIONS`, `DEFAULT_CATEGORIES` (hierarchické)
- Service-y (asset-types/conditions) importujú defaulty zo shared-types (de-duplikované)
- **Helper** `apps/api/src/lib/seed-tenant-defaults.ts` — `seedTenantDefaults(db, orgId, createdBy)`
  - typy + stavy: upsert na `{organisationId, slug}`
  - kategórie: dvojfázový find-or-insert (rodič → deti s parentId), idempotentné
- **Napojené:** JIT provisioning + admin create (organisations.service, best-effort try/catch),
  migrácia `2026-05-29` (types+conditions), migrácia `2026-05-29b` (categories backfill — samostatný
  kľúč lebo prvá migrácia už mohla byť completed)
- Kategórie hierarchicky: 6 hlavných, 3 s podkategóriami — učí používateľa že sa dajú vnárať
- Lokality zámerne prázdne

### Commity (pokračovanie)

```
feat(api): K7 asset-types + asset-conditions integration tests (RBAC, FK, slug)
feat(web): unified Číselníky page (categories, locations, types, conditions)
fix(api): wire runPendingMigrations into buildServer (was never called)
feat(api): auto-seed taxonomy defaults for new tenants (fork-customizable)
feat: seed default hierarchical categories for new tenants + forks
docs: poupratuj — NEXT.md + session log
```

### Ďalej na rade

1. **Onboarding flow** pre nových tenantov — uvítací krok / checklist (design + rozsah najprv)
2. Smoke test po deployi (migrations kolekcia, seed counts, /ciselniky)
3. Smoke test s kolegom
4. `email_unique` index fix pred SFZ onboardingom
5. Tech debt: migrácie do deploy-time kroku pri scale

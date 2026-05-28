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

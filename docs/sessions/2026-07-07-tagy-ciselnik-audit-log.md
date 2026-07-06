<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-07-07 — číselník Tagov, Audit log pre správcov

## Kontext

Pokračovanie po `2026-07-06-ui-buttons-tagy-freetext.md`. Dve nové požiadavky
od Janiky, obe s doplňujúcimi otázkami pred implementáciou (org policy).

## Časť 1 — číselník "Tagy" (commity `17ce25e`, `7b76b2bf`)

Požiadavka: doplniť do Číselníkov aj správu tagov, vrátane premenovania,
ktoré opraví (zlúči) tagy na všetkom existujúcom majetku.

### Rozhodnutia (Janika, `AskUserQuestion`)

- Premenovanie aj mazanie (nie len jedno z toho).
- Pri premenovaní na už existujúci tag: automatické zlúčenie duplicít
  (odporúčaná voľba).
- RBAC: Správca majetku (ASSET_MANAGER) + Administrátor (ADMIN) — pre OBE
  operácie, teda aj mazanie (výnimka oproti Kategóriám/Lokalitám, kde je
  mazanie ADMIN-only).

### Backend (`17ce25e`)

- Nové audit akcie `ASSET_TAG_RENAMED` / `ASSET_TAG_DELETED`
  (`shared-types/schemas/audit-log.ts` + `retention.service.ts`
  CRUD_ACTIONS).
- `AssetsRepository`: `findTagsSummary` (tag + počet použití),
  `renameTag` (aggregation-pipeline `updateMany`, `$setUnion`/`$setDifference`
  na množinové zlúčenie duplicít), `deleteTagEverywhere` (`$pull`).
- Nové endpointy: `GET /v1/assets/tags/summary`, `POST /v1/assets/tags/rename`,
  `POST /v1/assets/tags/delete` — `canWrite` (ASSET_MANAGER+ADMIN), obe write
  operácie logujú audit event. `openapi.json` + `api-types.ts` aktualizované.

### Frontend (`7b76b2bf`)

- Nové hooky v `api-hooks.ts`: `useTagsSummary`, `useRenameTag`, `useDeleteTag`
  — po úspechu invalidujú `asset-tags-summary`, `asset-tags` (autocomplete),
  `assets` (zoznam) aj `asset` (detaily).
- Nový tab **"Tagy"** v `CiselnikyContent.tsx` (4. záložka): zoznam tagov
  s počtom použití, inline premenovanie (rovnaký UX vzor ako ostatné taby),
  mazanie cez `ConfirmDeleteDialog` s počtom dotknutých kusov majetku v
  popise. Bez tlačidla "Pridať" — tagy vznikajú len priradením na majetku
  (`TagsCombobox`).
- Zobrazenie použije `displayTag()` (veľké prvé písmeno, kozmetické — dáta
  v DB ostávajú lowercase).

Overené: `tsc --noEmit`, `eslint`, `prettier --check` — čisté pri oboch
commitoch. Nasadené (push na `main`).

### Incident: stale `.git/index.lock`

Commit backend časti najprv zlyhal na `.git/index.lock` (pozostatok
z predošlej session, keď raw bash `git status` narazil na EPERM pri
unlocku). Git MCP tool sám lock nevie odstrániť — Janika ho zmazala ručne
(`rm -f .git/index.lock`), potom commit prešiel bez problémov.

## Časť 2 — Audit log pre správcov (rozrobené)

Požiadavka: kompletný Audit log v menu pre administrátorov, s možnosťou
vyhľadávania.

### Rozhodnutia (Janika, `AskUserQuestion` + doplnenia)

- Filtre: typ akcie + entita + osoba (actor) + dátum (žiadny voľný text).
- Nová samostatná položka menu (nie tab v inom nastavení).
- Zatiaľ len prehľadávanie, žiadny CSV export.
- Scoped na aktívny tenant (nie cross-tenant).
- Sémantika: kto, kedy, čo robil/zmenil.
- **RBAC (dodatočne upresnené):** menu aj endpoint majú vidieť ADMIN
  ("Administrátor") **aj** ASSET_MANAGER ("Správca majetku") — pôvodný
  plán počítal len s ADMIN, Janika chcela pridať aj Správcu majetku.

**Stav:** zatiaľ len naplánované (tasky #56-59), implementácia nezačatá.

## Overenie a nasadenie

- Backend: `tsc -b` (shared-types), `tsc --noEmit` (api), `eslint`,
  `prettier --check` — čisté.
- Frontend: `tsc --noEmit` (web), `eslint`, `prettier --check` — čisté.
- Oba commity pushnuté na `main`.

## Ďalšie kroky

- Implementovať Audit log backend (`GET /v1/audit-log`, filtre +
  stránkovanie, RBAC ADMIN+ASSET_MANAGER, scoped na aktívny tenant).
- Frontend: nová stránka `/audit-log`, hook, menu položka (viditeľná pre
  obe role).
- Overiť tsc+eslint+prettier, commit+push, poupratuj na konci session.

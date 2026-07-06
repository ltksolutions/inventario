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

**Stav: HOTOVÉ a nasadené.** Commity `310ae5b` (backend), `08abcd7` (frontend).

### Backend (`310ae5b`)

- Nový tenant-wide endpoint `GET /v1/audit-log` (na rozdiel od
  existujúceho per-entity `GET /v1/assets/:id/audit`): filtre `action`,
  `entityType`, `actorUserId`, `dateFrom`/`dateTo`, stránkovanie,
  zoradené najnovšie prvé. RBAC: `requireRole(['ASSET_MANAGER', 'ADMIN'])`.
- `AuditLogRepository`: nové `findByOrganisation`/`countByOrganisation`
  - kompound index `{organisationId, at: -1}`. Vždy filtruje podľa
    `organisationId` aktuálneho tenanta — nikdy cross-tenant.
- Nový modul `audit.routes.ts`, zaregistrovaný v `server.ts`.
- `openapi.json` + `api-types.ts`: enum hodnoty pre `action`/`entityType`
  filtre prevzaté priamo z `AuditLogSchema` (shared-types), nie ručne
  prepísané — pri pridaní novej akcie do schémy sa openapi dokument
  musí ešte ručne obnoviť (žiadna automatizácia na to zatiaľ nie je),
  ale aspoň sa hodnoty nekopírujú na dvoch miestach naraz v ručnej úprave.

### Frontend (`08abcd7`)

- Nová stránka `/audit-log` (`AuditLogContent.tsx`): filtre (Akcia, Typ
  entity, Osoba — z rovnakého `/v1/users/directory` ako modul Osoby,
  dátumový rozsah cez `DateField`), tabuľka (dátum/čas, osoba, akcia,
  entita s odkazom na majetok ak `entityType === 'Asset'`, popis,
  závažnosť ako farebný badge), stránkovanie 20/50/100. Bez exportu —
  len prehľadávanie (rozhodnutie Janiky pre v1).
- Nová menu položka "Audit log" v `AppShell.tsx` (`managerOnly` —
  ASSET_MANAGER + ADMIN).
- Nové hooky `useAuditLog`, `useCanViewAuditLog` v `api-hooks.ts`.
- Nová zdieľaná `apps/web/src/lib/audit-labels.ts` — kompletná slovenská
  mapa pre všetky akcie/typy entít/závažnosti zo shared-types
  `AuditLogSchema`. Existujúci per-asset audit tab
  (`AssetDetailContent.tsx`) predtým mal vlastnú lokálnu mapu pokrývajúcu
  len 6 `ASSET_*` akcií — prepojený na zdieľanú, teraz zobrazuje
  správne popisky pre všetky typy akcií, nie len tie na majetku.

### Tenant scoping — overené na výslovnú žiadosť Janiky

Janika upozornila, že Tagy AJ Číselníky AJ Audit log musia byť viditeľné
striktne podľa aktívneho tenanta. Overené v kóde:

- Tagy (`renameTag`/`deleteTagEverywhere`/`findTagsSummary`) používajú
  `tenantFilter(organisationId, ...)`.
- Audit log (`findByOrganisation`/`countByOrganisation`) filtruje vždy
  podľa `organisationId` z `request.currentUser` (rovnaký vzor ako
  existujúci `findByTarget`/`countByTarget`).
- Frontend: existujúci `switchOrg()` (`auth-context.tsx`) už pred touto
  session invaliduje CELÚ react-query cache pri prepnutí tenanta
  (`queryClient.invalidateQueries()` bez filtra) — vzťahuje sa
  automaticky aj na nové Tagy aj Audit log hooky, žiadna extra práca
  netreba.

## Overenie a nasadenie

- Backend: `tsc -b` (shared-types), `tsc --noEmit` (api), `eslint`,
  `prettier --check` — čisté.
- Frontend: `tsc --noEmit` (web), `eslint`, `prettier --check` — čisté.
- Všetky 4 commity (Tagy backend/frontend, Audit log backend/frontend)
  pushnuté na `main`.

## Ďalšie kroky

- Živé odskúšanie na produkcii (filtre v Audit logu, premenovanie/mazanie
  tagu so zlúčením duplicít).
- Zvážiť budúci CSV export z Audit logu (zámerne mimo v1 rozsahu).

<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session log — 2026-07-06 (večer, pokračovanie): Tagy — normalizácia + autocomplete

## Zadanie

Janika sa opýtala na pole "Tagy" na majetku:

1. Existuje niekde sumár tagov / samostatná kolekcia?
2. Dá sa pri zadávaní/editácii majetku ponúknuť zoznam existujúcich tagov, so zachovaním možnosti pridať nový?
3. Platia pravidlá na formát tagu (malé/veľké písmená, viacslovné tagy)?

## Prieskum (pred implementáciou)

- Tagy sú denormalizované pole `string[]` priamo v `Asset` dokumente — žiadna samostatná kolekcia, žiadny API endpoint na ich výpis.
- Zaujímavé zistenie: `TagsCombobox.tsx` mal už pripravenú `suggestions` prop na autocomplete, ale **nikde sa nepoužívala** — infraštruktúra existovala, ale nefungovala.
- Server-side sa vynucovala len dĺžka (1–50 znakov), nič viac. Klientská normalizácia (trim + lowercase) existovala len v `TagsCombobox.addTag()`, teda len kozmeticky pre toto jedno UI — iná cesta dát (import, iný klient) by uložila tag presne tak, ako prišiel.
- `docs/architecture/data-model.md` deklaruje plánovaný text index na `tags`, ktorý v skutočnom kóde neexistuje (nesúlad dokumentácia/kód, nezasahoval som doň v tomto kole).

## Rozhodnutia (odpovede Janiky)

- Rozsah: dorobiť celé teraz (endpoint + zapojenie do UI), nie len naplánovať.
- Pravidlá vynútené na serveri: **lowercase**, **trim + zbalenie viacnásobných medzier**, **viacslovné tagy s medzerou povolené** (nie pomlčky). Limit počtu tagov na majetok Janika nevybrala — zostáva bez obmedzenia.

## Implementácia

**Server-side normalizácia** (`packages/shared-types/src/schemas/common.ts`):

- Nová `TagSchema` — `.transform()` (trim → zbaliť medzery → lowercase) → `.pipe()` s validáciou dĺžky 1–50 AŽ PO normalizácii.
- `AssetSchema.tags` (shared-types) aj duplicitná `ApiCreateAssetBodySchema.tags` (`apps/api/assets.routes.ts`, POST telo) prepnuté na `TagSchema`. PATCH ide cez `UpdateAssetSchema` (shared-types) priamo, takže tam stačila jedna zmena.

**Endpoint na existujúce tagy**:

- `AssetsRepository.findDistinctTags(organisationId)` — Mongo `distinct('tags', ...)`, tenant-scoped, vylučuje soft-deleted, zoradené abecedne (`localeCompare('sk')`).
- Nový `GET /v1/assets/tags` (EMPLOYEE+, statická cesta popri `/v1/assets/:id` — find-my-way router ju prioritizuje bez ohľadu na poradie registrácie, rovnaký vzor ako `/v1/users/directory`).

**Frontend**:

- `useAssetTags()` hook (`api-hooks.ts`, generic-cast pattern — endpoint zatiaľ nie je v generated `api-types.ts`).
- `suggestions={tagsQuery.data}` zapojené do `TagsCombobox` v `AssetCreateContent.tsx` aj `AssetDetailEditForm.tsx`.
- `TagsCombobox.addTag()` doplnené o zbalenie viacnásobných medzier (predtým len trim+lowercase) — zhoda s `TagSchema` pre okamžitú klientskú spätnú väzbu (dedup vo formulári).
- `TagsComboboxProps.suggestions` typ rozšírený na `string[] | undefined` (exactOptionalPropertyTypes — `tagsQuery.data` je `undefined` počas loadingu).

## Overenie

- `tsc --noEmit` (API aj web), `eslint`, `prettier` — všetko čisté.
- Commit `d3aee39`, push, oba deploymenty (API `dpl_Ej4eAdW...`, web `dpl_6r81Sj...`) READY, `get_runtime_errors` (10 min okno) bez nových chýb.

## Poznámka pre budúcnosť

Existujúce tagy uložené pred touto zmenou (rôzna veľkosť písmen, nezbalené medzery) sa retroaktívne neupravujú — normalizácia platí len pre nové zápisy (POST/PATCH). Ak by sa ukázalo, že v produkčných dátach je veľa nekonzistentných variantov, treba zvážiť jednorazovú migráciu (`runPendingMigrations()` vzor).

<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-07-15 (pokračovanie) — cleanup „Osoby" + oprava CI

## Časť A — cleanup nepoužitých súborov po zlúčení Osoby+Používatelia (task #35)

Janika potvrdila, že `/users` funguje dobre v produkcii pre oba prípady
(ADMIN aj ASSET_MANAGER), a dala pokyn na cleanup.

**Pôvodný plán** (zo session logu 2026-07-14) rátal so zmazaním celého
`usePersonsDirectory`/`PersonSummary`/backend `/v1/users/directory*` páru
routes ako nepoužitých. Pri overovaní pred zmazaním (grep na skutočné
importy, nie len na to, čo hovoril starý session log) sa ukázalo, že to
nie je presné:

- `apps/web/src/components/PersonsContent.tsx` a `PersonDetailContent.tsx`
  — naozaj úplne nepoužité (len komentáre v `/persons` stránkach ich
  spomínali ako "kept pending cleanup"). **Zmazané.**
- `usePerson()` (jednotné číslo, `GET /v1/users/directory/:id`) — jediný
  volajúci bol `PersonDetailContent.tsx`, takže po jeho zmazaní je aj
  tento hook mŕtvy kód. **Zmazané** (hook z `api-hooks.ts` + samotná route
  `GET /v1/users/directory/:id` z `users.routes.ts`).
- `usePersonsDirectory()` (množné číslo, `GET /v1/users/directory` LIST) a
  typ `PersonSummary` — **NEZMAZANÉ.** Grep ukázal druhého, nesúvisiaceho
  volajúceho: filter "Osoba" na stránke Audit log
  (`AuditLogContent.tsx:usePersonsDirectory({ limit: 200 })`, používa sa
  na naplnenie dropdownu pre filtrovanie audit logu podľa aktéra). Tento
  vzťah nebol zaznamenaný v pôvodnom pláne cleanupu — keby sa zmazalo bez
  tejto kontroly, Audit log filter by prestal fungovať.

**Výsledný rozsah zmazania:**

- `apps/web/src/components/PersonsContent.tsx` (zmazané)
- `apps/web/src/components/PersonDetailContent.tsx` (zmazané)
- `usePerson()` v `api-hooks.ts` (zmazané)
- `GET /v1/users/directory/:id` route v `users.routes.ts` (zmazané)

**Zachované** (s doplneným komentárom vysvetľujúcim prečo, aby sa to
nabudúce neopakovalo): `usePersonsDirectory()`, `PersonSummary`,
`GET /v1/users/directory` (list), `toDirectoryShape`, `DirectoryQuerySchema`,
`DirectoryItemSchema`, `DirectoryListResponseSchema` — všetky potrebné pre
Audit log filter.

`/persons` a `/persons/[id]` ostávajú ako `redirect('/users')` (staré
záložky) — ich komentáre aktualizované, že komponenty sú teraz naozaj
zmazané (nie len "pending").

`tsc --noEmit`, `eslint`, `prettier --check` čisté na všetkých dotknutých
súboroch (backend aj frontend).

## Časť B — CI zlyhanie (GitHub Actions #365, #366)

Po pushi commitu `5fabb30` (detail+editácia používateľa, K1 backend)
zlyhali v CI dva existujúce testy:

- `users-get.test.ts` → `returns 200 with a trimmed shape for ASSET_MANAGER`
- `users-list.test.ts` → `trims ASSET_MANAGER response to .../roles/isActive/lastLoginAt only`

Príčina: oba testy overovali presný zoznam polí v ASSET_MANAGER-orezanom
tvare (`toManagerShape()`) ako `['_id', 'displayName', 'email', 'isActive',
'lastLoginAt', 'roles']` — ale K1 (task #37) tento tvar zámerne rozšíril o
`firstName`/`lastName`, aby ich nová stránka `/users/[id]` mohla zobraziť
v hlavičke aj pre ASSET_MANAGER. Testy neboli pri tej zmene aktualizované
— chýbajúci krok pri K1, nie regresia v behaviore.

**Oprava:** oba testy teraz očakávajú
`['_id', 'displayName', 'firstName', 'lastName', 'email', 'isActive',
'lastLoginAt', 'roles']`, s komentárom vysvetľujúcim prečo. Test names
aktualizované, aby zodpovedali novému zoznamu polí.

`tsc --noEmit`, `eslint`, `prettier --check` čisté. `vitest` sa v sandboxe
nedá spustiť (rovnaký dôvod ako doteraz — chýbajúci natívny
`@rollup/rollup-linux-arm64-gnu` binár) — CI na GitHub je autoritatívne
overenie tejto opravy.

## Čo zostáva

- Sledovať, že najbližší CI beh (po pushi) je zelený.
- Overiť Vercel deploy READY, `get_runtime_errors` bez nových nálezov.

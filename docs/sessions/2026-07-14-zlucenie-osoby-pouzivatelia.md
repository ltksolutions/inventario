<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-07-14 (pokračovanie) — zlúčenie „Osoby" + „Používatelia"

## Kontext

Janikov nápad: dá sa zlúčiť menu „Osoby" a „Používatelia" do jedného?

Preskúmaný kód: obe stránky čítali tú istú `users` kolekciu, len cez dva rôzne
endpointy s rôznym RBAC a rôznym výrezom polí.

- **„Používatelia"** (`/users`, len ADMIN) — plná administrácia: aktivácia/
  deaktivácia, GDPR obmedzenie, rola cez membership, odznak „Očakáva nástup".
- **„Osoby"** (`/persons`, ASSET_MANAGER+ADMIN) — zámerne odľahčený, read-only
  adresár (`GET /v1/users/directory*`) len na vyhľadanie človeka a preklik na
  jeho „osobnú kartu majetku" (čo má vypožičané) — bez MFA stavu a admin akcií.

Precedens v kóde: staršia samostatná stránka „Členovia" bola už raz takto
zrušená a zlúčená do „Používateľov".

Rozhodnuté (AskUserQuestion, 3 kolá):

1. Jedna stránka, jedno menu, obsah podľa role (nie len zdieľaný backend)
2. URL `/users` (nie `/persons`) — staré záložky presmerované
3. Detail osoby pre ASSET_MANAGER: nahradiť doterajším edit dialógom (nie
   samostatná osobná karta majetku) — výpožičky sa presúvajú do dialógu
4. Nepoužité súbory po overení: zmazať (nie nechať ležať) — vyžaduje ešte
   Janikino výslovné potvrdenie v momente mazania (org pravidlo, task #35)

## Implementácia (K1–K4, commity `6c87197`/`099e3c5`/`d2300b8`)

### K1 — backend RBAC + response shaping

`apps/api/src/modules/users/users.routes.ts`:

- `GET /v1/users` a `GET /v1/users/:id`: RBAC guard `canAdmin` → `canManage`
  (ASSET_MANAGER+ADMIN).
- Nová funkcia `toManagerShape()` (odlišná od legacy `toDirectoryShape()`,
  ktorá zostáva zamrznutá pre stále živé, ale už nepoužívané
  `/v1/users/directory*`) — vracia `_id, displayName, email, roles, isActive,
lastLoginAt` pre ASSET_MANAGER callera. `lastLoginAt` navyše oproti starému
  directory tvaru — ASSET_MANAGER predpripravuje budúcich zamestnancov
  (ADR-0034) a potrebuje vidieť odznak „Očakáva nástup".
- ADMIN caller (`request.currentUser.role === 'ADMIN'`) dostane nezmenený
  plný tvar. Zápisové endpointy (`PATCH /v1/users/:id`,
  `PATCH`/`DELETE /v1/memberships/:id`) ostávajú ADMIN-only bez zmeny.

### K2 — frontend merge

- `AppShell.tsx`: `/persons` nav odkaz zrušený, `/users` zmenené z
  `adminOnly` na `managerOnly`.
- `UsersContent.tsx`: gate na `useCanManagePersons()` (názov predchádza
  zlúčenie, zachovaný, aby sa nemuselo sahať do súborov určených na zmazanie),
  `canAdmin` (`useCanAdminUsers()`) navyše rozhoduje o akcii v riadku
  („Upraviť" vs „Zobraziť") a čo dialóg ponúka.
- `UserEditDialog.tsx`: nový prop `canEdit`. `canEdit=false` → čisto read-only
  (rola/stav ako text, žiadny danger zone, len tlačidlo „Zavrieť"). Pre oboch:
  nová sekcia „Výpožičky tejto osoby" (aktuálny majetok / čakajúce žiadosti /
  história) — portovaná z `PersonDetailContent.tsx` (`useLoans`,
  `useLoanRequests`), aby sa táto funkcia nestratila. Dialóg dostal
  `max-h-[85vh]` + `overflow-y-auto` na telo (dlhší obsah).
- `/persons/page.tsx` a `/persons/[id]/page.tsx`: prerobené na
  `redirect('/users')` — staré záložky/odkazy fungujú, komponenty
  `PersonsContent`/`PersonDetailContent` už nie sú importované, ale ostávajú
  na disku (task #35).

### K3 — testy

`apps/api/tests/integration/users-list.test.ts` a `users-get.test.ts`:

- Opravený existujúci RBAC test (`ASSET_MANAGER` už nemá byť v `it.each` na
  403 — dostáva teraz 200).
- Nové testy: ASSET_MANAGER → 200 + presný trimmed tvar (`Object.keys` sedí
  presne na `_id/displayName/email/isActive/lastLoginAt/roles`, žiadne
  `organisationId/createdAt/accountType/preferences/passwordHash`). ADMIN →
  nezmenený plný tvar (`organisationId`, `createdAt`, `membershipId` prítomné).
- `PATCH /v1/users/:id` už mal existujúci test na 403 pre ASSET_MANAGER —
  nezmenené, potvrdzuje, že zápisová cesta ostala ADMIN-only.

`tsc --noEmit`, `eslint`, `prettier --check` čisté v sandboxe na všetkých
dotknutých súboroch. `vitest` sa v sandboxe nedá spustiť (rovnaký dôvod ako
pri ADR-0034 K5 — chýba natívny `@rollup/rollup-linux-arm64-gnu` binár).
Janika spustí lokálne.

### K4 — dokumentácia

`docs/user-guide/reference/role-opravnenia.md`: riadok „Používatelia (admin
PATCH)" prerobený na „Používatelia (zoznam, detail, úprava)" so stĺpcom
čítania `ASSET_MANAGER / ADMIN`, nová poznámka pod čiarou vysvetľujúca
zlúčenie a rozdiel v obsahu. Žiadny iný user-guide dokument nespomínal
„Osoby"/`/persons`.

## Čo zostáva urobiť lokálne (Janika)

```bash
pnpm --filter api test tests/integration/users-list.test.ts tests/integration/users-get.test.ts
```

Po nasadení a krátkom overení v UI (že ASSET_MANAGER vidí zoznam +
read-only detail s výpožičkami, ADMIN nezmenene edituje) môžeš potvrdiť
task #35 — zmazanie nepoužitých súborov:

- `apps/web/src/app/persons/page.tsx` už len redirect (necháva sa)
- `apps/web/src/app/persons/[id]/page.tsx` už len redirect (necháva sa)
- `apps/web/src/components/PersonsContent.tsx` (na zmazanie)
- `apps/web/src/components/PersonDetailContent.tsx` (na zmazanie)
- `apps/web/src/lib/api-hooks.ts`: `usePersonsDirectory`, `usePerson`,
  `PersonSummary` (na zmazanie, po overení že nič iné ich nepoužíva)
- `apps/api/src/modules/users/users.routes.ts`: `/v1/users/directory` a
  `/v1/users/directory/:id` routes + `toDirectoryShape`/`DirectoryItemSchema`/
  `DirectoryQuerySchema`/`DirectoryListResponseSchema` (na zmazanie)

## Overenie a nasadenie

Push (3 commity naraz) → `inventario-web` READY hned, ale `inventario-api`
deployment pre finálny commit skončil **CANCELED** ("ignored-build-step").
Príčina: `ignoreCommand` v `apps/api/vercel.json`/`apps/web/vercel.json`
porovnával `git diff HEAD^ HEAD` — pri jednom `git push` s viacerými commitmi
to porovná len posledný commit (docs) voči jeho priamemu rodičovi, nie voči
poslednému skutočne nasadenému commitu. Keď je posledný commit v push
docs-only, celý push sa nesprávne vyhodnotí ako "len docs" a build API sa
preskočí — potvrdené priamo v produkcii (`GET /openapi.json` na
`api.inventario.estate` stále vracal starý popis „List users (admin)").

**Fix (commit `73ae0f4`):** `ignoreCommand` teraz používa
`${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}` — `VERCEL_GIT_PREVIOUS_SHA` je SHA
posledného úspešného deploymentu pre projekt/branch (exponovaný práve pri
Ignored Build Step), takže správne zachytí celý rozsah zmien od posledného
reálneho nasadenia, nie len posledný commit. Overené oficiálnou Vercel
dokumentáciou pred aplikovaním. Tento samotný push (netýka sa `docs/`) navyše
vynútil čerstvý build API, ktorým sa K1–K3 zmeny konečne reálne nasadili.

**Overené po redeployi:**

- `inventario-api` aj `inventario-web` READY.
- `GET https://api.inventario.estate/openapi.json` → `/v1/users` teraz
  `"List users (manager)"` (predtým `"List users (admin)"`) — K1 potvrdené live.
- `get_runtime_errors` (1h okno): žiadne nové chyby, len existujúca
  neúvisiaca anomália `MongoServerError: bad auth` (6× od 2026-05-28,
  zdokumentovaná už v predošlom session logu).

**Poznámka do budúcna:** ak sa má pushnúť viac commitov naraz, tento fix už
by mal správne zachytiť celý rozsah — ale bezpečnejšie je aj naďalej pushovať
priebežne (jeden commit → jeden push), nie kumulovať viac commitov pred
pushom.

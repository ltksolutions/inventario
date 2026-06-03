<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0029. Jedna hierarchická rola na membership (namiesto poľa rolí)

|                   |                                                                                                                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | 🟢 Accepted                                                                                                                                                                                                                                                       |
| **Dátum**         | 2026-06-03                                                                                                                                                                                                                                                        |
| **Autori**        | Ján Letko, Claude Opus 4.8 (LTK Solutions)                                                                                                                                                                                                                        |
| **Súvisiace ADR** | [0015 Cross-tenant memberships](0015-cross-tenant-memberships.md) (roly žijú na Membership), [0024 Odstránenie TEAM_MANAGER](0024-remove-team-manager-role.md) (predchádzajúce zúženie enumu), [0013 Multi-provider auth](0013-multi-provider-auth-self-serve.md) |

## Kontext

Dnešný model: člen organizácie (`Membership`) má **pole rolí** —
`roles: UserRole[]` s `.min(1)`. RBAC vrstva (`requireRole(allowed)` v
`apps/api/src/plugins/auth.ts`) vyhodnocuje prístup ako **OR cez množinu**:
„má používateľ aspoň jednu z povolených rolí?". Žiadna hierarchia neexistuje
— `ADMIN` **nededí** oprávnenia `ASSET_MANAGER`. Funguje to len preto, že
každý route povolené roly vymenúva explicitne (napr.
`requireRole([ADMIN, ASSET_MANAGER])`), alebo preto, že membership dostane
viac rolí naraz.

Dôsledok je viditeľný v UI: formulár pozvánky (`InvitationsContent.tsx`)
dovolí vybrať **viac rolí naraz** (multi-select „chips"). To nie je bug —
je to priamy odraz toho, že model je „množina". Ale nezodpovedá to
zamýšľanej sémantike.

### Zamýšľaná sémantika (rozhodnutie produktu)

Človek má v jednom tenante mať **práve jednu rolu**, pričom roly tvoria
**lineárnu hierarchiu úrovní prístupu**:

- **`ADMIN`** — môže všetko; zahŕňa aj schopnosti `ASSET_MANAGER` aj základného používateľa.
- **`ASSET_MANAGER`** — zahŕňa aj schopnosti základného používateľa (`EMPLOYEE` / `EXTERNAL`).
- **Základný používateľ** — je buď **`EMPLOYEE`**, alebo **`EXTERNAL`**.

`EMPLOYEE` a `EXTERNAL` sú **rovnocenné** (rovnaká úroveň prístupu), líšia sa
len **typom** vzťahu k organizácii (interný zamestnanec vs. externý
spolupracovník — klubový tréner, dobrovoľník). `TEAM_MANAGER` už neexistuje
([ADR-0024](0024-remove-team-manager-role.md)).

Vyjadrené úrovňami:

```
ADMIN          → level 3
ASSET_MANAGER  → level 2
EMPLOYEE       → level 1
EXTERNAL       → level 1   (rovnocenné s EMPLOYEE, len iný typ)
```

RBAC by sa pýtal „má používateľ aspoň úroveň X?" namiesto dnešného „je jeho
rola v zozname?". `requireMinRole(ASSET_MANAGER)` by znamenalo
„ASSET_MANAGER a vyššie" → `ADMIN` prejde automaticky. To je presne tá
dedičnosť, ktorá dnes chýba a kvôli ktorej sa všade vypisuje
`[ADMIN, ASSET_MANAGER]`.

### Háčik, ktorý treba ošetriť vedome

Keďže `EMPLOYEE` a `EXTERNAL` sú na **rovnakej úrovni**, samotná úroveň ich
nerozlíši. Ak niekde existuje pravidlo „toto smie `EMPLOYEE`, ale nie
`EXTERNAL`" (alebo naopak — napr. externý vidí len svoj klub), nie je to
otázka úrovne, ale **typu**, a musí sa kontrolovať explicitne na konkrétnu
rolu. Preto si musíme nechať možnosť pýtať sa aj na **presnú rolu**, nielen
na úroveň. Inak by sa „rovnocennosť" zvrhla na „identickosť", čo nechceme.

V čase písania tohto ADR **žiadne také pravidlo neexistuje** — v celom
`apps/api` sa nikde nerozlišuje `EMPLOYEE` vs `EXTERNAL` (oba sú vždy len
súčasťou „EMPLOYEE+" množiny v `requireRole`). Rozlíšenie je zatiaľ čisto
sémantické/UI. Mechanizmus na presnú rolu pripravíme, ale nepoužijeme.

### Obmedzenia

- **Schémy sú zdroj pravdy** (Zod → TS → JSON Schema → Mongo `$jsonSchema` →
  OpenAPI → `apps/web/api-types.ts`). Zmena tvaru roly na membership/pozvánke
  prefiltruje cez celý reťazec. Regen je povinný (viď ADR-0024).
- **Existujúce dáta.** `Membership.roles[]` aj `Invitation.roles[]` aj
  (deprecated) `User.roles[]` obsahujú polia. Pri prechode na jednu rolu
  treba migráciu, ktorá z poľa odvodí jednu hodnotu (najvyššia úroveň
  v poli).
- **JWT.** `InventarioJwtPayload.roles: string[]` a `issueAccessToken(...,
roles)` nesú pole. Zmena claimu sa dotkne všetkých auth tokov; krátkodobo
  (do expirácie 15-min access tokenov) budú v obehu staré tokeny.
- **Pred pilotom.** Reálne produkčné dáta zatiaľ nie sú kritické (LTK test
  tenant + príprava SFZ). Čistejšie spraviť teraz než po onboardingu.
- **SFZ repo.** `shared-types` je zdieľaný princíp s `Asset-Management`
  repom. Zmena sa prejaví aj tam — overiť pri implementácii.
- **Last-admin ochrana** (`countActiveAdmins`, `assertNotLastAdmin`,
  `assertNotLockingAdminOut`) dnes počíta cez `roles: 'ADMIN'` resp.
  `roles.includes('ADMIN')`. Musí ostať funkčná po zmene tvaru.

## Možnosti

Otázka nie je „či" (sémantika je rozhodnutá), ale **„ako hlboko rezať"** do
dátového modelu. Tri varianty, zoradené od najmenšieho po najväčší zásah.

### Možnosť A: Nechať `roles[]`, pridať len hierarchiu pri vyhodnocovaní + jednorola na vstupe

Dátový model (`roles: UserRole[]`) **ostáva**. Zmení sa len:

- **Vstup**: UI a pozvánka prejdú na single-select (jedna rola).
- **Ukladanie**: z jednej zvolenej roly sa uloží jednoprvkové pole
  (`ADMIN` → `['ADMIN']`).
- **RBAC**: pridá sa `requireMinRole(level)` postavený nad hierarchiou; staré
  `requireRole([...])` sa buď ponechá, alebo postupne nahradí.

- Plus: najmenší zásah; spätne kompatibilné s existujúcimi dátami bez
  migrácie tvaru; testy seedujúce `roles: [...]` ostávajú platné.
- Mínus: dáta naďalej **dovoľujú** stavy, ktoré model zakazuje
  (`['ADMIN', 'EXTERNAL']`); invariant „práve jedna rola" nie je vynútený
  schémou, len konvenciou na vstupe. Trvalý zdroj obrannej logiky proti
  vlastnej schéme. Pole `roles[]` zostáva ako mätúci „mŕtvy" multiplicitný
  rozmer.

### Možnosť B: Plná zmena tvaru na `role: UserRole` (zvolené)

Zmeniť dátový model z `roles: UserRole[]` na **`role: UserRole`** (jedna
hodnota) všade — schéma, JWT claim, migrácia, každý `roles.includes(...)`,
frontend. Hierarchia ako samostatná utilita (`lib/role-hierarchy.ts`)
s mapou úrovní a `requireMinRole`.

- Plus: konceptuálne čistý model; invariant „práve jedna rola" je vynútený
  **schémou**, nie konvenciou; nedá sa uložiť nekonzistentný stav; UI
  multi-select prirodzene zmizne; RBAC dedičnosť je explicitná a testovateľná.
- Mínus: dotkne sa ~25–30 miest v kóde + väčšina auth/membership/users testov;
  migrácia tvaru dát; koordinácia so SFZ repom; väčšie jednorazové riziko.

### Možnosť C: Rola + ortogonálny príznak `isExternal`

Jedna rola v hierarchii (`ADMIN | ASSET_MANAGER | EMPLOYEE`) plus samostatný
boolean `isExternal` pre typ.

- Plus: úroveň a typ sú explicitne oddelené.
- Mínus: protirečí rozhodnutiu, že `EMPLOYEE` a `EXTERNAL` sú **rovnocenné**
  — robil by z jedného rolu a z druhého príznak, čo zavádza asymetriu, ktorá
  nezodpovedá mentálnemu modelu. Dva zdroje pravdy pre „čo používateľ je".
  Zamietnuté.

## Rozhodnutie

Zvolená **Možnosť B — plná zmena tvaru na `role: UserRole`** + hierarchická
RBAC utilita. Dôvod: invariant „práve jedna rola" má byť vynútený v schéme,
nie dúfaný pri čítaní. Robíme to pred pilotom, kým sú dáta malé a migrácia
lacná. Možnosť A by trvalo nechala `roles[]` ako mätúci rozmer a večný zdroj
obranného kódu.

### 1. Enum + hierarchia (`packages/shared-types`)

- `user-role.ts`: ponechať hodnoty `EMPLOYEE | ASSET_MANAGER | ADMIN | EXTERNAL`.
  Pridať **mapu úrovní** a pomocné funkcie (čistá doména, testovateľná bez DB):
  ```
  ROLE_LEVEL: Record<UserRole, number> = {
    ADMIN: 3, ASSET_MANAGER: 2, EMPLOYEE: 1, EXTERNAL: 1,
  }
  roleSatisfies(actual: UserRole, required: UserRole): boolean
    → ROLE_LEVEL[actual] >= ROLE_LEVEL[required]
  ```
  Pozn.: `roleSatisfies(EXTERNAL, EMPLOYEE)` === `true` a naopak — sú
  rovnocenné. Na rozlíšenie typu slúži priame porovnanie `role === 'EXTERNAL'`.

### 2. Schémy — `roles[]` → `role`

- `membership.ts`: `roles: z.array(...).min(1)` → `role: z.enum(USER_ROLE_VALUES)`.
  Aktualizovať `CreateMembershipSchema`, `UpdateMembershipSchema` (`.pick({ role: true, ... })`).
- `invitation.ts`: `roles` → `role` v `InvitationSchema` aj `CreateInvitationSchema`.
- `user.ts` (deprecated `User.roles`): zvážiť ponechanie ako deprecated poľa
  (číta ho už len `synthesizeMembership` fallback a JIT provisioning). Buď
  tiež `role`, alebo nechať `roles[]` ako čisto legacy a nikdy nečítať pre RBAC.
  **Rozhodnúť pri implementácii** (viď Riziká).

### 3. RBAC vrstva (`apps/api/src/plugins/auth.ts`)

- Pridať `requireMinRole(required: UserRole)`: porovná `roleSatisfies(membership.role, required)`.
- Ponechať `requireRole(allowed: UserRole[])` pre prípady „presná rola / typ"
  (zatiaľ nepoužité pre EMPLOYEE/EXTERNAL rozlíšenie, ale pripravené).
- Prepísať existujúce guardy:
  - `[ADMIN, ASSET_MANAGER]` → `requireMinRole(ASSET_MANAGER)`
  - `[EMPLOYEE, ASSET_MANAGER, ADMIN, EXTERNAL]` (EMPLOYEE+) → `requireMinRole(EMPLOYEE)`
  - `[ADMIN]` → `requireMinRole(ADMIN)`
- `synthesizeMembership`: `roles` → `role` (fallback default `EMPLOYEE`).
- Backfill `request.currentUser.roles` (ADR-0015 compat) → `request.currentUser.role`.
  Pozor: servisná vrstva číta `actor.roles` (loans `hasManagerRole`, cancel admin
  check) — viď bod 5.

### 4. JWT (`apps/api/src/plugins/inventario-jwt.ts`)

- `InventarioJwtPayload.roles: string[]` → `role: string`.
- `issueAccessToken(user, org, membershipId, role)` — zmeniť signatúru z `roles` na `role`.
- `assertInventarioPayload` — validovať `role` (string) namiesto `roles` (array).
- Všetci volajúci `issueAccessToken` (oauth, email-auth, invitations, auth-session,
  registration) — odovzdať jednu rolu namiesto poľa.
- **Spätná kompatibilita**: staré tokeny s `roles[]` claimom prestanú validovať
  → používateľ sa musí znova prihlásiť. Pri pred-pilotnej fáze akceptovateľné;
  alternatíva = dočasne tolerovať oba tvary v `assertInventarioPayload` (viď Riziká).

### 5. Servisná vrstva — `actor.roles` / `roles.includes`

Prejsť a prepísať každý výskyt (presný zoznam v sekcii „Súpis dotknutých miest"):

- `loans.service.ts`: `hasManagerRole(actor)` (`actor.roles.includes('ASSET_MANAGER' | 'ADMIN')`)
  → `roleSatisfies(actor.role, 'ASSET_MANAGER')`; `cancelLoanRequest` admin check
  `actor.roles.includes('ADMIN')` → `actor.role === 'ADMIN'` (alebo `roleSatisfies`).
  Mongo filter `roles: { $in: ['ASSET_MANAGER', 'ADMIN'] }` (notify managers) →
  `role: { $in: ['ASSET_MANAGER', 'ADMIN'] }`.
- `users.service.ts`: `assertNotLockingAdminOut`, `update` (rolesBefore/rolesAfter
  diff, `countActiveAdminsExcluding`), JIT `buildUserFromClaims` (`roles: [EMPLOYEE]`),
  audit `USER_ROLE_GRANTED/REVOKED` (per-rola diff → jedna zmena role).
- `memberships.service.ts`: `assertNotLastAdmin`/`assertNotLastAdminForDeletion`
  (`targetRoles.includes('ADMIN')` → `role === 'ADMIN'`).
- `memberships.repository.ts`: `countActiveAdmins` filter `roles: 'ADMIN'` → `role: 'ADMIN'`.
- `memberships.routes.ts`: `PatchMembershipBodySchema` (`roles` → `role`),
  `activeMembership.roles.includes('ADMIN')` → `role === 'ADMIN'` /
  `roleSatisfies`, GET /v1/members + /v1/memberships výstup (`roles` → `role`).

### 6. Write-side provisioning (auth toky)

Všetky cesty, ktoré vytvárajú Membership/User/Invitation, musia písať jednu
rolu (dnes píšu `roles: [...]`):

- `registration.routes.ts` (email reg → ADMIN)
- `email-auth.routes.ts` (`/register/email` → ADMIN)
- `oauth.routes.ts` (self-serve ADMIN, `acceptInviteViaOAuth` new-user + cross-tenant)
- `invitations.routes.ts` (POST invite, accept new-user + existing-user, resend)

**Invariant (ADR-0015 rozšírenie):** všetky org-create / membership-create cesty
sa musia upraviť pri každej zmene tvaru roly — dokumentovaný invariant, rovnako
ako pri pridaní povinného poľa do Organisation.

### 7. Frontend (`apps/web`)

- `InvitationsContent.tsx`: multi-select chips → **single-select** (radio/jediný
  aktívny chip); odstrániť mŕtvy `TEAM_MANAGER` z `ALL_ROLES` (zvyšok po ADR-0024);
  `selectedRoles: Role[]` → `selectedRole: Role`; POST body `roles` → `role`;
  ADMIN gating (ASSET_MANAGER nemôže pozvať ADMIN) zachovať; label „Rola" je
  teraz správne v jednotnom čísle.
- `api-hooks.ts`: `MeResponse.roles` → `role`; `UserSummary.roles`/`UserDetail.roles`
  → `role`; `UserUpdatePatch.roles` → `role`; všetky helpery
  (`useCanAdminUsers`, `useCanEditAssets`, `useCanManageTaxonomy`,
  `useCanDeleteTaxonomy`, `useCanManageLoans`, `useCanManageStock`) prepísať
  z `roles.includes(...)` na `roleSatisfies(role, ...)` ekvivalent (frontend si
  drží vlastnú malú kópiu hierarchie alebo ju importuje zo `shared-types`);
  `USER_ROLES` tuple + `Role` typ aktualizovať; `MemberPickerItem.roles` → `role`.
- `AcceptInvitePage.tsx`: `InvitePreview.roles` → `role`; odstrániť `TEAM_MANAGER`
  z `ROLE_LABELS`; `roleLabel` = jediná rola.
- `auth-context.ts` (mimo prečítaného rozsahu — overiť): `user.roles` → `role`.
- Members/users admin stránky (`settings/members`, `users`) — overiť výber roly.

### 8. Migrácia dát

Nový skript v `apps/api/src/migrations/` (pattern ako 2026-05-31):

- `memberships`: pre každý doc `role = highestOf(roles[])` podľa `ROLE_LEVEL`
  (max úroveň v poli; pri zhode úrovní EMPLOYEE/EXTERNAL preferovať... — viď
  Riziká, treba pravidlo), potom `$set role`, `$unset roles`.
- `invitations`: rovnako `roles[]` → `role`.
- (deprecated) `users.roles`: podľa rozhodnutia v bode 2.
- Idempotentné (ak už má `role` a nemá `roles`, skip).

### 9. Regen artefaktov + testy

- `pnpm --filter @inventario/shared-types build` (JSON Schema regen).
- OpenAPI export (`pnpm --filter @inventario/api openapi:export:offline`),
  regen `apps/web/api-types.ts`.
- Testy: `rbac.test.ts`, `invitations-*.test.ts`, `auth*.test.ts`,
  `users-*.test.ts`, `migration-memberships.test.ts`, nová migrácia, fixtures
  (`test-fixtures.ts`, `test-jwt.ts` — JWT `roles` claim), `cross-tenant-isolation.test.ts`.
  Všetky `insertTestX({ roles: [...] })` → `role`.

## Súpis dotknutých miest (grep-driven, na overenie pri implementácii)

> Tento súpis je východiskový; pri implementácii spraviť úplný grep
> `roles` / `requireRole` / `\.roles` cez `apps/api/src`, `apps/web/src`,
> `packages/shared-types/src` (a SFZ repo), lebo niektoré výskyty (auth-context,
> admin stránky, MCP server) sú mimo prečítaného rozsahu.

### `packages/shared-types/src`

- `enums/user-role.ts` — pridať `ROLE_LEVEL` + `roleSatisfies` (enum hodnoty bez zmeny).
- `schemas/membership.ts` — `roles[]` → `role`; `CreateMembershipSchema`, `UpdateMembershipSchema`.
- `schemas/invitation.ts` — `roles[]` → `role`; `CreateInvitationSchema`.
- `schemas/user.ts` — deprecated `roles[]` (rozhodnúť: `role` / legacy-only).

### `apps/api/src` — plugins / auth

- `plugins/auth.ts` — `requireRole` + nový `requireMinRole`; `synthesizeMembership` (`roles`→`role`);
  `FastifyRequest` decorator typy; backfill `currentUser.role`.
- `plugins/inventario-jwt.ts` — `InventarioJwtPayload.roles`→`role`; `issueAccessToken` signatúra;
  `assertInventarioPayload`.

### `apps/api/src` — auth toky

- `modules/auth/oauth.routes.ts` — `issueAccessToken(..., roles)`, `ProvisionResult.roles`,
  self-serve ADMIN insert (`roles: [ADMIN]`), `acceptInviteViaOAuth` (membership + user insert
  `roles: newInv.roles`), refresh route (`defaultMembership.roles`).
- `modules/auth/email-auth.routes.ts` — `/register/email` user + membership insert (`roles: [ADMIN]`),
  login `issueAccessToken(..., membership.roles)`.
- `modules/auth/registration.routes.ts` — email reg user + membership insert (`roles: [ADMIN]`).
- `modules/auth/auth-session.routes.ts` — `issueAccessToken(..., targetMembership.roles)`;
  GET /me `activeMembership.roles` + `availableOrganisations[].roles`; DELETE /me (cez service).

### `apps/api/src` — invitations / memberships / users

- `modules/invitations/invitations.routes.ts` — `CreateInvitationSchema.roles`, `ROLE_LABELS`
  (už bez TEAM_MANAGER ✓), ADMIN-grant check (`inviter.roles.includes(ADMIN)`,
  `roles.includes(ADMIN)`), invite insert + accept (new-user + existing-user) membership/user
  `roles`, audit metadata `roles`, response `roles`/`acceptMode`.
- `modules/memberships/memberships.routes.ts` — `PatchMembershipBodySchema.roles`,
  `requireRole([...])` (→ `requireMinRole`), `activeMembership.roles.includes(ADMIN)`,
  `assertNotLastAdmin(..., existing.roles)`, `toPublic` (`roles`), GET /v1/members výstup `roles`.
- `modules/memberships/memberships.service.ts` — `assertNotLastAdmin(targetRoles)`,
  `assertNotLastAdminForDeletion` (`membership.roles.includes(ADMIN)`).
- `modules/memberships/memberships.repository.ts` — `countActiveAdmins` filter `roles: 'ADMIN'`.
- `modules/users/users.service.ts` — `buildUserFromClaims` (`roles: [EMPLOYEE]`),
  `assertNotLockingAdminOut`, `update` (rolesBefore/After diff, `countActiveAdminsExcluding`,
  `USER_ROLE_GRANTED/REVOKED`), `buildRepoPatch` (`patch.roles`).
- `modules/users/users.routes.ts` (mimo prečítaného rozsahu — overiť) — PATCH body `roles`,
  list filter `?role=`, response shape.
- `modules/users/users.repository.ts` (overiť) — `countActiveAdmins(Excluding)`,
  `PUBLIC_PROJECTION`, `UserUpdatePatch.roles`.

### `apps/api/src` — loans

- `modules/loans/loans.service.ts` — `hasManagerRole` (`actor.roles.includes`),
  `cancelLoanRequest` (`actor.roles.includes('ADMIN')`), `notifyManagersNewRequest`
  Mongo filter `roles: { $in: [...] }`.
- `modules/loans/loan-requests.routes.ts` + `loans.routes.ts` (overiť) — `requireRole` guardy
  (canRead/canWrite) → `requireMinRole`.

### `apps/api/src` — migrácie

- **Nová migrácia** `2026-06-xx-single-role.ts` — `roles[]` → `role` (memberships, invitations,
  prípadne users); zapojiť do `migrations/runner.ts`.
- `migrations/2026-05-23-memberships.ts` — historická, **nemeniť** (beží na starých dátach);
  ale overiť, že nová migrácia beží po nej.
- `migrations/2026-05-31-remove-team-manager-role.ts` — historická, nemeniť.

### `apps/web/src`

- `lib/api-hooks.ts` — `MeResponse`, `UserSummary`, `UserDetail`, `UserUpdatePatch`,
  `MemberPickerItem` (`roles`→`role`); `useCanAdminUsers`, `useCanEditAssets`,
  `useCanManageTaxonomy`, `useCanDeleteTaxonomy`, `useCanManageLoans`, `useCanManageStock`
  (`roles.includes`→hierarchia); `USER_ROLES` + `Role`.
- `components/InvitationsContent.tsx` — multi→single select, `ALL_ROLES` (drop TEAM_MANAGER),
  `selectedRoles`→`selectedRole`, `toggleRole`→set, POST `roles`→`role`.
- `components/AcceptInvitePage.tsx` — `InvitePreview.roles`→`role`, `ROLE_LABELS` (drop
  TEAM_MANAGER), `roleLabel`.
- `lib/auth-context.ts` (overiť) — `user.roles`→`role`.
- Admin stránky `app/settings/members`, `app/users` (overiť).

### `apps/api/tests`

- `helpers/test-fixtures.ts`, `helpers/test-jwt.ts` (JWT `roles` claim) — `roles`→`role`.
- `integration/rbac.test.ts`, `invitations-*.test.ts`, `auth*.test.ts`, `users-*.test.ts`,
  `cross-tenant-isolation.test.ts`, `mfa*.test.ts` (login issue token).
- `unit/migration-memberships.test.ts` + nový test pre single-role migráciu.

### SFZ `Asset-Management` repo

- Overiť zdieľané `shared-types` použitie; replikovať zmenu enumu/schém/migrácie alebo
  koordinovať. (Mimo rozsah tohto ADR, ale zaznamenať.)

## Dôsledky

### Pozitívne

- Model zodpovedá realite: jeden človek = jedna rola v tenante, vynútené schémou.
- RBAC dedičnosť explicitná a centralizovaná (`roleSatisfies`), nie roztrúsená do
  `[ADMIN, ASSET_MANAGER]` zoznamov v každom route.
- UI multi-select prirodzene zmizne; onboarding jednoduchší a jednoznačný.
- Nedá sa uložiť nekonzistentný stav (`['ADMIN', 'EXTERNAL']`).
- Pripravený (ale nepoužitý) mechanizmus na rozlíšenie typu EMPLOYEE/EXTERNAL,
  keď ho reálne pravidlo bude potrebovať.

### Negatívne / kompromisy

- Veľký jednorazový zásah (~25–30 miest + testy), migrácia tvaru dát, regen artefaktov.
- Staré JWT prestanú validovať → re-login (alebo dočasná dual-tvar tolerancia).
- Koordinácia so SFZ repom.
- Strata teoretickej schopnosti „dve nezávislé role naraz" — ale tá protirečí
  zamýšľanej sémantike, takže je to zámer, nie strata.

### Riziká, ktoré treba sledovať

- **Pravidlo pri migrácii pre zhodu úrovní.** Ak by mal niektorý existujúci doc
  `roles: ['EMPLOYEE', 'EXTERNAL']` (level 1 == level 1), `highestOf` je
  nejednoznačné. Treba deterministické pravidlo (napr. „ak je EMPLOYEE prítomný,
  vyhráva EMPLOYEE; inak EXTERNAL"). V praxi dnes asi neexistuje taký doc, ale
  migrácia to musí ošetriť, nie spadnúť.
- **Zlyhanie validácie na starých dátach.** Ak migrácia nedobehne pred nasadením
  novej schémy, doc s `roles[]` (a bez `role`) neprejde Zod/`$jsonSchema`.
  Mitigácia: migrácia pred/súčasne s deployom (`runPendingMigrations`).
- **JWT dual-tvar.** Buď akceptovať re-login (pred-pilot OK), alebo v
  `assertInventarioPayload` dočasne tolerovať `roles[]` aj `role` a v
  `loadCurrentUser` aj tak čítať autoritatívne z DB (membership), takže
  JWT roly aj tak nie sú zdroj pravdy (ADR-0015). Druhá cesta je bezpečnejšia.
- **Deprecated `User.roles`.** Rozhodnúť, či ho meniť. Číta ho `synthesizeMembership`
  fallback (pre-migration) a JIT `buildUserFromClaims`. Najbezpečnejšie: nechať
  `User.roles` ako legacy, nikdy ho nepoužiť pre RBAC, autoritu držať na
  `Membership.role`.
- **Prehliadnutý výskyt.** Hardcoded `'ADMIN'`/`roles` mimo prečítaného rozsahu
  (MCP server `apps/mcp-server`, auth-context, admin stránky). Mitigácia: úplný
  grep cez oba repo.
- **Posledný admin.** `countActiveAdmins` a všetky last-admin guardy musia po
  zmene tvaru naďalej správne počítať (`role: 'ADMIN'` namiesto `roles: 'ADMIN'`).
  Pokryť testom.

## Fázovanie

- **K1** — `shared-types`: `ROLE_LEVEL` + `roleSatisfies` + zmena schém
  (membership/invitation/user), JSON Schema regen. (Opus/Sonnet — doménový základ)
- **K2** — RBAC vrstva: `requireMinRole`, prepis guardov, `auth.ts` (`synthesizeMembership`,
  backfill `currentUser.role`), JWT plugin (`role` claim). (Sonnet)
- **K3** — servisná vrstva: loans, users, memberships (`roles.includes`→`roleSatisfies`/`===`,
  last-admin guardy, Mongo filtre). (Sonnet)
- **K4** — write-side auth toky: oauth/email-auth/registration/invitations/auth-session
  (membership/user/invite insert `role`, `issueAccessToken(..., role)`). (Sonnet)
- **K5** — migrácia dát `roles[]`→`role` (+ deterministické pravidlo zhody úrovní),
  zapojiť do runnera. (Sonnet)
- **K6** — frontend: `api-hooks` (typy + helpery), `InvitationsContent` (single-select),
  `AcceptInvitePage`, auth-context, admin stránky. (Sonnet)
- **K7** — regen OpenAPI + `api-types.ts`; testy (RBAC hierarchia vrátane
  `roleSatisfies(EXTERNAL, EMPLOYEE)`, last-admin, migrácia, fixtures, JWT). (Sonnet)
- **K8** — overiť/replikovať do SFZ repa; milestone/session doc. (Sonnet/Haiku)

## Referencie

- [ADR-0015 Cross-tenant memberships](0015-cross-tenant-memberships.md) — roly žijú na `Membership`, autoritatívny zdroj pre RBAC (DB, nie JWT)
- [ADR-0024 Odstránenie TEAM_MANAGER](0024-remove-team-manager-role.md) — predchádzajúce zúženie enumu; rovnaký migračný + regen pattern
- [ADR-0013 Multi-provider auth](0013-multi-provider-auth-self-serve.md) — auth toky, ktoré vydávajú JWT s rolami
- [packages/shared-types/src/enums/user-role.ts](../../packages/shared-types/src/enums/user-role.ts) — enum + nová `ROLE_LEVEL` mapa
- [packages/shared-types/src/schemas/membership.ts](../../packages/shared-types/src/schemas/membership.ts) — `roles[]` → `role`
- [packages/shared-types/src/schemas/invitation.ts](../../packages/shared-types/src/schemas/invitation.ts) — `roles[]` → `role`
- [apps/api/src/plugins/auth.ts](../../apps/api/src/plugins/auth.ts) — `requireRole` + nový `requireMinRole`
- [apps/api/src/plugins/inventario-jwt.ts](../../apps/api/src/plugins/inventario-jwt.ts) — JWT `roles` claim → `role`

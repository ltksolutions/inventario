<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session — DSAR práva dotknutých osôb (#3 + #4)

**Dátum:** 2026-06-01
**Model:** Claude Sonnet 4.6
**Trvanie:** jedna session

---

## Čo sme spravili

### #3 — Right to data portability (čl. 20): `GET /v1/me/export`

**Motivácia:** ROPA deklaruje toto právo, ale endpoint neexistoval. Právna povinnosť pred príchodom živých dát tenanta.

**Implementácia:**

`audit.repository.ts` — nová metóda `findByActor(userId)`:

- query `{ 'actor.userId': userId }`, sort `at: -1`
- používa existujúci `actor_userId` index (žiadny nový index)
- bez tenant filtra — export zahŕňa históriu naprieč všetkými tenantmi (používateľ mohol byť člen viacerých)

`users.service.ts` — rozšírenia:

- nové imports: `AuditLogRepository`, `MembershipsRepository`
- nový typ `ExportSelfResult` (exportedAt, profile, memberships, auditLog)
- konštruktor rozšírený o `membershipsRepo?` a `auditLogRepo?` (default null → spätná kompatibilita s auth middleware a JIT provisioningom)
- nová `toSafeProfileShape()` helper funkcia — stripuje `passwordHash`, `mfaSecret`, `mfaRecoveryCodes` explicitne (obranná vrstva nad `PUBLIC_PROJECTION`)
- nová metóda `exportSelf()`: `Promise.all([memberships, auditLog])`, fire-and-forget `DATA_EXPORT_REQUESTED` audit event (čl. 30), výstup cez `toSafeProfileShape`

`users.routes.ts` — rozšírenia:

- nové importy: `AuditLogRepository`, `MembershipsRepository`, `UpdateSelfInput`
- service konštruktor dostáva oba nové repo-objekty
- `ExportResponseSchema` (lenient `z.record`)
- `GET /v1/me/export` — RBAC: `requireAuth + loadCurrentUser` (žiadna role podmienka)

`tests/integration/users-export.test.ts` — 10 testov:

- správna top-level štruktúra (exportedAt, profile, memberships, auditLog)
- profile má správne polia callera
- secrets nie sú v profile (test odhalil bug → `toSafeProfileShape` fix)
- memberships obsahuje caller-ov záznam
- auditLog obsahuje callerove záznamy
- auditLog izolácia — nie záznamy iného používateľa
- emituje `DATA_EXPORT_REQUESTED` audit event (fire-and-forget, 50ms settle)
- 401 bez cookie
- EMPLOYEE a ASSET_MANAGER majú prístup

**Bug zachytený testom:** `not.toHaveProperty('passwordHash')` zlyhalo — `passwordHash: null` bol v profile. Príčina: `provisionUser` v test-fixtures robí priamy `insertOne` + `findOne` bez `PUBLIC_PROJECTION`, takže `actor` na requeste má `passwordHash: null`. Riešenie: `toSafeProfileShape()` stripuje secrets explicitne destructuringom, nie len cez DB projekciu.

---

### #4 — Self-service oprava profilu (čl. 16): `PATCH /v1/me`

**Motivácia:** Používateľ si nemohol opraviť vlastné údaje — vedel to len ADMIN cez `PATCH /v1/users/:id`. GDPR čl. 16 je právna povinnosť.

**Implementácia:**

`users.service.ts`:

- nový typ `UpdateSelfInput = Partial<Pick<User, 'firstName' | 'lastName' | 'displayName' | 'preferences'>>`
- nová metóda `updateSelf()`:
  - auto-derivácia `displayName` z `firstName + lastName` ak sa meno mení ale `displayName` nie je explicitný
  - explicitný `displayName` v body prevažuje auto-deriváciu
  - `repo.update()` bez transakcie (single-document, žiadne cross-collection invarianty)
  - fire-and-forget `USER_UPDATED` audit event s `computeShallowDiff`
  - výstup cez `toSafeProfileShape` (secrets vždy vystrihnuté)

`users.routes.ts`:

- `PatchMeBodySchema` so `.strict().partial()`:
  - `.strict()` — akékoľvek neznáme pole (roles, email, isActive, …) vráti 400; bez `.strict()` by Zod defaultne stripoval
  - `.partial()` — všetky 4 povolené polia sú voliteľné
- `PATCH /v1/me` — RBAC: `requireAuth + loadCurrentUser`

`tests/integration/users-patch-me.test.ts` — 16 testov:

- firstName + lastName update
- displayName only update
- preferences update
- auto-derivácia displayName
- explicitný displayName override
- empty body no-op (200, žiadna zmena)
- secrets nie sú vo výstupe
- USER_UPDATED audit event
- 5 validačných prípadov: prázdny string, príliš dlhý string, zakázané polia roles/email/isActive
- 4 RBAC varianty: 401 bez cookie, EMPLOYEE/ASSET_MANAGER/ADMIN môžu updatovať

---

## Kľúčové rozhodnutia

**Audit event — fire-and-forget (oba endpointy):** Zlyhanie logovania nesmie blokovať odpoveď. Chyby sú logované na stderr (`console.error`). V produkcii bude Vercel logy zachytávať.

**Memberships naprieč tenantmi v exporte:** `findByUser(userId)` vracia všetky memberships bez tenant filtra — správne podľa čl. 20 (všetky osobné údaje, nie len aktuálny tenant).

**`.strict()` pred `.partial()`:** Zod chainovanie musí byť `.strict().partial()` v tomto poradí. `.partial().strict()` by nefungovalo správne pre unknown keys rejection.

**`toSafeProfileShape` ako obranná vrstva:** `PUBLIC_PROJECTION` funguje na DB úrovni, ale nie pre in-memory objekty (napr. request context v testoch). Explicitný strip je dôležitý pre bezpečnosť exportu aj self-patch odpovede.

---

## Stav testov

```
users-export.test.ts  — 10/10 ✅
users-patch-me.test.ts — 16/16 ✅
celková test suite    — zelená ✅
```

---

## Čo zostáva z DSAR (TODO.md P1)

- **#5** Right to erasure (čl. 17) — asynchrónny hard-erasure job po 30 dňoch od soft-delete
- **#6** Right to restrict (čl. 18) — `isRestricted` flag na `User` + obmedzenie v UI

---

## Commit message

```
feat(api): GDPR DSAR rights — data export and self-service profile update
```

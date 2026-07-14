<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-07-14 (pokračovanie) — detail + editácia používateľa

## Kontext

Nadväzuje na zlúčenie „Osoby" + „Používatelia" (viď
`docs/sessions/2026-07-14-zlucenie-osoby-pouzivatelia.md`). Janikin nápad:

> na zozname pouzivatelov "/users" je na konci tlacitko upravit, to vidi asi
> iba Admin, ale potrebujeme doplnit pre Admin a spravca doplnit moznost
> odkliknut na detail pouzivatela kde bude vsetk vypozicany majetok, aj ten
> v minulosti, a pre Admina pridat moznost editovat Meno, Priezvisko a asi aj
> email.

Preskúmaný kód pred návrhom: sekcia výpožičiek už existovala vo vnútri
edit dialógu (portovaná pri predchádzajúcom zlúčení), ale admin PATCH
umožňoval upraviť len `isActive`; doména už rozlišuje `LOCAL` vs OAuth
(`ENTRA_ID`) účty pre zmenu emailu, s per-tenant unikátnym indexom na
`organisationId + email` (nie globálne unikátny, napriek zavádzajúcemu
komentáru v Zod schéme).

Rozhodnuté (AskUserQuestion, 3 kolá):

1. Samostatná stránka `/users/[id]` (nie dialóg) pre detail.
2. Email editovateľný len pri `LOCAL` účtoch, priamy prepis (bez potvrdzovacieho
   emailu — je to privilegovaná admin akcia, nie self-service). Duplicita v
   rámci organizácie sa chytá cez existujúci unikátny index (E11000 → 400).
3. **Rozdelenie na dva samostatné UI povrchy** (kľúčové Janikino spresnenie
   po prvom návrhu):
   - **Editačný modál** (ADMIN-only) — Meno, Priezvisko, Email (ak LOCAL),
     rola, Aktívny účet, Odobrať z organizácie. **Žiadne výpožičky.**
   - **Detail používateľa** (ASSET_MANAGER + ADMIN, read-only) — Meno,
     Priezvisko, Email v hlavičke + zoznam majetku (aktívny hore, vrátený
     dole) s dátumami vypožičky/vrátenia, s priamym prekliknutím na detail
     každého kusu majetku.
4. V zozname: meno = link na detail (obe role), ceruzka = otvorí editačný
   modál (len ADMIN).

## Implementácia (K1–K4)

### K1 — backend

`apps/api/src/modules/users/users.repository.ts`: `UserUpdatePatch` rozšírený
o `email`.

`apps/api/src/modules/users/users.service.ts`:

- Guardrail: zmena `email` sa odmietne (400) ak `before.accountType !== LOCAL`
  — správa mirroruje existujúci self-service change-email flow
  (`email-auth.routes.ts`).
- `displayName` sa teraz auto-derivuje z `firstName`/`lastName` aj v admin
  `update()` (predtým len v `updateSelf()`), keďže nový editačný modál
  nikdy neposiela `displayName` explicitne.
- Zápis obalený v try/catch — `E11000` (duplicitný email v rámci org) → 400
  s hláškou „Táto e-mailová adresa je už používaná v tejto organizácii."

`apps/api/src/modules/users/users.routes.ts`:

- `UpdateUserBodySchema` rozšírený o `firstName`, `lastName`, `displayName`,
  `email`.
- `toManagerShape()` (ASSET_MANAGER-orezaný tvar pre `GET /v1/users`) rozšírený
  o `firstName`/`lastName` — nová detail stránka ich potrebuje zobraziť
  samostatne pre obe role, nielen `displayName`.

### K2a — frontend: editačný modál

`apps/web/src/components/UserEditDialog.tsx` — kompletne prerobený:

- Zúžený prop rozhranie (`userId`, `isSelf`, `onClose` — `canEdit` zrušený,
  dialóg je teraz vždy len pre ADMIN).
- Odstránená celá sekcia výpožičiek (presunutá do novej detail stránky).
- Pridané polia Meno/Priezvisko (vždy editovateľné) a Email — editovateľný
  len pri `accountType === 'LOCAL'`, inak read-only text s vysvetlením
  „Účet je prihlásený cez Microsoft/Google — email je v správe providera".

`apps/web/src/lib/api-hooks.ts`: `UserUpdatePatch` (frontend typ) rozšírený o
`firstName`/`lastName`/`email`.

### K2b — frontend: detail stránka

Nový súbor `apps/web/src/app/users/[id]/page.tsx` — mirror
`/assets/[id]/page.tsx` (Next.js 15 async `params`, `AuthGate` wrapper).

Nový súbor `apps/web/src/components/UserDetailContent.tsx`:

- Gate na `useCanManagePersons()` (ASSET_MANAGER + ADMIN).
- Hlavička: meno, priezvisko, email (`useUser`).
- `useLoans({ borrowerId, limit: 200 })` → `toLoanRows()` sploští `items[]`
  (jedna výpožička môže pokrývať viac kusov majetku) na jeden riadok na
  kus majetku.
- Tabuľka aktívnych výpožičiek (hore) a histórie (dole), stĺpec „Majetok"
  je `<Link>` priamo na `/assets/:assetId`.

`apps/web/src/components/UsersContent.tsx`:

- Meno v zozname je teraz `<Link href="/users/:id">` (obe role).
- Akcia v riadku: len ceruzka pre ADMIN (otvorí editačný modál); pre
  ASSET_MANAGER žiadna akcia v riadku (detail sa otvára cez meno).

### K3 — testy

`apps/api/tests/integration/users-patch.test.ts` — nový `describe` blok:

- `firstName`/`lastName` update → `displayName` sa auto-derivuje.
- Email update na `LOCAL` účte — happy path (200).
- Email update na duplicitnú adresu v rámci org — 400.
- Email update na `ENTRA_ID` účte — 400 (OAuth guardrail).
- Re-submit rovnakého emailu na `ENTRA_ID` účte (nie je to zmena) — 200, aby
  no-op PATCH z formulára nepadal zbytočne.

`tsc --noEmit`, `eslint`, `prettier --check` čisté v sandboxe na všetkých
dotknutých súboroch (backend aj frontend). `vitest` sa v sandboxe nedá
spustiť (chýbajúci natívny `@rollup/rollup-linux-arm64-gnu` binár — rovnaký
dôvod ako pri predchádzajúcich session). Janika spustí lokálne.

### K4 — dokumentácia

`docs/user-guide/reference/role-opravnenia.md`:

- Footnote 6 rozšírená — vysvetľuje rozdelenie na detail (obe role) vs
  editačný dialóg (len ADMIN).
- Nová poznámka v sekcii „Typy účtov" o LOCAL-only obmedzení zmeny emailu.

## Čo zostáva urobiť lokálne (Janika)

```bash
pnpm --filter api test tests/integration/users-patch.test.ts
```

Po overení commit + push (git MCP, ako obvykle).

**Dôležité pre task #35 (cleanup):** `UserEditDialog.tsx` zostáva aktívne
používaný (ADMIN editačný modál) — nepridávať ho na zoznam na zmazanie.

## Overenie a nasadenie

Zostáva: commit + push, overiť Vercel deploy oboch projektov READY,
`get_runtime_errors` bez nových nálezov, a manuálne prejsť UI:

- ADMIN: klik na meno → detail s výpožičkami a linkami na majetok; ceruzka →
  editačný modál s Meno/Priezvisko/Email/rola/aktivita/odobratie.
- ASSET_MANAGER: klik na meno → rovnaký detail (read-only); žiadna ceruzka.

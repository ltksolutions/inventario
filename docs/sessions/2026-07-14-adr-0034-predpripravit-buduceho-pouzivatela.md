<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-07-14 (pokračovanie) — ADR-0034: predpríprava budúceho používateľa

## Kontext

Janikov návrh (verbatim, prekladom skrátené): správca majetku by mal vedieť vopred
pridať budúceho zamestnanca so známou firemnou e-mailovou adresou, aby mu mohol
schváliť a pripraviť výbavu ešte pred jeho nástupom — bez toho, aby zamestnanec
musel mať už vytvorený účet.

Pred implementáciou preskúmaný kód a spýtané 4 doplňujúce otázky (AskUserQuestion) +
1 dodatočná otázka o vzťahu k už raz zamietnutému [ADR-0032](../decisions/0032-loan-request-unregistered-beneficiary.md)
(2026-07-01) — podobne znejúci návrh, tam zamietnutý, pretože by ho mohla vyvolať
ktorákoľvek žiadosť podaná EMPLOYEE (obchádzka RBAC). Rozdiel tu: záznam vytvára
výslovne ASSET_MANAGER/ADMIN (rovnaká rola ako pri pozvánkach), a len pre overenú
firemnú doménu (`DOMAIN_RESTRICTED` + `autoJoinDomains`). Zdokumentované v
[ADR-0034](../decisions/0034-domain-restricted-pre-provisioned-members.md)
(commit `b2b2555`).

Rozhodnuté (všetko „odporúčané" pri AskUserQuestion):

1. Rola pri vytvorení vždy `EMPLOYEE`
2. Zrušenie/zrušený nábor = manuálne pozastavenie (`Membership.status = SUSPENDED`),
   žiadne mazanie
3. UI vstupný bod v existujúcej stránke Pozvánky, nie samostatná sekcia v Nastaveniach
4. Rozsah natrvalo len pre `DOMAIN_RESTRICTED` organizácie
5. Samostatné ADR s odkazom na ADR-0032 a vysvetlením rozdielu

## Implementácia (K1–K6)

### K1–K4 — schema, endpoint, `hasLoggedIn`, UI (commit `ff0df47`)

- **shared-types:** `CreatePreProvisionedMemberSchema` + `PreProvisionedMemberSchema`
  (`membership.ts`)
- **API:** `POST /v1/memberships/pre-provisioned` (ASSET_MANAGER/ADMIN) — validuje
  `memberJoinPolicy === DOMAIN_RESTRICTED` (inak `400 DOMAIN_RESTRICTED_ONLY`), doménu
  proti `autoJoinDomains` (inak `400 DOMAIN_NOT_ALLOWED`), globálnu unikátnosť e-mailu
  (inak `409`). Vytvorí `User` (`accountType: ENTRA_ID`, bez credentials,
  `lastLoginAt: null`) + `Membership` (`role: EMPLOYEE`, `status: ACTIVE`,
  `isDefault: true`), audit `MEMBER_PRE_PROVISIONED`.
- **`GET /v1/members` + `GET /v1/memberships`** — doplnený odvodený `hasLoggedIn`
  (`lastLoginAt !== null`), bez zmeny schémy.
- **UI:** nová sekcia „Pridať budúceho používateľa" na stránke Pozvánky
  (`InvitationsContent.tsx`), pod bežným formulárom pozvánky. Neaktívna (len
  vysvetlenie + odkaz do Nastavení), keď organizácia nemá `DOMAIN_RESTRICTED`.
  Odznak „Očakáva nástup" v zozname Používatelia namiesto dátumu posledného
  prihlásenia.
- **Bug fix mimo rozsahu ADR-0034, nájdený počas práce:** stránka Pozvánky gatovala
  prístup na `useCanAdminUsers()` (len ADMIN), hoci `POST /v1/invitations` už dnes
  povoľuje aj ASSET_MANAGER — ASSET_MANAGER dostávali „Prístup zamietnutý" pri pokuse
  pozvať kohokoľvek. Opravené novým `useCanManageMembers()` hookom.
- Znovupoužité bez zmeny: `attemptDomainAutoJoin` (merge-by-email pri prvom SSO
  prihlásení) a `assertBeneficiaryIsActiveMember` (gatekeeper v žiadostiach o
  výpožičku) — presne to bol dôvod, prečo bol tento rozsah implementačne malý.

### K5 — testy (commit `6d5e388`)

Nový `apps/api/tests/integration/memberships-pre-provisioned.test.ts`:

- RBAC (ASSET_MANAGER + ADMIN prejdú, EMPLOYEE 403, bez cookie 401)
- validácie (`INVITE_ONLY` org → 400, doména mimo allowlistu → 400, duplicitný e-mail
  → 409, chýbajúce/neplatné pole → 400)
- tvar odpovede + zápis do `users`/`memberships`/`audit_logs`
- merge test priamym volaním `attemptDomainAutoJoin` (rovnaký vzor ako
  `oauth-domain-autojoin.test.ts`) — potvrdené, že sa znovu použije existujúci
  `User` + `Membership`, žiadny duplikát, `lastLoginAt` sa nastaví
- happy-path beneficiary — predpripravený člen okamžite prejde
  `assertBeneficiaryIsActiveMember` v `POST /v1/loan-requests`

`tsc --noEmit` a `eslint` čisté v sandboxe. `vitest` sa v sandboxe nedá spustiť
(chýba natívny `@rollup/rollup-linux-arm64-gnu` binár — macOS `node_modules`
skopírovaný do linux-arm64 sandboxu). Janika spustila lokálne: **všetko zelené.**

### K6 — OpenAPI regen + user-guide + session doc (tento commit)

- **OpenAPI export:** rovnaký sandboxový limit ako pri `vitest` — `apps/api/scripts/export-openapi.ts`
  beží cez `tsx`, ktorý závisí od natívneho `esbuild` binárky (macOS `@esbuild/darwin-arm64`
  v `node_modules`, sandbox je linux-arm64). Export **nešlo spustiť v sandboxe.**
  Zostáva ako lokálny krok pre Janiku (príkazy nižšie).
- **User-guide:** nový `docs/user-guide/how-to/pridat-buduceho-pouzivatela.md` —
  predpoklady (DOMAIN_RESTRICTED + doména v allowliste), postup so screenshotmi-TODO,
  sekcia „Po dokončení" (odznak, beneficiary v žiadosti, auto-aktivácia pri prvom
  prihlásení), 6 riešení bežných problémov (preklep v e-maile, zrušený nábor...).
  Odkaz doplnený do `how-to/README.md`.
- Tento session doc + aktualizácia `docs/sessions/NEXT.md` a `docs/TODO.md`.

## Čo zostáva urobiť lokálne (Janika)

OpenAPI export aj `api-types.ts` regen bežia na natívnych binárkach, ktoré v
sandboxe nefungujú (rovnaký dôvod ako `vitest` — pozri K5 vyššie). Spusti lokálne:

```bash
pnpm --filter @inventario/api openapi:export:offline
git -C . diff --stat apps/api/openapi.json   # over, že sa objavil /v1/memberships/pre-provisioned
pnpm --filter web generate:api-types          # aj automaticky pred build/lint/typecheck
git add apps/api/openapi.json apps/web/src/lib/api-types.ts
git commit -m "chore(api): regenerovať openapi.json + api-types.ts (ADR-0034 K6)"
git push
```

(`openapi:export:offline` používa in-process `MongoMemoryServer`, nepotrebuje
reálne pripojenie na Atlas.)

## Overenie a nasadenie

K1–K4 (`ff0df47`) pushnuté, Vercel deploy `inventario-api` aj `inventario-web`
`READY`, `get_runtime_errors` za 15 minút po deployi bez nálezov. K5 (`6d5e388`)
pushnuté, testy typovo/lint čisté v sandboxe, lokálne `pnpm --filter api test`
**všetko zelené** (Janika potvrdila).

## Ďalšie kroky

- Lokálny OpenAPI/api-types regen + commit (vyššie) — jediný chýbajúci kúsok K6.
- Zvážiť (mimo rozsahu tohto ADR, spomenuté ako riziko v ADR-0034): report
  „predpripravení členovia bez prihlásenia > 90 dní" pre ADMIN, aby nezostávali
  osirelé záznamy po neúspešnom nábore.
- Otvorený implementačný detail z ADR-0034 (neriešený, len zaznamenaný): `PATCH
/v1/memberships/:id` je `ADMIN`-only, teda ASSET_MANAGER, ktorý osobu predpripraví,
  by ju sám nemusel smieť pozastaviť pri zrušenom nábore — existujúca asymetria,
  nie niečo, čo zaviedlo toto ADR.

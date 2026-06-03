<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-06-03 — post-deploy fixy (pozvánky URL, CI logo upload, resend tlačidlo)

| Atribút        | Hodnota                                             |
| -------------- | --------------------------------------------------- |
| **Dátum**      | 2026-06-03 (neskorý večer / živé testovanie)        |
| **Fáza**       | Production LIVE — ADR-0028 v2 uzavretý              |
| **Model**      | Opus 4.8                                            |
| **Východisko** | Reálne testovanie pozvánok na app.inventario.estate |
| **Výsledok**   | 3 commity, CI zelené, 884/884 testov                |

---

## Kontext

Po dokončení ADR-0028 v2 a brand hlavičky prebiehalo živé testovanie na produkcii.
Pri pozývaní nového používateľa sa objavili dva bugy a jedna chýbajúca drobnosť,
ktoré sa v tejto krátkej session vyriešili.

---

## Čo bolo opravené

### 1. fix(api): accept-invite link z FRONTEND_BASE_URL

**Bug:** Pozvánkový e-mail obsahoval rozbitý odkaz `https://.inventario.estate/accept-invite?token=…`
(bodka navyše, chýbala subdoména `app`).

**Root cause:** `invitations.routes.ts` odvodzoval `frontendUrl` z `OAUTH_REDIRECT_BASE_URL`
cez krehké `.replace('/v1/auth/callback','').replace('/api','')`. Druhé `.replace('/api','')`
chytilo `/api` v `https://api.inventario.estate` (presnejšie prvý výskyt v `https://api…`)
→ výsledok `https:/.inventario.estate` → browser normalizoval na `https://.inventario.estate`.

**Fix:** Použiť explicitný `FRONTEND_BASE_URL` z configu (už existoval, default
`http://localhost:3001`) namiesto odvodzovania:

```ts
const { FRONTEND_BASE_URL, … } = fastify.config;
const frontendUrl = FRONTEND_BASE_URL.replace(/\/+$/, '');
```

**Manuálne (Vercel):** `FRONTEND_BASE_URL=https://app.inventario.estate` nastavené v API projekte.

**Commit:** `fix(api): accept-invite link z FRONTEND_BASE_URL (rozbité https://.inventario.estate)`

### 2. fix(api): logo upload validuje vstup pred Blob tokenom

**Bug:** CI zlyhávalo na všetkých commitoch — 2 testy v `organisations-logo-upload.test.ts`
(„chýbajúci súbor → 400", „> 512 KB → 413") dostali **500** namiesto 400/413.

**Root cause:** CI nemá `BLOB_READ_WRITE_TOKEN`. Endpoint `POST /v1/organisations/current/logo`
kontroloval token **pred** validáciou vstupu → pri chýbajúcom tokene vrátil 500 skôr,
než sa dostal k validácii súboru/veľkosti.

**Fix:** Prehodené poradie kontrol v handleri — najprv validácia vstupu
(`request.file()` → 400, `toBuffer()`/`truncated`/>512 KB → 413, `detectImageType()` → 400),
**až potom** token check (chýba → 500). 4xx chyby klienta majú prednosť pred 5xx
konfiguračnou chybou. Princiálne správnejšie aj pre reálnu prevádzku.

**Commit:** `fix(api): logo upload validuje vstup pred Blob tokenom (CI 400/413 bez tokenu)`

### 3. feat(web): tlačidlo Odoslať znovu pre čakajúce pozvánky

**Požiadavka:** Možnosť znovu odoslať čakajúcu pozvánku (nový odkaz, predĺžená platnosť).

**Stav:** Backend `POST /v1/invitations/:id/resend` (nový token + predĺžená platnosť

- re-send e-mail, vrátane rejoin vetvy) **už existoval** — chýbal len frontend.

**Fix:** `InvitationsContent.tsx`:

- `RotateCcw` ikona, `resending` + `resendSuccess` state
- `handleResend(id, email)` → `POST …/resend`, zelený success banner, reload zoznamu
- tlačidlo „Odoslať znovu" pred „Odvolať" v každom riadku tabuľky

**Commit:** `feat(web): tlačidlo Odoslať znovu pre čakajúce pozvánky`

Tým sa uzavrela aj prvá odrážka položky #13 v TODO.md (Resend invitation).

---

## Poznámky / naučené

- **Odvodzovanie URL cez `.replace()` je antipattern** — keď existuje explicitný config
  (`FRONTEND_BASE_URL`), použiť ho. `.replace('/api','')` na `https://api…` je klasická pasca.
- **Poradie validácie v endpointoch:** 4xx (chyba klienta) pred 5xx (chyba konfigurácie).
  Bez toho testy v prostredí bez voliteľnej konfigurácie (CI bez Blob tokenu) padajú zavádzajúco.
- **Resend pozvánky je dobrý spôsob ako otestovať aj URL fix naraz** — nový mail ide cez
  novú logiku skladania odkazu.

---

**Tests:** 884/884 zelených | **Commity:** 3 (2× fix(api), 1× feat(web)) | **Status:** Production LIVE ✅

---

# Session 2026-06-03 — rejoin invite fix (E11000 → 500 na accept-invite)

| Atribút        | Hodnota                                                  |
| -------------- | -------------------------------------------------------- |
| **Dátum**      | 2026-06-03 (popoludní)                                   |
| **Fáza**       | Production LIVE — hotfix                                 |
| **Model**      | Sonnet 4.6                                               |
| **Východisko** | "An internal error occurred" pri prijatí pozvánky do LTK |
| **Výsledok**   | 1 commit, 787/787 testov zelených                        |

## Kontext

Po odoslaní pozvánky na jan.letko@icloud.com do LTK Solutions, s.r.o. (rola Správca majetku)
sa pri kliknutí „Prijať pozvánku" zobrazilo "An internal error occurred". Kód skočil na stav
`error` po neúspešnom `POST /v1/auth/accept-invitation` — backend vrátil 500.

## Root cause

`POST /v1/auth/accept-invitation` existing-user vetva vždy volala `membRepo.create()` =
`insertOne` s `{userId, organisationId}`. Unique index `memberships_userId_organisationId_unique`
pokrýva **všetky** dokumenty bez ohľadu na `deletedAt` (chýba `partialFilterExpression`).

V prod DB existoval soft-deleted membership pre jan.letko@icloud.com v LTK Solutions org
(`deletedAt: 2026-06-03T09:21:01.396Z`). `insertOne` zasiahol index → **E11000** →
neošetrená výnimka → 500 → frontend zobrazil "An internal error occurred".

Overené priamo v `inventario-prod` cez Atlas MCP:

```
memberships: { userId: "6a1f6a86a40ef2987127bd0a", organisationId: "6a18ba69ef5a83d709e0a770",
  status: "ACTIVE", isDefault: true, deletedAt: "2026-06-03T09:21:01.396Z" }
```

Dodatočná chyba v detekcii rejoin: `membRepo.findByUser()` vracia len `deletedAt: null` →
`isRejoin` bol vždy `false` aj pri skutočnom rejoini.

## Čo bolo opravené

**`MembershipsRepository.reactivate()`** — nová metóda: `findOneAndUpdate` soft-deleted
membership späť na `ACTIVE` (`deletedAt: null`, nová rola, `acceptedAt`, audit polia).
Sortuje `deletedAt: -1` → najnovší soft-deleted dokument. Vracia reaktivovaný doc alebo `null`.

**`invitations.routes.ts` K12 existing-user vetva:**

- Detekcia `isRejoin` opravená: priamy dotaz na kolekciu `memberships` s `deletedAt: { $ne: null }`
  namiesto `membRepo.findByUser()` (ktorý vracia len `deletedAt: null`)
- Rejoin cesta → `reactivate()` namiesto `create()`; race fallback `create()` + E11000 → 409
- Cross-tenant cesta → `create()` + E11000 → 409 (nie 500)
- Import `type Membership` a `type UserRole` doplnený

**Testy** — 3 nové integračné testy v `invitations-accept.test.ts`:

- `cross-tenant: existing user accepts invite → 204 + new membership created`
- `rejoin: reactivates soft-deleted membership instead of inserting new one`
- `double-accept: second accept returns 409, not 500`

## Poznámky / naučené

- **`membRepo.findByUser()` filtruje `deletedAt: null`** — na detekciu soft-deleted záznamov
  treba priamy dotaz na kolekciu.
- **Unique index bez `partialFilterExpression`** pokrýva aj soft-deleted dokumenty → rejoin
  musí reaktivovať, nie vkladať. Obranná vrstva (partial index) zostáva ako P1 tech-debt.
- **Atlas MCP cez `mcp-is-sportu:connect(connectionString)`** funguje na priame pripojenie
  na Inventario prod cluster — `mcp-is-sportu` a `sportnet` sú sport-net MCP ale podporujú
  vlastný connection string.

## P1 tech-debt (nie v tomto hotfixe)

Unique index `memberships_userId_organisationId_unique` by mal mať
`partialFilterExpression: { deletedAt: null }` — soft-deleted dokumenty by nemali
blokovať nové insertovania. Vyžaduje migráciu + reindex na produkcii.
Pridané do TODO.md.

---

**Tests:** 787/787 zelených | **Commity:** 1 | **Status:** Production LIVE ✅

---

# Session 2026-06-03 — users-list cross-tenant fix + ADR-0030 (registračné identity + Entra doména)

| Atribút        | Hodnota                                                        |
| -------------- | -------------------------------------------------------------- |
| **Dátum**      | 2026-06-03 (podvečer)                                          |
| **Fáza**       | Production LIVE — cross-tenant fix + auth architektúra (ADR)   |
| **Model**      | Sonnet 4.6 (fix) + Opus 4.8 (ADR)                              |
| **Východisko** | jan.letko@icloud.com nebol v Používateľoch LTK; Entra reziduum |
| **Výsledok**   | 2 commity (fix + ADR), všetky testy zelené                     |

## 1. fix: GET /v1/users cross-tenant (members cez memberships collection)

**Bug:** Po prijatí pozvánky sa jan.letko@icloud.com nezobrazil v admin zozname
Používatelia v LTK Solutions (0 používateľov napriek aktívnemu členstvu).

**Root cause:** `UsersService.list()` → `UsersRepository.list()` filtroval kolekciu
`users` podľa `organisationId`. Cross-tenant pozvaný user má na User dokumente
`organisationId` svojho **pôvodného** orgu (alebo žiadny), nie tenantu kam bol
pozvaný. Membership existoval správne (LTK org, rola ASSET_MANAGER), ale filter
na `users.organisationId` ho minul. Rovnaká rodina legacy patternu ako tech-debt #18.

**Fix:**

- `MembershipsRepository.findUserIdsByOrganisation(orgId)` — vráti `userId[]`
  aktívnych nezmazaných členov orgu
- `UsersRepository.listByUserIds({ userIds, ... })` — filtruje podľa `_id: { $in }`
  namiesto `organisationId`
- `UsersService.list()` — najprv vyrieši member userIds cez memberships, potom
  `listByUserIds()`
- `test-fixtures`: `insertTestUser()` aj `provisionUser()` auto-vytvárajú membership;
  `insertTestMembership()` je idempotentná (vráti existujúci ak `{userId, organisationId}`
  už je) — kritické na odstránenie 34 kaskádových E11000 v testoch po tom, čo
  `provisionUser` začal membership vytvárať
- `passkeys.test.ts`: manuálne `insertOne` membership bloky nahradené idempotentnou
  `insertTestMembership`
- `invitations-accept.test.ts`: cross-tenant a double-accept testy provisioned
  v separátnom orgu (`seedTestTenant`); rejoin test soft-deletuje membership cez
  `updateOne` namiesto druhého insertu

**Testy:** 2 nové (cross-tenant user viditeľný, foreign-org user neviditeľný).

**Commit:** `fix: GET /v1/users resolves members via memberships collection (cross-tenant fix)`

## 2. docs: ADR-0030 — registračné identity + Entra ako per-tenant doménová reštrikcia

**Kontext:** Reziduum zo začiatku projektu (Entra-only, ADR-0004). Registračná
obrazovka navodzuje „Microsoft = firemná Entra"; Apple chýba (503); `entraTenantId`
je mŕtve pole, ktoré sa pri logine na nič nepoužíva. SFZ je de-facto viazané na Entru.

**Kľúčové zistenie z kódu:** backend je už z ~80 % na želanom modeli. Microsoft
OAuth ide cez multi-tenant `organizations` endpoint (akékoľvek MS konto, bez väzby
na adresár). Registračný endpoint berie všetky 4 providery. Org sa vytvára s
`INVITE_ONLY` + všetky providery povolené. Schéma už má `entraTenantId`,
`customDomain`, `allowedAuthProviders`, `memberJoinPolicy`, `autoJoinDomains`.
Reálne chýba len: Apple, zapojenie `entraTenantId` ako doménovej reštrikcie do
auth flow, admin UI, a neutrálny frontend framing.

**Tri-cestné rozlíšenie (SSO otázka):** (1) MS OAuth `organizations`/`common` =
už máme, akékoľvek MS konto — to je registračné „Microsoft"; (2) Entra `tid`
reštrikcia = dnešný SFZ stav → presúva sa do per-tenant nastavenia; (3) SAML/OIDC
enterprise SSO = mimo rozsahu, samostatný neskorší projekt.

**Rozhodnutia:** registrácia = e-mail + Google + Apple + Microsoft (rovnocenné,
bez Entra framingu); Entra → per-tenant doménová politika cez existujúce polia
(aditívna zmena, žiadne nové polia); pozvánka má vždy prednosť (INVITE_ONLY default);
SFZ migrácia = dátová úprava jedného Organisation dokumentu bez odhlásenia členov.

**Plán:** D1–D7 (prevažne Sonnet) — D1 Apple, D2 entraTenantId+autoJoinDomains do
flow, D3 admin UI „Prihlasovanie a domény", D4 frontend registrácia, D5 SFZ migrácia,
D6 testy, D7 docs. Status **Proposed → schválené Janikou** (ideme na D1).

**Riziká vypichnuté:** SFZ login regresiu overiť pred deployom; `tid` čítať z
id_token claimu (nie Graph `/me`); `accountType: ENTRA_ID` sa dnes nastavuje aj
pre Google self-serve (drobný tech-debt).

**Commit:** `docs: ADR-0030 registration providers + Entra as per-tenant domain restriction`

## Poznámky / naučené

- **Cross-tenant viditeľnosť ide cez memberships, nie users.organisationId.** Akýkoľvek
  zoznam „členov orgu" musí rezolvovať cez memberships collection (ADR-0015 model:
  User globálny, Membership viaže na org).
- **Auto-membership v `provisionUser` = idempotentné fixtures všade.** Keď fixture
  začne vytvárať membership, všetky priame `insertOne` membership v testoch musia ísť
  cez idempotentnú helper, inak E11000 kaskáda.
- **`create_file` nepíše na reálny disk** — len `filesystem:write_file`. ADR-0030 sa
  najprv „vytvoril" do sandboxu (neviditeľný v GitHub Desktop), musel sa prepísať.

---

**Commity:** 2 (1× fix, 1× docs ADR) | **Status:** Production LIVE ✅ | **Next:** ADR-0030 D1

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

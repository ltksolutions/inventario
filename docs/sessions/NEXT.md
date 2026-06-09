# NEXT

## Aktuálny stav (2026-06-09)

**P1 a P2 z predošlého plánu sú hotové** (overené v kóde 2026-06-09):

- BULK vs SERIALIZED odlíšenie — `TrackingModeBadge` + badge v `AssetsTable` + `quantityOnHand`. ✅
- #19 partial index `memberships_userId_organisationId_unique` s `partialFilterExpression: { deletedAt: null }` — migrácia `2026-06-07-memberships-partial-index.ts` + repository. ✅ _(potvrdiť dobehnutie na prod)_
- #18 legacy `User.roles` — `PATCH /v1/users/:id` mutuje len `isActive`, role idú cez `PATCH /v1/memberships/:id`. ✅

**Dnešná session (2026-06-09):** Ecomail spam fix (`EMAIL_FROM_ADDRESS` → `noreply@mail.inventario.estate` vo Vercel) + CI fix `attemptDomainAutoJoin` `isNew` (commit `b981e41`, nasadené). Detail: `docs/sessions/2026-06-09-ecomail-ci-fix-overview.md`.

### ✅ E-mail notifikácia „máš protokol na podpis" — HOTOVÉ (2026-06-09)

- `sendProtocolToSignEmail` pridaná do `EmailService` interface + implementácia + HTML šablóna (`apps/api/src/plugins/email.ts`)
- `notifyProtocolToSign` private helper v `LoansService` — fire-and-forget po transakcii (vzor `sendLoanRejectedEmail`)
- Zapojené na 3 miestach: `fulfilLoanRequest`, `createDirectLoan`, `returnLoan` — vždy notifikuje borrowera
- Unit testy: `tests/unit/email-protocol-to-sign.test.ts` (interface contract); testy spúšťať lokálne (`pnpm test`), sandbox blokuje esbuild/mongodb-memory-server
- Typecheck: ✅ bez chýb

### ✅ E-mail notifikácia borrowerovi pri priamej výpožičke — HOTOVÉ (2026-06-09)

- `sendDirectLoanCreatedEmail` pridaná do `EmailService` + `notifyDirectLoanCreated` helper v `LoansService`
- Zapojené v `createDirectLoan` — fire-and-forget po transakcii
- Commit `3d29301`

### Manuálne checky (P2 zvyšok)

- Overiť `pnpm openapi:export:offline` (ručne dopĺňaný openapi.json — paths /v1/protocols a POST /v1/loans/:id/protocols)
- E2E test s dvomi rôznymi účtami (manager vydá, borrower podpisuje zo svojho účtu) — overí aj Dashboard blok „Čaká na vás"

---

## EU Compliance — gaps zistené 2026-06-09

Stav preverený voči deklaráciám na inventario.estate (EUPL-1.2 · REUSE 3.3 · GDPR ready · WCAG 2.1 AA).

### 🔴 P1 — Audit log: chýba LOAN_PROTOCOL_SIGNED

`protocols.routes.ts` (POST `/v1/loans/:id/protocols/:protocolId/sign`) nemá žiadne volanie `auditLog.record`. Prechod DRAFT → SIGNED je kľúčová právna udalosť — kto, kedy, akým spôsobom potvrdil prevzatie/vrátenie majetku.

**Fix:** Pridať `LOAN_PROTOCOL_SIGNED` do `protocols.routes.ts` po úspešnom podpise (po zápise do DB), s `target.entityType: 'LoanProtocol'`, `target.entityId: protocolId`, `severity: 'INFO'`, `legalBasis: 'legitimate_interest'`. Taktiež pridať `LOAN_PROTOCOL_SIGNED` do `CRUD_ACTIONS` v `retention.service.ts`.

### 🟡 P2 — Audit log: LOAN_PROTOCOL_CREATED chýba v retention

Akcia `LOAN_PROTOCOL_CREATED` je logovaná v kóde, ale **chýba v `CRUD_ACTIONS`** zozname v `retention.service.ts` → nikdy sa nepseudonymizuje. Fix: pridať jeden riadok do `CRUD_ACTIONS` array.

### 🟡 P2 — REUSE 3.3: chýba `.reuse/` adresár a 122 súborov bez SPDX hlavičky

Web deklaruje **REUSE 3.3 compliant**, ale:

- Chýba `.reuse/dep5` alebo `.reuse/REUSE.toml` (povinný pre REUSE spec)
- 122 zdrojových súborov (z 341) nemá `SPDX-FileCopyrightText` + `SPDX-License-Identifier` hlavičku — najmä `apps/api/src/modules/audit/`, `categories/`, `locations/`, `organisations/`, `stock/`, `users/`, `loans/`, utility libs, helper súbory

**Fix:** (a) Pridať `.reuse/REUSE.toml` (alebo `dep5`) pre generované súbory a binary assets. (b) Batch-pridať SPDX hlavičky do chýbajúcich zdrojových súborov — 1-riadkový copyright + license comment. Potom spustiť `reuse lint` v CI. Súbory v `dist/` a `node_modules/` sa riešia cez `.reuse/dep5` (REUSE to predvída).

### 🟢 P3 — WCAG 2.1 AA: marketing site má 3 otvorené P1 nálezy

Podľa `docs/compliance/wcag-2.1-aa-audit.md` (audit z 17. mája 2026, plánovaný fix „Phase D"):

- **#1** SVG a emoji ikony bez `aria-hidden` (1.1.1 Non-text content)
- **#2** Chýba `<main>` landmark (1.3.1 Info and relationships)
- **#3** Link color `--brand-accent #388fc3` má kontrast ~3.5:1 voči bielej — pod AA limitom 4.5:1 (1.4.3 Contrast)

`apps/web` (aplikácia) zatiaľ bez WCAG auditu — plánovaný `eslint-plugin-jsx-a11y` + `@axe-core/cli` v CI.

### ✅ Čo je v poriadku

- GDPR Article 30 záznamy existujú (`docs/compliance/gdpr-article-30.md`)
- Retenčná politika implementovaná (`retention.service.ts`) — 3 časové pásma (24/60/84 mesiacov), pseudonymizácia (nie mazanie)
- `LOAN_PROTOCOL_CREATED` je logovaný (chýba len v retention — viď P2 vyššie)
- LICENSES/ adresár obsahuje EUPL-1.2.txt, CC-BY-4.0.txt, LicenseRef-DejaVu.txt ✅
- EUPL-1.2 licencia v existujúcich súboroch správne ✅

---

## Archív — stav (2026-06-07, koniec 2. session)

**Detail výpožičky + Preberacie protokoly UI HOTOVÉ a OTESTOVANÉ na produkcii.** Nové: `/loans/[id]` detail s protokolmi, CLICK_TO_SIGN podpis, PDF/Tlač, `/protocols` zoznam + menu (managerOnly), backend `GET /v1/protocols` + `POST /v1/loans/:id/protocols` (backfill), sign fixuje snapshot strany. Detaily: `docs/sessions/2026-06-07-loan-detail-protokoly-ui.md`.

E2E test prešiel (PROT-2026-000001 → SIGNED, PDF render OK). Pri teste opravené 2 prod bugy: (1) ProtocolCard — podpis druhej strany, keď je user oboma stranami (`f10ecdb`), (2) PDF render padal s JPEG logom tenanta — embedJpg podľa magic bytes + vercel.json includeFiles pre assets (`e9834c4`, `ed916b9`). `pnpm install` + `pnpm test` lokálne prebehli OK.

Dodatočne: PDF layout fix (sivé pásy tabuľky + čas podpisu Europe/Bratislava, `0a4952f`) a **Dashboard blok „Čaká na vás"** (`9022e83`) — akčný prehľad žiadostí na schválenie/vydanie, protokolov na podpis a výpožičiek po termíne s priamymi odkazmi; manager aj employee variant. Všetko nasadené na prode.

## ĎALŠIA SESSION — začni tu

### Protokoly — drobnosti (P2)

- Overiť `pnpm openapi:export:offline` (ručne dopĺňaný openapi.json — nové paths /v1/protocols a POST /v1/loans/:id/protocols)
- Zvážiť e-mail notifikáciu „máš protokol na podpis" (EmailService existuje)
- Test s dvomi rôznymi účtami (manager vydá, borrower podpisuje zo svojho účtu) — overí aj Dashboard blok „Čaká na vás" s reálnymi dátami

### Vizuálne odlíšenie BULK vs SERIALIZED (P1)

- V zozname majetku (`/assets`) vizuálne odlíšiť BULK položky (badge/ikona)
- Pri BULK v detaile zobraziť `quantityOnHand` prominentne

### Pre-GA cleanup

- `PATCH /v1/users/:id` — odstrániť/migrovať legacy `User.roles[]` endpoint (TODO #18)
- Smoke test + DR test

---

## Pôvodný stav (2026-06-06, koniec session — handoff do Cowork)

Testovanie formulárov na `app.inventario.estate` (SFZ tenant). Pridávanie majetku (SERIALIZED aj BULK) funguje. RECEIPT logika pri BULK create **dokončená a nasadená**. Sklad stránka funguje.

### Hotové v tejto session

- Combobox dropdown fixes, lokalita quick-create (`EXTERNAL`), Štítky→Tagy
- Číselníky: plný LocationDialog s výberom typu + Upraviť tlačidlo
- LocationType enum: `HEADQUARTERS` + `BRANCH` (migrácia `2026-06-05b`)
- Org nastavenia: inventárne číslovanie sekcia + `foundContactInfo`/`inventoryNumberFormat` v API schéme (boli stripované Zodom — preto sa neukladali)
- trackingMode SelectField + `initialQuantity` pole pre BULK
- RECEIPT pohyb pri BULK create (`assets.service.ts` + `assets.routes.ts` inject `StockMovementsRepository`)
- Stock overview fixes: `$$` premenné v `$lookup`, `$arrayElemAt` namiesto `$first`, `$ifNull` na `quantityOnHand` (legacy assety bez poľa), stringify ID v response

## ROZROBENÉ — pokračovať tu

### Stav rozrobeného Skladu (P0 — dokončiť test)

Sklad prehľad (`/stock`) sa načítava správne. Zobrazuje **1 položku**: `SFZ-2026-00002` "Predlžovací elektrický kábel, 5m", stav **Prázdne (0 ks)**.

**Prečo 0 ks:** táto BULK predlžovačka bola vytvorená _pred_ dokončením RECEIPT logiky, takže nemá žiadny RECEIPT pohyb a `quantityOnHand` bolo `undefined` (teraz sa v overview defaultuje na 0 cez `$ifNull`). Je to legacy dáta, nie bug.

**Čaká sa na test príjmu (next step):**

1. Klik na `SFZ-2026-00002` → detail (`/assets/6a241d101df5faf33798c30a`)
2. Tab **Sklad** → tlačidlo **Príjem na sklad**
3. Zadať počet (napr. 10) + lokalitu → overiť že:
   - vznikne RECEIPT záznam v `stock_movements` (kolekcia je teraz prázdna)
   - `quantityOnHand` sa nastaví na 10
   - stav v prehľade sa zmení z "Prázdne" na "V poriadku"
4. **Posledný neoverený bod:** či tab Sklad v detaile (`StockPanel`) korektne načíta pohyby pre položku s legacy `quantityOnHand`. Ak padá, skontrolovať `useStockMovements` hook + `GET /v1/stock/:itemId/movements` (rovnaký vzor legacy undefined ako pri overview).

### Pozn. pre nový BULK majetok (čistý flow)

Nové BULK položky vytvorené _po_ tejto session už dostanú RECEIPT pohyb automaticky z `initialQuantity` (minimum 1, vynútené na FE). Test: vytvoriť novú BULK položku s počtom → hneď by mala mať správny `quantityOnHand` + RECEIPT záznam.

## Ďalšie kroky (po dokončení Sklad testu)

### Vizuálne odlíšenie BULK vs SERIALIZED (P1)

- V zozname majetku (`/assets`) vizuálne odlíšiť BULK položky (badge/ikona)
- Pri BULK v detaile zobraziť `quantityOnHand` prominentne

### Pre-GA cleanup

- `PATCH /v1/users/:id` — odstrániť/migrovať legacy `User.roles[]` endpoint (TODO #18)
- Smoke test + DR test

## Referencie

- Session doc: `docs/sessions/2026-06-06-testing-forms-ciselníky-org-settings.md`
- TODO.md: #23 (RECEIPT — DONE), #18 (legacy roles endpoint)
- Detail položky predlžovačky: `/assets/6a241d101df5faf33798c30a`

## Pozn. pre Cowork prostredie

V Cowork beží terminál + filesystem priamo na disku — žiadny `copy_file_user_to_claude` workaround. `pnpm typecheck` / `pnpm test` / `pnpm build` možno spúšťať priamo. Git stále cez GitHub Desktop (GPG signing).

# NEXT

## Aktuálny stav (2026-06-11)

**EU compliance je kompletne uzavreté** + audit eventy pre prílohy. Session log: `docs/sessions/2026-06-11-eu-compliance-p1-p2-p3-attachments-audit.md`. Commity: `c816787`, `be7ab64`, `d9b100a`, `1cfa838`, `efbddfb`. Testy 941 passed | 2 skipped; reuse lint 622/622.

- ✅ P1 audit `LOAN_PROTOCOL_SIGNED` + retencia (P2)
- ✅ P2 REUSE 3.3 (SPDX hlavičky + `.reuse/REUSE.toml`)
- ✅ P3 WCAG #1–#6 marketing site
- ✅ Audit eventy pre prílohy (`ASSET_ATTACHMENT_*`)

**Otvorené (nice-to-have / pre-GA):** pridať `reuse lint` do CI; `apps/web` WCAG audit pred launchom; integračné testy pre attachments modul; EXIF strip; súkromné blob URL pre citlivé doklady; Zebra ZPL test (ADR-0027); smoke + DR test; E2E protokolov s 2 účtami; `EMAIL_PROVIDER=ecomail` pre Preview; odvolať mail-tester pozvánku.

---

## Aktuálny stav (2026-06-10)

**Detail majetku — kompletná dávka HOTOVÁ a nasadená** (941/941 testov green). Detail: `docs/sessions/2026-06-10-asset-detail-fixes.md`.

- Protokol PDF: serialNumber + kategória v snapshote ✅
- `appBaseUrl` + verejný `publicAssetLookup` nastaviteľné v Organizácia → QR kódy a štítky; QR/štítky bez 409 (env/default fallback) ✅
- Audit log tab na detaile majetku (`GET /v1/assets/:id/audit`) ✅
- Prílohy + foto majetku (Vercel Blob), hlavné foto na hero karte ✅
- Auth-aware QR sken: prihlásený → interný detail; anonymný → lost&found len s kontaktom (bez identity majetku) ✅
- Opravené: PDF štítok 500 (JPEG logo), multipart double-register, prázdny QR náhľad (credentialed fetch)

**Follow-upy (nice-to-have):** ~~audit eventy pre prílohy~~ ✅ HOTOVÉ (2026-06-11), EXIF strip, súkromné blob URL pre citlivé doklady, živé odskúšanie Zebra ZPL vetvy (ADR-0027).

### ✅ Audit eventy pre prílohy — HOTOVÉ (2026-06-11)

- Nové akcie `ASSET_ATTACHMENT_ADDED` / `_REMOVED` / `_SET_PRIMARY` v `audit-log.ts` enum (prefix `ASSET_` → legalBasis `contract`).
- `attachments.routes.ts` loguje všetky 3 write operácie (POST/DELETE/PATCH primary) cez `fastify.auditLog.record` — **cieľ `entityType: 'Asset'`**, aby sa záznamy zobrazili v audit tabe detailu majetku (`GET /v1/assets/:id/audit`). Snapshot: attachmentId, originalFilename, attachmentType, mime, size.
- Doplnené do retention `CRUD_ACTIONS` (24m). Overené: tsc + eslint ✅. Pozn.: attachments modul nemá integračné testy — kandidát na doplnenie.

### ✅ E-mail notifikácie overené (2026-06-10)

- mail-tester.com: **9.3/10**, SPF + DKIM + DMARC **pass** (aligned). DNS pre `mail.inventario.estate` (SPF cez CNAME na SparkPost, DKIM `ecomail._domainkey.mail`, DMARC, tracking) je správny a publikovaný.
- **Root-cause prečo predtým maily nešli:** produkčný deployment bežal s `EMAIL_PROVIDER=stub` (`[EMAIL-STUB] Would send email` v logu) — env premenná `EMAIL_PROVIDER=ecomail` bola síce vo Verceli, ale **Vercel načíta env len pri novom deployi**. Po `vercel --prod` redeployi sa maily reálne posielajú cez Ecomail.
- Prod env (potvrdené): `EMAIL_PROVIDER=ecomail`, `EMAIL_FROM_ADDRESS=noreply@mail.inventario.estate`, `EMAIL_FROM_NAME=Inventario`, `EMAIL_REPLY_TO=support@inventario.estate`, `ECOMAIL_API_KEY` set. Mŕtva premenná `EMAIL_FROM` (appka ju nečíta) zmazaná.
- Zvyšné body v mail-testeri sú neaktívne: `FROM_FMBLA_NEWDOM28` (dočasná penalizácia za novú doménu — sama zmizne) a chýbajúci `List-Unsubscribe` (irelevantné pre transakčné maily). **Netreba riešiť.**
- TODO drobnosť: odvolať testovaciu pozvánku na `test-y0ie7157d@srv1.mail-tester.com`; zvážiť `EMAIL_PROVIDER` aj pre Preview (teraz len Production → preview deploye posielajú cez stub).

**EU compliance — VŠETKO HOTOVÉ (2026-06-11):** ~~P1 `LOAN_PROTOCOL_SIGNED`~~ ✅, ~~P2 `LOAN_PROTOCOL_CREATED` v retention~~ ✅, ~~P2 REUSE/SPDX hlavičky~~ ✅, ~~P3 WCAG marketing site~~ ✅ — viď nižšie.

### ✅ P2 REUSE 3.3 + P3 WCAG — HOTOVÉ (2026-06-11)

- **REUSE/SPDX:** Inline SPDX hlavičky doplnené do 114 zdrojových súborov (`.ts/.js/.sh/.py`, EUPL-1.2); `.reuse/REUSE.toml` pokrýva nekomentovateľné súbory (JSON/YAML/config = EUPL-1.2, .md/.cff/assety = CC-BY-4.0, .ttf = LicenseRef-DejaVu). Opravená diakritika „Jan"→„Ján" v 7 hlavičkách. **`reuse lint` = 622/622 compliant.** Pozn.: `reuse` CLI pridať do CI (`pipx install reuse` + `reuse lint`).
- **WCAG:** všetkých 6 nálezov (#1–#6) vyriešených v `docs/marketing-site/`. Detail v `docs/compliance/wcag-2.1-aa-audit.md`. Väčšina #2–#6 už bola nasadená skôr; doplnený hlavne `aria-hidden` na dekoratívne emoji (badge prvky, technology/sub-processors, interactive-demo) a aria-label na viewport tlačidlá v `demo.html`.
- Overené: shared-types + api `tsc` ✅, eslint ✅, reuse lint ✅.

### ✅ P1 + P2 audit log — HOTOVÉ (2026-06-11)

- Nová audit akcia `LOAN_PROTOCOL_SIGNED` v `audit-log.ts` enum + nový `target.entityType` `'LoanProtocol'`.
- `protocols.routes.ts` sign endpoint loguje **každý podpis zvlášť** (handover/receive) po úspešnom `repo.update`: `entityType: 'LoanProtocol'`, `legalBasis: 'contract'` (default pre LOAN\_), snapshot (protocolNumber, type, loanId, signedSide, method, transitionedToSigned), metadata (ipAddress, bothSigned, newStatus). Plugin dependency rozšírená o `'audit'`.
- Retention `CRUD_ACTIONS` doplnené o `LOAN_PROTOCOL_CREATED` **aj** `LOAN_PROTOCOL_SIGNED` (24m bucket → pseudonymizácia).
- Overené: shared-types rebuild (tsc), `tsc --noEmit` api ✅, eslint protocols+retention ✅. **Lokálne ešte spustiť:** `pnpm openapi:export` (bez nových paths, ale refresh) a `pnpm test`.

---

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

### ✅ P1 — Audit log: LOAN_PROTOCOL_SIGNED (HOTOVÉ 2026-06-11, viď vyššie)

`protocols.routes.ts` (POST `/v1/loans/:id/protocols/:protocolId/sign`) nemá žiadne volanie `auditLog.record`. Prechod DRAFT → SIGNED je kľúčová právna udalosť — kto, kedy, akým spôsobom potvrdil prevzatie/vrátenie majetku.

**Fix:** Pridať `LOAN_PROTOCOL_SIGNED` do `protocols.routes.ts` po úspešnom podpise (po zápise do DB), s `target.entityType: 'LoanProtocol'`, `target.entityId: protocolId`, `severity: 'INFO'`, `legalBasis: 'legitimate_interest'`. Taktiež pridať `LOAN_PROTOCOL_SIGNED` do `CRUD_ACTIONS` v `retention.service.ts`.

### ✅ P2 — Audit log: LOAN_PROTOCOL_CREATED v retention (HOTOVÉ 2026-06-11, viď vyššie)

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

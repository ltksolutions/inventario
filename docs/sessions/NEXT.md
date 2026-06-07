# NEXT

## Aktuálny stav (2026-06-07, koniec 2. session)

**Detail výpožičky + Preberacie protokoly UI HOTOVÉ a OTESTOVANÉ na produkcii.** Nové: `/loans/[id]` detail s protokolmi, CLICK_TO_SIGN podpis, PDF/Tlač, `/protocols` zoznam + menu (managerOnly), backend `GET /v1/protocols` + `POST /v1/loans/:id/protocols` (backfill), sign fixuje snapshot strany. Detaily: `docs/sessions/2026-06-07-loan-detail-protokoly-ui.md`.

E2E test prešiel (PROT-2026-000001 → SIGNED, PDF render OK). Pri teste opravené 2 prod bugy: (1) ProtocolCard — podpis druhej strany, keď je user oboma stranami (`f10ecdb`), (2) PDF render padal s JPEG logom tenanta — embedJpg podľa magic bytes + vercel.json includeFiles pre assets (`e9834c4`, `ed916b9`). `pnpm install` + `pnpm test` lokálne prebehli OK.

## ĎALŠIA SESSION — začni tu

### Protokoly — drobnosti (P2)

- Overiť `pnpm openapi:export:offline` (ručne dopĺňaný openapi.json — nové paths /v1/protocols a POST /v1/loans/:id/protocols)
- Zvážiť e-mail notifikáciu „máš protokol na podpis" (EmailService existuje)
- Test s dvomi rôznymi účtami (manager vydá, borrower podpisuje zo svojho účtu)

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

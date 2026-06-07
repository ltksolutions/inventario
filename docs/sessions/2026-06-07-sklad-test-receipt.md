# Session 2026-06-07 — Sklad: test príjmu (RECEIPT) + StockPanel fix

> Prvá plná Cowork session. Model: Claude Opus 4.8.

## Čo sa riešilo

### P0: Test príjmu na sklad (produkcia, SFZ tenant)

Test podľa NEXT.md na `SFZ-2026-00002` „Predlžovací elektrický kábel, 5m" (BULK):

- **Príjem +10 ks** (lokalita BA centrála SFZ, dôvod „Test príjmu — RECEIPT flow") → zostatok 1 → **11 ks**
- História pohybov v `StockPanel` sa načítava a invaliduje správne (2 pohyby: +1 zo 6.6., +10 zo 7.6.)
- Prehľad `/stock`: stav **V poriadku**, 11 ks, ref. príjem 10 ks
- **Reconciliation:** „Cache sedí — zostatok 11 ks" — ledger = cache
- Overené aj priamo v DB (`stock_movements` 2 RECEIPT záznamy s korektným `balanceAfter`, `assets.quantityOnHand: 11`)

Pozn.: NEXT.md hovoril o prázdnej `stock_movements` — medzitým existoval RECEIPT +1 zo 6.6. 16:18 (test po nasadení RECEIPT logiky).

### StockPanel fix — legacy quantityOnHand (web)

- **Bug (bod 4 z NEXT.md):** legacy BULK assety s `quantityOnHand == null` zobrazovali v karte „Zostatok na sklade" nekonečný `Skeleton` — null tam neznamená loading (asset je už načítaný), ale legacy dáta
- **Fix:** `?? 0` (vzor ako `$ifNull` v stock overview) — karta zostatku + `InfoRow` „Aktuálny zostatok" v dialógoch Príjem/Korekcia
- Commit `e33a826`, nasadené na prod (Vercel READY)

### Infraštruktúra Cowork prostredia

- **MongoDB MCP `inventario-prod`** pridaný (read-only, cluster inventario-prod, DB `inventario`) — konfig v `claude_desktop_config.json`
- **GitHub Integration** pripojený — tools overiť v novej session (Actions/CI logy)
- **Vercel MCP** overený (team ltksolutions-projects, deploye + logy)
- Pozn.: priame Mongo pripojenie zo sandboxu nejde (sieť blokovaná); pnpm v sandboxe nejde (vyžaduje Node 24, je 22) — typecheck cez `apps/web/node_modules/.bin/tsc --noEmit`
- Commitlint: header ≤ 100 znakov — commit texty vždy ako Summary + Description (GitHub Desktop dve polia)

## Čo zostáva (TODO)

### Vizuálne odlíšenie BULK vs SERIALIZED (P1) — ďalšia session

- V zozname majetku (`/assets`) badge/ikona pre BULK položky
- V detaile BULK zobraziť `quantityOnHand` prominentne

### Pre-GA cleanup

- TODO #18: `PATCH /v1/users/:id` legacy `User.roles[]` endpoint
- Smoke test + DR test

## Referencie

- TODO.md: #23 (RECEIPT — ✅ DONE, otestované), #18 (legacy roles endpoint)
- Predošlá session: `2026-06-06-testing-forms-ciselníky-org-settings.md`
- Detail položky: `/assets/6a241d101df5faf33798c30a`

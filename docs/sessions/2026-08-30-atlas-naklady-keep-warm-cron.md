<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-08-30 — MongoDB Atlas náklady + zrušenie keep-warm cronu

## Kontext

Janika nahlásila nárast nákladov na MongoDB Atlas pre projekt
`inventario.estate`: 24,56 → 68,26 USD. Databáza má pritom len ~4 MB dát
(549 dokumentov), takže rast zjavne nie je z objemu dát.

Pôvodná hypotéza (Janikina): za nárast môže Vercel Cron keep-warm ping
pridaný commitom `8a91c32` (14. 7. 2026):

```json
{ "path": "/health/ready", "schedule": "*/4 * * * *" }
```

= 360 volaní denne proti Atlasu bez ohľadu na reálne používanie appky.

## Diagnostika

### Krok 1 — čo cron reálne robí

`/health/ready` nie je „jeden ping". Pri **studenom** zásahu sa nabootuje
celá Fastify appka:

1. `plugins/mongo.ts` → `client.connect()` + `db.command({ ping: 1 })`
   (TLS handshake + auth)
2. `server.ts` → `checkPendingMigrations()` (1 dotaz)
3. **17× `repo.ensureIndexes()`** pri registrácii route pluginov
   (napr. `asset-conditions.routes.ts:71`)
4. až potom samotný `ping` z handlera

Zároveň sa ukázalo, že návrh „pingovať len funkciu bez DB volania"
(cieľ `/health` namiesto `/health/ready`) by pomohol len málo — mongo
plugin sa registruje pri boote, takže cold start otvorí spojenie tak či
tak. A `maxIdleTimeMS: 10_000` znamená, že socket sa zavrie 10 s po
pingu, čiže deklarovaný benefit „udrží teplé aj DB spojenie" v praxi
neplatí.

### Krok 2 — cron bol už pred touto session zbytočný

Commit `b07cabc` (`"fluid": true`, Fluid Compute) prišiel **2,5 hodiny
po** commite s cronom. Fluid rieši presne tú príčinu, kvôli ktorej cron
vznikol: bez neho obslúži jedna teplá inštancia len 1 request naraz, a
stránky appky posielajú 2–5 paralelných volaní naraz.

Keep-warm ping navyše drží teplú len **jednu** inštanciu, zatiaľ čo
Vercel smeruje requesty na ľubovoľnú — je to lotéria, nie riešenie.

### Krok 3 — porovnanie s projektom „fakturácia"

Janika sa pýtala, prečo inventário ping potrebuje a projekt
`~/Documents/GitHub/fakturacia` nie. Zistené:

- Fakturácia má **4 crony**, dva z nich každých 5 min
  (`/api/cron/ingest`, `/api/cron/backfill`) = 576 behov denne, ktoré
  robia reálnu prácu proti Mongu (Graph polling, dedup, GridFS zápisy).
  Čiže _viac_ než inventário, nie menej.
- Nepotrebuje keep-warm z troch štrukturálnych dôvodov:
  1. jedna Next.js appka, per-route lambdy — žiadny Fastify plugin
     reťazec, žiadnych 17× `ensureIndexes()`, žiadne Swagger pri boote
  2. **Server Components** — `faktury/page.tsx` ťahá dáta priamo na
     serveri, jedna navigácia = jeden request (inventário: 2–5
     paralelných klientských volaní)
  3. `loading.tsx` je Suspense loader pre daný segment, nie globálny
     blokujúci `GlobalFetchOverlay` na `useIsFetching()`

Poznámka: `GlobalFetchOverlay` je dôvod, prečo sa cold start v inventáriu
vôbec „cítil" ako 10 s zamrznutie. Zostáva otvorený follow-up (odložený
už v session logoch zo 14. aj 15. 7.).

### Krok 4 — skutočná príčina nákladov (Atlas Cost Explorer)

Rozpad podľa clustera, projekt `inventario.estate`:

| Faktúra | inventario-prod | **inventario-dev** | bez mena (`6a1851ff`) | staré `sfz-asset-mgmt-*` | Spolu |
| ------- | --------------- | ------------------ | --------------------- | ------------------------ | ----- |
| 2026-05 | 0,89            | —                  | 0,89                  | 8,17                     | 9,95  |
| 2026-06 | 7,80            | —                  | 7,80                  | —                        | 15,60 |
| 2026-07 | 8,06            | 9,65               | 6,85                  | —                        | 24,56 |
| 2026-08 | 7,54            | **60,72**          | —                     | —                        | 68,26 |

**Záver: cron nie je príčinou.** Cron beží len na produkčnom deploymente,
teda výhradne proti `inventario-prod` — a ten je plochý (8,06 → 7,54,
dokonca mierne dole). Celý nárast +43,70 USD je jeden dev cluster.

`inventario-dev` na 60,72 USD je nad stropom Atlas Flex (~30 USD/mesiac),
takže Flex to byť nemôže. Sedí to na **dedikovaný M10** (~0,08 USD/h ≈
58 USD/mes.). Podporuje to aj predošlý riadok: 9,65 USD ≈ M10 za 5 dní.

Podozrenie: bezmenný cluster `6a1851ff` mal v máji/júni presne tú istú
sumu ako `inventario-prod` (0,89/0,89, potom 7,80/7,80), v júli 6,85 a v
auguste zmizol — zatiaľ čo `inventario-dev` v júli vzniklo. Vyzerá to na
prerobenie/znovuvytvorenie clustera, pri ktorom sa omylom vybral
dedikovaný tier namiesto Flexu.

Celoorganizačná položka „Clusters" rastie: 36,55 → 76,20 → 97,72 →
144,71 USD.

## Zmena (táto session)

- **`apps/api/vercel.json`** — odstránený cron záznam
  `GET /health/ready` `*/4 * * * *`. Retention cron
  (`/v1/system/retention/run`, mesačne) ostáva.
- **`apps/api/src/modules/health/health.routes.ts`** — komentár v
  hlavičke prepísaný z „používa sa na keep-warm" na historickú poznámku
  s odkazom na tento log.

Endpoint `/health/ready` sa **nemaže** — naďalej slúži na deploy
verifikáciu a prípadný uptime monitoring.

## Ďalšie kroky

1. **Prioritne (mimo kódu, na Janikinej strane):** overiť v Atlase tier
   clustera `inventario-dev`. Ak je to M10, prepnutie na Flex ušetrí
   ~55 USD/mesiac — rádovo viac než čokoľvek v kóde.
2. Overiť, či „Billed Date" v Cost Exploreri znamená mesiac spotreby. Ak
   áno, 68,26 USD je **prebiehajúca augustová faktúra**, ktorá stále
   narastá.
3. Prejsť aj projekty `IS sportu` a `contineo.app` — rovnaký vzorec
   65–68 USD sa tam objavuje tiež (contineo 11,50 → 65,20).
4. Subjektívne sledovať, či sa po zrušení cronu nevráti pomalý preloader.
   Ak áno, správna odpoveď nie je vrátiť cron, ale:
   - obmedziť `GlobalFetchOverlay` len na kritické requesty
   - presunúť `ensureIndexes()` mimo cold-startu (rovnaký vzor ako
     migrácie, commit `00a2515`)
   - zvážiť vypnutie Swaggeru v produkcii

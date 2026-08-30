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

Poznámka: `GlobalFetchOverlay` bol dôvod, prečo sa cold start v inventáriu
vôbec „cítil" ako 10 s zamrznutie. **Opravené už 17. 7. commitom
`1c239e0`** (overlay sleduje `useIsMutating()`, nie `useIsFetching()`) —
viď `docs/sessions/2026-07-17-zebra-lna-cors-fetch-overlay.md`.

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

1. ~~Overiť v Atlase tier clustera `inventario-dev`.~~ **Overené — je to
   M10.** Viď dodatok na konci dokumentu.
2. Overiť, či „Billed Date" v Cost Exploreri znamená mesiac spotreby. Ak
   áno, 68,26 USD je **prebiehajúca augustová faktúra**, ktorá stále
   narastá.
3. Prejsť aj projekty `IS sportu` a `contineo.app` — rovnaký vzorec
   65–68 USD sa tam objavuje tiež (contineo 11,50 → 65,20).
4. Subjektívne sledovať, či sa po zrušení cronu nevráti pomalý preloader.
   Nemalo by — všetky tri opatrenia proti nemu sú hotové (`staleTime`
   `8a91c32`, Fluid Compute `b07cabc`, overlay len pre mutácie `1c239e0`).
   Ak by sa predsa vrátil, správna odpoveď nie je vrátiť cron, ale:
   - presunúť `ensureIndexes()` mimo cold-startu (rovnaký vzor ako
     migrácie, commit `00a2515`)
   - zvážiť vypnutie Swaggeru v produkcii

---

## Dodatok — overenie clusterov a rozhodnutia (2026-08-30, neskôr)

### `inventario-dev` je M10 a je úplne prázdny

Atlas potvrdil: `inventario-dev` = **M10 (General)**, AWS Frankfurt
(eu-central-1), Replica Set 3 nodes, Encrypted Storage, Backups Active.
`inventario-prod` = **Flex**. Dedikovaný cluster sa podľa dokumentácie
MongoDB **nedá zmenšiť späť na Flex ani Free** — jediná cesta je nový
cluster + migrácia + zmazanie starého.

Janika si všimla, že dev vykazuje väčší disk než prod (2,00 GB vs
3,60 MB). Vysvetlenie: **porovnávajú sa dve rôzne veličiny.** Dev
(dedikovaný) zobrazuje _Disk Usage_ = obsadenosť 10 GB provisioned disku
vrátane oplogu, journalu a WiredTiger súborov. Prod (Flex) zobrazuje
_Data Size_ = logická veľkosť dokumentov; réžiu enginu vôbec neukáže.

Data Explorer to potvrdil definitívne: `inventario-dev` má **20 kolekcií,
všetky 0 dokumentov, 0 B data size**. Tie 2 GB sú čistá réžia mongodu.

Rovnako vysvetlené aj „podozrivé" metriky dev clustera (57 spojení,
1,6 čítania/s, 58 KB/s out oproti 13 / 0,05 / 1,36 KB/s na prode):
externý monitoring nasadený nie je, takže ide o **Atlas automation a
monitoring agentov + replikáciu medzi tromi uzlami**. Opcounters ukážu
konštantných ~17–20 op/s celý mesiac na databáze bez jediného dokumentu.
Flex túto internú prevádzku skrýva, dedikovaný cluster ju ukáže.

Zaujímavý detail: dev má kompletné sady indexov (assets 9, audit_logs 7,
locations 7…), ale nula dokumentov a chýbajúce `migrations` aj
`asset_types`. To je odtlačok `ensureIndexes()` pri cold starte — Vercel
Preview deploye tam appku nabootovali a vytvorili indexy, ale nikdy nič
nezapísali.

### Kde sú ostré dáta — overené tromi spôsobmi

1. **Obsah `inventario-prod`:** 40 kusov majetku, 29 používateľov, 17
   výpožičiek, 3 organizácie (`ltk-solutions-s-r-o`,
   `slovensky-futbalovy-zvaz`, `demo`), 219 audit záznamov.
2. **Živá prevádzka:** posledná aktivita v audit logu 10. 8. (celý reťazec
   ASSET_CREATED → LOAN_REQUEST_APPROVED → LOAN_PICKED_UP →
   LOAN_PROTOCOL_SIGNED), posledné prihlásenie 29. 8.
3. **Produkcia číta tento cluster:**
   `GET /v1/public/organisations/login-context?slug=slovensky-futbalovy-zvaz`
   na `api.inventario.estate` vrátil dáta, ktorých `logoUrl` obsahuje
   presne to org `_id`, ktoré je v tomto clusteri
   (`6a2132796759f4db9a40bcad`). Kontrolný dotaz na neexistujúci slug → 404.

### Konzumenti `inventario-dev`

- **CI: nie.** `tests/setup.ts` nastavuje `process.env['MONGO_URI']` na
  in-memory replica set **bezpodmienečne**, takže prepíše hodnotu z CI.
  Secrets `MONGO_URI_TEST`, `ENTRA_API_CLIENT_ID_TEST`,
  `ENTRA_TENANT_ID_TEST` boli mŕtve (ENTRA_* sú v config pluginu optional
  a v auth flow nepoužité od Slice #6c K17).
- **Lokálny vývoj: nie** — `apps/api/.env.local` mieri na
  `inventario-prod`, DB `inventario`.
- **Vercel Preview: áno** — jediný zostávajúci konzument.

### Rozhodnutia (Janika)

1. **`inventario-dev` zmazať, náhradu nerobiť.** Žiadny M0 ani Flex.
   Vedomý dôsledok: Preview deploye `inventario-api` prestanú nabíehať
   (mongo plugin padne pri štarte). Dependabot PR majú testy aj tak
   preskočené, takže praktický dopad je minimálny.
2. **`apps/api/.env.local` ostáva namierený na produkciu.** Vedome
   prijaté riziko, nie otvorený bod — lokálny `pnpm dev` píše do ostrých
   dát tenanta SFZ.
3. **Mŕtve CI secrets upratané** — `.github/workflows/ci.yml`, odstránený
   celý `env:` blok s `MONGO_URI_TEST` / `ENTRA_*_TEST` a aktualizované
   zastarané komentáre.

### Otvorené

- Zmazať `inventario-dev` v Atlase (Janika, mimo kódu). Žiadny `mongodump`
  netreba — cluster nemá čo zálohovať.
- Zmazať nepoužívané repo secrets v GitHub Settings: `MONGO_URI_TEST`,
  `ENTRA_API_CLIENT_ID_TEST`, `ENTRA_TENANT_ID_TEST`.
- Vercel `inventario-api` → Preview `MONGO_URI` ukazuje na mŕtvy cluster —
  buď premennú odstrániť, alebo Preview deploye vedome nechať padať.
- `if: github.actor != 'dependabot[bot]'` v `ci.yml` už nemá pôvodné
  opodstatnenie (chýbajúce secrets). Dá sa zrušiť, aby dependabot PR
  bežali aj testami — zámerne ponechané, samostatné rozhodnutie.
- Projekty `IS sportu` (68,29 → 22,63) a `contineo.app` (11,50 → 65,20)
  vykazujú rovnaký M10 podpis. Contineo stojí za kontrolu prednostne.

---

## Dodatok 2 — zálohovanie produkcie na Flexe (2026-08-30)

Otvorené Janikou po zmazaní dev clustera: **máme na `inventario-prod`
zálohy, keď je to Flex?** Odpoveď: áno, ale s podstatnými limitmi, ktoré
treba mať zapísané — najmä kvôli `docs/compliance/` (Data Retention
Schedule, DPIA), kde by tvrdenia o zálohovaní mali sedieť s realitou.

### Čo Flex dáva

Zálohy sú zapnuté automaticky, nedá sa to vypnúť ani konfigurovať:

- **8 posledných denných snapshotov**, možno ich stiahnuť alebo obnoviť
  do Atlas clustera
- snapshoty sa vždy berú zo **sekundárneho uzla** (bez dopadu na výkon)
- správa záloh vyžaduje **Project Owner** práva

### Čo Flex nedáva

- **Žiadne vlastné politiky** — retencia ani čas snímania sa nedajú meniť
- **Jeden denný snapshot** v pevný čas, začínajúci 24 h po vytvorení
  clustera
- **Žiadne on-demand snapshoty** — nedá sa urobiť „záloha pred rizikovou
  migráciou"
- **Žiadny Point-in-Time restore** — dostupný až od M10
- Flex snapshot sa dá obnoviť len do replica setu, nie do shardovaného
  clustera; a Atlas nevie obnoviť žiadny snapshot **do** Flex clustera
  z dedikovaného zdroja

**Reálne RPO je teda až 24 hodín.** Ak sa dáta poškodia o 17:00 a snapshot
bol o 06:00, stráca sa všetko medzitým.

### Vedomý nepomer (na záznam)

Do 30. 8. 2026 mala **prázdna** dev databáza tri uzly, šifrované úložisko
a plnohodnotné zálohy s vlastnou politikou, zatiaľ čo **ostré dáta SFZ**
(40 kusov majetku, 29 používateľov, 17 výpožičiek, podpísané preberacie
protokoly) majú jeden denný snapshot a 8 dní histórie. Po zmazaní dev
clustera je to už len otvorená otázka pre produkciu.

Rozhodnutie zatiaľ **nechať Flex** — M10 na produkcii by stálo tých istých
~58 USD/mes., ktoré sme práve ušetrili, a pre pilotného tenanta je 8 denných
snapshotov obhájiteľných. Je to ale vedomý trade-off, nie prehliadnutie.

### Otvorené (bez ohľadu na tier)

1. **Overiť, že snapshoty naozaj existujú** — Atlas → `inventario-prod` →
   Backup. Zálohu, ktorú nikto nikdy nevidel, nemáme.
2. **Skúsiť restore nanečisto (DR test)** — už je to otvorený bod v NEXT.md
   od júna („smoke + DR test"). Flex snapshot sa dá obnoviť do iného
   clustera alebo stiahnuť lokálne. Prvý restore nesmie byť až v deň, keď
   o dáta reálne príde.
3. **Zosúladiť `docs/compliance/`** — skontrolovať, či Data Retention
   Schedule / DPIA / Security Whitepaper netvrdia o zálohovaní viac, než
   Flex reálne poskytuje.
4. **Pozn. k zmazanému dev clusteru:** ak boli pri ukončení ponechané jeho
   zálohy, ostávajú dostupné pod menom pôvodného clustera (a účtujú sa),
   kým nevypršia alebo sa nezmažú.

Zdroj: MongoDB Atlas docs — Flex Cluster Backups.

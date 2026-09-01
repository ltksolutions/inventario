<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-09-01 (3) — „sfz" z kódu von a oprava limitu uploadu

## Kontext

Janika: „sfz" už nemá byť v žiadnom kóde ani v názvoch a poliach kolekcií.
Pri tom istom audite sa ukázalo, že limit 20 MB na upload príloh na
Verceli nemôže fungovať.

Rozsah schválený vopred: kód, schémy, infra a testovacie fixtures.
Dokumentácia zostáva — tam „SFZ" znamená pilotného zákazníka a skutočné
udalosti, prepísanie by z faktov urobilo nepravdu.

## 1. Limit uploadu — potvrdený bug, opravený

`server.ts` mal `limits: { fileSize: 20 * 1024 * 1024 }` a handler hlásil
vlastnú chybu „Maximálna veľkosť je 20 MB". Vercel má ale strop **4,5 MB
na telo requestu aj odpovede**.

**Overené skutočným requestom na produkciu**, bez cookie (takže sa nič
nezapísalo):

```
POST /v1/assets/000000000000000000000000/attachments
  6 MB súbor  → HTTP 413   (Vercel, ešte pred našou funkciou)
  1 KB súbor  → HTTP 401   (náš requireAuth, teda request dorazil)
```

Upload 5–20 MB súboru teda v produkcii padal a používateľ dostal hrubú
413 namiesto našej hlášky. Nikto to nenahlásil, lebo jediná nahraná
príloha má 2,23 MB.

Limit je teraz **4 MB** na oboch miestach (`server.ts` aj
`ATTACHMENT_MAX_BYTES`), zvyšok do 4,5 MB je rezerva na multipart obálku
a hlavičky. Text v UI (`AssetDetailContent.tsx`) aj v OpenAPI popise
upravený. Cesta k väčším súborom je priamy upload do úložiska tenanta
mimo funkcie — ADR-0037.

## 2. „sfz" — čo šlo von a v akej kategórii

### Hodnoty v databáze (migrácia `2026-09-01-drop-sfz-naming`)

- **`attachments.bucket`** — enum `'sfz-asset-attachments' |
'sfz-asset-protocols'`. Pole išlo von **úplne**: Vercel Blob buckety
  nemá, hodnota sa zapisovala natvrdo a nikto ju nečítal.
  `'sfz-asset-protocols'` sa nezapísalo ani raz, PDF protokoly sa
  generujú a hneď streamujú.
- **`affiliation.type`: `SFZ_DEPARTMENT` → `ORG_DEPARTMENT`**
  v `memberships` a `users`. V produkcii to nemal ani jeden dokument
  (31 memberships má `affiliation.type` prázdny, 29 users pole vôbec
  nemá), ale migrácia je tam pre dev a demo prostredia.

Zmerané pred zmenou: prílohy 1 dokument (2,23 MB), celá DB 4,1 MB.
Migrácia dát je teda triviálna; rozhodnutie bolo o schéme, nie o objeme.

### Identifikátory, ktoré neboli len kozmetika

- `server.ts` vracal na `GET /` `{ name: '@sfz/api' }` — to je **verejná
  odpoveď API**, nie komentár. Teraz `@inventario/api`.
- `@sfz/shared-types` v docstringoch a v hláškach generátorov — balík sa
  pritom naozaj volá `@inventario/shared-types`, takže to bolo aj
  **nesprávne**, nielen staré.

### Príklady v hláškach a placeholderoch pre používateľa

Prefix inventárneho čísla `"SFZ"` → `"INV"`, `SFZ-2026-0001` →
`INV-2026-0001`, domény `sfz.sk` / `majetok.futbalsfz.sk` → `firma.sk` /
`majetok.firma.sk`, e-mail `jano@futbalsfz.sk` → `jano@firma.sk`,
`data-tenant='sfz'` → `'firma'`. Dotknuté: `organisations.routes.ts`,
`config.ts`, `dynamic-cors.ts`, `organisation.ts`,
`OrganisationSettingsContent.tsx`, `AuthSettingsContent.tsx`,
`InvitationsContent.tsx`, `BrandProvider.tsx`, `TenantLoginPage.tsx`,
`middleware.ts`.

### Komentáre o pilotnom zákazníkovi

Štyri miesta v migráciách a v `UserDetailContent.tsx` hovorili „SFZ org",
„SFZ pilot". Preformulované na „pilotný tenant" / „druhá organizácia" —
fakt zostáva, názov ide von.

### Infra a testovacia databáza

- `infra/docker-compose.yml`: projekt `sfz-asset-management` →
  `inventario`, kontejnery `sfz-mongodb`/`-mongo-express`/`-mailhog` →
  `inventario-*`, volumes `sfz-mongodb-data`/`-config` →
  `inventario-mongodb-*`, `MONGO_INITDB_DATABASE: sfz_asset_management` →
  `inventario`.
- testovacia DB `sfz_asset_management_test` → `inventario_test`,
  migračné test DB `sfz_migration_*` → `inventario_migration_*`.
- test JWT: issuer `urn:sfz-test:dev` → `urn:inventario-test:dev`,
  kid `sfz-test-key` → `inventario-test-key`.

**Pozor pri prvom `docker compose up` po tejto zmene**: názvy volumes sa
zmenili, takže staré lokálne dáta sú v starých volumes (`sfz-mongodb-data`).
Nové prostredie nabootuje prázdne. Staré volumes zostali na disku a dajú
sa zmazať ručne (`docker volume rm sfz-mongodb-data sfz-mongodb-config
sfz-minio-data`) — zámerne som ich nemazal.

### Čo som nechal a prečo

- **`.github/markdown-link-check.json`** má výnimky pre
  `assets.futbalsfz.sk` a `api.futbalsfz.sk` — v prvom kole som ich nechal
  s odôvodnením, že sú to skutočné externé domény SFZ. **To bolo
  nesprávne** a Janika to zachytil: `assets.futbalsfz.sk` bola **stará
  doména tejto appky** pred prechodom na `inventario.estate` (máj 2026).
  Doriešené v druhom kole, viď nižšie.
- **`apps/web/src/middleware.ts`** drží `app.inventario.sportup.sk`
  v `CANONICAL_HOSTS` — to nie je „sfz" a je to vedomý druhý kanonický
  host.
- **Dokumentácia** (117 md súborov) — SFZ ako zákazník, compliance
  dokumenty, session logy, DR test log.
- **`seed-demo-tenant.ts`**: predvolený `--admin-email` bol
  `jan.letko@futbalsfz.sk`, teraz `jan.letko@firma.sk`. **To je zmena
  chovania skriptu** — ak ho spúšťaš bez `--admin-email`, teraz hľadá
  neexistujúceho používateľa a skončí s chybou. Zámerne som nemenil
  logiku, len hodnotu; ak chceš, vrátim tam tvoj e-mail alebo z parametra
  urobím povinný.

## Overenie

| krok                                                                                                 | výsledok                           |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `grep -i sfz` v `apps/*/src`, `packages/*/src`, testoch, infra, `.github` (mimo link-check výnimiek) | 0 výskytov                         |
| `generated/json-schema.json` po regenerácii                                                          | 0 výskytov                         |
| `tsc --noEmit` api + web                                                                             | čisté                              |
| eslint api + web + packages                                                                          | 0                                  |
| testy `@inventario/api`                                                                              | 70 súborov, 1059 passed, 2 skipped |
| testy `@inventario/shared-types`                                                                     | 7 súborov, 127 passed              |
| testy `@inventario/web`                                                                              | 1 súbor, 8 passed                  |
| `openapi:sync` + prettier + reuse                                                                    | čisté                              |

## Overené v produkcii po deployi

Migrácia sa spustila sama cez post-deploy workflow:

```
migrations.key = '2026-09-01-drop-sfz-naming'
completedAt    = 2026-09-01T16:04:03.975Z
```

A jediná príloha v produkcii už pole `bucket` nemá — zostalo
`originalFilename: image.jpg`, `sizeBytes: 2234886`. Overené read-only
dotazom do Atlasu, nie z logu.

## Nefungovalo / zamietnuté

- **Spustiť `pnpm` skripty** — Mac má node 26, repo vyžaduje 24.x
  (`ERR_PNPM_UNSUPPORTED_ENGINE`). Binárky som spúšťal priamo. Navyše
  `packages/shared-types/node_modules/.bin` nemá `tsc` (je len v roote),
  takže build balíka je `../../node_modules/.bin/tsc`.
- **Premenovať `NATIONAL_TEAM` a `CLUB`** v tom istom enume — nechal som.
  Sú to futbalové pojmy, ale nie „sfz"; zmena by bola mimo dohodnutého
  rozsahu a je to otázka na produkt, nie na úklid.

## Zostáva otvorené

- `storageKey` nesie celú URL, nie kľúč — pozostatok, ktorý zjednotí
  ADR-0037.
- ADR-0037 čaká na schválenie.

---

## Druhé kolo — staré domény, junk súbory a e-mail

### Staré domény boli stale, nie externé

`assets.futbalsfz.sk` nie je doména SFZ, ktorú by bolo treba obchádzať —
je to **stará doména tejto appky** pred prechodom na `inventario.estate`
(session `2026-05-22-domain-rename.md`). Zostala na štyroch miestach
v dokumentácii, ktoré ten prechod prehliadli:

| kde                                              | bolo                                                                                    | je                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `user-guide/getting-started/prve-prihlasenie.md` | `https://assets.futbalsfz.sk`                                                           | `https://app.inventario.estate`                                               |
| `user-guide/troubleshooting.md`                  | cookies pre `assets.futbalsfz.sk`                                                       | `app.inventario.estate`                                                       |
| `user-guide/_templates/tutorial.template.md`     | príklad adresy                                                                          | `app.inventario.estate`                                                       |
| `architecture/mcp-server.md`                     | `mcp.assets.futbalsfz.sk/sse`, `api.assets.futbalsfz.sk/api/v1`, premenná `SFZ_API_URL` | `mcp.inventario.estate/sse`, `api.inventario.estate/v1`, `INVENTARIO_API_URL` |

Obe výnimky z `markdown-link-check.json` teda išli von — nemali čo
obchádzať. `app.inventario.estate` aj `api.inventario.estate/health`
vracajú 200 (overené curlom). `mcp.inventario.estate` je v backtickoch,
takže ho link checker nekontroluje; MCP server neexistuje a doména sa
dorieši, keď sa bude stavať.

Pozn.: `api.assets.futbalsfz.sk/api/v1` malo aj nesprávnu cestu — API má
`/v1`, nie `/api/v1`.

### Junk súbory z 29. 5.

V roote repa boli dva **prázdne súbory z tej istej minúty** (29. 5. 13:18),
zjavne z mistypnutého príkazu: `inventario@0.1.0` a `turbo`. Namiesto
zmazania ich niekto pridal do `.gitignore` (riadky 77–78). Súbory aj tie
dva riadky sú von, plus 30 `.DS_Store` po repe.

**Docker Desktop na tomto Macu nie je nainštalovaný** —
`/usr/local/bin/docker` je visiaci symlink na `/Applications/Docker.app`,
ktorá tam nie je. Staré volumes `sfz-mongodb-data` a spol., pred ktorými
som v prvom kole varoval, teda neexistujú a niet čo mazať. To varovanie
bolo zbytočné.

### Predvolený e-mail v seed skripte

`seed-demo-tenant.ts` má `--admin-email` default `office@ltk.solutions` —
demo tenant patrí prevádzkovateľovi, nie konkrétnej osobe.

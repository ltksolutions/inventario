<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-09-02 — object storage, fázy 2 až 5 (ADR-0037)

Nadväzuje na plán `docs/sessions/2026-09-01-plan-object-storage.md`
a na ADR-0037. Fáza 0 a 1 (abstrakcia úložiska, private store) skončili
v predchádzajúcej session.

## Kde sú teraz prílohy a logá

| Čo               | Kde leží                                       | Ako sa k tomu klient dostane                             |
| ---------------- | ---------------------------------------------- | -------------------------------------------------------- |
| originál prílohy | private Blob store `inventario-private` (iad1) | `POST /v1/attachments/:id/download` → podpísaná URL      |
| náhľad prílohy   | BinData v `attachments.thumbnail`              | `GET /v1/attachments/:id/thumbnail` (za autentifikáciou) |
| logo tenanta     | BinData v `organisations.brandKit.logo`        | `GET /v1/public/organisations/:slug/logo` (verejné, CDN) |

Starý public store `inventario-api-blob` (fra1) zostáva pripojený a jeho
objekty sú nedotknuté — sú to jediné kópie z čias pred migráciou.

## 1. Dva story vedľa seba a prefix `BLOB_PRIVATE_`

Projekt už mal `BLOB_READ_WRITE_TOKEN` patriaci **starému public storu**.
Keby sa nový store pripojil s predvoleným prefixom `BLOB`, prepísal by ho
a rozbil pôvodný upload.

Vážnejšie: `@vercel/blob` pri chýbajúcom `token` siahne na
`process.env.BLOB_READ_WRITE_TOKEN`. Bez explicitného tokenu by teda
originály príloh potichu skončili vo **verejnom** store. Preto:

- prefix je `BLOB_PRIVATE_`,
- token sa SDK predáva vždy explicitne,
- `createVercelBlobStorage` bez tokenu **padne**,
- OIDC cesta sa nepoužíva vôbec — pri dvoch pripojených storoch ju ani
  nie je ako rozlíšiť.

Store bol omylom pripojený aj k projektu `contineo-app`; odpojené.

## 2. Región

`x-vercel-id` na `api.inventario.estate` je `fra1::iad1` — edge je vo
Frankfurte, ale **funkcia beží v IAD1 (Washington)**. Nový store je preto
v `iad1`, teda lepšie spolu s funkciou než starý `fra1`.

## 3. Náhľady

`lib/thumbnail.ts` — dlhšia strana 800 px, JPEG q0,8, ~200–300 KB.
Renderuje `@napi-rs/canvas` (Skia), ktorá už v repe je kvôli QR obrázkom.

Náhľad je v BinData, nie v store: vo výpise majetku by každá fotka inak
znamenala podpísanú URL a plný prenos originálu.

**Náhľad NIKDY nesmie ísť do výpisu príloh.** Každý čítací dotaz nad
`attachments` ho vylučuje projekciou (`WITHOUT_THUMBNAIL`) a stráži to
samostatný test `attachments-thumbnail-projection.test.ts`.

## 4. Chyby, ktoré stáli čas

### `Buffer.from(BSON Binary)` vráti PRÁZDNY buffer

Mongo driver vracia BinData ako BSON `Binary`, čo **nie je** `Uint8Array`.
`Buffer.from()` na ňom nespadne — vráti prázdno. Chytil to test, dvakrát
(náhľad, potom logo). Riešenie je `lib/bson-binary.ts` a používa sa
všade, kde sa BinData číta.

### Response schéma je aj runtime serializér

`fastify-type-provider-zod` použije response schému na serializáciu, takže
schéma na binárnom endpointe by z `Buffer` spravila JSON. Binárne routy
preto response schému **zámerne nemajú**.

### `requireAuth` číta cookie, nie hlavičku

Testy s `Authorization: Bearer` dostávali 401. Auth je v cookie
`inv_access`.

### `--check` na OpenAPI YAML padal o jeden znak

`yaml.stringify` píše `"…user's…"`, Prettier to prepíše na `'…user''s…'`.
Skript `openapi-to-yaml.ts` si teraz výstup formátuje Prettierom sám.

### CORP zabila logo (nájdené až po deployi)

Helmet dáva globálne `Cross-Origin-Resource-Policy: same-origin`. Logo sa
načítava cez `<img src>` z `app.inventario.estate`, kým endpoint je na
`api.inventario.estate` — taká požiadavka je `no-cors` a CORP ju
zablokuje. Pri starých Blob URL to nevadilo, tie CORP hlavičku nemali.
Routa teraz nastavuje `cross-origin`; kryje to test.

## 5. Kontrola OpenAPI v CI — bola tam diera

Pre-commit hook regeneroval `openapi.json`, ale **nie** `docs/api/openapi.yaml`.
A `docs.yml` sa spúšťa len pri zmene v `docs/**`, takže zmena zdrojáku API
Redocly nikdy nespustila. Kontrola je preto v `ci.yml`, nie v `docs.yml`,
a hook dopĺňa oba súbory.

## 6. Migrácia `2026-09-02-attachments-to-private-blob`

Produkcia, beh 2026-09-02 05:46:43 → 05:46:47 (3,7 s), bez chyby:

- 1 príloha (2,23 MB JPEG) → private store, náhľad 600×800 / 5,5 kB
- 2 logá (`ltk-solutions-s-r-o` PNG, `slovensky-futbalovy-zvaz` JPEG)
  → BinData, `logoUrl` na verejný endpoint s `?v=<timestamp>`

Rozhodnutia:

- **Cesta v store sa odvodzuje od `_id` prílohy**, nie z náhodného UUID —
  opakovaný beh prepíše ten istý objekt namiesto duplikátu.
- **Typ obsahu z magic bytes**, nie z uloženého `mimeType`.
- **Staré objekty v Blobe sa nemažú.** Migrácia sa nedá vrátiť: po
  prepnutí na private store starý kód novú prílohu neprečíta.
- **Čiastočné zlyhanie**: chyba jednej položky sa zaloguje a ide sa
  ďalej, na konci migrácia hodí výnimku → neoznačí sa ako dokončená a pri
  ďalšom deployi sa dobehne zvyšok.

Poznámka k runneru: migrácie **nebežia pri štarte API**. Cold start má len
pasívny `checkPendingMigrations` (warning); reálne ich spúšťa
`POST /v1/system/migrations/run` z workflow `migrate-on-deploy.yml`.
Zlyhanie teda zčervená workflow, appku nezhodí.

## 7. Web

Galéria aj hero karta berú `GET /v1/attachments/:id/thumbnail`. Kliknutie
si vypýta podpísanú URL z `/download` a otvorí ju v novej karte; okno sa
otvára **pred** `await`, inak by ho blokovač zahodil.

Nový hook `useAuthedBlobUrl`: chránený obrázok sa fetchuje s
`credentials: 'include'` a renderuje ako blob URL. `<img src>` by pri
cross-origin requeste auth cookie neposlal — v produkcii je cookie
`SameSite=None`, ale lokálne `lax` a `:3000` vs. `:3001` sú rôzne originy.
Rovnaký prístup už používal QR náhľad.

Logá zmenu vo webe **nepotrebovali**: `brandKit.logoUrl` po migrácii
ukazuje na náš verejný endpoint, takže prihlasovacia stránka, ScanPage aj
PDF loader fungujú bez zásahu.

## Čo zostáva otvorené

- Staré objekty v public Blobe — zmazať až po overení v prevádzke.
- Upload z webu ide stále cez multipart (strop 4 MB kvôli Vercelu).
  Priama cesta `upload-url` + `confirm` (25 MB) je na API hotová, web ju
  zatiaľ nepoužíva.
- `brandKit.logo.width/height` sú rozmery **náhľadu**, nie originálu, ak
  je logo väčšie než 800 px. Zdedené z upload routy, len kozmetika.
- ETag verejného loga stojí na `organisation.updatedAt`, ktorý migrácia
  nemenila. Cache-buster `?v=` to kryje, ale ETag by mal sledovať logo.
- PDF `logo-loader` fetchuje `logoUrl`, teda API volá samo seba cez sieť.
  Priame čítanie `brandKit.logo` z dokumentu by ušetrilo round-trip.

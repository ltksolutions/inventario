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

### Hodina hľadania chyby, ktorá tam nebola

Migrácia `2026-09-02b` hlásila „originál v úložisku nie je" na prílohe
z prvého priameho uploadu. Postavil som z toho reťaz dedukcií — `get`
vracia `null` práve pri 404, `head` tú cestu tiež nenájde, pritom pri
`confirm` ju našiel, takže medzi tými stavmi je jediná operácia, `put`,
ktorý teda musel uložiť inam — a podľa toho som aj zasahoval do kódu.

**Bolo to celé nesprávne.** Používateľ pripomenul, že tú fotku po nahraní
zmazal. V dokumente je `deletedAt` **minútu** po `createdAt`. Mazanie
prílohy odstraňuje aj objekt z úložiska, takže originál chýbať MAL.

Chyba bola v migrácii: filter neobsahoval `deletedAt: null`. Doplnené.

Čo z tých zásahov zostalo, lebo je to správne aj tak:

- `get` ide s `useCache: false`. Volá sa v `confirm` hneď po zápise a
  v migráciách — čítame práve to, čo sa zmenilo, takže CDN cache tam
  nemá čo robiť. **Nebol to fix**, len správne nastavenie.
- `confirm` berie `pathname` z odpovede `put`. Rozdiel sa nikdy
  nevyskytol (`storage.put` ho loguje ako `warn` a log je čistý), ale
  zapisovať si do DB vlastnú predstavu namiesto odpovede store je
  zbytočné riziko.
- Hláška z `get` nesie HTTP status. Bez neho sa nedá odlíšiť „nie je tam"
  od „nemáme naň právo" — to bola prvá vec, ktorá diagnostiku zdržala.

Poučenie: **v dokumente bola odpoveď celý čas.** Než postaviť reťaz
dedukcií o SDK, stačilo pozrieť `deletedAt` na tom jednom dokumente.

### JPEG kvalita je 0–100, nie 0–1

Náhľady boli nepoužiteľné — plochy rozpadnuté na bloky. `toBuffer` v
`@napi-rs/canvas` berie kvalitu na **škále 0–100**. Naša hodnota `0.8` sa
neodmietla, len znamenala kvalitu ≈1.

Ukazovateľ bol v dátach a nikto si ho nevšimol: náhľad z fotky 2,23 MB mal
**5,5 kB**. To je na 600×800 JPEG absurdne málo — presne to malo padnúť do
oka pri kontrole migrácie.

Overené proti `@napi-rs/canvas@1.0.2`, ten istý obrázok:

| kvalita | veľkosť |
| ------- | ------- |
| 0.8     | 3,7 kB  |
| 80      | 6,7 kB  |
| 100     | 59,7 kB |

Na šumovom obrázku 800×600 je rozdiel 17 kB proti 275 kB. Test to preto
chytá cez veľkosť náhľadu detailnej fotky (dolná hranica 80 kB); plochá
farba by na to nestačila, tá sa zakóduje do pár kilobajtov aj pri
najhoršom nastavení.

Existujúce náhľady prerába migrácia `2026-09-02b-regenerate-thumbnails` —
originál sa musí stiahnuť, z náhľadu sa náhľad prerobiť nedá.

### PUT bez hlavičiek uložil 200 a nič neuložil

Prvý reálny upload skončil na `confirm` s hláškou „Objekt v úložisku
neexistuje" — pritom PUT vrátil 200.

Podpísaná URL nejde na `*.blob.vercel-storage.com`, ako by sa čakalo, ale
na `https://vercel.com/api/blob/?pathname=…`. To je control-plane
rozhranie SDK a parametre uploadu čaká v HLAVIČKÁCH, nie v URL:
`x-vercel-blob-access`, `x-content-type`, `x-api-version`,
`x-vercel-blob-store-id`. Bez nich odpovie 200, ale objekt neuloží tam,
kde ho `confirm` hľadá.

Hlavičky preto diktuje server a vracia ich v odpovedi `upload-url`:
`access` musí byť `private` bez ohľadu na to, čo si myslí klient, a verzia
control-plane API patrí k SDK, ktoré má v rukách API. Klient dopĺňa len
`Content-Type` a `x-content-length`, ktoré vie zo `File`.

Čistá SDK cesta `uploadPresigned` z `@vercel/blob/client` sa použiť nedá:
jej fetch na `handleUploadUrl` nemá `credentials: 'include'`, takže by
naša auth cookie neprešla a endpoint by vrátil 401.

CORS pritom v poriadku bol — preflight z `app.inventario.estate` vracia
`allow-origin: *`, `PUT` aj `content-type`.

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

### Upload: priama cesta

`uploadAttachment` robí tri kroky — `upload-url` (server vydá podpis a
určí cestu), PUT priamo do storu, `confirm` (server objekt stiahne, overí
magic bytes, odstráni EXIF, vyrobí náhľad a až tu vzniká záznam). Strop je
tým 25 MB namiesto 4 MB, lebo PUT ide mimo našej funkcie.

Chyba z `confirm` sa hlási inak než chyba z uploadu: bez tretieho kroku
príloha nevznikne a objekt v store zostane osirelý.

Lokálne bez `BLOB_PRIVATE_READ_WRITE_TOKEN` vracia stub adresu `stub://`,
na ktorú prehliadač nahrať nevie — vtedy web padá späť na pôvodnú
multipart cestu.

## Čo zostáva otvorené

- Staré objekty v public Blobe — zmazať až po overení v prevádzke.
- Priamy upload z prehliadača **funguje** (overené 2026-09-02 reálnym
  súborom) — po dvoch opravách, viď „PUT bez hlavičiek" a „JPEG kvalita".
- `brandKit.logo.width/height` sú rozmery **náhľadu**, nie originálu, ak
  je logo väčšie než 800 px. Zdedené z upload routy, len kozmetika.
- ETag verejného loga stojí na `organisation.updatedAt`, ktorý migrácia
  nemenila. Cache-buster `?v=` to kryje, ale ETag by mal sledovať logo.
- PDF `logo-loader` fetchuje `logoUrl`, teda API volá samo seba cez sieť.
  Priame čítanie `brandKit.logo` z dokumentu by ušetrilo round-trip.

<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT

Pracovný zoznam — **len to, čo je otvorené alebo plánované**. História
hotových stavov je v `NEXT-archiv.md`.

Pravidlo: keď je vec hotová a nasadená, ide von odtiaľto. Session log
zostáva zdrojom detailov, `CHANGELOG.md` zdrojom toho, čo sa zmenilo.
Dokumentácia je indícia, `git log` je pravda — pred tvrdením „toto je
ešte otvorené" over v gite, či sa to medzitým nevyriešilo.

---

## Najbližšie kroky (kód)

- **Sériová auth reťaz na dashboarde.** Dashboard query čaká na
  `/v1/auth/me` (`enabled: isAuthenticated`), lebo potrebuje vedieť, že
  je používateľ prihlásený. Zisk zo súbežného spustenia by bol ~0,6 s
  (1,84 → ~1,2 s). Otázka je, či to stojí za komplikáciu s obnovou
  vypršaného tokenu. Kontext: `2026-08-31-pomale-nacitanie-dashboardu.md`.
- **Slovník `error` na `/v1/system`** — `migrations`, `indexes` a
  `retention` majú v poli `error` skratky v SCREAMING_SNAKE
  (`INDEXES_DISABLED`, `UNAUTHORIZED`) namiesto konvencie zvyšku API
  (`NotFound`, `BadRequest`). Tvar tela je od 2026-09-01 jednotný,
  slovník nie. Sú to zdokumentované kódy pre deploy workflow, takže zmena
  chce rozhodnutie, nie mechanickú opravu.
- **`issues` v chybovej odpovedi je v praxi zriedkavé** — validácia vstupu
  cez Fastify vracia jednu chybu v `message`, `issues` sa naplní len keď
  sa `ZodError` dostane k error handleru priamo. Ak má integrátor dostávať
  field-level chyby vždy, treba prepojiť `setErrorHandler` s Fastify
  `schemaErrorFormatter`. Kontext:
  `2026-09-01-openapi-chybove-odpovede.md`.
- **Node 24 na dev stroji** — Mac má len node 26, `package.json` vyžaduje
  `engines.node: 24.x`, takže `pnpm` skripty padajú na
  `ERR_PNPM_UNSUPPORTED_ENGINE`. Zatiaľ sa obchádza spúšťaním binárok
  priamo z `node_modules/.bin`. Rozhodnúť: doinštalovať node 24, alebo
  uvoľniť `engines`. Kontext: `2026-09-01-openapi-chybove-odpovede.md`.
- **i18n (SK / CS / EN)** — dnes žiadne i18n nie je, texty sú
  v komponentoch natvrdo po slovensky. Platforma je ale white-label
  a multi-tenant, takže prvý český alebo anglický tenant to otvorí.
  Rozsah, ktorý treba rozhodnúť **pred** prvým riadkom kódu:
  - knižnica (`next-intl` vs. `react-i18next` vs. vlastné) a či routing
    nesie locale v ceste (`/sk/...`) alebo nie
  - kde sa locale berie: preferencia používateľa v DB, nastavenie
    organizácie, `Accept-Language`, alebo kombinácia s prioritou
  - fallback: chýbajúci preklad má padnúť na slovenčinu, **nikdy** na kľúč
  - texty z API — chybové `message` z `error-handler.ts` a e-mailové
    šablóny sú tiež používateľské texty. Prekladať na serveri podľa
    locale používateľa, alebo posielať kód a prekladať na klientovi?
    (Odpoveď má dopad na tvar chybovej odpovede — `error` je dnes voľný
    text, nie enum.)
  - dátumy, čísla a meny — dnes formátované slovensky
    Toto je rozhodnutie na **ADR**, nie na commit. Kým nevznikne, nezavádzať
    i18n knižnicu ani nerozbíjať texty do kľúčov (pravidlo je v `CLAUDE.md`).
- **Ďalší štvrťročný DR test je po termíne** — posledný záznam v
  `docs/compliance/dr-test-log.md` je #1 z 2026-05-23 (PASS), kadencia
  podľa `disaster-recovery-plan.md` je štvrťročná. Flex tier neumožňuje
  restore do nového clustera, takže test #1 išiel do dev clustera, ktorý
  je medzitým určený na zmazanie — pred ďalším testom vyriešiť cieľ
  restoru.
- **Staré objekty v public Blobe zmazať — čaká len na rozhodnutie.**
  Migrácia `2026-09-02-attachments-to-private-blob` ich nechala na mieste,
  lebo sa nedá vrátiť. Nová cesta je 2026-09-02 overená v prevádzke celá:
  upload (priamy PUT do storu + `confirm`), náhľad, otvorenie originálu
  podpísanou URL aj logo na prihlasovacej stránke. Potom sa dá odpojiť
  starý store `inventario-api-blob` a zahodiť `BLOB_READ_WRITE_TOKEN`
  — okrem mazania starého loga v `organisations.routes.ts`, ktoré ho
  ešte používa a s odpojením musí ísť von.
- **`BLOB_API_VERSION = '12'` je v `attachments.routes.ts` natvrdo** —
  `@vercel/blob` ju neexportuje. Pri bumpe SDK overiť, či sa nezmenila;
  test kontroluje len to, že hlavička je neprázdna.
- **Osirelé objekty v private store** — z neúspešných uploadov (PUT bez
  hlavičiek, 2026-09-02) ich v store niekoľko zostalo: objekt vznikol, ale
  `confirm` záznam nevytvoril. Upratovanie osirelých objektov nikto
  nerobí; retenčný job sa ich netýka.
- **Plná záloha originálov** — náhľad v BinData je degradovaná poistka,
  nie záloha. Blob nemá verzovanie. Možnosti: mesačný cron zrkadliaci
  store inam, alebo zmieriť sa s jednou kópiou. Rozhodnúť samostatne.
- **Validácia expirácie podpísaných URL** — dnes sa spoliehame na hodnotu
  z `UPLOAD_URL_TTL_SECONDS` / `DOWNLOAD_URL_TTL_SECONDS` a nikde
  neoverujeme, že store expiráciu naozaj vynucuje. Chce jeden test proti
  reálnemu storu.
- **Drobnosti po ADR-0037** (žiadna z nich nič nerozbíja, detaily
  v `2026-09-02-object-storage-fazy-2-5.md`): `brandKit.logo.width/height`
  sú rozmery náhľadu, nie originálu, ak je logo väčšie než 800 px; ETag
  verejného loga stojí na `organisation.updatedAt`, ktorý sa pri zmene
  loga nemení (kryje to cache-buster `?v=`); PDF `logo-loader` fetchuje
  `logoUrl`, teda API volá samo seba cez sieť, namiesto priameho čítania
  `brandKit.logo`.
- **`docs/user-guide/` je napísaný pre SFZ, nie pre white-label produkt** —
  „Som zamestnanec SFZ", `support@futbalsfz.sk` _(TODO: overiť)_,
  `noreply@futbalsfz.sk`, doména `@futbalsfz.sk` ako príklad. Nový tenant
  si to prečítať nemôže. Je to väčšia práca než premenovanie — chce
  rozhodnutie, či bude user-guide generický s príkladmi, alebo per-tenant.
  Zistené 2026-09-01.
- **Docker Desktop na tomto Macu nie je** — `/usr/local/bin/docker` je
  visiaci symlink na neexistujúcu `/Applications/Docker.app`. Lokálny
  compose stack sa odtiaľ spustiť nedá; ak ho chceš, treba Docker
  doinštalovať.
- **`mcp.inventario.estate` treba doriešiť** pri stavbe MCP servera —
  `docs/architecture/mcp-server.md` už na ňu odkazuje, DNS a Vercel
  projekt neexistujú.
- **`docs/sessions/README.md` má zastaralý index** — indexovaný zoznam
  končí pri 2026-05, session logy od júna do septembra v ňom nie sú.
  Buď doplniť, alebo index zrušiť a nechať len konvencie (adresár je
  zoradený podľa dátumu sám). Zistené 2026-09-01.
- **GitHub Discussions** — v repozitári nie sú zapnuté (Settings →
  Features), ale `docs/user-guide/support.md` na ne odkazuje. Odkaz je
  zatiaľ v `ignorePatterns` link checkera; po zapnutí ten pattern
  odstrániť.

## Úklid v kóde (nice-to-have, nie blocker)

- **`apps/web/src/lib/api-hooks.ts`** — dočasné pretypovanie
  `apiClient.GET` / `apiClient.POST` v `useBorrowerBorrowedItems` a
  `useReturnItemsFromBorrower`. Vzniklo, kým `api-types.ts` nepoznalo
  nové endpointy; po `generate:api-types` sa dá zrušiť. Čistý úklid,
  nie funkčná zmena.
- **`DateField`** — klávesnicová navigácia šípkami v mriežke, a11y
  audit, živé odskúšanie flip-up v prehliadači.
- **Vercel function región** — zvážiť pinnutie bližšie k regiónu
  MongoDB Atlas. Pozorované `iad1` / `sfo1` / `fra1`, teda deploy môže
  skončiť aj za oceánom od databázy vo Frankfurte.

## Živé overenie na hardvéri

- **Zebra ZD420 + Browser Print** — softvérové blokácie sú odstránené
  (LNA address space, CORS preflight), fyzický test ešte neprebehol:
  čitateľnosť QR, diakritika, sýtosť. Safari ostáva nepodporované
  (mixed-content blok, vedomé rozhodnutie z 15. 7.).

## Ops mimo kódu (Janika)

- **Atlas** — zmazať cluster `inventario-dev` (M10, prázdny, ~58 USD/mes.);
  zmazať mŕtve repo secrets `MONGO_URI_TEST`, `ENTRA_API_CLIENT_ID_TEST`,
  `ENTRA_TENANT_ID_TEST`; vyriešiť Preview `MONGO_URI` vo Verceli (ukazuje
  na cluster, ktorý sa má zmazať); prekontrolovať projekt `contineo.app`
  (rovnaký M10 podpis, 11,50 → 65,20 USD).
- **Zálohovanie produkcie** — `inventario-prod` je Flex, teda 8 denných
  snapshotov, bez vlastnej politiky, bez on-demand snapshotov a **bez
  Point-in-Time restore**. Reálne RPO až 24 h, vedome prijaté (M10 by
  stálo tých istých ~58 USD/mes.). Otvorené: overiť v Atlas → Backup, že
  snapshoty naozaj existujú; spraviť DR test (restore nanečisto — stály
  otvorený bod od júna); skontrolovať, či `docs/compliance/` netvrdí o
  zálohovaní viac, než Flex reálne poskytuje.
- **Apple Sign-In** — Apple Developer credentials + `APPLE_*` env
  premenné.
- **Bezpečnosť** — rotácia produkčného Mongo hesla; voliteľné vyčistenie
  demo dát z produkcie.

## Pre-GA / neskôr

- `@axe-core/cli` v CI proti nasadenému `apps/web`.
- Súkromné blob URL pre citlivé doklady.
- E2E test protokolov s dvomi účtami.
- `EMAIL_PROVIDER=ecomail` pre Preview; odvolať mail-tester pozvánku.
- CSV export z Audit logu (zámerne mimo v1).
- Bulk invite cez CSV; per-tenant override e-mailového providera.
- `test-jwt-loader` → migrácia na `provisionUser()`.
- MCP server (Slice #10, plánované Q1 2027).

---

## Vedomé rozhodnutia (nie otvorené body)

Veci, ktoré vyzerajú ako nedorobok, ale sú tak zvolené — aby sa
neotvárali dokola.

- **`/v1/assets/by-token/{publicToken}` koliduje tvarom s
  `/v1/assets/{id}/…`.** Redocly to hlási ako `no-ambiguous-paths` (4
  warningy: `{id}/audit`, `{id}/qr`, `{id}/attachments`, `{id}/label`) —
  request na `/v1/assets/by-token/x` by teoreticky mohol matchovať
  `{id} = "by-token"`. V praxi ku kolízii nedochádza: `by-token` má za
  segmentom parameter, ostatné majú literál. Oprava by znamenala
  premenovať endpointy, teda breaking change API aj zásah do
  `apps/web/src/components/ScanPage.tsx` — nestojí to za to.
  Pozn.: starší záznam tu uvádzal `/v1/assets/tags/*`; to bolo nesprávne,
  tie cesty sú jednosegmentové a Redocly ich nehlási (overené 2026-09-01).
- **Swagger v produkcii ostáva zapnutý.** Vercel projekt
  `inventario-api` má `ENABLE_SWAGGER` nastavenú explicitne (Production
  - Preview) a prebíja default odvodený od `NODE_ENV` v `config.ts`,
    takže `/docs` na produkčnom API funguje. Swagger stál z cold startu
    ~45 ms — vedľa 1,75 s ušetrených inde je to zanedbateľné — a nič
    neodhaľuje, keďže repo je verejné aj s OpenAPI schémou. Default v
    kóde slúži ako poistka, keby premennú niekto odstránil.
- **`inventario-prod` ostáva na Flex tieri** napriek limitom záloh
  (viď vyššie). M10 by stálo ~58 USD/mes. za funkcie, ktoré pri 4 MB
  dát nepotrebujeme.
- **`apps/api/.env.local` mieri na produkciu.** Vedome prijaté riziko.
- **Safari nepodporuje Zebra tlač** (mixed-content blok). Rozhodnutie
  z 15. 7., nebudeme obchádzať.

---

## Referencie

- Archív hotových stavov: `docs/sessions/NEXT-archiv.md`
- Session logy: `docs/sessions/`
- ADR: `docs/decisions/`
- TODO.md: #18 (legacy roles endpoint)

## Pozn. pre Cowork prostredie

V Cowork beží terminál + filesystem priamo na disku — žiadny
`copy_file_user_to_claude` workaround. `pnpm typecheck` / `pnpm test` /
`pnpm build` možno spúšťať priamo. Git cez MCP alebo GitHub Desktop
(GPG signing).

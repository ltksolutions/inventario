# Plán implementácie — ADR-0037 (object storage)

> **Typ:** Pre-session plan. Schválené rozhodnutie je
> [ADR-0037](../decisions/0037-object-storage-bindata-plus-tenant-s3.md).
> Tento dokument je plán realizácie, nie rozhodnutie.
>
> **Stav:** čaká na (a) vytvorenie private Blob storu, (b) rozhodnutie
> o dvoch bodoch nižšie.

## Čo musíš urobiť ty (blokuje všetko ostatné)

Private Blob store sa nedá vytvoriť z kódu — treba tvoj Vercel prístup:

```bash
vercel blob create-store inventario-private --access private
```

alebo v dashboarde: projekt → **Storage** → **Create Database** → **Blob**
→ **Continue** → access **Private**.

Potom store **pripoj k projektu `inventario-api`**. Vercel tým do
prostredia pridá OIDC token a `BLOB_STORE_ID` sám; pre lokálny vývoj mimo
Vercelu treba `BLOB_READ_WRITE_TOKEN` daného storu do
`apps/api/.env.local`.

Existujúci **public** store zostáva — logá aj staré prílohy v ňom
nateraz ostávajú (mažeme až po overení).

## Dve veci na rozhodnutie pred kódom

### 1. EXIF a priamy upload do storu — regresia, ktorú treba vedome vyriešiť

Dnes upload príloh prechádza funkciou a `lib/strip-image-metadata.ts`
z každého obrázka **odstráni EXIF** — teda GPS súradnice, sériové číslo
telefónu a presný čas. Je to zámerná data-minimalizácia (GDPR), fotky
majetku z mobilov to nesú bežne.

Ak sa originál nahráva **podpísaným PUT priamo do storu**, funkcia ho
nevidí a **EXIF sa do storu dostane nedotknutý.** To je vecná regresia
v ochrane osobných údajov, nie detail.

Možnosti:

|       | ako                                                                            | plus                                   | mínus                                                        |
| ----- | ------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------ |
| **A** | `confirm` krok po uploade originál stiahne, odstráni EXIF a prepíše ho v store | garancia zostáva na serveri, kde patrí | jeden extra round-trip na súbor, platí sa Blob Data Transfer |
| **B** | strip v prehliadači pred uploadom                                              | žiadny extra prenos                    | privacy-kritický kód na klientovi, klient ho môže obísť      |
| **C** | obrázky ďalej cez funkciu (≤4 MB), podpísaný PUT len pre PDF a veľké dokumenty | najmenšia zmena                        | limit 4 MB pre fotky zostáva, teda pôvodný problém nezmizne  |

Odporúčam **A**: prenos je jednorazový, garancia zostáva overiteľná
serverom a limit na veľkosť fotky sa uvolní.

Pozn.: `4,5 MB` strop Vercelu sa na tento fetch **nevzťahuje** — je to
limit tela requestu a odpovede _funkcie voči klientovi_, nie odchádzajúcich
volaní funkcie. 20 MB obrázok teda funkcia stiahnuť a spracovať vie
(pamäť 1024 MB, `maxDuration` 30 s).

### 2. Kto generuje náhľad

Vyplýva z bodu 1. Ak platí A, náhľad vyrobí ten istý `confirm` krok
z už stiahnutého buffera — teda **zadarmo**, bez ďalšieho prenosu.
`@napi-rs/canvas` je v `apps/api` už dnes.

## Postup

### Fáza 0 — príprava (bez závislosti na store)

1. `plugins/config.ts` — pridať `BLOB_READ_WRITE_TOKEN` a `BLOB_STORE_ID`
   do Zod schémy ako voliteľné; doplniť do `.env.example` a do
   `turbo.json` → `globalEnv`.
2. `lib/storage/` — tenká abstrakcia nad Blobom, rovnaký vzor ako
   `plugins/email-providers/` (interface + `vercel-blob` implementácia +
   `stub` pre testy). Bez toho by integračné testy siahali na skutočný
   store.

### Fáza 1 — schéma a náhľady v BinData

3. `packages/shared-types/src/schemas/attachment.ts`:
   - `storagePathname: string` — pathname v private store (dnešný
     `storageKey` nesie celú public URL)
   - `thumbnail: { data: Buffer; mimeType: string; width: number; height: number } | null`
   - `storageAccess: 'public-legacy' | 'private'` — aby sa staré a nové
     prílohy dali rozlíšiť počas prechodu
4. `packages/shared-types/src/schemas/organisation.ts` — `brandKit.logo`
   ako BinData (`data`, `mimeType`, `width`, `height`), `logoUrl` zostáva
   pre spätnú kompatibilitu a pre externé URL.
5. `lib/thumbnail.ts` — `@napi-rs/canvas`, dlhšia strana 800 px, JPEG
   q≈0.8, cieľ do ~300 KB.
6. `GET /v1/attachments/:id/thumbnail` — `requireAuth` +
   `loadCurrentUser` + `canRead`, tenant check, `private, no-cache`,
   `ETag` + `If-None-Match` → `304`.
7. `GET /v1/public/organisations/:slug/logo` — **bez** autentifikácie,
   `Cache-Control: public, s-maxage=86400`, `ETag`. Musí vracať len logo
   a nič iné; je CDN-cachovaný, takže chyba v tenant scope by bola
   cachovaná chyba.
8. **Test, ktorý stráži, že sa binárka nedostane do výpisov** — žiadny
   dotaz nad `attachments` nesmie vrátiť `thumbnail.data` bez explicitného
   vyžiadania.

### Fáza 2 — private store

9. `POST /v1/assets/:id/attachments/upload-url` — `canWrite`, vráti
   podpísaný PUT a `pathname` (`attachments/<tenantId>/<assetId>/<uuid>.<ext>`).
10. `POST /v1/assets/:id/attachments/confirm` — overí, že objekt existuje
    a jeho veľkosť aj typ; stiahne, odstráni EXIF, prepíše v store;
    vyrobí náhľad; zapíše metadáta a `sha256`.
11. `GET /v1/attachments/:id/download` — po autorizácii vráti **podpísanú
    GET URL** s expiráciou 15 min. Nikdy nelogovať celú URL.
12. `DELETE /v1/attachments/:id` — mazať v private store aj náhľad v DB.
13. Starý multipart `POST /v1/assets/:id/attachments` **zostáva** pre
    súbory do 4 MB (dohodnuté), ale ukladá už do private storu.
14. Logo: `POST /v1/organisations/current/logo` prestane písať do Blobu,
    zapíše BinData do `brandKit.logo`.

### Fáza 3 — migrácia dát

15. Migrácia `2026-09-XX-attachments-to-private-blob`: pre každú prílohu
    so starou public URL stiahnuť, uložiť do private storu, vyrobiť
    náhľad, prepnúť `storageAccess`. Pre logá stiahnuť a uložiť BinData.
    V produkcii ide o **1 prílohu a 2 logá**. Idempotentná (preskočí, čo
    už má `storageAccess: 'private'`).
16. Staré public objekty **nechať** — mažeme až po overení, so tvojím
    potvrdením. Do vtedy zostávajú verejne čitateľné.

### Fáza 4 — web

17. Zoznam a detail majetku ťahajú `thumbnail` endpoint; klik na fotku
    vyžiada `download` a otvorí podpísanú URL.
18. Login stránka a `ScanPage` ťahajú logo z nového verejného endpointu.
19. Overiť mobile-first na úzkom viewporte.

### Fáza 5 — dokumentácia

20. `CHANGELOG.md`, `ARCHITECTURE.md` (tok requestu a hranice),
    `RUNBOOK.md` (nový store, čo robiť keď upload zlyhá),
    `docs/architecture/data-model.md`, session log.

## Riziká

- **Verejný logo endpoint je bez autentifikácie a CDN-cachovaný.** Chyba
  v tenant scope sa zacachuje. Chce vlastný test na cross-tenant.
- **Náhľad vo výpise.** Bod 8 nie je nice-to-have.
- **Podpísaná URL je do expirácie prenosná.** Krátka expirácia, žiadne
  logovanie celých URL.
- **Náhľady nafúknu DB.** Pri 300 KB a tisíc prílohách 300 MB proti
  dnešným 4,1 MB. Sledovať proti stropu Atlas Flex.
- **Migrácia sa nedá vrátiť** — po prepnutí na private store starý kód
  novú prílohu neprečíta. Preto staré objekty nemažeme.

## Definition of Done

`pnpm lint`, `typecheck`, `test`, `format:check` čisté → `openapi:sync`
a `redocly lint` čisté → nové endpointy pokryté integračnými testami
vrátane cross-tenant a projection testu → rozhranie overené mobile-first
→ migrácia idempotentná a otestovaná → `NEXT.md`, `CHANGELOG.md`,
`ARCHITECTURE.md`, `RUNBOOK.md` a session log aktualizované → commity so
`Signed-off-by`.

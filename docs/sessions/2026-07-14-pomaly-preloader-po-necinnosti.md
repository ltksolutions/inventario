<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-07-14 (pokračovanie) — pomalý preloader po nečinnosti

## Kontext

Janikov popis (verbatim, skrátené): po 2-3 min nečinnosti a otvorení stránky
(napr. Majetok) sú dáta na pozadí viditeľné do 1-2s, ale preloader sa točí
ešte niekoľko sekúnd, niekedy aj viac ako 10s. Doplňujúce otázky
(AskUserQuestion): postihnuté aj iné stránky (Žiadosti, Používatelia...), len
po nečinnosti (cold), nie počas bežného prezerania.

## Diagnóza

Z Vercel runtime logov (`inventario-api`, 30 min okno, 2026-07-14 18:21–18:51
UTC):

- Po nečinnosti frontend vypáli naraz 4-5 requestov (assets, categories,
  locations, organisations/current...). Väčšina dopadne na teplú instanciu
  (~0,3-1s). Minimálne jeden pravidelne dopadne na studenú instanciu, ktorá
  musí od nuly nabootovať Node proces → pripojiť MongoDB (TLS handshake) →
  inicializovať e-mail/JWT služby → Swagger — spolu ~10-12s, než sa vôbec
  začne vykonávať samotný dotaz.
- `GlobalFetchOverlay` je globálny `useIsFetching()` counter — čaká na
  **všetky** rozbehnuté requesty naraz, takže visí, kým nedobehne aj ten
  jeden studený.
- Overené: Vercel Function región je už fixovaný na jeden (`iad1`) —
  variabilita fra1/sfo1/iad1 v starších logoch bola len routing-tag v reqId,
  nie skutočný región vykonania funkcie. Región teda nebol súčasťou
  problému, žiadna zmena tam nebola potrebná.

## Rozhodnuté (AskUserQuestion)

Janika si vybrala "čo odporúčaš ty" → odporučil som:

1. `staleTime` 5 min pre málo sa meniace dáta (menej paralelných requestov
   po krátkej nečinnosti)
2. Vercel Cron keep-warm ping (menej frekventné studené starty)
3. Región vs. Atlas — vynechané, ukázalo sa zbytočné (pozri vyššie)

Vercel plán potvrdený ako Pro → Cron môže bežať častejšie ako 1×/deň.

## Implementácia (commit `8a91c32`)

- **`apps/web/src/lib/api-hooks.ts`** — `makeListHook` dostal nepovinný
  `staleTimeMs` parameter; `useCategories`/`useLocations` a
  `useAssetConditions` teraz používajú nový `REFERENCE_DATA_STALE_TIME_MS`
  (5 min) namiesto globálneho 30s defaultu z `providers.tsx`. Mutácie nad
  týmito zdrojmi (create/rename/delete) už invalidateQueries volajú, takže
  freshness po úprave nie je ovplyvnená.
- **`apps/web/src/lib/organisations-hooks.ts`** — `useCurrentOrganisation`
  rovnako, `staleTime: REFERENCE_DATA_STALE_TIME_MS` (import z
  `api-hooks.ts`).
- **Zámerne vynechané: `useMembers`** (beneficiary picker, ADR-0025) —
  `POST /v1/memberships/pre-provisioned` (ADR-0034) tento query key nikde
  neinvaliduje, takže dlhší staleTime by spomalil presne to, čo ADR-0034
  riešilo (okamžitá použiteľnosť predpripraveného člena ako beneficiary).
- **`apps/api/vercel.json`** — nový cron záznam: `GET /health/ready` každé
  4 min (`*/4 * * * *`). Endpoint už existoval, bez auth, pingne aj Mongo
  (`fastify.mongo.db.command({ ping: 1 })`) — udrží teplú instanciu aj DB
  spojenie súčasne.
- **`apps/api/src/modules/health/health.routes.ts`** — doplnený komentár
  vysvetľujúci nové použitie endpointu (keep-warm cron).

`tsc --noEmit`, `eslint`, `prettier --check` čisté na všetkých upravených
súboroch (sandbox tentoraz nemal problém, žiadny natívny binár nebol
potrebný — čisté TS/JSON zmeny).

## Nasadenie a overenie

Push → oba deployy (`inventario-api`, `inventario-web`) `READY`,
`get_runtime_errors` bez nových chýb (jediný nález — `MongoServerError: bad
auth`, 6× od 2026-05-28 — je z výrazne staršieho deploymentu, nesúvisí s
touto zmenou, len na vedomie ako drobná pretrvávajúca anomália).

## Ďalšie kroky

- Overiť subjektívne o niekoľko dní, či sa frekvencia dlhého spinovania
  preloadera znížila.
- Ak problém pretrváva: zvážiť obmedzenie `GlobalFetchOverlay` len na
  kritické (blocking) requesty namiesto úplne všetkých — väčšia UX zmena,
  vedomne odložená mimo tejto úlohy.
- `MongoServerError: bad auth` (6× od mája) — nesúvisiace, ale stojí za
  krátku kontrolu, ak sa začne opakovať častejšie.

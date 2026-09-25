<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-09-25 — vyhľadávanie v majetku

Podnet od kolegu: „v majetku mi nefunguje vyhľadávanie, bolo by fajn,
keby hľadalo nie len názov a inventárne číslo, ale aj sériové číslo".

## Príčina

Hlásenie bolo užšie, než skutočný problém. V `AssetsListContent.tsx` sa
filtrovalo **klientsky nad aktuálnou stránkou** (default 20 položiek):

```ts
const haystack = `${asset.inventoryNumber} ${asset.name}`.toLowerCase();
```

`GET /v1/assets` poznal len `limit` / `skip`. Dve chyby naraz:

1. položka na strane 2+ sa nenašla vôbec — preto „nefunguje", aj keď
   kolega hľadal podľa názvu,
2. sériové číslo (ani výrobca, model, popis) v haystacku nebolo.

## Oprava

- **API**: `GET /v1/assets?q=` — voliteľný, `trim`, max 200 znakov.
  `buildAssetSearchFilter` (`modules/assets/asset-search.ts`) postaví
  `$or` s escapovaným `$regex` (`$options: 'i'`) cez `inventoryNumber`,
  `name`, `serialNumber`, `manufacturer`, `model`, `description`.
  Tenant scope pridáva repozitár cez `tenantFilter` ako doteraz.
  Nie je to breaking change — parameter je voliteľný, tvar odpovede sa
  nemení.
- **Web**: `useAssets` je vlastný hook (nie `makeListHook`), lebo ako
  jediný z trojice assets/categories/locations posiela `q`. V zozname
  300 ms debounce, zmena výrazu vráti na stranu 1, riadok s počtom
  ukazuje „Nájdených N položiek". Klientsky haystack je preč.
- Rozsah polí (+ výrobca, model, popis) odsúhlasil maintainer.

## Testy

Najprv padajúci test, potom oprava:

- `tests/integration/assets-list-search.test.ts` — 12 testov. Pred
  opravou **9 padlo / 3 prešli** (prešli tie, čo `q` nepotrebujú:
  tenant izolácia, zoznam bez `q`, 401). Po oprave 12/12.
- `tests/unit/asset-search.test.ts` — 6 testov nad čistou funkciou.
- Fixture `insertTestAsset` dostal voliteľné `serialNumber`,
  `manufacturer`, `model`, `description` (default `null` ako doteraz).

Celé monorepo: `pnpm lint`, `pnpm typecheck`, `pnpm format:check` čisté;
`pnpm test` — api **78 súborov, 1135 passed / 2 skipped**, web 8,
shared-types 127. `openapi:sync` spustený, `redocly lint` valid
(5 warningov `no-ambiguous-paths`, v diffe nevznikol žiadny nový).

## Nefungovalo / zamietnuté

- **Testy cez shell v Cowork VM nebežia** — `node_modules` sú
  nainštalované pre macOS arm64, vo VM (linux arm64) chýba
  `@rollup/rollup-linux-arm64-gnu`. Preinštalovanie by prepísalo
  `node_modules` na Macu, takže zamietnuté; testy bežali priamo na Macu
  (`/usr/local/bin` node 24.15.0 v PATH, Homebrew má node 26).
- **`placeholderData: keepPreviousData`** pri písaní — zamietnuté, zmenilo
  by to aj správanie stránkovania (namiesto skeletonu stará stránka).
  Mimo rozsahu.
- **UI v prehliadači neoverené naživo** — lokálny API server by potreboval
  Mongo z `.env`, dev cluster je od 2026-09-04 zmazaný a na produkčné
  dáta sa nesiaha. Zmena v UI je len text (placeholder, riadok
  s počtom, empty state); layout filtra (1 stĺpec na mobile,
  `sm:grid-cols-[1fr_auto_auto_auto]`) sa nemenil. Placeholder skrátený
  na 33 znakov, aby sa zmestil do úzkeho poľa na telefóne. Overiť po
  nasadení na mobile.

## Otvorené

Zapísané v `NEXT.md`: filtre Stav a Typ sú stále klientske nad stránkou;
nekotvený regex nevyužíva index.

<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-09-04 — repo mimo iCloudu

Nadväzuje na `2026-09-03-vercel-typecheck-vypis.md`, sekciu „Zdvojené
adresáre robí iCloud, nie pnpm". Tam bola príčina pomenovaná, ale
neodstránená. Teraz je.

## Presun

```
z:  ~/Documents/GitHub/inventario   (synchronizované iCloudom)
na: ~/GitHub/inventario             (bežný lokálny adresár)
```

Overené, že nová cesta je naozaj mimo iCloudu: `~/GitHub` je obyčajný
adresár (`readlink -f` vracia sám seba, nie je to symlink),
`~/Library/Mobile Documents/com~apple~CloudDocs/` obsahuje `Desktop`
a `Documents`, ale **nie** `GitHub`. Synchronizácia Desktop & Documents
sa na domovský koreň nevzťahuje.

Pozn.: xattr `com.apple.fileprovider.pinned` na presunutom adresári
zostal — atribúty sa presúvajú spolu so súborom. Nie je to indícia, že
nová cesta je synchronizovaná.

## Ešte jedno čistenie

Presun sám vyrobil ďalšie konfliktné kópie: **1869** ciest tvaru `… 2`
(oproti 1042 pred dvomi dňami), všetky v `node_modules`, `.next` a
`.turbo`, ani jedna v sledovaných súboroch. Zmazané a `pnpm install
--frozen-lockfile` (5,8 s). **1869 → 0.**

Toto by malo byť posledné takéto čistenie — príčina je odstránená, nie
obídená.

## Čo si presun vyžiadal

- **Cowork connected folder** ukazoval na starú cestu a po presune bol
  prázdny. Vyžiadaný prístup k novej ceste.
- **`CLAUDE.md` sekcia 11** uvádzala starú cestu. Zároveň tam ešte stálo
  „Mac má node 26, `pnpm` skripty padajú na
  `ERR_PNPM_UNSUPPORTED_ENGINE`" s obchádzkou cez priame spúšťanie
  binárok — to bolo 2026-09-03 vyvrátené (Mac má v PATH node 24.15.0
  prvý), ale v sekcii 11 to prežilo. Prepísané.
- **`NEXT.md`**: bod o iCloude ide von, je vyriešený.

Historické session logy staré cesty spomínajú a **nechávajú sa tak** —
sú záznamom stavu v danom čase. Rovnako `infra/vercel/DEPLOYMENT.md`
a `scripts/commit-phase-c-blok-5.sh`, ktoré odkazujú na ešte starší názov
repa `Asset-Management`; tie sú zastarané z iného dôvodu a je to
samostatná vec.

## Overené po presune

`pnpm typecheck`, `pnpm lint`, `pnpm test` — viď commit.

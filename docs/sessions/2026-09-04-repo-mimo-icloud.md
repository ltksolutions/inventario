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

Historické session logy, ADR a `docs/milestones/` staré cesty a starý názov
repa spomínajú a **nechávajú sa tak** — sú záznamom stavu v danom čase.

## Starý názov repa `Asset-Management`: dve z toho boli live 404-ky

Pri kontrole zvyškov po premenovaní sa ukázalo, že to nie je len
dokumentačný dlh. `github.com/Slovensky-futbalovy-zvaz/Asset-Management`
ani `github.com/janletko/Asset-Management` **nepresmerúvajú** — overené
naostro, oboje vracia 404. A odkazovali na ne dve živé miesta:

- `apps/docs/app/layout.tsx` — `projectLink` (odkaz „GitHub" v navbare)
  a `docsRepositoryBase` (každé „Edit this page"). Teda na
  docs.inventario.estate viedli tieto odkazy do prázdna.
- `.github/ISSUE_TEMPLATE/config.yml` — „Bezpečnostné hlásenie"
  a „Otázky a diskusia" v issue chooseri.

Oboje prepísané na `ltksolutions/inventario` (to je skutočný `origin`).
Odkaz na Discussions zostáva a bude 404, kým sa Discussions v repe
nezapnú — to je otvorený bod v `NEXT.md`, nie nová vec.

Ďalej opravené, už len dokumentačne:

- `infra/vercel/{DEPLOYMENT,DOCS-DEPLOYMENT,APP-DEPLOYMENT}.md` — názov repa
  pri „Import Git Repository", lokálne cesty a názov Vercel projektu
  (`asset-management-api` → `inventario-api`). Prepísané aj tam, kde ide
  o historickú vetu — projekt sa dnes tak nikde nevolá, takže starý názov
  by čitateľa poslal hľadať niečo, čo neexistuje. Pôvodné znenie drží
  `git log`.
- `scripts/commit-phase-c-blok-5.sh` — `REPO_ROOT` bol natvrdo zapísaná
  cesta, ktorá prežila premenovanie repa **aj** jeho presun a ukazovala do
  prázdna. Odvodzuje sa z umiestnenia skriptu. Poznámka „push manually via
  GitHub Desktop" tiež von.
- `CLAUDE.md` sekcia 5 tvrdila, že číslovanie ADR je „aktuálne po `0036`" —
  v `docs/decisions/` je `0039`.

## Overené po presune

`pnpm typecheck`, `pnpm lint`, `pnpm test` — viď commit.

## Úklid na konci dňa

`NEXT.md` prečistený proti realite, nie proti dojmu:

- **`inventario-dev` je zmazaný** (Janika, 2026-09-04). Bod ide z Ops
  sekcie von. Vedľajší dôsledok: cieľ štvrťročného DR testu je tým otvorený
  naostro — test #1 išiel presne do tohto clustera a Flex neumožňuje restore
  do nového. Doplnené na oboch miestach, kde sa DR test spomína.
- **Zápis o Preview `MONGO_URI` bol nesprávny.** Tvrdil, že Preview
  premenná ukazuje na dev cluster. Overené cez `vercel env ls` na projekte
  `inventario-api`: `MONGO_URI` je nastavená **len pre Production**,
  `MONGO_DB_NAME` pre Production aj Preview. Premenná v Preview teda nie je
  vôbec — Preview deploy API by mal padnúť na Zod validácii v `config.ts`.
  Či Preview niekto reálne používa, **nevieme**; zapísané ako rozhodnutie,
  nie ako oprava. Ostatné tri Vercel projekty nekontrolované.

TODO/FIXME v kóde: **6**, žiadne nové a žiadne na akciu —
`test-jwt-loader` (už je vlastným bodom v `NEXT.md`), poznámka K18
v `memberships.routes.ts`, dva `TODO(future)` v `design-tokens` a dva
odkazy na `docs/TODO.md`.

`CHANGELOG.md` dostal zápis pod Fixed o tých 404 odkazoch — je to jediná
dnešná zmena, ktorú vidí používateľ.

Overené na záver: `format:check` čistý, typecheck 7/7, lint 7/7,
test 84 súborov / 1252 passed, 2 skipped, `reuse lint` compliant.

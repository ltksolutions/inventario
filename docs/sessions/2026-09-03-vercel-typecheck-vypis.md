<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-09-03 — výpis TypeScript chýb vo Vercel builde

Janika nahlásil, že „Vercel hlási chyby" — build log commitu `cc80c4c`
obsahuje ~40 hlásení `error TS…`. Nižšie je, čo sa overilo a prečo z toho
nevyplýva zásah do kódu.

## Deploy nespadol

`dpl_63xoEcptUnUMAgo6CZhVybSRUt4A` (commit `cc80c4c`, target production)
je `READY`; log končí `Build Completed in /vercel/output [39s]` a
`Deployment completed`. Za ním je päť `CANCELED` redeployov toho istého
commitu — to sú opakované kliknutia na Redeploy, nie zlyhania.

## Ten výpis nerobí náš build

`apps/api/vercel.json` má `buildCommand`, ktorý na `apps/api` **žiadny
`tsc` nespúšťa**:

```
cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @inventario/shared-types build
```

V logu je poradie: náš buildCommand dobehne, potom Vercel v `apps/api`
spustí `Installing dependencies...`, vypíše `Using TypeScript 5.9.3
(local user-provided)` a hneď za tým ide výpis chýb. Typuje si to
vercelovský Node builder pre entrypoint `api/index.ts`, s vlastnou
efektívnou konfiguráciou kompilátora.

## Nie je to nové a nie je to od nás

Rovnaké hlásenia sú v builde `dpl_3fxUtok8gqwK7DiA3y487v7A7cr5`
(commit `45c37ae`, 2026-07-16) — `Response.ok`, `Filter<>` overloady
v migráciách, `audit.repository.ts(109,15)`, oba e-mailoví provideri.
Aj v dnešnom `53d0410`. Ani jeden build na nich nespadol.

Náš vlastný gate je zelený: `tsc -p tsconfig.eslint.json --noEmit`
lokálne prejde. TypeScript 5.9.3, `@types/node` 22.20.1, `undici-types`
6.21.0, v repe jediná kópia každého.

## Prečo tam tie chyby vznikajú — nevieme

Hlásenia sa zhlukujú do troch tvarov:

1. `Property 'ok' does not exist on type 'Response'` — globálny `Response`
   sa u Vercelu rozlišuje na niečo iné než undici typy z `@types/node`.
   Náš tsconfig má `lib: ["ES2022"]` a `types: ["node"]`; keby ich builder
   rešpektoval, `.ok` by tam bolo.
2. Zod „optional vs. required" nezhody (`asset-conditions`,
   `loan-requests`, `memberships`, `stock`).
3. Mongo `Filter<>` overloady v starých migráciách a `audit.repository`.

Že ide o konfiguráciu na strane builderu, a nie o náš kód, vyplýva
z toho, že lokálne s tým istým TypeScriptom nič z toho nepadá. **Ktoré
voľby presne builder prepisuje, overené nie je** a nehádame to.
V dokumentácii Vercelu sa spôsob, ako ten typecheck vypnúť, nenašiel.

Rozhodnutie 2026-09-03: **necháme tak.** Kozmetický výpis, ktorý build
nezhodí, v súboroch, ktorých sa aktuálna práca netýka. Opravovať ich pre
konfiguráciu, ktorú nemáme v rukách, by znamenalo prispôsobovať kód
cudziemu nastaveniu — a náš strict režim je prísnejší, nie voľnejší.

## Vedľajšie zistenia

**`memory` v `vercel.json` je mŕtva voľba.** Build hlási
`Provided 'memory' setting in 'vercel.json' is ignored on Active CPU
billing`. Voľba `"memory": 1024` je z konfigurácie vyhodená; `RUNBOOK.md`
aj komentár v `attachments.routes.ts` ju uvádzali ako platný fakt, takže
tvrdili o systéme viac, než bola pravda. Efektívnu veľkosť inštancie
Vercel API v projektových nastaveniach nevystavuje, preto dokumentácia
odkazuje na nastavenie projektu a neuvádza číslo.

**Zdvojené adresáre v `node_modules` na dev Macu.** 1042 ciest tvaru
`… 2`, `… 3` (napr. `apps/api/node_modules/fastify 2`, `tsx 2`, `tsx 3`,
`argon2 2`) — podpis kolízie cloudovej synchronizácie. Všetko je pod
`node_modules`, teda mimo gitu a mimo Vercelu; git status je čistý.
Riešenie je čistá reinštalácia (`rm -rf` na `node_modules` + `pnpm
install`), nič sa nemazalo bez rozhodnutia.

## Bod „Node 24 na dev stroji" bol zle diagnostikovaný

`NEXT.md` tvrdil: _Mac má len node 26, `pnpm` skripty padajú na
`ERR_PNPM_UNSUPPORTED_ENGINE`, rozhodnúť či doinštalovať node 24 alebo
uvoľniť `engines`._ Overené 2026-09-03 — nič z toho netreba.

Na Macu je v login-shell PATH `/usr/local/bin` **pred** `/opt/homebrew/bin`:

| Cesta               | node     | pnpm                            |
| ------------------- | -------- | ------------------------------- |
| `/usr/local/bin`    | v24.15.0 | corepack shim → `9.12.0` v repe |
| `/opt/homebrew/bin` | v26.0.0  | —                               |

Teda presne to, čo repo deklaruje: `engines.node: 24.x`,
`packageManager: pnpm@9.12.0`, `.nvmrc: 24.15.0`. Kolízie medzi tými dvomi
adresármi sú len tri (`node`, `npm`, `npx`), takže nič sa netieni omylom.
`pnpm typecheck` na Macu prejde: 7/7 tasks, exit 0.

`ERR_PNPM_UNSUPPORTED_ENGINE` prišiel z **linuxového VM Coworku**, nie
z Macu — ten má node 22.23.2 a `engine-strict=true` v `.npmrc` ho správne
odmietne. Poučenie do `NEXT.md`: `pnpm` skripty spúšťať na Macu
(`osascript`), nie v `device_bash`.

Nič sa neinštalovalo, `engines` ani `engine-strict` sa nemenili.

## Zdvojené adresáre: príčinou je iCloud, nie pnpm

Nie je to len `node_modules` — duplikáty boli aj v `apps/*/.next`. Príčina:
repo leží v `~/Documents/GitHub/inventario`, a `~/Documents` je
synchronizované iCloudom (`FXICloudDriveDesktop = 1`,
`FXICloudDriveDocuments = 1`, repo má xattr
`com.apple.fileprovider.pinned`). iCloud rieši konflikt tým, že vyrobí
kópiu `name 2` / `name 3` — a pri tisícoch drobných súborov, ktoré pnpm
prepisuje, konfliktov je dosť.

Vyčistené: `rm -rf` na všetky `node_modules` a `.next`, potom
`pnpm install --frozen-lockfile` (11,8 s, 1095 balíčkov zo store).
**1042 → 0.** Zvyšok po `rm` na `mathjax-full@3.2.2` boli `.DS_Store`
súbory, ktoré sa vyrobili počas mazania; pnpm balíček doinštaloval znova.

**Príčina zostáva.** Bude sa to vracať, kým repo leží v iCloude. Trvalé
riešenie (presun mimo `~/Documents`) je v `NEXT.md` ako samostatné
rozhodnutie — znamená prepojiť GitHub Desktop, editor, Cowork connected
folder a lokálne `.env` cesty.

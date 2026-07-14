<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-07-14 — QR obrázok s logom, dependabot PR, prod incident, Zebra UI + záložky

## Časť 1 — logo a text priamo v QR obrázku (commit `654d9d2`)

`GET /v1/assets/:id/qr` teraz vracia kompozitný PNG/SVG namiesto holého QR
kódu: logo organizácie vycentrované v QR (rovnaký 22% ratio a fallback na
default logo ako pri Avery štítkoch) + inventárne číslo a názov majetku
vytlačené pod kódom.

- Nový `qr-image-renderer.ts`, PNG cez `@napi-rs/canvas` (rovnaký embedded
  DejaVuSans font ako ADR-0022 — diakritika bez závislosti na systémových
  fontoch). Skia `loadImage()` si sama rozpozná formát obrázka, čím zmizla
  celá triedas PNG/JPEG embed-bugov, ktorá sa v `pdf-lib` rendereroch
  objavila dvakrát.
- `Cache-Control` na endpointe zmenený z `public, immutable` na
  `private, max-age=300` — obrázok teraz závisí od mutovateľných dát
  (názov majetku, logo organizácie), nie len od nemenného `publicToken`.
- `QrCard` na detaile majetku sa teraz sizuje podľa reálneho aspect ratio
  kompozitného obrázka (už nie je štvorcový), `object-contain` proti
  deformácii.

## Časť 2 — dependabot PR triage (4 PR)

GitHub MCP nie je pripojený — triage cez Claude in Chrome (browser),
Janika prihlásená.

- PR #9 `fsfe/reuse-action` 5→6 — zelené CI, zlúčené (`c048a64`).
- PR #10 `actions/checkout` 6→7 — zelené CI, zlúčené (`6b82884`).
- PR #11 `actions/cache` 5→6 — zelené CI, zlúčené (`6f1d26a`).
- PR #12 (skupina `minor-and-patch`, 23 balíčkov vrátane `prettier`
  3.8.3→3.9.5, `@fastify/cookie` 11.0.2→11.1.1, `turbo`, `@types/node`,
  eslint balíčky...) — `format:check` zlyhal, pretože nový prettier
  inak formátuje 7 súborov. Opravené priamo na dependabot vetve
  (`prettier --write` + `git checkout origin/<branch>` bez
  `createBranch: true`, viď poznámka nižšie), commit `160e879`, CI
  zelené, zlúčené (`7b0c54d`).

**Poučenie (git MCP quirk):** `git_checkout` s `createBranch: true` na
mene remote vetvy (bez `origin/` prefixu) nevytvorí branch z tej remote
vetvy — vytvorí novú vetvu z aktuálneho HEAD. Príznak: `git diff
main..branch` je prázdny. Správny postup: `checkout origin/<branch>`
(bez createBranch) → over commit → `branch create` + `checkout` na
lokálnu vetvu.

## Časť 3 — INCIDENT: produkčné API spadlo po zlúčení PR #12 (commit `5e40c25`)

Krátko po merge PR #12 nahlásená (systémovým logom) plná výpadok API:
`Error [ERR_REQUIRE_ESM]: require() of ES Module .../cookie@2.0.1/...
from .../@fastify+cookie@11.1.1/.../index.js not supported`.

**Root cause:** `@fastify/cookie` 11.1.1 (súčasť PR #12 bumpu) si stiahol
`cookie@2.0.1` ako závislosť — `cookie@2.0.1` je ESM-only, ale
`@fastify/cookie`-ho vlastný `index.js` (CJS) ho volá cez `require()`.
Padalo to na KAŽDOM cold starte serverless funkcie → plný výpadok.
Vercelov build step pre `apps/api` (esbuild-style transpilácia) toto
netypecheckuje naostro, takže CI zelené aj Vercel build success dali
falošnú istotu — až `mcp__vercel__get_runtime_logs` (nie
`get_runtime_errors`, ten počas výpadku ukazoval "no errors") odhalil
skutočné 500-ky.

**Fix:** `apps/api/package.json` — `@fastify/cookie` pripnutý na presnú
`11.0.2` (bez `^`), Janika spustila `pnpm install` (regeneroval
`pnpm-lock.yaml`, potvrdené `cookie@1.1.1` a `cookie@2.0.1` už nikde v
locku), commit + push. Overené `get_runtime_logs` (group_by
statusCode) — nula 500-iek na novom deployi. End-to-end vyriešené za
cca 15 minút.

**Trvalé poučenie zapísané do pamäte:** po zlúčení KAŽDÉHO npm/yarn
dependabot PR (nie GitHub Actions PR — tie sú bezpečné) treba do 1-2
minút po deployi overiť `get_runtime_logs` na produkcii, nielen CI
status. Pri 500-spike zvážiť pin/revert konkrétneho balíčka (nie celého
PR).

## Časť 4 — ADR-0027 gap: chýbajúci write path pre `labelPrinting.mode` (commit `480586c`)

Pri príprave test návodu na Zebra tlač (pôvodná Janikova otázka "kde sme
skončili s BrowserPrint od Zebry") sa zistilo, že ADR-0027 (Avery PDF +
Zebra ZPL tlač štítkov) bolo v TODO/session logoch značené ako "L1-L7
kompletné", ale **write path nikdy nebol dorobený**: `labelPrinting` sa
pri vytvorení organizácie hardcodoval na `null` (4 miesta), ale žiadny
PATCH endpoint toto pole neexponoval — Zod ho ticho stripoval z každého
requestu. Cela ZEBRA_ZPL vetva bola v produkcii nedosiahnuteľná, hoci
backend renderer aj frontend tlačidlá boli hotové a nasadené od
2026-06-02.

**Fix:** `UpdateOwnOrganisationBodySchema` (PATCH `/v1/organisations/current`)
doplnené o `labelPrinting: OrganisationLabelSettingsSchema.nullable()`.
Repository/service vrstva nepotrebovala zmenu — `OrganisationUpdatePatch`
už pole povoľoval, `updateCurrent`/`updateSelf` robia generický
passthrough `$set`. Nový integračný test (PATCH → GET round-trip pre
`ZEBRA_ZPL`). `openapi.json` regenerovaný.

## Časť 5 — how-to návod na Zebra test (commit `014f0b7`, neskôr aktualizovaný `54d6e67`)

Nový `docs/user-guide/how-to/vytlacit-qr-kody-zebra.md` — pre Janiku,
technický test na reálnom hardvéri (ZD420 + Browser Print), nie pre
koncového používateľa: inštalácia agenta, pripojenie tlačiarne,
prepnutie `labelPrinting.mode`, testovacia tlač, checklist (QR
čitateľnosť, diakritika, rozmery, logo, sýtosť), troubleshooting.
Odkaz doplnený do `how-to/README.md`.

Návod pôvodne popisoval prepnutie módu cez Swagger PATCH (jediná cesta
v tom momente) — po Časti 6 (UI prepínač) prerobený tak, aby krok 3
používal appku namiesto Swaggera; Swagger ostáva len ako pokročilá
diagnostika.

## Časť 6 — UI prepínač pre Zebra tlač v Nastaveniach (commit `9261a99`)

Na Janikovu žiadosť doplnený skutočný UI prepínač do `/settings/organisation`,
blok "QR kódy a štítky" — dovtedy sa `labelPrinting.mode` dalo nastaviť
len cez Swagger. Rozhodnutie (AskUserQuestion): štruktúrované polia
(šírka/výška štítka, DPI, sýtosť), nie voľný JSON textarea — konzistentné
s ostatnými poľami na stránke.

- Nový checkbox "Tlačiť štítky na Zebra termálnej tlačiarni (ZPL)" +
  4 podmienené polia (viditeľné len keď zapnuté).
- `buildLabelPrinting()` helper zachová `pdfPreset`/`finderText` z
  existujúcej konfigurácie (stránka pre ne nemá vlastné UI).
- `LabelPrintButton`/`BatchLabelPrintButton` overené — nepotrebujú
  žiadnu zmenu, už čítajú `org.labelPrinting?.mode` a automaticky
  prepnú label na "Tlačiť na Zebra".

## Časť 7 — záložky v Nastaveniach organizácie na desktope (commit `0b29eef`)

Janikova požiadavka: sekcie od "Základné údaje" po koniec (8 sekcií)
sú na dlhej stránke `/settings/organisation` lepšie ako záložky na
desktope, na mobile ostať pod sebou.

**Rozhodnutia (AskUserQuestion):**

- 5 záložiek (zlúčenie príbuzných sekcií), nie 8 samostatných:
  Základné údaje / QR kódy a štítky / Číslovanie (inventárne +
  protokoly) / Branding / Fakturácia a adresy (fakturácia + sídlo +
  korešpondenčná adresa).
- Jedno spoločné tlačidlo "Uložiť zmeny" (nie per-tab) — zachováva
  existujúci jeden PATCH request so všetkými poľami.
- Karta "Aktuálny plán" zostáva vždy viditeľná nad záložkami.

**Implementácia:** tab bar (`role="tablist"`) viditeľný len `sm:` a
vyššie (`hidden ... sm:flex`), každá skupina obalená `role="tabpanel"`
divom s `className={activeTab === id ? '' : 'sm:hidden'}` — na mobile
(pod `sm:`) je táto trieda nikdy efektívna, takže všetky skupiny
zostávajú viditeľné pod sebou presne ako doteraz. Breakpoint `sm:`
zvolený pre konzistenciu (repo nikde nepoužíva `md:`/`lg:`).

## Overenie a nasadenie

Všetkých 6 hlavných commitov (bez dependabot merge commitov) prešlo
sandboxovým `tsc --noEmit` + `eslint` + `prettier --check/--write`
pred pushom; API zmeny (incident fix, ADR-0027 gap) navyše Janikiným
lokálnym `pnpm install`/`pnpm test`/`pnpm openapi:export:offline`.
Každý push na `main` overený cez Vercel MCP (`get_deployment`,
`get_runtime_logs`) — všetky deploye `READY`, nula runtime chýb.

## Ďalšie kroky

- **Živý test na hardvéri** (ZD420 + Browser Print) — softvérová
  blokáda (chýbajúci write path) je odstránená a UI prepínač hotový,
  ale samotný fyzický test (QR čitateľnosť, diakritika, sýtosť) ešte
  neprebehol. Návod: `docs/sessions/../user-guide/how-to/vytlacit-qr-kody-zebra.md`.
- Zvážiť, či QR kompozitný obrázok (Časť 1) potrebuje analogický UI
  prepínač alebo je vždy-zapnuté správanie v poriadku (zatiaľ
  nezvýrazňované, funguje ako drop-in náhrada pôvodného holého QR).

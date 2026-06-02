<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Prompt do nového chatu — ADR-0022 K2 (renderer protokolov)

> Skopíruj text nižšie (medzi čiarami) do nového chatu. Model: **Sonnet 4.6**.

---

Ahoj Claude. Pokračujeme na projekte **Inventario** (open-source white-label asset
management SaaS, Fastify + MongoDB Atlas + TypeScript pnpm monorepo, Next.js frontend,
Vercel). Komunikujeme **po slovensky**. Lokálny repo: `/Users/janletko/Documents/GitHub/inventario`.

Dnes robíme **ADR-0022 krok K2 — deterministický PDF renderer preberacích protokolov.**
Je to najväčší jednotlivý kus celej feature, preto má vlastnú session.

## Najprv si prečítaj (v tomto poradí)

1. `docs/sessions/2026-06-01-loan-protocols-plan.md` — plán K2–K8, rozhodnutia R1–R3 a invarianty
2. `docs/decisions/0022-loan-protocol-pdf.md` — ADR (on-demand render, neukladať PDF)
3. `packages/shared-types/src/schemas/loan-protocol.ts` — `LoanProtocolSchema` (čo renderuješ)
4. `apps/api/src/modules/loans/loans.service.ts` — kde protokol neskôr (K4) vznikne (len pre kontext, K2 to nerieši)

## Rozhodnutia, ktoré sú UŽ uzavreté (neotvárať znova)

- **Font:** DejaVu Sans, jeden default, embedovaný v API, subset zapnutý. Žiadny per-tenant
  výber, žiadny upload. Multilanguage (latinka + diakritika).
- **Papier:** `protocol.paperSize` (`'A4' | 'LETTER'`) — číta sa ZO ZÁZNAMU protokolu (snapshot),
  NIE zo živého tenant nastavenia. A4 → 595×842 pt, LETTER → 612×792 pt.
- **Logo:** per-tenant z `Organisation.brandKit.logoUrl`, fetch s **timeout + fallback na
  default Inventario logo**. `pdf-lib` neembeduje SVG → ak je logoUrl SVG, použiť default.
  Logo fetch je MIMO transakcie (render je on-demand). Cache = až Fáza 2.

## Čo presne spraviť v K2

Cieľ: čistá deterministická funkcia
`renderProtocolPdf(protocol, organisation, font, logo) → Uint8Array`.

1. **Závislosti** — pridať `pdf-lib` + `@pdf-lib/fontkit` do `apps/api/package.json`
   (zatiaľ tam NIE sú; je tam len `qrcode`). Po pridaní `pnpm install` (spúšťam ja).
2. **Font** — stiahnuť/uložiť `DejaVuSans.ttf` do `apps/api/src/modules/protocols/assets/`
   - SPDX/licenčný súbor vedľa (REUSE čistota — Jan to bude neskôr lintovať).
3. **Default logo** — predpripravený PNG v repo (`pdf-lib` neembeduje SVG).
4. **Renderer** `renderProtocolPdf()`:
   - paper size z `protocol.paperSize`
   - hlavička: logo (s fallbackom) + `organisation.displayName` + (ak je) `billing.legalName/ico/dic`
   - telo: typ (HANDOVER/RETURN), `protocolNumber`, `issuedAt`, strany (handover/receive snapshoty)
   - tabuľka položiek: inventoryNumber, názov, sériové číslo, kategória, stav — **stránkovanie pri 25+ položkách**
   - pätka: podpisové bloky (handover/receive) — prázdne v DRAFT, vyplnené v SIGNED
   - **DETERMINIZMUS (kritický invariant):** `CreationDate`/`ModDate` = `protocol.issuedAt`
     (NIE `now()`); žiadne náhodné ID; font/logo fixné vstupy
   - slovenský, ľudský jazyk ("Odovzdávajúci", "Preberajúci"); musí vyzerať dobre aj vytlačené a podpísané perom
5. **Mini-test už teraz** (nie až K7): dvojitý render toho istého fixture → identický hash.
   Ak to nesedí, render nie je deterministický a nejdeme ďalej.

K2 je čistá funkcia — DB/transakcie NErieš (to je K4). Render sa dá vyvíjať a testovať
izolovane: vyrenderovať z fixture objektu, otvoriť PDF, skontrolovať diakritiku + paper size.

## Workflow pravidlá (dôležité)

- **Filesystem MCP** je jediný spoľahlivý prístup na reálny disk. Bash sandbox je izolovaný —
  never trust jeho ls/cat/grep.
- `create_directory` pred `write_file` pri nových adresároch.
- `edit_file` chce byte-perfektný oldText (pozor na diakritiku a curly quotes); pri väčších
  zmenách radšej `write_file` celý súbor.
- **Po zmene shared-types schém:** `pnpm --filter @inventario/shared-types build` →
  `pnpm --filter @inventario/api openapi:export:offline` → `pnpm test`. (K2 možno schému
  nemení — ak nie, stačí build+test.)
- **Git:** ja commitujem + pushujem cez GitHub Desktop. Ty NEcommituješ cez MCP (commit
  signing zlyhá). Priprav header-only commit message (GitHub Desktop blank-line pasca).
- **Testy s každou zmenou.** Po práci mi daj ready-to-copy príkazy `pnpm typecheck` + `pnpm test`.
- Vedúci princíp celého produktu: **praktické pre bežnú dennú prevádzku z reálneho života.**

Začni tým, že si prečítaš ten plán a schému, potvrdíš mi rozsah K2 a navrhneš poradie krokov.
Potom poďme.

---

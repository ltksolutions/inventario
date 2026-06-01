<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Plán — ADR-0022 Preberacie protokoly (K2–K8)

**Dátum:** 2026-06-01
**Model:** Claude Opus 4.8 (plán) → Sonnet 4.6 (K2–K7), Haiku 4.5 (K8)
**ADR:** [`docs/decisions/0022-loan-protocol-pdf.md`](../decisions/0022-loan-protocol-pdf.md)
**Stav:** K1 hotový (schéma), K2–K8 čaká

---

## Kde sme

K1 je hotový a otestovaný: `pdfAttachmentId` odstránený z `LoanProtocolSchema`,
shared-types build + openapi regen + full test zelené. Schéma je teraz finálny tvar
pre on-demand model (PDF sa neukladá, `pdfSha256` lazy).

Zvyšok (K2–K8) je realisticky **2–3 sessions**. K2 (renderer) je najväčší jednotlivý
kus a má zmysel ho robiť ako samostatnú session s plnou pozornosťou — determinizmus
renderu je kritický invariant, nie detail.

---

## Rozhodnutia na potvrdenie PRED K2

Tieto dve veci určujú rozsah K2. Treba ich rozhodnúť na začiatku ďalšej session:

### R1. Font — DejaVu Sans vs Noto Sans

Obe sú licenčne kompatibilné (DejaVu = public-domain-like / Bitstream Vera licencia;
Noto = OFL 1.1 — pri OFL pozor na REUSE/SPDX záznam). Obe pokrývajú plnú SK diakritiku.

- **DejaVu Sans** — väčší glyf coverage, väčší súbor (~700 KB regular), jednoduchšia licencia.
- **Noto Sans** — modernejší vzhľad, OFL (treba `LICENSES/OFL-1.1.txt` + SPDX), menší ak subset.

> **Odporúčanie:** DejaVu Sans pre jednoduchšiu licenčnú stopu (dôležité pri REUSE cleanup,
> ktorý je ďalšia priorita po protokoloch). Subsetting zapnúť kvôli veľkosti.

### R2. Logo cache — teraz alebo Fáza 2?

ADR hovorí: default Inventario logo (SVG→PNG rasterizácia, build-time) v K2; per-tenant
logo cache z `brandKit.logoUrl` je zmienené ale môže ísť až do Fázy 2.

> **Odporúčanie:** v K2 spraviť len **default logo** (build-time PNG v repo). Per-tenant
> `brandKit.logoUrl` fetch + cache odložiť do Fázy 2 — pilot tenant (SFZ) zatiaľ logo
> nemá nastavené, takže default postačuje a šetrí to komplexitu (external fetch, cache
> invalidation, fallback na timeout). Render ostáva čistá funkcia s logom ako fixným vstupom.

---

## K2 — Renderer (najväčší kus, samostatná session)

**Cieľ:** deterministický `renderProtocolPdf(protocol, organisation, font, logo) → Uint8Array`.

- Pridať font do repa: `apps/api/src/modules/protocols/assets/<font>.ttf` (+ SPDX/licencia)
- Pridať `@pdf-lib/fontkit` závis (`pdf-lib` už možno je — overiť v package.json)
- Default logo: SVG → PNG build-time rasterizácia (alebo predpripravený PNG v repo)
- `renderProtocolPdf()`:
  - hlavička: logo + `Organisation.displayName` + (ak je) `billing.legalName/ico/dic`
  - telo: typ protokolu (HANDOVER/RETURN), `protocolNumber`, `issuedAt`, strany (handover/receive snapshoty)
  - tabuľka položiek: inv. číslo, názov, sériové číslo, kategória, stav — **stránkovanie pri 25+ položkách**
  - pätka: podpisové bloky (handover/receive) — prázdne v DRAFT, vyplnené v SIGNED
  - **DETERMINIZMUS:** `CreationDate`/`ModDate` = `issuedAt` (NIE `now()`); žiadne náhodné ID; font+logo fixné vstupy
- **Pozn.:** renderer sám osebe nepotrebuje DB ani transakcie — je to čistá funkcia. Dá sa
  vyvíjať a testovať izolovane (vyrenderovať z fixture objektu, otvoriť PDF, skontrolovať diakritiku).

**Mini-test už v K2** (nie až K7): dvojitý render toho istého fixture → identický hash.
Ak toto nesedí hneď, render nie je deterministický a nemá zmysel ísť ďalej.

---

## K3 — `protocolNumber` generátor

- Formát `PROT-YYYY-NNNNNN` (regex už v schéme), zero-padded 6 cifier
- Scoped **org + rok**, transakčne (rovnaký princíp ako `inventoryNumber` — pozri ako je
  to spravené v assets module)
- Atomický counter v transakcii; unique index `(organisationId, protocolNumber)`
- Counter collection alebo `findOneAndUpdate` s `$inc` — mirror existujúceho inventoryNumber patternu

---

## K4 — Repository + service integrácia (jadro)

- `LoanProtocolsRepository` cez `OrganisationScopedRepository` pattern (ADR-0005)
- V `loans.service.ts` — tri inserčné body, všetky vnútri existujúceho `runInTransaction`:
  - `fulfilLoanRequest` → HANDOVER protokol, `Loan.handoverProtocolId`
  - `createDirectLoan` → HANDOVER protokol, `Loan.handoverProtocolId`
  - `returnLoan` → RETURN protokol, `Loan.returnProtocolId`
- Protokol vzniká so `status: DRAFT`, prideleným `protocolNumber`, **snapshotmi** strán a
  položiek (NIKDY živé asset/user dáta — snapshot v momente transakcie)
- `pdfSha256: null`, `signatures: { handover: null, receive: null }`
- **Pozn. ADR-0026:** jedno `fulfil` = jeden Loan = jeden HANDOVER protokol (viazaný na `loanId`)
- Service dostane `db` explicitne (getDb pattern — pozor na `mongoClient.db()` bez argumentu!)

---

## K5 — Routes (read + PDF)

- `GET /v1/loans/:id/protocols` — zoznam protokolov k zápožičke
- `GET /v1/protocols/:id` — metadata (JSON)
- `GET /v1/protocols/:id/pdf` — on-demand render, `application/pdf`, voliteľný lazy `pdfSha256`
- RBAC: účastník protokolu (borrower) ALEBO ASSET_MANAGER+ADMIN
- Cross-tenant izolácia (organisationId scope)

---

## K6 — Podpis (CLICK_TO_SIGN)

- `POST /v1/protocols/:id/sign` `{ method: 'CLICK_TO_SIGN' }`
- Zapíše `signatures.handover` / `.receive` (signedAt, method, ipAddress, signatureImageId: null)
- Keď **obe** strany podpísané → `DRAFT → SIGNED`
- Pri prechode na SIGNED dopočítať a fixovať `pdfSha256` (hash záväznej verzie)
- RBAC: len príslušná strana protokolu môže podpísať svoju časť
- BIOMETRIC + EXTERNAL = mimo rozsah (Fáza 2)

---

## K7 — Testy (povinné pokrytie)

- **Determinizmus renderu** — dvojitý render → rovnaký hash (kritický invariant)
- Diakritika — SK znaky (`ľščťžýáíéäô`) sa vyrenderujú správne
- `protocolNumber` číslovanie + **race** (dva súbežné fulfil v rovnakom org/roku)
- RBAC — borrower vidí svoje, manager všetky, cudzí 403
- Cross-tenant izolácia — protokol z org A neviditeľný v org B
- **Snapshot-not-live** — zmena assetu/usera po vzniku protokolu NEMENÍ obsah protokolu
- Stránkovanie pri 25+ položkách
- Protokol per Loan pri viacnásobnom `fulfil` (ADR-0026)
- Podpis: jednostranný = stále DRAFT; obojstranný = SIGNED + pdfSha256 fixed

---

## K8 — Dokumentácia (Haiku)

- Milestone doc (čo bolo implementované, endpoint inventory, invarianty)
- Session log
- Zatvoriť #7 v TODO.md → presun do milestone docu
- Aktualizovať NEXT.md

---

## Poradie a deľba na sessions (návrh)

```
Session A:  R1+R2 rozhodnutia → K2 (renderer + mini determinizmus test)   [Sonnet, veľká]
Session B:  K3 (číslo) → K4 (repo + service integrácia)                    [Sonnet]
Session C:  K5 (routes) → K6 (podpis) → K7 (testy) → K8 (docs)             [Sonnet + Haiku]
```

Možné zlúčiť B+C ak K2 ide hladko. K2 sa NEZLUČUJE s ničím — je to základ a chce čistú hlavu.

---

## Invarianty (nezabudnúť)

1. **Determinizmus renderu** — žiadne `now()`, dátumy zo záznamu, explicitné PDF metadata
2. **Snapshot, nie živé dáta** — render číta výhradne z `LoanProtocol`, nikdy z asset/user
3. **Nemennosť po SIGNED** — zmena = AMENDMENT (Fáza 2), nie edit
4. **Transakčná bezpečnosť** — protokol vzniká v existujúcej fulfil/return/direct transakcii, render je MIMO transakcie
5. **Po zmene schémy:** `pnpm --filter @inventario/shared-types build` → openapi regen → full test (beží Janika, nie Claude cez MCP)

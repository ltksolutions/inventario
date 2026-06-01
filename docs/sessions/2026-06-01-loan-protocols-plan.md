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

**Rozšírené 2026-06-01 (diskusia s Janom) — ešte súčasť K1, schema zmeny hotové:**

- `LoanProtocolSchema.paperSize` (`'A4' | 'LETTER'`, default A4) — **snapshot** veľkosti
  papiera na zázname (NIE živé nastavenie — nemennosť + determinizmus).
- `Organisation.protocolSettings` (`OrganisationProtocolSettingsSchema`, nullable) —
  per-tenant default papier; hodnota sa kopíruje do snapshotu pri vzniku protokolu.
- Oboje exportované cez barrel (`schemas/index.js` `export *`). **Po týchto zmenách znova
  spustiť** `pnpm --filter @inventario/shared-types build` → openapi regen → full test
  (beží Janika).

Zvyšok (K2–K8) je realisticky **2–3 sessions**. K2 (renderer) je najväčší jednotlivý
kus a má zmysel ho robiť ako samostatnú session s plnou pozornosťou — determinizmus
renderu je kritický invariant, nie detail.

---

## Rozhodnutia (POTVRDENÉ 2026-06-01 s Janom)

Týmto sú R1–R3 uzavreté, K2 ide podľa nich:

### R1. Font — jeden default, žiadny výber ✅

**DejaVu Sans**, embedovaný v API, subset zapnutý. Multilanguage (latin-ext + cyrilika +
grécka v jednom súbore), permisívna licencia. **Žiadne** per-tenant font pole, **žiadny**
upload, žiadna validácia. Plne deterministické. (Per-tenant font / upload = mimo rozsah,
ani Fáza 2 pokiaľ nepríde reálna požiadavka.)

### R2. Papier — A4 default, per-tenant A4/LETTER, ako snapshot ✅

Schéma už hotová (viž vyššie). K2 renderer číta `protocol.paperSize` zo záznamu, NIE zo
živého tenant nastavenia. K4 pri vzniku protokolu skopíruje
`Organisation.protocolSettings.paperSize` (alebo default A4 ak null) do `LoanProtocol.paperSize`.
Renderer mapuje A4 → 595×842 pt, LETTER → 612×792 pt.

### R3. Logo — per-tenant z `brandKit.logoUrl`, BEZ cache (fetch pri každom stiahnutí) ✅

`brandKit.logoUrl` už existuje na schéme — žiadne nové pole. Render fetchne logo z URL pri
každom stiahnutí PDF. **Povinné ochrany** (inak krehké):

- **timeout** na fetch (napr. 3–5 s) — render sa nesmie zaseknúť na pomalom logu,
- **fallback na default Inventario logo** ak fetch zlyhá / timeout / nie je PNG/JPG,
- logo fetch je MIMO loan transakcie (render je on-demand, nikdy neblokuje fulfil/return),
- `pdf-lib` neembeduje SVG → ak je `logoUrl` SVG, použiť default (rasterizácia tenant SVG = Fáza 2).

> **Dôsledok determinizmu (vyriešiť v K6):** logo je externý vstup, ktorý sa môže zmeniť.
> `pdfSha256` sa fixuje až pri prechode na SIGNED (rozhodnutie 7 ADR), dovtedy je DRAFT render
> „živý". Po SIGNED by zmena loga zmenila hash — preto pri fixácii `pdfSha256` (K6) explicitne
> rozhodnúť: buď sa logo bytes zafixujú ku snapshotu pri SIGNED, alebo sa akceptuje že
> `pdfSha256` platí pre verziu loga v čase podpisu. Nenechať na náhodu.

> **Cache = Fáza 2** ako optimalizácia bez zmeny kontraktu (rasterizovaný PNG per tenant).

---

## K2 — Renderer (najväčší kus, samostatná session)

**Cieľ:** deterministický `renderProtocolPdf(protocol, organisation, font, logo) → Uint8Array`.

- Pridať font do repa: `apps/api/src/modules/protocols/assets/DejaVuSans.ttf` (+ SPDX/licencia)
- Pridať `@pdf-lib/fontkit` závis (`pdf-lib` už možno je — overiť v package.json)
- Default Inventario logo: predpripravený PNG v repo (`pdf-lib` neembeduje SVG)
- **Paper size:** `protocol.paperSize` → A4 (595×842 pt) alebo LETTER (612×792 pt)
- `renderProtocolPdf()`:
  - hlavička: logo (tenant `brandKit.logoUrl` s timeout+fallback, inak default) +
    `Organisation.displayName` + (ak je) `billing.legalName/ico/dic`
  - telo: typ protokolu (HANDOVER/RETURN), `protocolNumber`, `issuedAt`, strany (handover/receive snapshoty)
  - tabuľka položiek: inv. číslo, názov, sériové číslo, kategória, stav — **stránkovanie pri 25+ položkách**
  - pätka: podpisové bloky (handover/receive) — prázdne v DRAFT, vyplnené v SIGNED
  - **DETERMINIZMUS:** `CreationDate`/`ModDate` = `issuedAt` (NIE `now()`); žiadne náhodné ID; font fixný vstup
- **Pozn.:** renderer číta výhradne zo záznamu (`protocol.*`), DB/transakcie nepotrebuje
  okrem logo fetchu. Dá sa vyvíjať a testovať izolovane (vyrenderovať z fixture, otvoriť PDF,
  skontrolovať diakritiku + paper size).

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
- **`paperSize` snapshot:** skopírovať `Organisation.protocolSettings?.paperSize ?? 'A4'`
  do `LoanProtocol.paperSize` pri vzniku
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
- **Rozhodnúť logo-vs-hash otázku z R3** (zafixovať logo bytes alebo akceptovať verziu v čase podpisu)
- RBAC: len príslušná strana protokolu môže podpísať svoju časť
- BIOMETRIC + EXTERNAL = mimo rozsah (Fáza 2)

---

## K7 — Testy (povinné pokrytie)

- **Determinizmus renderu** — dvojitý render → rovnaký hash (kritický invariant)
- Diakritika — SK znaky (`ľščťžýáíéäô`) sa vyrenderujú správne
- **Paper size** — A4 vs LETTER dáva správne rozmery stránky; snapshot sa nemení po zmene tenant settingu
- `protocolNumber` číslovanie + **race** (dva súbežné fulfil v rovnakom org/roku)
- RBAC — borrower vidí svoje, manager všetky, cudzí 403
- Cross-tenant izolácia — protokol z org A neviditeľný v org B
- **Snapshot-not-live** — zmena assetu/usera po vzniku protokolu NEMENÍ obsah protokolu
- Logo fallback — neplatná/nedostupná `logoUrl` → default logo, render nespadne
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
Session A:  K2 (renderer + paper size + logo fetch/fallback + mini determinizmus test)  [Sonnet, veľká]
Session B:  K3 (číslo) → K4 (repo + service integrácia vrátane paperSize snapshot)        [Sonnet]
Session C:  K5 (routes) → K6 (podpis + logo/hash rozhodnutie) → K7 (testy) → K8 (docs)    [Sonnet + Haiku]
```

Možné zlúčiť B+C ak K2 ide hladko. K2 sa NEZLUČUJE s ničím — je to základ a chce čistú hlavu.

---

## Invarianty (nezabudnúť)

1. **Determinizmus renderu** — žiadne `now()`, dátumy zo záznamu, explicitné PDF metadata
2. **Snapshot, nie živé dáta** — render číta výhradne z `LoanProtocol` (vrátane `paperSize`),
   nikdy z asset/user/organisation live nastavení (okrem loga — externý vstup, viď R3)
3. **Nemennosť po SIGNED** — zmena = AMENDMENT (Fáza 2), nie edit
4. **Transakčná bezpečnosť** — protokol vzniká v existujúcej fulfil/return/direct transakcii,
   render (vrátane logo fetchu) je MIMO transakcie
5. **Po zmene schémy:** `pnpm --filter @inventario/shared-types build` → openapi regen → full
   test (beží Janika, nie Claude cez MCP)

---

## Tlač (žiadny extra kód)

`GET /v1/protocols/:id/pdf` vráti `application/pdf` s fyzickou veľkosťou stránky (A4/LETTER
zo snapshotu). Prehliadač aj budúca mobilná app otvoria ten istý endpoint a natívny tlačový
dialóg vytlačí na správnu veľkosť papiera. Žiadne UI riešenie tlače netreba — je to vlastnosť
samotného PDF.

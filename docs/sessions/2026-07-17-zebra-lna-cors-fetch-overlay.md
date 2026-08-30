<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-07-17 — Zebra tlač v Chrome (LNA + CORS) + GlobalFetchOverlay

> **Pozn.:** tento log bol dopísaný spätne 2026-08-30. Pôvodná session
> skončila commitmi bez „poupratuj" kroku, takže `NEXT.md` aj `TODO.md`
> o týchto troch zmenách nevedeli šesť týždňov. Obsah je zrekonštruovaný
> z commit messages (`0f170bf`, `1c239e0`, `45c37ae`), ktoré boli
> podrobné.

## Kontext

Dve nezávislé témy v jednej session:

1. **Zebra tlač štítkov nefungovala v Chrome** — nahlásené kolegom pri
   testovaní 2026-07-17.
2. **Pomalý preloader** — posledný odložený krok z diagnostík zo 14. a 15. 7., ktorý sa v oboch predošlých logoch označil ako „vedome
   odložený".

---

## 1. Zebra Browser Print v Chrome — dva samostatné bugy

### 1a. Chrome Local Network Access blokoval fetch (`0f170bf`)

Chrome 142+ zaviedol Local Network Access (LNA). Náš kód deklaroval
`targetAddressSpace: 'local'` pre `localhost:9100` (Zebra Browser Print
agent), lenže Chrome ten cieľ vyhodnocuje ako `loopback`. Nezhoda
deklarovanej a skutočnej address space spôsobí, že Chrome request
**zablokuje ešte pred zobrazením povoľovacieho dialógu**:

> Request had a target IP address space of `local` yet the resource is in
> address space `loopback`.

Opravené na všetkých 6 miestach (`getDefaultZebraPrinter`,
`getFirstAvailableZebraPrinter`, `sendZplToPrinter`) v
`LabelPrintButton.tsx` a `BatchLabelPrintButton.tsx`. Aktualizované aj
komentáre vysvetľujúce LNA (`local` vs `loopback`, názvy povolení
„Apps on device" / „Local Network Access").

### 1b. POST /write padal na CORS preflighte (`45c37ae`)

Po oprave address space prešli `GET /default` a `/available`, ale
`POST /write` padal na:

> Cannot parse Access-Control-Allow-Headers response header field in
> preflight response

Príčina: `application/json` je „non-simple" hlavička, ktorá spustí CORS
preflight (OPTIONS). Zebra Browser Print agent má v starom firmvéri chybnú
`Access-Control-Allow-Headers` odpoveď na preflight, ktorú Chrome nevie
sparsovať → request zablokuje ešte pred samotným POST-om.

**Riešenie:** z `/write` spraviť „simple request" —
`Content-Type: text/plain;charset=UTF-8` je CORS-safelisted a preflight
nespúšťa. Telo (JSON string) ostáva nezmenené, Zebra agent ho parsuje bez
ohľadu na content-type (dokumentovaný funkčný postup).

**Čoho sa to netýka:** POST na náš backend `/v1/labels/zpl` ostáva
`application/json` — `api.inventario.estate` má korektné CORS, preflight
tam prejde. `GET /default` a `/available` content-type nenastavujú.

---

## 2. GlobalFetchOverlay — len pre mutácie (`1c239e0`)

**Toto uzavrelo tému pomalého preloadera**, ktorá sa ťahala cez session
zo 14. 7. (staleTime + keep-warm cron) a 15. 7. (Fluid Compute + index).

Celoobrazovkový blur overlay bol viazaný na `useIsFetching()` — zobrazil sa
pri **akomkoľvek** queryi v lete. To bola skutočná príčina hláseného
problému: načítanie stránky (napr. `/assets`) vypáli viac paralelných
GET-ov (assets + categories + locations + current org). Hlavný list query
sa vráti rýchlo a dáta sa vykreslia, ale ak niektorý sekundárny GET padne
na studenú serverless inštanciu (~10 s), overlay držal **celú obrazovku**
zakrytú celý ten čas — používateľ videl dáta preblysknúť za blurom a potom
sa znova zakryli na ~10 s.

Overlay teraz sleduje `useIsMutating()` — zobrazí sa len pri zápisoch
(uloženie/mazanie), kde je blokovanie obrazovky do potvrdenia serverom
správne UX. Čítacie fetche ho už nespúšťajú; každá list stránka má vlastný
skeleton pre svoj hlavný query, initial `/v1/me` auth check pokrýva
`AuthGate` samostatne.

Overené bez regresie: všetky dátové list stránky majú vlastné skeletony;
komponenty bez skeletonu (`AuthSettings`, `Organisations`) používajú raw
fetch, ktorý overlay nikdy nespúšťal.

Zmena je app-wide — jeden globálny komponent v `AppShell`.

---

## Stav témy „pomalý preloader" po tejto session

Všetky tri opatrenia sú hotové a dopĺňajú sa:

| Opatrenie                             | Commit             | Čo rieši                                 |
| ------------------------------------- | ------------------ | ---------------------------------------- |
| `staleTime` 5 min pre referenčné dáta | `8a91c32` (14. 7.) | menej paralelných GET-ov po nečinnosti   |
| Fluid Compute                         | `b07cabc` (15. 7.) | jedna inštancia obslúži súbežné requesty |
| Overlay len pre mutácie               | `1c239e0` (17. 7.) | studený štart už neblokuje obrazovku     |

Keep-warm cron z `8a91c32` bol štvrtým opatrením, ale **zbytočným** —
zrušený 2026-08-30, viď
`docs/sessions/2026-08-30-atlas-naklady-keep-warm-cron.md`.

## Čo zostalo otvorené

- Živý test Zebra tlače na hardvéri (ZD420 + Browser Print) po oboch
  opravách — softvérové blokácie sú odstránené, fyzický test
  (čitateľnosť QR, diakritika, sýtosť) ešte neprebehol.
- Safari nie je podporované (mixed-content blok na `http://localhost:9100`
  z HTTPS stránky) — rozhodnutie z 15. 7.: nič nemeniť, odporúčať
  Chrome/Edge.

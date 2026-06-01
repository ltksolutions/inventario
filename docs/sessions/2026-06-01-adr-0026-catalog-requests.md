<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-06-01 (poobede) — ADR-0026: katalógové žiadosti + oddelené vydávanie

| Atribút        | Hodnota                                                           |
| -------------- | ----------------------------------------------------------------- |
| **Dátum**      | 2026-06-01                                                        |
| **Modely**     | Opus 4.8 (návrh ADR + diskusia)                                   |
| **Východisko** | Smoke test formulára žiadosti odhalil chýbajúci typ žiadosti      |
| **Výsledok**   | ✅ ADR-0026 napísaný a Accepted; implementácia nasleduje (Sonnet) |

---

## Čo to spustilo

Pri prvom reálnom prechode formulárom „Nová žiadosť o výpožičku" na produkcii vyšlo
najavo: tlačidlo „Odoslať žiadosť" bolo disabled, lebo `canSubmit` vyžaduje aspoň jednu
položku v koši — a v prázdnom/nízko-zásobovom tenante niet čo vybrať. To nebol bug, ale
odhalilo **zásadnú medzeru v doménovom modeli**.

Súčasný model (ADR-0012/0023/0025) pozná len **konkrétnu žiadosť** — `LoanRequestItem`
má povinné `assetId`, žiadateľ vyberá konkrétne inventárne čísla. Ale ~95 % reálnych
žiadostí je **katalógových**: „potrebujem 1 projektor, 10 kužeľov, myš ak je skladom" —
žiadateľ uvažuje v kategóriách a množstvách, konkrétny kus priradí až správca pri vydaní.
Toto bol od začiatku zámer (žiadosť oddelená od vydania), ale model ho nikdy nezachytil.

## Rozhodnutia z diskusie

| Otázka                            | Rozhodnutie                                                           |
| --------------------------------- | --------------------------------------------------------------------- |
| Typ žiadosti                      | **Len katalógová** — konkrétny výber assetId zrušený                  |
| Vstup                             | Kategória + množstvo + voľná poznámka                                 |
| Množstvo                          | Pevné číslo (nie rozsah)                                              |
| Mäkké podmienky („ak je skladom") | Celá žiadosť je **„splniť čo sa dá"** — žiadny per-item optional flag |
| Rezervácia počas PENDING          | **Žiadna** — evidencia dopytu, dostupnosť sa rieši pri vydaní         |
| Čiastočné vydanie                 | Áno (žiadaných 10, vydá 8)                                            |
| Po čiastočnom vydaní              | Správca rozhodne — nechať otvorenú alebo uzavrieť                     |
| Žiadosť → Loan                    | 1 žiadosť → N Loanov postupne v čase                                  |
| Schvaľovací krok                  | Approve a vydanie **oddelené** (approve = „beriem do riešenia")       |
| Rozsah implementácie              | Celý cieľový model naraz (systém prázdny, fázovanie by len odložilo)  |

**Prečo teraz:** produkcia je prázdna (žiadne žiadosti/loany/majetok). Zmena FSM = žiadna
migrácia. O mesiac na živých dátach by to bola riziková migrácia. Robíme to teraz načisto.

## Výsledný model (ADR-0026)

> Žiadosť = katalógový dopyt (kategória + množstvo + poznámka). Nedrží zásobu. Správca je
> jediný gatekeeper — pri vydaní mapuje kategória+množstvo → konkrétne kusy / BULK množstvo
> a vydá. Vydaním vzniká Loan. 1 žiadosť → N Loanov postupne.

**Nový FSM žiadosti:** `PENDING → APPROVED → PARTIALLY_FULFILLED → FULFILLED/CLOSED`
(+ REJECTED/CANCELLED z PENDING). Approve už nevytvára Loan — vydanie je samostatný krok
cez nový `POST /v1/loan-requests/:id/fulfil`.

**Dátový model:** `LoanRequestItem` prepísaný z `assetId` → `categoryId + quantityRequested

- quantityFulfilled + note + categorySnapshot`. `resultingLoanId`→`resultingLoanIds[]`.
`Loan` ostáva (dueAt per ADR-0025, BULK per ADR-0020).

**Prelínanie:** „10 kužeľov" = BULK výdaj (ADR-0020), „1 projektor" = SERIALIZED kus
z kategórie. Jeden tok vydania pre oboje.

## Dopad na predošlé ADR

- **ADR-0012** — prepisuje sa jadro FSM (žiadosť už neviaže konkrétny asset; approve ≠ pickup).
- **ADR-0020** — vydávanie je presne to miesto, kde sa SERIALIZED/BULK mapuje.
- **ADR-0023** — beneficiaryId + priamy loan ostávajú bez zmeny.
- **ADR-0025** — dueAt nullable sa nastaví na Loan pri vydaní (nie na žiadosť).

## Implementačný plán (K1–K7) — pre Sonnet

| Blok | Popis                                                                                  |
| ---- | -------------------------------------------------------------------------------------- |
| K1   | Schéma: `LoanRequestStatus` (7 stavov), `LoanRequestItem` prepis, `resultingLoanIds[]` |
| K2   | Repository + service FSM (createCatalogRequest, approve, **fulfil**, reject, cancel)   |
| K3   | Routes: create (kat.+množstvo), approve (len stav), **fulfil** (nový), reject, cancel  |
| K4   | Frontend `/loans/request` — kategória+množstvo formulár (žiadny asset picker)          |
| K5   | Frontend — obrazovka vydávania pre správcu (mapovanie na kusy/BULK, čiastočné vydanie) |
| K6   | Tests — FSM, čiastočné vydanie, N Loanov, over-fulfilment guard, súbeh, RBAC           |
| K7   | OpenAPI + api-types regen, devlog, cross-linky                                         |

**Postup:** blok po bloku (K1 → typecheck → K2 …), nie všetko naraz. Po každom kroku zelený stav.

## Odložené (Fáza 2)

Rozsah množstva (min–max), per-item „nepovinné", `Category.allowOpenEnded`, auto-expirácia
APPROVED žiadostí, multi-approver routing, notifikácie o čiastočnom vydaní.

ADR: `docs/decisions/0026-catalog-requests-and-fulfilment.md` (Accepted).

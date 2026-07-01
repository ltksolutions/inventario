<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Custom `DateField` (orezaný natívny kalendár) + zamietnutý ADR-0032 (2026-07-01)

> **Účel.** Nahlásený bug (screenshot, Safari, `app.inventario.estate/žiadosti/nová`):
> pri žiadosti o výpožičku s viac položkami sa natívny kalendár (`<input type="date">`)
> po rozkliknutí čiastočne stratí — formulár sa predĺži, pole „Od"/„Do" sa posunie
> nižšie a kalendár prekryje tlačidlo „Odoslať žiadosť"/okraj okna. Súčasťou session
> bola aj samostatná otázka (predtým v konverzácii) o žiadosti pre nového zamestnanca,
> ktorý ešte nie je v systéme — zamietnutá, zdokumentovaná ako ADR-0032. Model: Claude
> Sonnet 5 (Cowork).

## Čo sa spravilo

### 1. ADR-0032 — žiadosť pre osobu mimo systému (zamietnutý)

Preverené: `beneficiaryId` na `LoanRequest` (ADR-0023) musí byť existujúci `User`.
Navrhnuté (a Jánom zamietnuté) riešenie: `pendingBeneficiary` — voľný text meno+e-mail,
`beneficiaryId` nullable, blok schválenia kým sa nedoplní reálny používateľ.

**Rozhodnutie:** zamietnuté v celom rozsahu — beneficiary musí byť existujúci `User`,
bez výnimky. Ak treba žiadať za osobu mimo systému, treba ju najprv zaregistrovať
(invite flow). Dokument ostáva v `docs/decisions/0032-loan-request-unregistered-beneficiary.md`
ako záznam zváženej a zamietnutej možnosti — nezmazaný, len status zmenený na
`❌ Rejected` s doplneným dôvodom.

### 2. ADR-0033 — Custom `DateField` komponent (accepted, nasadené)

Natívny `<input type="date">` je — rovnako ako natívny `<select>` (ADR-0018) — plne
pod kontrolou OS/prehliadača: nedá sa mu cez CSS povedať, aby sa otvoril nahor, keď
dole nie je miesto. Rovnaký `type="date"` sa používal na 4 miestach appky.

Zvážené možnosti: (A) štýlovaný natívny input — nerieši problém; (B) **plne vlastný
`DateField`, bez novej závislosti** — zvolené; (C) vlastný `DateField` + `react-day-picker`
na kalendárovú matematiku — zamietnuté (nová závislosť, manuálny `pnpm add` krok mimo
sandboxu); (D) vlastný `DateField` + `@floating-ui/react-dom` na positioning —
zamietnuté (rovnaký dôvod, `createPortal` + `position: fixed` rieši to isté bez
závislosti).

- Nový `apps/web/src/components/DateField.tsx` — trigger `<button>` (formát
  `dd.mm.rrrr`) + kalendárová mriežka (Po–Ne, sk-SK), ručná dátumová matematika
  (`new Date(year, month+1, 0).getDate()` pre dni v mesiaci, natívne `Date` pre
  priestupné roky). `value`/`onChange` ako ISO string `YYYY-MM-DD` — identický tvar
  ako natívny input → drop-in náhrada, žiadna zmena state/validation/API kódu.
- Positioning: `createPortal(document.body)`, `position: fixed`, súradnice z
  `getBoundingClientRect()` triggeru — pri otvorení sa rozhodne nahor/nadol podľa
  dostupného priestoru. Portál obchádza `overflow`/`transform` predka, funguje aj
  v modáli (`FulfilLoanRequestModal`). Zatvára sa na `Escape`/klik mimo/scroll.
- Nasadené vo všetkých 4 miestach: `LoanRequestContent.tsx`, `FulfilLoanRequestModal.tsx`
  (priamo, `useState`), `AssetCreateContent.tsx`, `AssetDetailEditForm.tsx` (cez
  `Controller`, react-hook-form — rovnaký vzor ako `SelectField`).
- V1 bez šípkovej klávesnicovej navigácie v mriežke dní (Escape/klik mimo/Tab
  funguje) — vedomý fast-follow, nie blocker.

Overené: `tsc --noEmit` (apps/web) ✅, `eslint src --max-warnings 0` (celý `apps/web/src`) ✅.

### 3. Commit + push cez „Control your Mac" (osascript), nie git MCP

Ján explicitne požiadal o zmenu zaužívaného postupu — namiesto git MCP (predchádzajúci
zvyk) commit+push spravil Claude priamo cez `Control_your_Mac osascript` (`do shell
script` v Terminal.app na jeho reálnom Macu, https remote → keychain credential helper).
Prvý pokus (viacriadková `-m -m -m` správa) zlyhal na `osascript`/commitlint; druhý
pokus s kratšou dvojriadkovou správou prešiel cez pre-commit hook (`lint-staged` +
`turbo typecheck`, 7/7 cache hit) aj push bez problémov.

## Otvorené / follow-up

- Klávesnicová navigácia šípkami v kalendárovej mriežke `DateField` (fast-follow,
  pozri ADR-0033 „Riziká, ktoré treba sledovať").
- A11y audit `DateField` (WAI-ARIA dialog/grid pattern implementovaný manuálne,
  neoverené so screen readerom).
- Vizuálne overiť v prehliadači, že sa kalendár skutočne vyskočí nahor pri dlhšom
  formulári (nebolo testované live, len cez kód/logiku).

## Pozn. k prostrediu (Cowork sandbox)

Rovnaké obmedzenia ako predtým: žiadny `pnpm install` v sandboxe (memory pravidlo).
`tsc`/`eslint` binárky už existujú v `node_modules/.bin` → typecheck/lint spustiteľné
priamo bez inštalácie. Commit+push tentokrát cez `Control_your_Mac` (osascript) na
Jánovu žiadosť, nie git MCP.

## Commity (2026-07-01)

`f481e58` — `feat(ui): custom DateField komponent namiesto natívneho date inputu`
(7 files changed: `DateField.tsx` nový, `LoanRequestContent.tsx`,
`FulfilLoanRequestModal.tsx`, `AssetCreateContent.tsx`, `AssetDetailEditForm.tsx`
upravené, `docs/decisions/0032-*.md` + `0033-*.md` nové).

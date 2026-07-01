<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0033. Custom `DateField` komponent namiesto natívneho `<input type="date">`

|                   |                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Accepted (implementované 2026-07-01)                                                                                                      |
| **Dátum**         | 2026-07-01                                                                                                                                   |
| **Autori**        | Ján Letko, Claude Sonnet 5 (LTK Solutions)                                                                                                   |
| **Súvisiace ADR** | [0018 Custom SelectField](0018-select-field-component.md), [0025 Open-ended loans + request form](0025-open-ended-loans-and-request-form.md) |

## Kontext

Nahlásený problém (screenshot, `app.inventario.estate/žiadosti/nová`, Safari): pri
žiadosti o výpožičku s viac položkami sa formulár predĺži, pole „Od"/„Do" sa
posunie nižšie a natívny kalendár prehliadača (`<input type="date">`) sa po
rozkliknutí čiastočne stratí — prekryje ho tlačidlo „Odoslať žiadosť" / okraj okna.

Natívny date picker je — rovnako ako natívny `<select>` riešený v
[ADR-0018](0018-select-field-component.md) — plne pod kontrolou OS/prehliadača:
nedá sa mu cez CSS povedať, aby sa otvoril nahor, keď dole nie je miesto, ani ho
nejde vizuálne zladiť s brand tokenmi. Rovnaký `type="date"` sa používa na 4
miestach appky:

- `LoanRequestContent.tsx` — nová žiadosť (nahlásený problém, Od/Do)
- `FulfilLoanRequestModal.tsx` — vydanie z katalógovej žiadosti (Do, v modáli)
- `AssetCreateContent.tsx` — nový majetok (Dátum nadobudnutia, Záruka do)
- `AssetDetailEditForm.tsx` — editácia majetku (rovnaké polia)

`FulfilLoanRequestModal` je navyše modál — treba riešenie, ktoré nezávisí od
`overflow` predka (bežný CSS problém pri `position: absolute` v scrollovateľných
kontajneroch).

V appke dnes **neexistuje žiadna "flip-up, keď dole nie je miesto" logika** —
`SelectField` a `Combobox` (ADR-0018) sa vždy otvárajú nadol (`top-full`). Toto je
prvý komponent, ktorý túto logiku potrebuje.

## Možnosti

### A: Štýlovaný natívny `<input type="date">` (status quo + CSS)

- **Plus:** nulový JS, a11y a mobile OS-picker zadarmo.
- **Mínus:** nerieši problém — pozícia/rozbaľovanie kalendára je mimo CSS. Zamietnuté,
  rovnaký dôvod ako v ADR-0018 pre `<select>`.

### B: Custom `DateField` — plne vlastný (bez novej závislosti)

Vlastný komponent: trigger `<button>` s formátovaným dátumom (`dd.mm.rrrr`) +
kalendárová mriežka renderovaná do DOM-u, `value`/`onChange` ako ISO string
(`YYYY-MM-DD`) — presne ten istý tvar ako natívny input dnes, takže je to drop-in
náhrada bez zmeny žiadneho state/validation/API kódu.

Kalendárová matematika (dni v mesiaci, prvý deň týždňa pre `sk-SK`, priestupné
roky) sa počíta ručne cez natívne `Date`. Positioning: popover sa renderuje cez
`createPortal(document.body)` s `position: fixed` a súradnicami vypočítanými z
`getBoundingClientRect()` triggeru + `window.innerHeight/innerWidth` — rozhodne
sa pri otvorení, či ísť nadol alebo nahor. Portál do `document.body` obchádza
`overflow`/`transform` predka (funguje rovnako v `FulfilLoanRequestModal`).

- **Plus:** **0 nových npm balíkov** — žiadna zmena `package.json`/lockfile, žiadny
  krok navyše pre Jána (sandbox nemá `pnpm install`). Rovnaká filozofia ako
  ADR-0018 ("minimalizovať závislosti"). Plná vizuálna kontrola (Tailwind, brand
  tokeny, rovnaký `border-radius`/farby ako ostatné inputy). `value` ostáva ISO
  string → drop-in náhrada v `Controller` (react-hook-form) aj v plain `useState`
  formulároch.
- **Mínus:** kalendárová matematika a klávesnica sú naša zodpovednosť (mitigované:
  algoritmus je bežný a dobre testovateľný — `new Date(year, month+1, 0).getDate()`
  pre počet dní v mesiaci; jednotkové testy pokryjú hranice mesiaca/roka).
  V1 podporuje zatváranie na Escape/klik mimo, klávesnicová navigácia v mriežke
  (šípky) je vynechaná z V1 — fast-follow, nie blocker (mesiac sa dá prepínať
  šípkami vedľa nadpisu, deň sa vyberá kliknutím/Tab+Enter).

### C: Custom `DateField` + malá knižnica na kalendárovú matematiku (`react-day-picker`)

- **Plus:** menej vlastných bugov okolo dátumovej matematiky/i18n.
- **Mínus:** nová závislosť → treba `pnpm add` u Jána (mimo sandboxu, manuálny krok),
  napriek tomu, že kalendárová matematika pre gregoriánsky mesačný grid je bežný,
  dobre zdokumentovaný algoritmus bez skrytých úskalí. Nepridáva hodnotu úmernú
  cene závislosti + manuálneho kroku. **Zamietnuté.**

### D: Custom `DateField` + pozičná knižnica (`@floating-ui/react-dom`) len na flip/clip

- **Plus:** robustnejšie riešenie okrajových prípadov (veľmi malé okno, viacero
  scroll kontajnerov).
- **Mínus:** rovnaký problém ako C — nová závislosť, manuálny `pnpm add` krok.
  `createPortal` + `position: fixed` (možnosť B) rieši presne ten istý problém
  (vrátane modálu) bez závislosti. **Zamietnuté** — pridaná robustnosť nestojí za
  cenu závislosti pri súčasnom rozsahu appky (žiadne vnorené scroll kontajnery
  okrem jedného modálu).

## Rozhodnutie

Zvolili sme **Možnosť B: plne vlastný `DateField`**, bez novej závislosti.
Nasadený vo všetkých 4 miestach, kde sa dnes používa `<input type="date">`.

### Komponent

`apps/web/src/components/DateField.tsx`:

```tsx
<DateField
  label="Od" // povinný — pre aria-label + placeholder pri prázdnej hodnote
  value={plannedFrom} // ISO 'YYYY-MM-DD' alebo ''
  onChange={setPlannedFrom}
  min={today} // voliteľné, ISO string
  max={undefined} // voliteľné, ISO string
  required
/>
```

- **Trigger:** `<button>` s formátovaným `dd.mm.rrrr` (alebo placeholder „Vyberte
  dátum"), ikona kalendára, rovnaký vizuál ako ostatné inputy (`border-border-default`,
  `focus:ring-brand-primary`).
- **Popover:** `createPortal` do `document.body`, `position: fixed`. Pri otvorení
  sa zmeria `getBoundingClientRect()` triggeru a `window.innerHeight` — ak pod
  triggerom nie je aspoň výška kalendára (~340px) a nad ním je viac miesta, otvorí
  sa nahor (`bottom` súradnica namiesto `top`). Zatvára sa na `Escape`, klik mimo,
  a pri scroll/resize (rovnaký `useEffect` pattern ako `SelectField`).
- **Mriežka:** mesačný grid Po–Ne (sk-SK), šípky `◀ ▶` na zmenu mesiaca, dnešný
  deň zvýraznený bodkou, vybraný deň zvýraznený `bg-brand-primary`, dni mimo
  `min`/`max` disabled (rovnaká sémantika ako natívny `min`/`max`).
- **Integrácia:**
  - `LoanRequestContent.tsx`, `FulfilLoanRequestModal.tsx` — priamo, `value`/`onChange`
    z existujúceho `useState` (bezo zmeny state logiky).
  - `AssetCreateContent.tsx`, `AssetDetailEditForm.tsx` — cez `Controller`
    (react-hook-form), presne ako `SelectField` dnes (`Controller` → `render` →
    `DateField value={field.value} onChange={field.onChange}`).

### Kedy je natívny `<input type="date">` stále vhodný

- Rovnaké výnimky ako pri `SelectField` (ADR-0018): formuláre mimo hlavnej appky,
  server-rendered kontexty bez JS.
- Nový date input v appke by mal používať `DateField`. Výnimky komentovať
  `// ADR-0033: natívny date input — [dôvod]`.

## Dôsledky

### Pozitívne

- Rieši nahlásený bug — kalendár sa vždy zobrazí celý, bez ohľadu na dĺžku
  formulára nad ním (aj v modáli).
- Konzistentný vizuál naprieč OS/prehliadačmi, zladený s brand tokenmi.
- Žiadna nová závislosť, žiadny manuálny krok pre Jána.
- `value`/`onChange` tvar (ISO string) = drop-in náhrada, 0 zmien v
  state/validation/API kóde vo všetkých 4 formulároch.

### Negatívne / kompromisy

- Klávesnicová navigácia v mriežke (šípky ↑↓←→ medzi dňami) je vo V1 vynechaná —
  fast-follow. Mesiac sa prepína šípkami, deň klikom/Tab.
- Kalendárová matematika a lokalizácia (sk-SK, prvý deň týždňa) je naša
  zodpovednosť — pokryté jednotkovými testami hraníc mesiaca/roka.
- Popover sa nerepositioning-uje kontinuálne pri scrolle (len pri otvorení) —
  akceptované, rovnaký zjednodušený prístup ako `SelectField`.

### Riziká, ktoré treba sledovať

- **A11y audit** — WAI-ARIA `dialog`/`grid` pattern pre kalendár implementovaný
  manuálne; pri WCAG 2.1 AA audite overiť screen readery. Rovnaké riziko a
  mitigácia ako v ADR-0018 (zvážiť Radix, ak nájdeme problém).
- **Klávesnica v mriežke** — ak sa v praxi ukáže potreba (napr. power users,
  a11y audit), doplniť ↑↓←→ navigáciu ako fast-follow.

## Referencie

- [ADR-0018 Custom SelectField komponent](0018-select-field-component.md) — precedens filozofie „vlastný komponent, minimum závislostí"
- [apps/web/src/components/SelectField.tsx](../../apps/web/src/components/SelectField.tsx) — vzor pre outside-click/Escape handling
- [apps/web/src/components/DateField.tsx](../../apps/web/src/components/DateField.tsx) — implementácia

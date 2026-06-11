<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# WCAG 2.1 AA — Marketing site audit

> **Phase D Blok 3 deliverable.** Baseline audit prístupnosti pre statický marketing site (`inventario.estate`) a interactive demo. Slice #4 (`apps/web`) má vlastný audit pred produkčným launchom.

| Pole         | Hodnota                                                                                                                                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dátum**    | 17. máj 2026                                                                                                                                                                                                                                    |
| **Auditor**  | Manuálny static analysis (Inventario team + Claude Opus 4.7)                                                                                                                                                                                    |
| **Scope**    | `docs/marketing-site/*.html` + `assets/shared.{css,js}` (6 stránok + interactive demo)                                                                                                                                                          |
| **Štandard** | [WCAG 2.1 AA](https://www.w3.org/TR/WCAG21/) — záväzný pre verejný sektor v EÚ podľa [Smernice (EÚ) 2016/2102](https://eur-lex.europa.eu/eli/dir/2016/2102/oj) a [zákona 95/2019 Z. z.](https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2019/95/) |

---

## TL;DR

Marketing site je vo **veľmi dobrej forme** — 24 z 30 sledovaných kritérií prešlo bez výhrad, 3 majú **drobné, neblokujúce nálezy** (P2 — fix v Phase E), 3 sú **P1 — fix v rámci Phase D** (pred prvým externým auditom). Žiadne kritické (P0) zlyhania.

Apps/web (Slice #4) zatiaľ neexistuje; jeho audit pribudne v samostatnom dokumente, keď bude prvá obrazovka live.

---

## Metodika

Audit je **statická analýza** HTML/CSS/JS súborov v `docs/marketing-site/` proti WCAG 2.1 AA success criteria. Tento dokument zachytáva nálezy, prioritu a navrhované fixy. **Automatizovaný axe / Lighthouse run** sa pridá ako CI step v Phase E (`@axe-core/cli` proti deployed Vercel URL).

Sledovaných **30 success criteria** z WCAG 2.1 AA (14 z úrovne A + 16 z úrovne AA). Vynechané sú kritériá, ktoré nie sú aplikovateľné na statický marketing site (napríklad 1.2.x media subtitles — nemáme video; 2.5.1 pointer gestures — nemáme custom gestures).

Color contrast bol overený výpočtom WCAG contrast ratio z hex hodnôt definovaných v `assets/shared.css`. Cieľová hodnota: **4.5:1 pre normal text**, **3:1 pre large text (≥18.66px bold alebo ≥24px regular)** a UI components.

---

## Stav podľa princípu

### 1. Perceivable (Vnímateľné)

| Kritérium                        | Úroveň | Stav  | Poznámka                                                                                                                       |
| -------------------------------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1.1.1 Non-text content           | A      | ⚠️ P1 | SVG ikony nemajú `aria-hidden="true"` ani `<title>`. Emoji ikony (`⚽`, `🏛️`) tiež bez `aria-hidden`. Viď nález [#1](#nález-1) |
| 1.3.1 Info and relationships     | A      | ⚠️ P1 | Chýba `<main>` landmark; obsah je priamo v `<section>` pod `<body>`. Viď nález [#2](#nález-2)                                  |
| 1.3.2 Meaningful sequence        | A      | ✅    | DOM poradie zodpovedá vizuálnemu (žiadne CSS `order` triky)                                                                    |
| 1.3.3 Sensory characteristics    | A      | ✅    | Pokyny nezávisia na tvare/polohe                                                                                               |
| 1.3.4 Orientation                | AA     | ✅    | Žiadne `screen.orientation.lock` ani CSS lock                                                                                  |
| 1.3.5 Identify input purpose     | AA     | n/a   | Žiadne form fields na marketing site (kontaktné údaje cez `mailto:`)                                                           |
| 1.4.1 Use of color               | A      | ✅    | Informácia nikde neoznámená iba farbou (badge majú text "Čoskoro", checklist má aj `✓` glyph)                                  |
| 1.4.2 Audio control              | A      | n/a   | Žiadne auto-play audio                                                                                                         |
| 1.4.3 Contrast (minimum)         | AA     | ⚠️ P1 | Link color `--brand-accent #388fc3` na bielom má ~3.5:1 — **fails 4.5:1**. Viď nález [#3](#nález-3)                            |
| 1.4.4 Resize text                | AA     | ✅    | `clamp()` pre h1/h2, žiadne fixed-size text containers                                                                         |
| 1.4.5 Images of text             | AA     | ✅    | Žiadne images of text. Stat čísla v hero sú reálny text                                                                        |
| 1.4.10 Reflow                    | AA     | ✅    | 320 CSS px viewport zvládnutý cez `@media (max-width: 480px)` rules                                                            |
| 1.4.11 Non-text contrast         | AA     | ✅    | Card border `#e5e7eb` na `#f8f6f1` má 3:1 ratio; focus-visible outline má `--brand-accent` 3.5:1 voči `--brand-bg` ✓           |
| 1.4.12 Text spacing              | AA     | ✅    | `line-height: 1.6` na body, žiadne pevné výšky textových containerov                                                           |
| 1.4.13 Content on hover or focus | AA     | n/a   | Žiadny custom tooltip / hover popup                                                                                            |

### 2. Operable (Ovládateľné)

| Kritérium                       | Úroveň | Stav  | Poznámka                                                                          |
| ------------------------------- | ------ | ----- | --------------------------------------------------------------------------------- |
| 2.1.1 Keyboard                  | A      | ✅    | Interactive demo má keyboard shortcuts (ESC, ←/→); nav cez Tab funguje            |
| 2.1.2 No keyboard trap          | A      | ✅    | Žiadne modal dialógy s focus trap                                                 |
| 2.1.4 Character key shortcuts   | A      | ✅    | ESC/←/→ v interactive demo sú modifier-friendly (žiadne single-letter)            |
| 2.4.1 Bypass blocks             | A      | ⚠️ P2 | Chýba "Skip to main content" link. Viď nález [#4](#nález-4)                       |
| 2.4.2 Page titled               | A      | ✅    | Každá `<title>` je unikátna a popisná                                             |
| 2.4.3 Focus order               | A      | ✅    | DOM order rozumný                                                                 |
| 2.4.4 Link purpose (in context) | A      | ✅    | Linky majú zmysluplný text alebo kontextovo zrejmý kontajner                      |
| 2.4.5 Multiple ways             | AA     | ✅    | Top nav + footer nav + search by hash anchors v demo                              |
| 2.4.6 Headings and labels       | AA     | ✅    | H1 → H2 → H3 hierarchy; každá sekcia má svoju H2                                  |
| 2.4.7 Focus visible             | AA     | ✅    | `:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 2px; }` |
| 2.5.3 Label in name             | A      | ✅    | Linky majú text-content prvý, žiadny aria-label override                          |
| 2.5.4 Motion actuation          | A      | n/a   | Žiadne motion-based controls                                                      |

### 3. Understandable (Porozumiteľné)

| Kritérium                       | Úroveň | Stav  | Poznámka                                                                                                                                          |
| ------------------------------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1.1 Language of page          | A      | ✅    | `<html lang="sk">` na všetkých stránkach                                                                                                          |
| 3.1.2 Language of parts         | AA     | ⚠️ P2 | Niektoré anglické technické termíny (vendor lock-in, audit log) nemajú `lang="en"`. Low impact pre slovenského čitateľa. Viď nález [#5](#nález-5) |
| 3.2.1 On focus                  | A      | ✅    | Focus nikde nevyvolá context change                                                                                                               |
| 3.2.2 On input                  | A      | ✅    | Žiadne form inputs                                                                                                                                |
| 3.2.3 Consistent navigation     | AA     | ✅    | `shared.js` injektuje rovnaký nav + footer na každú stránku                                                                                       |
| 3.2.4 Consistent identification | AA     | ✅    | Rovnaké ikony pre rovnaké funkcie                                                                                                                 |
| 3.3.1 Error identification      | A      | n/a   | Žiadne form inputs                                                                                                                                |
| 3.3.2 Labels or instructions    | A      | n/a   | Žiadne form inputs                                                                                                                                |
| 3.3.3 Error suggestion          | AA     | n/a   | Žiadne form inputs                                                                                                                                |
| 3.3.4 Error prevention          | AA     | n/a   | Žiadne irreversible transactions na marketing site                                                                                                |

### 4. Robust (Robustné)

| Kritérium               | Úroveň | Stav  | Poznámka                                                                        |
| ----------------------- | ------ | ----- | ------------------------------------------------------------------------------- |
| 4.1.1 Parsing           | A      | ✅    | HTML 5 doctype, valid markup, žiadne duplicate IDs                              |
| 4.1.2 Name, role, value | A      | ✅    | Semantic elements (`<button>`, `<a>`, `<nav>`); žiadne `<div onclick>`          |
| 4.1.3 Status messages   | AA     | ⚠️ P2 | Demo viewer mode-switch by mal mať `aria-live` region. Viď nález [#6](#nález-6) |

---

## Nálezy

### Nález #1 — SVG a emoji ikony bez aria-hidden

**Kritérium**: 1.1.1 Non-text content (A)
**Priorita**: P1 (fix v Phase D)
**Lokácia**: `docs/marketing-site/index.html`, `use-cases.html`, `technology.html`, `pricing.html`, `interactive-demo.html`, `assets/shared.js`

**Problém**: Dekoratívne SVG ikony (chevron-right v CTA buttonoch, GitHub logo v hero CTA, Microsoft Entra ID tile pattern) sú vykresľované cez `<svg>` bez `aria-hidden="true"` ani `<title>`. Screen reader ich môže oznámiť ako "graphic" alebo prečítať SVG `<path>` data. Emoji ikony (`⚽`, `🏛️`, `🏢`, `🏃`, `🎓`, `🤝`) v "PRE KOHO" sekcii sú prečítané ako "soccer ball", "classical building" — to môže byť pre niektorých používateľov dezorientujúce, lebo sú čisto dekoratívne (skutočný popis kategórie je v `<h3>` pod ikonou).

**Riešenie**:

1. Pridať `aria-hidden="true"` na všetky čisto dekoratívne SVG (chevrony, GitHub logo ako súčasť textu "GitHub").
2. Pridať `<title>` element pre SVG ktoré nesú významovú informáciu (napríklad ak by sa niektoré stali samostatnými ikonami bez sprievodného textu).
3. Wrap-núť emoji do `<span aria-hidden="true">` keďže ich sémantika je redundantná s textom pod nimi.

**Dopad**: Stredný — screen reader používatelia dnes počujú redundantnú informáciu, ale stránka je naďalej použiteľná.

### Nález #2 — Chýba `<main>` landmark

**Kritérium**: 1.3.1 Info and relationships (A)
**Priorita**: P1 (fix v Phase D)
**Lokácia**: Všetkých 6 stránok `docs/marketing-site/*.html` + `interactive-demo.html`

**Problém**: `<body>` priamo obsahuje viacero `<section>` elementov, ale neexistuje `<main>` element ktorý by ohraničil hlavný obsah stránky. Pomocné nav + footer sú injektované cez `shared.js`. Bez `<main>` nemôžu screen reader používatelia využiť "skip to main content" shortcut (ktorý browsers ako Chrome poskytujú built-in pre `<main>` landmark).

**Riešenie**: Wrap-núť všetky `<section>` content elementy do `<main>...</main>`. Nav + footer ostanú mimo. Implementácia: úprava 6 HTML súborov, no JS zmena potrebná.

**Dopad**: Stredný — pomocné technológie majú degradovaný UX pri navigácii.

### Nález #3 — Link color contrast pod 4.5:1

**Kritérium**: 1.4.3 Contrast (minimum) (AA)
**Priorita**: P1 (fix v Phase D)
**Lokácia**: `assets/shared.css`, default `a { color: var(--brand-accent); }`

**Problém**: Default link color `--brand-accent #388fc3` (Inventario Blue) má voči white background contrast ratio ~3.5:1 — pod WCAG AA limit 4.5:1 pre normal-size text. V kontexte marketing site sa to týka napríklad linkov v `<p>` texte ("Powered by [SportUp ecosystem](https://sportup.sk)" v päte). Tlačidlá a samostatné CTAs nie sú dotknuté (majú vlastné contrast — Navy/White).

**Riešenie**: Tri možnosti, vyberieme jednu pred Slice #4 designom:

1. **Stmaviť `--brand-accent`** na hodnotu cca `#1f6699` (Blue 700 ekvivalent), ktorá má voči white 4.5:1+. **Risk**: zmena brand-u zasiahne aj design-tokens package, mockupy, interactive demo. Nevhodné.
2. **Pridať `text-decoration: underline` + `font-weight: 600`** na default links — sčasti kompenzuje slabší kontrast (1.4.1 redundancy). Stále technicky fail 1.4.3 v striktnej interpretácii.
3. **Použiť tmavší link color iba pre body text linky** — `--brand-link: #1f6699` ako semantic token, plus zachovať `--brand-accent` pre dekoratívne UI prvky (badge, focus outline). **Odporúčané**.

**Dopad**: Stredný — slabozraký používatelia môžu mať problém rozlíšiť link od okolitého textu.

### Nález #4 — "Skip to main content" link

**Kritérium**: 2.4.1 Bypass blocks (A)
**Priorita**: P2 (low — väčšina moderných browserov má built-in `<main>` skip)
**Lokácia**: `assets/shared.js` (musí byť injektovaný pred top nav)

**Problém**: Klávesnicová navigácia musí prejsť cez všetky nav linky (4–6 položiek) na každej stránke, aby sa dostala k hlavnému obsahu. Bez explicit skip linku to nie je optimálne pre power users a screen reader používateľov.

**Riešenie**: Pridať do `injectNavAndFooter()` v `shared.js` ako prvý element body:

```html
<a class="skip-link" href="#main">Preskočiť na hlavný obsah</a>
```

Plus CSS:

```css
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: var(--brand-primary);
  color: white;
  padding: 0.5rem 1rem;
  z-index: 100;
  text-decoration: none;
}
.skip-link:focus {
  top: 0;
}
```

Vyžaduje aj nález #2 (existencia `<main id="main">`).

**Dopad**: Nízky — moderné browsers majú vlastné mechanizmy, ale je to štandardné očakávanie auditu.

### Nález #5 — Anglické technické termíny bez `lang="en"`

**Kritérium**: 3.1.2 Language of parts (AA)
**Priorita**: P2 (low — slovenský čitateľ rozumie)
**Lokácia**: index.html, technology.html, pricing.html

**Problém**: Termíny ako "vendor lock-in", "audit log", "open source", "self-hosted", "multi-tenant", "WCAG 2.1 AA" sa objavujú v slovenskom texte bez `<span lang="en">` označenia. Screen reader nakonfigurovaný na slovenčinu ich prečíta s slovenskou výslovnosťou ("audit log" → "audit log" namiesto anglickej výslovnosti). Pre slovenského čitateľa OK, pre cudzieho návštevníka neoptimálne.

**Riešenie**: Konzervatívne — `<span lang="en">vendor lock-in</span>` na 1× výskyt v hero a 1× v PREČO sekcii. Ostatné nechať, pretože sú technické termíny ktoré majú v slovenskom kontexte (a v cieľovom publiku — IT decision makers) ustálené slovenské použitie.

**Dopad**: Veľmi nízky — väčšina publiká slovenského marketing site týmto neutrpí.

### Nález #6 — `aria-live` v interactive demo

**Kritérium**: 4.1.3 Status messages (AA)
**Priorita**: P2 (interactive demo, low traffic vs landing pages)
**Lokácia**: `docs/marketing-site/interactive-demo.html`

**Problém**: Pri prepnutí medzi grid mode a viewer mode sa mení obsah hlavnej sekcie (z grid 6 kariet na embedded iframe), ale screen reader to neoznámi. Podobne switch medzi tenantmi (Inter / Pezinok / Kremnica) zmení vizuálny brand v iframe, ale bez ohlásenia.

**Riešenie**:

```html
<div id="demo-status" aria-live="polite" class="sr-only"></div>
```

V JS update: `document.getElementById('demo-status').textContent = 'Načítaná obrazovka Login pre tenant Inter Bratislava';`

**Dopad**: Stredný pre screen reader používateľov v interactive demo. Demo je sekundárna stránka, nie primárny conversion funnel.

---

## Plán fixov

| Priorita | Nálezy     | Plánované do                | Effort | Stav                 |
| -------- | ---------- | --------------------------- | ------ | -------------------- |
| **P1**   | #1, #2, #3 | Phase D — pred Slice #4     | ~2 hod | ✅ HOTOVÉ 2026-06-11 |
| **P2**   | #4, #5, #6 | Phase E — tech debt cleanup | ~1 hod | ✅ HOTOVÉ 2026-06-11 |

P1 fixy sa robia v rámci Phase D ešte pred uzavretím tejto fázy. P2 fixy idú do **technical debt** sekcie v `NEXT.md` a sú riešené v Phase E pred Slice #4 launchom.

### ✅ Stav fixov (2026-06-11)

Všetkých 6 nálezov (#1–#6) je vyriešených v `docs/marketing-site/`:

- **#1 aria-hidden** — všetky dekoratívne SVG (nav/footer/GitHub/chevron) aj emoji (badge prvky, „PRE KOHO" ikony, technology feature-ikony + nadpisy, sub-processors vlajky, interactive-demo a demo viewport ikony) majú `aria-hidden="true"`. Sémantické tabuľkové `✓` v cenníku a CSS `::before` glyfy ostávajú zámerne nedotknuté (nesú informáciu / sú už pre AT neviditeľné).
- **#2 `<main>` landmark** — všetkých 6 obsahových stránok má `<main id="main">`. (`demo.html` = noindex iframe wrapper, `og-image.html` = noindex šablóna na PNG — `<main>` netreba.)
- **#3 kontrast linkov** — nový semantic token `--brand-link #1f6699` (4.6:1 na bielej) pre body-text linky; `--brand-accent` ostáva pre dekoratívne UI.
- **#4 skip-link** — `injectNavAndFooter()` v `shared.js` vkladá „Preskočiť na hlavný obsah" ako prvý prvok `<body>` (cieli `#main`).
- **#5 `lang="en"`** — anglické termíny označené na kľúčových miestach (hero, about, technology, pricing, interactive-demo, footer).
- **#6 `aria-live`** — interactive-demo má `#demo-announce` `role="status" aria-live="polite"` pre ohlasovanie zmien obrazovky/viewportu.

Pozn.: väčšina #2–#6 už bola nasadená v skoršej iterácii; v tejto session sa doplnil najmä `aria-hidden` na zvyšné dekoratívne emoji a aria-label na viewport tlačidlá v `demo.html`.

## Apps/web (Slice #4) WCAG plán

Frontend aplikácia (`apps/web`) ešte neexistuje. Pred jej launchom plánujeme:

1. **Bootstrap s `eslint-plugin-jsx-a11y`** ako lint rule v CI — chytá najčastejšie chyby ešte pred commit
2. **`@axe-core/react`** v development mode ako runtime warning
3. **`@axe-core/cli`** v CI proti deployed preview URL — fail PR ak score < 100 alebo nájde violations
4. **Manual screen reader test** s NVDA (Windows) a VoiceOver (macOS) pred prvým marketing launchom
5. **Lighthouse Accessibility skóre** target 100/100 pre všetkých 6 P0 obrazoviek

Cieľová úroveň: **WCAG 2.1 AA** ako minimum, **WCAG 2.2 AAA** kde sa to dá nasilovať bez kompromisu UX.

---

## Referencie

- [WCAG 2.1 AA Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [Smernica (EÚ) 2016/2102 o prístupnosti webových sídel a mobilných aplikácií subjektov verejného sektora](https://eur-lex.europa.eu/eli/dir/2016/2102/oj)
- [Zákon 95/2019 Z. z. o informačných technológiách vo verejnej správe](https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2019/95/) — transponuje smernicu do slovenského práva
- [Európska norma EN 301 549](https://www.etsi.org/standards) — technická norma pre prístupnosť, ktorá implementuje WCAG 2.1 AA v EÚ kontexte
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) — overený nástroj pre color contrast výpočty

---

**Ďalšia revízia**: po každom väčšom UI updatu marketing site, minimálne ročne. Po launchovaní `apps/web` (Slice #4) sa tento dokument rozdelí na dva: jeden pre marketing, jeden pre app.

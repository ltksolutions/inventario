<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Brand Guide — Inventario

> **Audience:** Developeri, designeri a contributor-i ktorí pracujú na Inventario alebo derivátnych projektoch.
>
> **Status:** Living document. Updates vítané cez PR s typom `docs(brand): ...`.
>
> **Verzia brandu:** v1.0 (15. máj 2026, post-pivot)

---

## Obsah

1. [Filozofia značky](#1-filozofia-značky)
2. [Vizuálne základy](#2-vizuálne-základy)
3. [Logo](#3-logo)
4. [Farebná paleta](#4-farebná-paleta)
5. [Typografia](#5-typografia)
6. [Brand pattern](#6-brand-pattern)
7. [Hlasový tón a copywriting](#7-hlasový-tón-a-copywriting)
8. [Multi-tenant whitelabeling](#8-multi-tenant-whitelabeling)
9. [Forks & derivatives](#9-forks--derivatives)
10. [Referenčné príklady](#10-referenčné-príklady)
11. [Don'ts](#11-donts)

---

## 1. Filozofia značky

**Inventario** je otvorená multi-tenant platforma pre evidenciu a vypožičiavanie majetku. Brand musí komunikovať tri veci:

| Hodnota                                   | Vizuálne vyjadrenie                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| **Transparentnosť**                       | Otvorený zdrojový kód, audit-friendly, viditeľné stavy (status dot na logu) |
| **Inštitucionálna spoľahlivosť**          | Navy ako primárna farba, geometrické tvary, žiadne hravé špirály            |
| **Otvorenosť pre rôzne typy organizácií** | Multi-tenant by design, neutrálny default brand, scope pre rebrand          |

### Tagline

> **„Transparentná správa majetku. Bez vendor lock-in."**

Krátka verzia: **„Bez vendor lock-in."**

Powered by signature: **„Powered by SportUp ecosystem."**

### Brand atribúty

- ✅ Profesionálne, ale prístupné
- ✅ Geometrické, čisté
- ✅ Sebavedomé bez agresie
- ✅ Slovenské, ale medzinárodne pochopiteľné
- ❌ NIE: hravé, ironické, "tech bro" tone
- ❌ NIE: vystrašujúce, korporátne, vendor-y
- ❌ NIE: trendy meme aesthetic

---

## 2. Vizuálne základy

### Pomer mriežky

Logo a UI elementy používajú **mriežku 4px** (resp. 8px na väčších kontextoch). Touch targety na mobile ≥ 44×44 px (WCAG 2.1 AA).

### Skleérotí a tiene

Subtílne, navy-based. Nikdy nie čierne pure-black shadows.

```css
/* Default elevation */
box-shadow: 0 2px 6px rgba(26, 45, 71, 0.12);

/* Hover elevation */
box-shadow: 0 10px 30px -8px rgba(26, 45, 71, 0.12);

/* CTA emphasis */
box-shadow: 0 4px 14px color-mix(in srgb, var(--brand-primary) 25%, transparent);
```

### Border-radius

| Element        | Radius                    |
| -------------- | ------------------------- |
| Buttons        | `10px`                    |
| Cards          | `16px`                    |
| Inputs         | `10px`                    |
| Badges         | `999px` (pill)            |
| Logo container | `7–10px` (proporcionálne) |

---

## 3. Logo

### Koncept

Logo Inventaria sa skladá z dvoch sémantických prvkov:

1. **Tri horizontálne čiary klesajúcej šírky** (95% → 75% → 55% opacity) — reprezentujú **vrstvy majetku** (kategórie → podkategórie → konkrétne položky). Klesajúca opacity zdôrazňuje hierarchiu.

2. **Modrý accent dot vpravo dole** — reprezentuje **"aktívny status"** alebo **"current activity"**. Je to vizuálna metafora pre real-time transparentnosť systému.

### Varianty

| Súbor                                                                   | Použitie                                  | Pomer        |
| ----------------------------------------------------------------------- | ----------------------------------------- | ------------ |
| [`logo.svg`](docs/assets/brand/inventario/logo.svg)                     | Inline v dokumentoch, dedí `currentColor` | 1:1 (32×32)  |
| [`logo-container.svg`](docs/assets/brand/inventario/logo-container.svg) | Standalone, navy rounded container        | 1:1 (32×32)  |
| [`logotype.svg`](docs/assets/brand/inventario/logotype.svg)             | Logo + wordmark, hlavičky dokumentov      | 4:1 (240×60) |
| [`favicon.svg`](docs/marketing-site/assets/favicon.svg)                 | Browser tab, app icon                     | 1:1 (32×32)  |

### Minimálna veľkosť

- **Logomark (sám)**: 16×16 px digital, 5×5 mm print
- **Logotype (s textom)**: 100×25 px digital, 30×7.5 mm print

### Ochranná zóna (clear space)

Okolo loga musí byť **minimálne výška jedného "baru"** (cca 12.5% celkovej výšky) voľného priestoru. Nič sa do tejto zóny nevkladá.

```
┌────────────────────────────────────┐
│           [clear zone]              │
│   ┌──────────────────────────┐     │
│ [c]│  ████████████████        │[c]  │
│   │  █████████████             │     │
│   │  █████████      ●          │     │
│   └──────────────────────────┘     │
│           [clear zone]              │
└────────────────────────────────────┘
```

### Logo na rôznych pozadiach

- **Light background (paper/white)**: použiť `logo.svg` s `color: var(--brand-primary)` alebo `logo-container.svg`
- **Dark background (navy/black)**: použiť `logo.svg` s `color: white` (accent dot zostane modrý — to je správne)
- **Photo/complex background**: použiť `logo-container.svg` pre dostatočný kontrast
- **Single-color print (faxom)**: použiť `logo.svg` v navy alebo black, accent dot môže byť konvertovaný na 30% gray

---

## 4. Farebná paleta

### Primary palette

```css
--brand-primary: #1a2d47; /* Navy   — hlavná brand farba */
--brand-accent: #388fc3; /* Blue   — accent, links, highlights */
--brand-bg: #f8f6f1; /* Paper  — page background */
--brand-muted: #6b7a8d; /* Steel  — secondary text */
```

| Farba     | HEX       | RGB           | OKLCH                 | Použitie                        |
| --------- | --------- | ------------- | --------------------- | ------------------------------- |
| **Navy**  | `#1a2d47` | `26 45 71`    | `oklch(24% 0.04 256)` | Primary CTA, headers, logo      |
| **Blue**  | `#388fc3` | `56 143 195`  | `oklch(60% 0.11 240)` | Accent dot, hover states, links |
| **Paper** | `#f8f6f1` | `248 246 241` | `oklch(97% 0.01 80)`  | Page background, light cards    |
| **Steel** | `#6b7a8d` | `107 122 141` | `oklch(56% 0.03 244)` | Captions, secondary text        |

### Semantic colors

```css
--color-success: #10b981; /* Emerald — confirmations, dostupné */
--color-warning: #f59e0b; /* Amber   — pending, blízky deadline */
--color-danger: #ef4444; /* Rose    — errors, po-termínové */
```

### Hero gradient

Signature gradient pre hero sekcie a kľúčové CTA momenty:

```css
background: linear-gradient(
  135deg,
  var(--brand-primary) 0%,
  color-mix(in oklch, var(--brand-primary) 75%, var(--brand-accent) 25%) 100%
);
```

### Accessibility

Všetky farebné kombinácie musia spĺňať **WCAG 2.1 AA** kontrast:

| Background | Foreground | Contrast | Status           |
| ---------- | ---------- | -------- | ---------------- |
| `paper`    | `primary`  | 13.5 : 1 | ✅ AAA           |
| `paper`    | `muted`    | 4.8 : 1  | ✅ AA            |
| `primary`  | `white`    | 12.6 : 1 | ✅ AAA           |
| `primary`  | `accent`   | 3.4 : 1  | ⚠️ AA Large only |

> **Pravidlo**: Modrý accent nikdy nepoužívame ako **text na navy pozadí** v malých veľkostiach. Iba ako accent prvok (dot, underline, icon).

---

## 5. Typografia

### Font families

```css
--font-sans: 'Poppins', system-ui, -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', 'Menlo', monospace;
```

| Font               | Použitie                                | Weights                                  |
| ------------------ | --------------------------------------- | ---------------------------------------- |
| **Poppins**        | Telo, UI, headings, wordmark            | 400, 500, 600, 700, 800 + italic 700/800 |
| **JetBrains Mono** | Kód, inventárne čísla, technical labels | 400, 500                                 |

### Wordmark "Inventario"

Wordmark má fixné styling parametre:

```css
font-family: 'Poppins', sans-serif;
font-weight: 800;
font-style: italic;
letter-spacing: -0.02em;
```

> **Italic + extra bold + tight letter-spacing** = výrazná, dynamická signature. Nemení sa.

### Typografická hierarchia

```css
h1 {
  font-size: clamp(2rem, 4vw, 3.25rem);
  font-weight: 800;
}
h2 {
  font-size: clamp(1.5rem, 3vw, 2.25rem);
  font-weight: 700;
}
h3 {
  font-size: 1.25rem;
  font-weight: 700;
}
h4 {
  font-size: 1rem;
  font-weight: 600;
}
p {
  font-size: 1rem;
  line-height: 1.6;
}
```

### Mono labels

Pre **technické labels** (kategórie sekcií, inventárne čísla, metriky) používame mono font s caps:

```css
font-family: var(--font-mono);
font-size: 0.7rem;
text-transform: uppercase;
letter-spacing: 0.08em;
color: var(--brand-muted);
```

Príklad: `PRE KOHO JE INVENTARIO`, `LT-2026-001`, `~158 s`

---

## 6. Brand pattern

### Koncept

Logo Inventaria je **systémovou jednotkou**, nie len ozdobou. Opakovaním loga v mriežke vzniká **brand pattern** ktorý sa dá použiť všade kde chceme "Inventario by design":

- Hero sekcie na webe (overlay s nízkou opacity)
- Print materiály (brožúry, vizitky, hlavičkové papiere)
- Prezentácie (sekčné slidy)
- Social media (LinkedIn cover, OG images)
- Merchandise (samolepky, tričká)

### Špecifikácia

- **Tile rozmer**: 120 × 120 px (vektor, scaluje sa)
- **Tile interval**: 180 × 180 px (background-size pri implementácii)
- **Opacity**: 5–8 % na tmavom pozadí, 4–6 % na svetlom pozadí
- **Accent dot opacity**: 35–50 % (jemne viditeľný, ale nie krikľavý)
- **Súbor**: [`docs/assets/brand/inventario/pattern.svg`](docs/assets/brand/inventario/pattern.svg)

### Implementácia v CSS

```css
.hero-section {
  background: var(--brand-primary);
  position: relative;
}
.hero-section::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url('/assets/brand/inventario/pattern.svg');
  background-repeat: repeat;
  background-size: 180px;
  opacity: 0.07;
  pointer-events: none;
  mix-blend-mode: overlay;
}
.hero-section > * {
  position: relative;
  z-index: 1;
}
```

Alebo s pripravenou utility classou (`assets/shared.css`):

```html
<section class="hero-gradient">
  <!-- Pattern sa aplikuje automaticky cez ::after -->
</section>
```

Pre custom miesta:

```html
<section class="pattern-bg pattern-dark">
  <!-- Pattern overlay pre svetlé pozadie -->
</section>
```

### Pattern guidance

- ✅ **Použiť na**: hero sekcie, "About us" pozadia, sekčné delivery
- ✅ **Použiť na**: print materiály (vizitky, brožúry) ako "watermark"
- ❌ **Nepoužívať**: pod hlavným textom (zhoršuje čitateľnosť)
- ❌ **Nepoužívať**: na malých UI elementoch (button, badge)
- ❌ **Nepoužívať**: v aplikácii v produkčnom prostredí (rušilo by data-heavy UI)

---

## 7. Hlasový tón a copywriting

### Tonalita

**Sebavedomá, ale skromná. Technicky kompetentná, ale prístupná. Slovenská, ale otvorená medzinárodne.**

| ✅ Áno                                                              | ❌ Nie                                 |
| ------------------------------------------------------------------- | -------------------------------------- |
| „Vybudovali sme platformu, ktorá je transparentná a auditovateľná." | „Sme NAJLEPŠIA platforma na trhu!"     |
| „Mestá si môžu kód forkovať a hostiť sami."                         | „Naša revolučná technológia mení hru." |
| „Inventario je open source pod EUPL-1.2."                           | „Naša patentovaná architektúra..."     |
| „Typicky odpovieme do 24 hodín."                                    | „Vždy reagujeme okamžite!"             |

### Slovenčina

- **Tykáme** v marketingu — Inventario je friendly, nie korporátne
- **Vykáme** v enterprise komunikácii (DPA, právne dokumenty)
- Vyhýbame sa anglicizmom kde je dobrá slovenská alternatíva:
  - ✅ „výpožička" (nie „lend")
  - ✅ „evidencia majetku" (nie „asset management" — okrem pozdneho subtitle)
  - ✅ „schvaľovanie" (nie „approval flow")
- **Ale**: technické termíny ostávajú v angličtine kde sú zaužívané:
  - „SSO", „API", „RBAC", „audit log", „CI/CD", „SDK"

### Často používané formulácie

| Frázy ktoré máme radi               | Použitie               |
| ----------------------------------- | ---------------------- |
| „Transparentná správa majetku"      | Hero, taglines         |
| „Bez vendor lock-in"                | Headline, key argument |
| „Otvorený zdrojový kód"             | Trust messaging        |
| „Pre koho je Inventario"            | Sekcia s use cases     |
| „Powered by SportUp ecosystem"      | Footer, attribution    |
| „EUPL-1.2 · REUSE 3.3 · GDPR ready" | Trust badge pack       |

---

## 8. Multi-tenant whitelabeling

Inventario je **multi-tenant white-label platforma**. To znamená že **každá organizácia môže mať vlastný branding**:

### Cloud Multi-tenant tenant (Pro plán)

- Nahrá si **vlastné logo** (PNG/SVG, max 256×256)
- Nakonfiguruje **primary brand farby** (3 farby: primary, accent, background)
- Custom **email template branding** pre notifikácie
- **Inventario branding ostáva v footri** ("Powered by Inventario")

### Privátna inštancia (Enterprise plán)

- Všetko z Pro
- **Custom doména** (napr. `assets.bratislava.sk`)
- **Kompletný rebrand** UI — vrátane wordmark
- **Email odosielateľ** s custom doménou
- Inventario attribution iba v `/about` page (právny minimum)

### Self-hosted fork (EUPL-1.2)

- **Plný rebrand** — vlastné meno, logo, copywriting
- **Žiadne Inventario attribution** v UI (ale viď [§9 Forks & derivatives](#9-forks--derivatives))

### Technická implementácia

Brand customization sa robí cez **CSS custom properties**, ktoré sa nastavujú per tenant:

```css
/* Per-tenant override v admin UI */
:root[data-tenant='bratislava'] {
  --brand-primary: #003d7a;
  --brand-accent: #ffd700;
  --brand-bg: #fffef7;
}
```

Toto je presný pattern, ktorý už používame v [`docs/design/screens/`](docs/design/screens/) mockupoch — 4 demo tenanti (Inventario / Inter / Pezinok / Kremnica).

---

## 9. Forks & derivatives

Inventario je licencované pod **[EUPL-1.2](LICENSE)**. To znamená že **každý môže projekt forknúť** a používať na vlastné účely, **vrátane komerčného použitia**.

### Čo môžeš pri fork-u

- ✅ Plne **rebranduj UI** — vlastné meno, logo, farby
- ✅ Predávaj služby postavené na fork-u
- ✅ Modifikuj kód
- ✅ Hostuj na vlastnej infraštruktúre

### Čo musíš pri fork-u zachovať

EUPL-1.2 vyžaduje:

1. **SPDX license headery v kóde** — každý zdrojový súbor musí mať svoje SPDX metadáta
2. **Zachovať `LICENSE` súbor** s plným textom EUPL-1.2
3. **Atribúciu pôvodného projektu** v dokumentácii (EUPL-1.2 §5):
   > "Tento produkt je založený na projekte Inventario (https://inventario.estate) od LTK Solutions, licencovanom pod EUPL-1.2."
4. **REUSE 3.3 compliance** — strojovo overiteľné `reuse lint`

### Brand-specific pravidlá pre forks

- ❌ **NESMIEŠ** používať "Inventario" ako meno produktu pre fork (matie spotrebiteľov)
- ❌ **NESMIEŠ** používať Inventario logo v derivátnom produkte
- ❌ **NESMIEŠ** tvrdiť, že tvoj fork je oficiálna distribúcia
- ✅ **MÔŽEŠ** povedať „založené na Inventario" alebo „derivative of Inventario"
- ✅ **MÔŽEŠ** prispievať späť do upstream projektu (PR vítané!)

### Príklad správneho fork attribution

V README fork-u:

```markdown
# MestoInventár

Open-source nástroj pre správu majetku miest a obcí.
Založený na projekte [Inventario](https://inventario.estate)
od LTK Solutions, licencovanom pod EUPL-1.2.
```

V UI fork-u (footer alebo `/about`):

```
Based on Inventario (EUPL-1.2) · github.com/ltksolutions/inventario
```

---

## 10. Referenčné príklady

### Implementácie v repe

| Kontext                     | Súbor                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Marketing web hero          | [`docs/marketing-site/_home.html`](docs/marketing-site/_home.html)                     |
| App login screen            | [`docs/design/screens/_login-page.html`](docs/design/screens/_login-page.html)         |
| App dashboard               | [`docs/design/screens/_dashboard-page.html`](docs/design/screens/_dashboard-page.html) |
| Multi-tenant brand switcher | [`docs/design/screens/02-dashboard.html`](docs/design/screens/02-dashboard.html)       |
| Shared CSS variables        | [`docs/marketing-site/assets/shared.css`](docs/marketing-site/assets/shared.css)       |
| Design tokens (TypeScript)  | [`packages/design-tokens/tokens.json`](packages/design-tokens/tokens.json)             |

### Skoré screenshots

Plné screenshots pre prezentácie:

- 6 P0 obrazoviek aplikácie: `docs/design/screens/index.html`
- 5 marketingových stránok: `docs/marketing-site/index.html`

---

## 11. Don'ts

### Logo

- ❌ Neotáčaj logo
- ❌ Nedeformuj proporcie (stretch / squeeze)
- ❌ Nepridávaj outline okolo loga
- ❌ Nepoužívaj logo na zložitom photo background bez container variantu
- ❌ Nemeň poradie čiar (vždy najširšia hore, klesajúca šírka dolu)
- ❌ Nemeň pozíciu accent dot (vždy vpravo dole pri najkratšej čiare)
- ❌ Nemeň farbu accent dot na inú ako `#388fc3`

### Farby

- ❌ Nepoužívaj čistú čiernu `#000000` — používaj navy `#1a2d47`
- ❌ Nepoužívaj čistú bielu pre text na navy — používaj `#f8f6f1` (paper) pre subtle warmth
- ❌ Nepridávaj náhodné akcentné farby — držme sa palety
- ❌ Modrý accent nikdy ako čistý text na navy v `< 14px` veľkosti

### Typografia

- ❌ Nepoužívaj Comic Sans, Arial, Times New Roman, ani iné default fonty
- ❌ Nemiešaj viacero sans-serif fontov v jednom dokumente
- ❌ Wordmark "Inventario" vždy v italic — nikdy regular
- ❌ Nepoužívaj `text-transform: uppercase` na bežný text (iba na mono labels)

### Pattern

- ❌ Nepoužívaj pattern na text-heavy strany v aplikácii
- ❌ Opacity nikdy nad 10 % — pattern je decorácia, nie content
- ❌ Nemiešaj 2 patterns naraz
- ❌ Pattern v animácii — žiadne moving backgrounds

### Hlas

- ❌ Žiadne emoji v copywriting (iba ako utility v UI — emoji ikony v cards)
- ❌ Žiadne corporate buzzwordy ("synergy", "leverage", "ecosystem play")
- ❌ Žiadne FOMO marketing ("LAST CHANCE!", "ONLY TODAY!")
- ❌ Žiadne porovnávanie s konkurenciou by name

---

## Maintainers

Tento BRAND.md udržiavame ako **living document**. Otázky / PR / suggestions:

- 📧 Email: **inventario@ltk.solutions**
- 🐙 GitHub: [ltksolutions/inventario](https://github.com/ltksolutions/inventario)
- 💬 Issues s tagom `brand` pre brand-related diskusie

---

**Verzia**: v1.0
**Last updated**: 15. máj 2026
**Next review**: pri každom väčšom release (`v0.X.0`)

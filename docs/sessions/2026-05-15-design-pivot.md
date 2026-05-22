# Session plán — Design exploration: multi-tenant white-label platforma a brand systém

> **✅ STATUS UPDATE (15. máj 2026, večer):** Session **úspešne zexekuovaná**. Viď kompletný výsledok v
> [`2026-05-15-day-summary.md`](2026-05-15-day-summary.md). Táto fáza prekročila pôvodný scope a obsiahla aj:
> brand system v1.0 (BRAND.md), pricing strategy v1.0 + Annual Contract, kompletný marketingový web (5 stránok),
> deploy prípravu (Vercel + DNS guides). Tento dokument je ponechaný ako **historická referencia pre pôvodný plán**.

|                              |                                            |
| ---------------------------- | ------------------------------------------ |
| **Dátum plánovanej session** | 15. máj 2026 (zajtra)                      |
| **Predpokladaná dĺžka**      | 3–5 hodín (rozdelená na 3 fázy)            |
| **Pripravil**                | Claude Opus 4.7 + Ján Letko, 14. máj 2026  |
| **Status**                   | ✅ Zexekuované a prekročené (15. máj 2026) |

---

## 1. Strategický kontext — finalizovanie multi-tenant smerovania

### 1.1 Východzí stav

Backend Inventaria je v slice #3 (kategórie, lokácie, FK protection). Technicky ide o clean multi-tenant systém. Nasledujúca session sa zameraná na finalizovanie brand identity, design token systému a marketingovej prezentácie platformy.

### 1.2 Nový smer

Riešenie má slúžiť **akejkoľvek organizácii**, ktorá potrebuje evidovať a vypožičiavať majetok:

- **Športové zväzy** — SFZ, hokejový, basketbalový, atletický zväz, vodný motorizmus, ...
- **Mestá a obce** — mestský majetok (mobiliár, technika, kancelárie, výzdoba)
- **VÚC** — krajský majetok rozprestrený po stovkách obcí
- **Kluby** — futbalové, hokejové, multišportové
- **Školy a školské zariadenia** — IT vybavenie, športové potreby, učebné pomôcky
- **Občianske združenia, nadácie, NGO**

Užívateľské skupiny sú širšie ako len tréneri:

- **Manažéri klubov / funkcionári** — žiadajú o majetok pre podujatia
- **Rodičia** — preberajú dresy pre deti
- **Brigádnici / dobrovoľníci** — krátkodobé vypožičanie technického vybavenia
- **Externí dodávatelia** — preberajú majetok pre konkrétnu zakázku

### 1.3 Budúca integrácia

Riešenie má byť pripravené na napojenie na platformu **sportup.sk** ako jeden z modulov:

- SSO cez sportup.sk identity (popri Microsoft Entra ID)
- Multi-tenant architektúra (každý zväz/klub má svoj "organisation" priestor)
- Branding per-tenant (logo, farby, slogan)
- API ready pre embedded use v sportup.sk

### 1.4 Implikácie pre vývoj

| Oblasť            | Zmena                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Naming**        | Premenovať projekt z _SFZ Asset Management_ na neutrálne meno (napr. _Loan_, _Asseta_, _OpenAssets_, _Inventario_, alebo zatiaľ kódové meno) |
| **Design tokens** | Abstrahovať SFZ-špecifické farby do _default tenant_ + povoliť tenant override                                                               |
| **Dátový model**  | Pridať `Organisation` entity ako root tenant boundary; každý dokument má `organisationId`                                                    |
| **Auth**          | Multi-tenant Entra ID (každá organizácia má svoj tenant) + sportup.sk OIDC ako budúci provider                                               |
| **Frontend copy** | Žiadne "SFZ", "reprezentácia", "tréner" v defaultných textoch; používať generické pojmy                                                      |
| **Funkčná špec**  | Zovšeobecniť terminológiu a user stories                                                                                                     |

---

## 2. Plán session-y na zajtra

Session je rozdelená do troch fáz. Každá je samostatne dokončiteľná — ak nestihneme, ostatok prejde do ďalšej session.

### Fáza A — Strategický pivot (1 hodina)

Cieľ: zafixovať nový charakter projektu v dokumentácii.

1. **Rozhodnutie o pomenovaní**
   - Už potvrdené večer 14. mája: **code name _Inventario_**. Formálna fixácia v doc-och.

2. **ADR-0002: Multi-tenant white-label architecture**
   - Architecture Decision Record zachytávajúci pivot.
   - Záznam: čo sa mení, čo zostáva, aké sú dôsledky pre slice #4+.

3. **ADR-0003: Open-source licensing strategy (EUPL-1.2 + REUSE + EU funding readiness)**
   - Záznam prečo EUPL-1.2 (kompatibilita pre verejný sektor SR/EU, multi-language ekvivalencia)
   - Plus dual licensing: zdrojový kód EUPL-1.2, dokumentácia CC-BY-4.0
   - REUSE 3.3 compliance ako podmienka pre EU fondy a verejný sektor

4. **Refactor `functional-spec.md`**
   - Globálny find-and-replace: "SFZ" → "{{organizationName}}", "tréner" → "user", "reprezentácia" → "team", "katalóg majetku SFZ" → "katalóg majetku organizácie".
   - Pridať sekciu "Multi-tenant model".
   - Doplniť use cases pre mestá, kluby, školy.

5. **Aktualizácia `docs/README.md` a koreňového `README.md`**
   - Tagline (motto projektu): _"Transparent, auditable asset management platform — forkable, self-hostable, no vendor lock-in."_
   - Slovenská verzia: _"Transparentná a auditovateľná platforma pre správu majetku — forkovateľná, samohostícia, bez vendor lock-in."_
   - Use case appendix.

### Fáza A.5 — EUPL + REUSE + Brand identity (1 hodina, nová!)

Cieľ: nastaviť _Inventario_ ako plný open-source projekt kompatibilný s EU fondami, s vizuálnou identitou prevzatou z sportup.sk.

#### A.5.1. EUPL-1.2 licensing setup

Nástrojé a súbory potrebné v repe (priamo podľa sportup.sk šablóny):

```
Asset-Management/
├── LICENSE                    # EUPL-1.2 plain text (zdrojový kód)
├── LICENSE-DOCS               # CC-BY-4.0 plain text (dokumentácia)
├── LICENSES/                  # plne texty používaných licencií (REUSE)
│   ├── EUPL-1.2.txt
│   └── CC-BY-4.0.txt
├── REUSE.toml                 # centrálne licenčné mapovanie REUSE 3.3
├── CITATION.cff               # ako citovať projekt
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── SECURITY.md
└── README.md                  # nové EUPL + REUSE badge-e
```

Konkrétne kroky:

- Kopírovať `LICENSES/EUPL-1.2.txt` a `LICENSES/CC-BY-4.0.txt` zo sportup.sk repa
- Vytvoriť kořeňové `LICENSE` (full EUPL-1.2 text) a `LICENSE-DOCS` (CC-BY-4.0)
- Vytvoriť `REUSE.toml` s mapovaním:
  - `apps/**`, `packages/**`, `*.ts`, `*.tsx`, `*.dart` → EUPL-1.2
  - `docs/**`, `README.md`, `CHANGELOG.md`, `ROADMAP.md` → CC-BY-4.0
  - `apps/web/public/**` (brand assets, og-image) → CC-BY-4.0
- Pridať `SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions` + `SPDX-License-Identifier: EUPL-1.2` headers do všetkých existujúcich source files (alebo použiť REUSE.toml route)
- Validovať: `python3 -m reuse lint` — musí prejšť 100%
- Pridať REUSE badge do README: `[![REUSE status](https://api.reuse.software/badge/github.com/Slovensky-futbalovy-zvaz/Asset-Management)](https://api.reuse.software/info/github.com/Slovensky-futbalovy-zvaz/Asset-Management)`

#### A.5.2. EU fondy compliance — čo ešte treba

Okrem EUPL + REUSE existuje viacero ďalších požiadaviek pre OPII, OP Slovensko, Digital Europe Programme a podobné zdroje:

| Požiadavka                             | Prečo                                                                                     | Implementácia                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **EUPL-1.2 licencia**                  | EU komisia odporúča pre verejný sektor; mnohé EU výzvy ju vyžadujú                        | hotovo v A.5.1                                                                           |
| **REUSE 3.3 compliance**               | Strojovo overiteľná licenčná čistota — podmienka pre OpenForum, Joinup, Software Heritage | hotovo v A.5.1                                                                           |
| **GitHub repo verejný**                | Auditítěrom musí byť repo dostupný počas celej doby udržateľnosti (5 rokov po skončení)   | prehɣsuneť z private na public; nýzny majitelia: ltksolutions org alebo nová organizácia |
| **CITATION.cff**                       | DOI/citačné metadata pre výskumné a verejné inštitúcie                                    | kopírovať zo sportup.sk a upravíť                                                        |
| **CODE_OF_CONDUCT.md**                 | Podmienka mnohých grantov (incl. Horizon Europe)                                          | Contributor Covenant 2.1 (štandard)                                                      |
| **CONTRIBUTING.md**                    | Značka aktivnej open-source správy projektu                                               | sectionsu: setup, conventions, PR process, DCO                                           |
| **SECURITY.md**                        | Coordinated Vulnerability Disclosure (CVD) policy                                         | email + GPG key pre security issues                                                      |
| **CHANGELOG.md**                       | Keep a Changelog formát — čítateľný Conventional Commits commit história                  | už máme Conventional Commits, len doplniť manual changelog                               |
| **Slovak language compliance**         | OPII a OP Slovensko požaduje SK dokumentáciu                                              | už robime v SK                                                                           |
| **Accessibility WCAG 2.1 AA**          | Verejný sektor v EU MUSÍ mať WCAG 2.1 AA (Smernica 2016/2102, zákon 95/2019)              | testovať v slice #4 (apps/web)                                                           |
| **GDPR Article 30 records**            | Záznamy o spracovaní os.údajov                                                            | už máme audit log; doplniť _Purpose Catalogue_ ako sportup.sk                            |
| **Software Bill of Materials (SBOM)**  | EU CRA — Cyber Resilience Act vyžaduje SBOM do 2027                                       | generovať cez `cyclonedx-bom` v CI                                                       |
| **OpenAPI 3.1 specifikatie**           | Požiadavka pre interoperáciu s verejnými systémami                                        | už generérujeme z Zod → JSON Schema, stačí pridať OpenAPI export                         |
| **ISA² / EIF compliance**              | European Interoperability Framework pre cross-border services                             | dokumentácia                                                                             |
| **Vercel deployment v EU regióne**     | GDPR data residency                                                                       | už robime: cdg1 / fra1 region                                                            |
| **Conformity assessment (CE marking)** | CRA + AI Act 2025 — ak by systém mal AI komponenty                                        | aktuálne nemáme AI; keď MCP server pridame AI features, treba assessment                 |

Dodatočné dokumenty (môžu počkať, ale dobre o nich vedieť):

- **DPIA** (Data Protection Impact Assessment) — pred produkciou
- **Threat Model** — STRIDE alebo PASTA
- **Disaster Recovery Plan** — RTO/RPO definície
- **SLA / Operations runbook**

#### A.5.3. Brand identity — prevzatie z sportup.sk

Podla tvojej správy preberieme **národnú identitu sportup.sk** ako základ pre _Inventario_ vizuálny systém. To zároveň pripravuje hladkú budúcu integráciu na sportup.sk.

**Farebná paleta** (z `sportup.sk/website/brand/BRAND.md`):

| Názov | HEX       | RGB         | Použitie v _Inventario_                                 |
| ----- | --------- | ----------- | ------------------------------------------------------- |
| Navy  | `#1A2D47` | 26 45 71    | Primárna — header, sidebar, dark surfaces, body text    |
| Blue  | `#388FC3` | 56 143 195  | Akcent — CTA, linky, active states, asset status badges |
| White | `#FFFFFF` | 255 255 255 | Texty na tmavom pozadí, card surfaces v dark mode       |
| Paper | `#F8F6F1` | 248 246 241 | Teplejšie pozadie stránky (light mode)                  |
| Muted | `#6B7A8D` | 107 122 141 | Sekundárny text, dividers, placeholder text             |

**Typografia:**

- Nadpisy: **Poppins** 700, 800 Italic
- Telo: **Poppins** 400, 500
- Mono (inventárne čísla, kód, QR data): **JetBrains Mono** 400, 500
- Slogan: **Poppins** 700 Italic

**Slogan / motto na heading-i:**

> _"Good Idea Sport Slovakia"_ — prevzaté zo sportup.sk pre národnú identitu, ale s vlastným pod-tagline pre Inventario:
>
> **_Transparentná správa majetku. Bez vendor lock-in. · Powered by SportUp ecosystem._**

**Logo — dočasný plan:**

- Pre prvú session použijeme wordmark _"Inventario"_ v Poppins 800 Italic, navy farba
- Pre väčšie session-y vyrábime samostatný logotyp (kompozit s ikonkou _box / inventory_)
- Finally bude mať vlastný Affinity Designer súbor (`Inventario_logo.af`) podla sportup.sk pattern

**Implementácia v design tokens:**

- Refactor `tokens.json` — vrstvy `primitives` / `semantic` / `brand`
- `brand.default` = SportUp identity (Navy + Blue + Paper)
- `brand.sfz` = SFZ červená+modrá (zachováme súčasné tokens ako reference brand pre demo)
- `brand.tenantX` = každý tenant override-uje

### Fáza B — Design tokens & vizuálny systém (1.5 hodiny)

Cieľ: pripraviť **brand-agnostic design system** ktorý vie každý tenant overridnúť.

1. **Refactor `packages/design-tokens/tokens.json`**
   - Rozdelenie na tri vrstvy:
     - `primitives` — raw color palette, neutrálne škály, base tokens (nezávisí od brand-u)
     - `semantic` — sémantické tokens odkazujúce na primitives (success, warning, danger, info, asset-status)
     - `brand` — branding vrstva odkazujúca na primitives; default = SFZ ako _reference implementation_, ale ľahko nahraditeľná
   - Pridať `radius`, `shadow`, `spacing`, `typography` s rozšírenými scale (xs–4xl, leading, tracking).

2. **Pridať dark mode tokens**
   - Každý semantic token má `light` a `dark` variant.
   - Pripraviť pre OS-level dark mode + tenant preference.

3. **Generátor pre konzumentov**
   - Existujúci `dist/` exportuje TS const. Pridáme:
     - **CSS variables** (`dist/tokens.css`) — pre web app, načítané do `:root`
     - **Tailwind config** (`dist/tailwind-preset.cjs`) — extends pre Tailwind v3/v4
     - **Flutter ThemeData** (`dist/theme.dart`) — pre mobile app
   - Skript `pnpm --filter design-tokens build:all` vygeneruje všetky tri varianty z jedného tokens.json.

4. **Tenant branding mechanizmus**
   - Návrh API: každý tenant má `branding: { primaryColor, secondaryColor, logoUrl, faviconUrl }`.
   - Pri SSR/CSR injekuje CSS variables do `:root` podľa current tenant.

### Fáza C — Design exploration cez Claude (2 hodiny)

Cieľ: vytvoriť **high-fi interactive mockups** pre top screens, ktoré budú slúžiť ako kontrakt pre implementáciu slice #4.

#### C1. Identifikácia top screens

Najprv si dohodneme zoznam. Návrh top 10 obrazoviek pre prvú iteráciu:

| #   | Screen                                        | Persona                   | Priorita |
| --- | --------------------------------------------- | ------------------------- | -------- |
| 1   | Login (multi-tenant)                          | Všetci                    | P0       |
| 2   | Tenant onboarding (signup nového klubu/mesta) | Tenant admin              | P1       |
| 3   | Dashboard (role-aware)                        | Všetci                    | P0       |
| 4   | Assets list + filters + search                | Asset manager, employee   | P0       |
| 5   | Asset detail (s QR, history, edit)            | Asset manager             | P0       |
| 6   | Asset create/edit form                        | Asset manager             | P0       |
| 7   | Categories admin (tree view)                  | Asset manager, admin      | P1       |
| 8   | Locations admin (tree view)                   | Asset manager, admin      | P1       |
| 9   | Loan request form                             | Employee, parent, manager | P0       |
| 10  | Loan approval queue                           | Asset manager             | P0       |
| 11  | My loans (active + history)                   | Všetci                    | P0       |
| 12  | Loan return + protocol (s podpisom)           | Asset manager             | P1       |
| 13  | Users admin                                   | Admin                     | P1       |
| 14  | Audit log viewer                              | Admin                     | P2       |
| 15  | Settings & branding (per-tenant)              | Tenant admin              | P1       |

Pre **zajtrajšiu session** navrhujem urobiť P0 screens (8 obrazoviek) v dvoch variantoch každý.

#### C2. Design exploration workflow

Pre každú obrazovku:

1. **Wireframe round** (5 min): nakreslím v Claude jednoduchý SVG/HTML wireframe ukazujúci layout a hierarchiu. Bez farieb, len boxy a text.
2. **Hi-fi round** (15 min): aplikujem design tokens, vytvorím **interactive React/HTML artifact** v Claude. Plne funkčný — filter, sort, hover stavy, modals.
3. **Iterácia** (5 min): povieš čo ti chýba alebo prekáža; upravím.
4. **Export** (2 min): uložím finálny HTML/JSX do `docs/design/screens/{nazov}.html`.

Pre 8 P0 screens × 25 min = **~3.5 hodiny**. Realisticky urobíme **5–6 screens** v jednej session, zvyšok v ďalšej.

#### C3. Responsive design

Každý mockup ukáže **tri breakpointy** v jednom artefakte:

- **Mobile** — 375px (iPhone SE)
- **Tablet** — 768px (iPad portrait)
- **Desktop** — 1280px (typický laptop)

Použijem CSS container queries / media queries; v Claude artifacte vieš preklikávať medzi viewportami.

#### C4. Mobile-first principle

Vychádzam z mobile design (375px), potom rozširujem na desktop. Dôvody:

- **Šport tréneri a rodičia budú primárne mobile** pri preberacích/vratných situáciách
- **QR sken funguje len cez mobile kameru** → mobile musí byť first-class, nie afterthought
- **Komunálni a podnikoví admini budú primárne desktop** — pre nich je rozšírenie z mobile dizajnu prirodzené (viac priestoru, sidebar, multi-column)

#### C5. Flutter compatibility check

Pred finalizáciou každého mockup-u skontrolujem, či sa dá natívne implementovať vo Flutteri:

- **Áno**: štandardné komponenty (Card, ListView, BottomSheet, Drawer, FormField, Chip, Badge)
- **Áno s alternatívou**: hover stavy (na mobile nie sú; používať tap states)
- **Nie**: niektoré complex CSS efekty (backdrop-filter blur, conic gradients) — vyhneme sa im

---

## 3. Deliverables po zajtrajšej session

| #   | Deliverable                                                          | Lokácia                                                          |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | ADR-0002 Multi-tenant white-label                                    | `docs/decisions/0002-multi-tenant-white-label.md`                |
| 2   | ADR-0003 Open-source licensing (EUPL + REUSE)                        | `docs/decisions/0003-licensing-eupl-reuse.md`                    |
| 3   | Refaktorovaný `functional-spec.md` (Inventario brand)                | `docs/functional-spec.md`                                        |
| 4   | LICENSE + LICENSE-DOCS + LICENSES/ súbory                            | repo root + `LICENSES/`                                          |
| 5   | REUSE.toml s plným mapovaním + REUSE lint passing                    | repo root                                                        |
| 6   | CITATION.cff, CODE_OF_CONDUCT.md, CONTRIBUTING.md, SECURITY.md       | repo root                                                        |
| 7   | Refactored design tokens (primitives/semantic/brand, SportUp paleta) | `packages/design-tokens/tokens.json`                             |
| 8   | Multi-platform token exports                                         | `dist/tokens.css`, `dist/tailwind-preset.cjs`, `dist/theme.dart` |
| 9   | Top 5–6 P0 screens — interactive mockups (Poppins + SportUp brand)   | `docs/design/screens/*.html`                                     |
| 10  | Design system overview                                               | `docs/design/README.md`                                          |
| 11  | Brand assets adoptované z sportup.sk (dočasne)                       | `apps/web/public/brand/` (až v slice #4)                         |
| 12  | Slice #3.5 milestone doc                                             | `docs/milestones/slice-3-5-design-pivot.md`                      |
| 13  | README.md s EUPL + REUSE badge-mi a Inventario branding              | repo root                                                        |

---

## 4. Prezentačné výstupy (pre teba ako "ukážka procesu")

Toto je dôležitá vrstva, lebo budeš prezentovať ako sme s Claude pracovali.

### 4.1 Walkthrough video / screencast

Počas session si rob krátke (30–60 s) screen recordings na kľúčové momenty:

- Generovanie wireframu z prázdnej obrazovky
- Iterácia mockup-u na základe feedback-u
- Switch medzi mobile/desktop view v rovnakom artifacte
- Vygenerovanie Flutter ThemeData z tokens.json

Tieto klipy potom použiješ v prezentácii.

### 4.2 "Before & After" porovnania

Pre kľúčové rozhodnutia (napr. wireframe → hi-fi mockup; SFZ-only tokens → multi-tenant tokens) ulož **snapshot pred a po**. V prezentácii to ukáže **rýchlosť iterácie**.

### 4.3 Štruktúrovaný príbeh pre prezentáciu

Navrhujem 5-aktovú štruktúru:

1. **Akt 1: Problém** — fragmentovaná evidencia majetku v SFZ a iných organizáciách
2. **Akt 2: Rozhodnutie pivot na platformu** — z SFZ-only na multi-tenant white-label
3. **Akt 3: Design-first workflow** — ako sme s Claude generovali mockupy ešte pred prvým React komponentom
4. **Akt 4: Implementačná rýchlosť** — backend (slice 1–3) postavený za X dní s 257 testami a CI
5. **Akt 5: Vízia** — integrácia na sportup.sk, použiteľnosť pre mestá, VÚC, kluby

### 4.4 Metriky do prezentácie

Connectionm dnešnej session už máme čísla, ktoré sa pekne prezentujú:

- **257 integration testov** beží proti reálnej Atlas DB každý PR
- **16 test files** pokrývajú backend od auth po FK protection
- **~158 sekúnd** lokálna test duration (CI ~5–6 min)
- **5 funkčných modulov** (auth, audit, assets, categories, locations) + 1 in progress (users)
- **2 utility libraries** napísané od základov (slugify, hierarchy validation)
- **0 production incidents** (lebo ešte nie sme v produkcii, ale dáta a auth už sú solídne)

---

## 5. Príprava na zajtra — čo si nachystaj

### 5.1 Vizuálne materiály

- Logo SFZ vo vektorovej forme (SVG ideálne) — budem ho používať ako _reference branding_ v mockupoch
- 2–3 príklady ako vyzerá iná organizácia, na ktorú projekt cieliš (mesto Bratislava, hokejový zväz, lokálny klub) — ich logá a farby ak ich máš
- Screenshot z platformy sportup.sk (alebo URL) — aby som vedel jej design language pre budúcu konzistenciu

### 5.2 Obsahové rozhodnutia

Pripravím sa odpovedať na tieto otázky, ale ak chceš môžeš sa nad nimi vopred zamyslieť:

1. **Name** — chceš vybrať teraz, alebo to necháme ako "kódové meno" zatiaľ?
2. **Domain** — chceš si zaregistrovať doménu? Skontroluj `.sk` aj `.io`.
3. **Open source?** — bude projekt open source na GitHube alebo proprietary? Toto ovplyvňuje licenciu, README, contributing guide.
4. **Pricing model** — keď budeš ponúkať platformu iným organizáciám: free tier? Per-tenant subscription? Per-user?
5. **Hosting** — bude každý tenant zdieľať jednu DB alebo separátne DB per tenant?

### 5.3 Technické rozhodnutia (môžu počkať)

Tieto nemusia byť zajtra rozhodnuté, ale postavíme infraštruktúru tak aby to neblokovalo neskoršie rozhodnutia:

- Single-tenant vs multi-tenant DB (Mongo Atlas Flex tier vs dedicated cluster per tenant)
- White-label deployment (custom domain per tenant — `assets.bratislava.sk`, `assets.sfz.sk`)
- Theming engine (CSS variables vs Tailwind theme runtime vs CSS-in-JS)

---

## 6. Po-session todo (presúvame z dnes)

- ✅ K9 delete protection commit-nutý a CI zelený
- ⏳ **K10 Users admin module** — odložené, urobíme po design session
  - Logické miesto: po design fáze, lebo Users module má vlastný UI screen (Users admin) ktorý dostaneme z mockupu
- ⏳ **K11 Slice #3 milestone doc** — po K10

---

## 7. Potenciálne riziká a mitigácie

| Riziko                                                 | Pravdepodobnosť | Dopad                                          | Mitigácia                                                                               |
| ------------------------------------------------------ | --------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| Design exploration trvá dlhšie ako 2h                  | Stredná         | Nestihneme všetky P0 screens                   | Fixne 25 min per screen; ak prekračuje, parkuj a presunieme                             |
| Nezhoda na project name                                | Vysoká          | Pokračujeme s code name "SFZ Asset Management" | Zhodneme sa že to nie je blokátor; rename v ľubovoľnom čase                             |
| Tenant branding API návrh kompletne mení backend       | Nízka           | Refactor existujúcich modulov                  | Návrh je read-only `organisationId` field; existujúce moduly len pridajú scoping filter |
| Flutter dev efekt — niektoré web mockups nepôjdu 1:1   | Stredná         | Nutné variabilne navrhnuté Flutter screens     | C5 check pri každom mockup-e; alternative patterns dokumentujeme                        |
| Vizuálna kvalita mockup-ov nedosiahne tvoje očakávania | Nízka–stredná   | Demotivácia                                    | Po prvom screen-e zhodnotíme; iterujem až do "OK" predtým ako ideme ďalej               |

---

## 8. Otvorené otázky pre zajtra

Toto sú veci, ktoré chcem prediskutovať na začiatku session-y predtým ako sa pustíme do roboty:

1. **Project naming** — vybrať alebo odložiť?
2. **Multi-tenancy DB stratégia** — shared cluster s `organisationId` field, alebo DB-per-tenant?
3. **Top screens priorita** — súhlasíš so zoznamom v sekcii C1, alebo upraviť?
4. **Branding pre prezentáciu** — chceš aby som v mockupoch ukázal default branding (neutrálne modré) alebo zostal pri SFZ pre demo continuity?
5. **Doložená responsivita** — chceš sa pri mockupoch sústrediť mobile-first, alebo desktop-first?
6. **Demo data** — pre mockupy potrebujem fiktívne dáta. Mám použiť SFZ-like (dresy, lopty, notebooky) alebo viac mix (mestský mobiliár, klubové vybavenie, IT)?

---

## 8. Rozhodnutia z 14. máj večer (✅ potvrdené)

Nasledujúce rozhodnutia boli odsúhlasené 14. máj 2026 (21:45). Slúžia ako fixné vstupy pre zajtrajšiu session.

| #   | Rozhodnutie                                               | Hodnota                                                                                                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Code name projektu**                                    | ✅ **_Inventario_** — používaný do prezentácie. Finálny brand neskôr po user testingu.                                                                                                                                                                                                                                |
| 2   | **Multi-tenancy stratégia**                               | ✅ **Shared Atlas cluster + `organisationId` field** na všetkých kolekciách (logical multi-tenancy). Veľké organizácie s vlastnými GDPR/compliance požiadavkami si môžu **forkovať open-source** a hostiť vlastnú inštanciu. Žiadny `database: string` field nepotrebujeme — fork je jednoduchší aj transparentnejší. |
| 3   | **Top screens P0 (zajtra)**                               | ✅ **6 obrazoviek**: Login (multi-tenant) · Dashboard (role-aware) · Assets list + filters · Asset detail · Loan request form · **My loans (user-first priorita!)**. P1 a P2 v ďalších session-ách.                                                                                                                   |
| 4   | **Branding pre demo**                                     | ✅ **Neutrálna default modrá** (`#2563eb`). Tenant switcher v top-right ako _demo control_ — ukazuje magic moment „mesto Pezinok → ŠK Inter → škola Kremnica".                                                                                                                                                        |
| 5   | **Mobile-first proces, desktop-rovnocenná implementácia** | ✅ Začíname v 375px viewporte, rozširujeme do tablet (768px) a desktop (1280px). Žiadny screen nie je _mobile-only_ ani _desktop-only_ (okrem QR skenu).                                                                                                                                                              |
| 6   | **Demo data**                                             | ✅ Tri mix tenanti: **ŠK Inter Bratislava** (klub) + **Mesto Pezinok** (samospráva) + **Stredná škola Kremnica** (škola). SFZ ako historical footnote v prezentácii.                                                                                                                                                  |

### Open source & fork stratégia (implikácia rozhodnutia #2)

Projekt bude v budúcnosti **open source** s permissive licenciou (Apache 2.0 alebo MIT — rozhodneme zajtra vo Fáze A). Toto má niekoľko dôsledkov:

- **Tenant isolation cez `organisationId`** zostáva primárny mechanizmus pre väčšinu zákazníkov (kluby, malé obce, školy)
- **Veľké organizácie** (SFZ, krajské mestá, ministerstvá) s tvrdými GDPR/compliance požiadavkami → **fork repo + self-host** = vlastná DB, vlastná infraštruktúra, vlastné upgrades
- **Code quality** musí byť "public-facing" od začiatku — čistý kód, dobrá dokumentácia, README s onboarding
- **CONTRIBUTING.md a CODE_OF_CONDUCT.md** budú potrebné keď spravíme repo public
- **Licencia footer** v UI: "Powered by Inventario · open source" (linkuje na GitHub)
- **Hosted SaaS** verzia (na inventario.sk alebo podobne) bude jednou z deployment opcií — popri self-hosting a fork-hostingu

Táto stratégia je **konkurenčná výhoda v prezentácii**:

- _"Nepotrebujete dôverovať dodávateľovi — kód je verejný, audit-ovateľný, forkovateľný"_
- _"SFZ môže pokračovať s touto codebase aj keď partnerská spolupráca skončí"_
- _"Mestá a VÚC majú istotu vendor lock-in nezávislosti"_

### Demo tenant detaily

**Tenant A — ŠK Inter Bratislava (klub):**

- Assets: dresy 40 ks, lopty 15 ks, kužele, notebooky pre trénerov 3 ks, kamera, dron
- Personas: tréner A1, manažér klubu, rodič preberajúci dres dieťaťu
- Locations: kabíny, sklad športového vybavenia, klubovňa

**Tenant B — Mesto Pezinok (samospráva):**

- Assets: služobné notebooky 25 ks, projektory 5 ks, mobiliár (lavičky, koše), motorové vozidlá 3 ks, kosačky
- Personas: starosta, vedúci útvaru, technický zamestnanec
- Locations: mestský úrad, technické služby, kultúrny dom

**Tenant C — Stredná škola Kremnica (škola):**

- Assets: laptopy 40 ks, tablety 25 ks, športové vybavenie, hudobné nástroje, učebné pomôcky
- Personas: riaditeľ, učiteľ IKT, žiak (parent proxy pre podpis)
- Locations: učebne, telocvičňa, kabinet IT

---

## 9. Záver

Zajtrajšia session je **strategicky najdôležitejšia v celom projekte zatiaľ**. Mení projekt z interného SFZ nástroja na platformu s potenciálom rastu. Backend, ktorý sme dnes dokončili, je už dostatočne flexibilný (žiadne SFZ-špecifické pole, len konfigurácia kategórií); ostáva to len zafixovať v dokumentácii a postaviť na to **vizuálny systém ktorý každý tenant cíti ako vlastný**.

Doba prípravy mockup-ov je dobre investovaná: každý screen, ktorý zajtra spolu vytvoríme, ušetrí 2–4 hodiny iteratívneho codovania v slice #4 (frontend bootstrap), pretože budeme mať jasný cieľ kam smerovať.

Tešíme sa na zajtra. Naozaj výborná práca dnes.

— Ján a Claude, 14. máj 2026 (21:30)

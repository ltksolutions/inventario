<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Inventario

[![License: EUPL-1.2](https://img.shields.io/badge/License-EUPL--1.2-blue.svg)](LICENSE)
[![Docs: CC-BY-4.0](https://img.shields.io/badge/Docs-CC--BY--4.0-lightgrey.svg)](LICENSE-DOCS)
[![REUSE status](https://api.reuse.software/badge/github.com/ltksolutions/inventario)](https://api.reuse.software/info/github.com/ltksolutions/inventario)
[![Status](https://img.shields.io/badge/status-foundation--ready-orange)](<>)
[![Tests](https://img.shields.io/badge/tests-962%20passing-brightgreen.svg)](<>)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://conventionalcommits.org)
[![Code of Conduct](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)
[![Slovak](https://img.shields.io/badge/Lang-Slovak-blue.svg)](<>)

> **_Transparentná správa majetku. Bez vendor lock-in._**
>
> Otvorená platforma pre evidenciu a vypožičiavanie majetku — pre športové zväzy, mestá a obce, VÚC, kluby, školy, neziskové organizácie a každého, kto potrebuje vedieť kde čo má a kto si to vzal.

|                           |                                                                            |
| ------------------------- | -------------------------------------------------------------------------- |
| **Status**                | 🟢 Foundation ready · launch-ready 90%                                     |
| **Verzia**                | 0.3 (predfáza beta)                                                        |
| **Posledná aktualizácia** | máj 2026                                                                   |
| **Licencia (kód)**        | [EUPL-1.2](LICENSE) — European Union Public Licence                        |
| **Licencia (docs)**       | [CC-BY-4.0](LICENSE-DOCS) — Creative Commons                               |
| **REUSE compliance**      | [REUSE 3.3](https://reuse.software/spec/)                                  |
| **Ekosystém**             | Powered by [SportUp](https://github.com/ltksolutions/sportup.sk) ecosystem |

---

## O projekte

**Inventario** je otvorená platforma pre evidenciu a vypožičiavanie majetku. Pomáha organizáciám vedieť **kde čo majú**, **kto si to vzal**, **kedy to vráti** a **akou cestou to prešlo**.

Vznikol v **LTK Solutions, s.r.o.** ako riešenie pre evidenciu majetku v športových organizáciách, mestách a obciach, školách a neziskových organizáciách — všade tam, kde **rovnaký problém riešia všetci**: kde čo je a kto to má. Otvorili sme ho ako open-source pod **EUPL-1.2** licenciou — aby z neho mohli profitovať všetci, nielen jeden zadávateľ.

**Nie je to účtovný systém.** Inventario je evidenčný a workflow nástroj. Neslúži na odpisy, fakturáciu ani účtovné súvzťažnosti. Slúži na to aby každá organizácia presne vedela kde má svoj majetok a v akom je stave.

### Kľúčové princípy

1. **Multi-tenant od základu** — jedna inštancia, mnoho organizácií. Každá má svoj priestor, svoje farby, svoje workflow.
2. **White-label** — žiadne značky tretích strán. Mesto Pezinok vidí "Mesto Pezinok"; športový zväz vidí svoju identitu; klub vidí svoju klubovú identitu.
3. **Transparentné a auditovateľné** — open-source kód, REUSE compliance, audit log každej zmeny.
4. **Bez vendor lock-in** — veľké organizácie si môžu kód forkovať a hostiť vlastnú inštanciu (EUPL-1.2 to plne umožňuje).
5. **Pripravené pre EU verejný sektor** — EUPL licencia, REUSE, GDPR audit log, plánovaná WCAG 2.1 AA, SBOM, OpenAPI 3.1.
6. **API-first** — webové rozhranie, mobilná aplikácia a MCP server pre AI sú konzumenti rovnakého REST API.

### Pre koho

| Typ organizácie                | Príklady použitia                                                       |
| ------------------------------ | ----------------------------------------------------------------------- |
| **Športové zväzy**             | Reprezentačné vybavenie, kamerová technika, dresy, transport            |
| **Športové kluby**             | Tréningové pomôcky, dresy, výstroj mládeže                              |
| **Mestá a obce**               | Mobiliár, služobné notebooky, vozidlá, kosačky, kultúrne podujatia      |
| **VÚC**                        | Krajský majetok rozprestrený po stovkách obcí, IT, výstavnícka technika |
| **Školy a školské zariadenia** | IT vybavenie, učebné pomôcky, športové potreby, hudobné nástroje        |
| **Neziskové organizácie**      | Vybavenie pre projekty, podujatia, výpožičky členom                     |

### Kľúčové vlastnosti

- 📦 Evidencia ľubovoľného majetku s flexibilným dátovým modelom
- 🏷️ QR kódy a čiarové kódy pre rýchlu fyzickú identifikáciu
- 🔄 Workflow vypožičania, predĺženia a vrátenia s elektronickými protokolmi
- ✍️ Digitálne podpisy preberacích a vratných protokolov
- 📜 Plná história pohybov a kompletný audit log
- 🔐 Multi-provider auth — Microsoft Entra ID, Google, Apple (plán) + email/heslo
- 👥 Multi-tenant s per-tenant brandingom (logo, farby, slogan)
- 🌐 Otvorené REST API (OpenAPI 3.1)
- 📱 Mobile-first web app + budúca natívna Flutter aplikácia
- 🤖 MCP server pre AI asistentov (vyhľadávanie, schvaľovanie, reporty cez prirodzený jazyk)

---

## Prečo EUPL a open-source

| Aspekt                 | Argument                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Transparentnosť**    | Kód je verejný — každá organizácia môže auditovať čo systém robí s jej dátami                              |
| **Bez vendor lock-in** | Akýkoľvek subjekt si môže projekt forkovať a hostovať vlastnú inštanciu                                    |
| **EU verejný sektor**  | EUPL-1.2 je licencia vytvorená Európskou komisiou, právne ekvivalentná v 23 jazykoch EÚ vrátane slovenčiny |
| **Audit a bezpečnosť** | Komunita môže odhaliť bezpečnostné slabiny rýchlejšie ako jediný dodávateľ                                 |
| **Udržateľnosť**       | Ani jeden subjekt nemôže projekt "vypnúť" — ostáva dostupný komunite                                       |
| **Kompatibilita**      | EUPL je kompatibilný s GPL, AGPL, MPL a ďalšími open-source licenciami                                     |
| **EU fondy**           | Splnené podmienky pre OPII, OP Slovensko, Digital Europe Programme, Horizon Europe                         |

---

## Technologický stack

| Vrstva             | Technológia                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------- |
| **Backend**        | Node.js 20+, Fastify, TypeScript, Zod                                                        |
| **Frontend (web)** | React, TypeScript, Vite, Tailwind CSS, shadcn/ui (mobile-first)                              |
| **Mobile (plán)**  | Flutter (fáza 4, zdieľané design tokens)                                                     |
| **Databáza**       | MongoDB Atlas + Native driver + Zod ([ADR-0005](docs/decisions/0005-mongo-native-driver.md)) |
| **Autentifikácia** | Inventario JWT (RS256, cookie-based) + OAuth (Google, Microsoft, Apple plán) + email/heslo   |
| **MCP server**     | Node.js, `@modelcontextprotocol/sdk`                                                         |
| **Monorepo**       | pnpm workspaces + Turborepo                                                                  |
| **CI/CD**          | GitHub Actions + Vercel                                                                      |
| **Hosting**        | Vercel (EU región: cdg1/fra1) — alebo self-host cez fork                                     |
| **Brand & dizajn** | [SportUp design system](https://github.com/ltksolutions/sportup.sk) (Navy, Blue, Poppins)    |

---

## Štruktúra repa

```
Inventario/
├── apps/
│   ├── api/                  # ✅ Fastify backend (REST API, RBAC, audit, FK protection)
│   ├── web/                  # ✅ Next.js webová aplikácia (mobile-first)
│   ├── mcp-server/           # 📅 MCP server pre AI integrácie
│   └── mobile/               # 📅 Flutter aplikácia (fáza 4)
├── packages/
│   ├── shared-types/         # ✅ Zod schémy + TS typy + JSON Schema generátor
│   ├── design-tokens/        # ✅ Multi-vrstvový token systém (primitives/semantic/brand)
│   ├── api-client/           # 📅 Vygenerovaný TS klient z OpenAPI
│   ├── ui/                   # 📅 Zdieľané React komponenty
│   └── config/               # 📅 ESLint, TSConfig, Prettier presety
├── docs/
│   ├── functional-spec.md    # ✅ Funkčná špecifikácia
│   ├── architecture/         # ✅ Dátový model, MCP server spec
│   ├── api/                  # ✅ OpenAPI 3.1
│   ├── decisions/            # ✅ Architecture Decision Records (30+)
│   ├── user-guide/           # ✅ Používateľská príručka (getting-started, how-to, reference)
│   ├── milestones/           # ✅ Slice-by-slice milestone docs
│   ├── sessions/             # ✅ Session plány + denné súhrny (NEXT.md = aktuálny stav)
│   ├── compliance/           # ✅ GDPR, DPA, ROPA, DPIA, retencia, sub-processors
│   └── marketing-site/       # ✅ inventario.estate (static HTML) + /screenshots
├── infra/
│   ├── docker-compose.yml    # ✅ Lokálna Mongo + MailHog + MinIO
│   └── vercel/               # ✅ Deployment docs pre Vercel
├── LICENSES/                 # ✅ Plné texty licencií (EUPL-1.2, CC-BY-4.0)
├── REUSE.toml                # ✅ Centrálne licenčné mapovanie
├── CITATION.cff              # ✅ Citačné metadata
├── LICENSE                   # ✅ EUPL-1.2 (kód)
├── LICENSE-DOCS              # ✅ CC-BY-4.0 (dokumentácia)
└── .github/                  # ✅ CI/CD, issue/PR templates, CODEOWNERS
```

Legenda: ✅ hotové · 🟡 v progrese · 📅 plánované

---

## Aktuálny stav

**Backend (apps/api):** 962 testov passing, launch-ready 90%, čaká na právny review.

Detaily v [`docs/milestones/`](docs/milestones/) a [`docs/sessions/NEXT.md`](docs/sessions/NEXT.md).

---

## Dokumentácia

### Pre používateľov

📖 **[Používateľská príručka](docs/user-guide/)** — onboarding tutoriály, how-to návody, reálne scenáre, slovník pojmov. Tykáme čitateľovi, písané prirodzene v slovenčine.

### Pre vývojárov a integrátorov

| Dokument                                                 | Popis                                            |
| -------------------------------------------------------- | ------------------------------------------------ |
| [Funkčná špecifikácia](docs/functional-spec.md)          | Čo systém robí (moduly, roly, user stories)      |
| [CLAUDE.md](CLAUDE.md)                                   | Konvencie repa (aj pre ľudí, nielen pre Claude)  |
| [ARCHITECTURE.md](ARCHITECTURE.md)                       | Mapa kódu — moduly, dátové toky, hranice balíkov |
| [RUNBOOK.md](RUNBOOK.md)                                 | Deploy, rollback, cron joby, incidenty           |
| [Architektúra](docs/architecture/README.md)              | Architektonický prehľad, C4 diagramy             |
| [Dátový model](docs/architecture/data-model.md)          | MongoDB kolekcie a vzťahy                        |
| [API špecifikácia](docs/api/openapi.yaml)                | OpenAPI 3.1                                      |
| [MCP server](docs/architecture/mcp-server.md)            | Špecifikácia MCP integrácie                      |
| [ADR](docs/decisions/README.md)                          | Architecture Decision Records (37×)              |
| [Milestones](docs/milestones/)                           | Slice-by-slice progress documentation            |
| [shared-types README](packages/shared-types/README.md)   | Single source of truth pre dátový model          |
| [design-tokens README](packages/design-tokens/README.md) | Multi-vrstvový token systém                      |

---

## Lokálny vývoj

### Predpoklady

- **Node.js** `20.11.0` (riadi `.nvmrc`)
- **pnpm** `9.12.0+`
- **Docker + Docker Compose** (pre lokálnu Mongo, MinIO, MailHog)
- **VS Code** (odporúčané — automaticky ti ponúkne potrebné rozšírenia)

### Spustenie

```bash
# 1. Klonuj repo a nainštaluj závislosti
git clone https://github.com/ltksolutions/inventario.git
cd inventario
pnpm install

# 2. Nakopíruj environment template
cp .env.example .env
# (uprav podľa potreby — predvolené hodnoty sú pre lokálny dev OK)

# 3. Spusti lokálnu infraštruktúru
docker compose -f infra/docker-compose.yml up -d
#   → MongoDB na :27017
#   → Mongo Express UI na http://localhost:8081
#   → MailHog UI na http://localhost:8025
#   → MinIO Console na http://localhost:9001

# 4. Build packages
pnpm build

# 5. Spustenie testov
pnpm test

# 6. Spustenie API dev servera
pnpm --filter @inventario/api dev
#   → API na http://localhost:3000
#   → Swagger UI na http://localhost:3000/docs
```

Detaily o lokálnej infraštruktúre v [`infra/README.md`](infra/README.md).

### REUSE validácia

Projekt udržuje **REUSE 3.3 compliance** — každý súbor má jednoznačnú licenčnú a copyright metadata. Validácia:

```bash
# Inštalácia REUSE toolu (raz)
pip install reuse

# Validácia
reuse lint
```

CI automaticky overuje REUSE compliance pri každom PR.

---

## Self-hosting a fork

Pre organizácie ktoré potrebujú **plnú kontrolu** nad svojou inštanciou (GDPR, compliance, suverenita dát):

1. **Fork** tento repozitár na vlastný GitHub account / GitLab inštanciu
2. **Konfiguruj** vlastný OAuth provider alebo email/heslo flow
3. **Deploy** na vlastnú infraštruktúru (Vercel, Azure, Hetzner, AWS, on-premise)
4. **Customizuj** branding cez design tokens
5. **Synchronizuj** zmeny z upstream cez Git remote

EUPL-1.2 licencia toto **explicitne umožňuje** — jediná podmienka je zachovanie licencie a copyright noticov v odvodených dielach.

Detaily v [SELF-HOSTING.md](docs/self-hosting.md) (TBD).

---

## Ako prispieť

Vítame príspevky! Či už ide o opravu typu v dokumentácii, návrh novej funkcionality alebo refaktoring kódu — sme radi za každý PR.

- 📖 Prečítaj si [CONTRIBUTING.md](CONTRIBUTING.md) — workflow, conventional commits, code review pravidlá
- 📋 [Kódex správania](CODE_OF_CONDUCT.md) — Contributor Covenant 2.1
- 🐛 [Nahlás bug](../../issues/new?template=bug_report.yml)
- 💡 [Navrhni funkcionalitu](../../issues/new?template=feature_request.yml)
- 🛡️ [Bezpečnostné hlásenia](SECURITY.md) — pre zraniteľnosti použite Security Advisories, nie verejné issues

### Dobré first issues

Hľadáte spôsob ako začať? Pozrite si [issues s label `good first issue`](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).

### Developer Certificate of Origin (DCO)

Príspevky musia byť podpísané cez `git commit -s` (DCO sign-off). Detaily v [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Licencie

Inventario používa **dual licensing model** v súlade s odporúčaniami Európskej komisie a štandardami REUSE:

| Obsah                                   | Licencia                  | Detaily                                                      |
| --------------------------------------- | ------------------------- | ------------------------------------------------------------ |
| **Zdrojový kód** (`apps/`, `packages/`) | [EUPL-1.2](LICENSE)       | European Union Public Licence — kompatibilná s GPL/AGPL/MPL  |
| **Dokumentácia** (`docs/`)              | [CC-BY-4.0](LICENSE-DOCS) | Creative Commons Attribution — voľne použiteľná s atribúciou |
| **Brand assets sportup.sk**             | CC-BY-4.0                 | Logá a vizuálne prvky SportUp ekosystému                     |

### Brand assets

Inventario používa vizuálnu identitu **[SportUp — Good Idea Sport Slovakia](https://github.com/ltksolutions/sportup.sk)** ako _default tenant branding_. Ak forkujete projekt pre vlastnú organizáciu:

- ✅ **SportUp brand assets môžete použiť** ak ostávate v _SportUp ekosystéme_ (kluby, zväzy, slovenské športové organizácie sa odporúča používať pre vizuálnu jednotnosť)
- ⚠️ **Pre nezávislé inštancie** si vytvorte vlastnú vizuálnu identitu cez design tokens (`packages/design-tokens/`)
- 🚫 **Loga konkrétnych organizácií** nie sú súčasťou Inventaria — sú vlastníctvom príslušných organizácií

📘 **Detailný brand guide pre developerov a designerov nájdete v [`BRAND.md`](BRAND.md)** — obsahuje použitie loga, farebnú paletu, typografiu, brand pattern, copywriting tonalitu a pravidlá pre forks & derivatives.

### Citácia

Ak používate Inventario vo svojej práci alebo publikácii, prosím citujte ho cez metadata v [CITATION.cff](CITATION.cff). GitHub vám automaticky zobrazí "Cite this repository" tlačidlo.

---

## Ekosystém

Inventario je súčasť **[SportUp ekosystému](https://sportup.sk)** — otvorenej infraštruktúry pre slovenský šport a verejný sektor. Plánované integrácie:

| Komponent                                                    | Status        | Popis                                                    |
| ------------------------------------------------------------ | ------------- | -------------------------------------------------------- |
| **[SportUp.sk](https://github.com/ltksolutions/sportup.sk)** | 📅 v príprave | Národný register osôb, organizácií, aktivít a športovísk |
| **SportUp Identity**                                         | 📅 plánované  | SSO federácia pre celý ekosystém                         |
| **MCP servery**                                              | 📅 plánované  | AI tooling pre celý ekosystém                            |
| **RPO / RFO**                                                | 📅 cez ÚPVS   | Štátne registre osôb a organizácií                       |

Inventario **funguje samostatne** — integrácia na SportUp je voliteľná a postupná.

---

## Founding contributors

Medzi prvých _founding contributors_ Inventaria patrí **Slovenský futbalový zväz** ako jeden z prvých používateľov platformy.

---

## Kontakty

| Rola           | Osoba                                     | Kontakt                                                     |
| -------------- | ----------------------------------------- | ----------------------------------------------------------- |
| **Maintainer** | Ján Letko / LTK Solutions                 | [inventario@ltk.solutions](mailto:inventario@ltk.solutions) |
| **Ecosystem**  | SportUp — Good Idea Sport Slovakia        | [sportup.sk](https://sportup.sk)                            |
| **Partner**    | Vinonichta — gastronomický a wine partner | [jakub@vinonichta.sk](mailto:jakub@vinonichta.sk)           |
| **Security**   | _viď [SECURITY.md](SECURITY.md)_          | Coordinated Vulnerability Disclosure                        |

---

## Poďakovanie

Inventario by nevznikol bez:

- **LTK Solutions** — vyvinula a otvorila Inventario komunite pod EUPL-1.2
- **Slovenského futbalového zväzu** — prvý founding contributor a early adopter platformy
- **SportUp ekosystému** — vizuálna identita, design language a budúca platformová integrácia
- **Vinonichta** — gastronomický a wine partner, ktorý drží morálku pri večerných strategických session-ách 🍷
- **Open-source komunity** okolo Fastify, MongoDB, React, Tailwind, Vitest, Zod a Model Context Protocol
- **Európskej komisie** — za EUPL-1.2 licenciu a podporu open-source vo verejnom sektore

Brand a vizuál: **SportUp Design Manual v2.0** (2026) — odvodený od národnej značky "Good Idea Sport Slovakia".

---

**Inventario** · _Transparent asset management. No vendor lock-in._
Powered by [SportUp](https://sportup.sk) ecosystem · Licensed under [EUPL-1.2](LICENSE)

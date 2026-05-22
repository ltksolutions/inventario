<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session Summary — 22. máj 2026

> **Typ session:** Ops + compliance + repo cleanup
> **Dĺžka:** ~5 hodín (3 session-y v tom istom dni)
> **Status:** ✅ Completed
> **Partneri:** Ján Letko (LTK Solutions) + Claude Sonnet 4.6 / Opus 4.7

---

## TL;DR

Tri bloky práce: (A) doménová migrácia `inventario.estate` a GitHub rename (z predchádzajúceho chatu), (B) produkčné env vars + sub-processors stránka, (C) plná SFZ naratívna migrácia — Inventario je teraz framing-om LTK Solutions produkt, SFZ je jeden z founding contributors.

---

## Čo sme spravili

### A. Doménová migrácia (z predchádzajúceho chatu, commit pushnutý)

Kompletná migrácia `inventario.sportup.sk` → `inventario.estate` a GitHub docs na `ltksolutions/inventario` v ~35 súboroch. Commit `docs: migrate inventario.sportup.sk → inventario.estate, ltksolutions/inventario`.

Podrobnosti v [`2026-05-22-domain-rename.md`](2026-05-22-domain-rename.md).

### B. Produkčné env vars + sub-processors stránka

**Vercel `inventario-api` — nové env vars:**

| Variable                    | Akcia                                        |
| --------------------------- | -------------------------------------------- |
| `CORS_ORIGINS`              | Update na `https://app.inventario.estate`    |
| `MFA_SECRET_ENCRYPTION_KEY` | Added (64-hex, AES-256-GCM pre TOTP secrets) |
| `ECOMAIL_API_KEY`           | Added (ltksolutions account)                 |
| `EMAIL_PROVIDER`            | `ecomail`                                    |
| `EMAIL_FROM_ADDRESS`        | `noreply@inventario.estate`                  |
| `EMAIL_FROM_NAME`           | `Inventario`                                 |

Health check po redeploy: `{"status":"ok","uptime":5.54}` ✅

**Sub-processors verejná stránka:**

- Vytvorená `docs/marketing-site/sub-processors.html` — GDPR čl. 28 register
- 6 aktívnych sub-processorov (Vercel, MongoDB, Ecomail, Microsoft, Google, Apple plánované)
- 1 voliteľný (Resend), 3 mimo rozsahu (Anthropic, GitHub, Google Fonts)
- Footer v `shared.js` rozšírený o "Právne → Sub-procesori (GDPR)" link
- `docs/compliance/legal/sub-processors.md` — dátum publikácie 2026-05-22

Commit: `feat(marketing): add sub-processors public page`

### C. SFZ naratívna migrácia

Rozhodnutie: Inventario vzniklo v **LTK Solutions** ako multi-tenant platforma pre evidenciu majetku v športových organizáciách, mestách, školách a neziskovom sektore. SFZ je **prvý founding contributor** — nie pôvodný zadávateľ v centre príbehu.

**Phase A — strategická narrative (~8 súborov):**

| Súbor                                             | Čo sa zmenilo                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| `README.md`                                       | Full rewrite origin story, SFZ → founding contributor, testy 257→962    |
| `docs/marketing-site/about.html`                  | Rewrite Príbeh section, Timeline, team card                             |
| `docs/sessions/NEXT.md`                           | Drop SFZ-side blockers, mark env vars + sub-processors done             |
| `BRAND.md`                                        | "post-pivot" → "otvorenie pod EUPL-1.2"                                 |
| `ROADMAP.md`                                      | "post-pivot" preč, SFZ tenant → "founding contributors", test count     |
| `docs/decisions/0010-multi-tenant-white-label.md` | Kontext reframed (LTK Solutions design decision, nie SFZ internal tool) |
| `CHANGELOG.md`                                    | "Strategický pivot z SFZ" → "Verejný open-source release"               |
| `apps/api/.env.example`                           | Header "SFZ Asset Management" → "Inventario"                            |

Commit: `docs: reframe project origin narrative — LTK Solutions as creator, SFZ as founding contributor`

**Phase B — config + code (~3 súbory):**

| Súbor                            | Čo sa zmenilo                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `apps/api/.env.example`          | MONGO_URI user `sfz-api`→`inventario-api`, DB `sfz_asset_management`→`inventario`, Entra comment |
| `apps/api/src/plugins/config.ts` | `MONGO_DB_NAME` default: `sfz_asset_management`→`inventario`                                     |
| `.github/workflows/ci.yml`       | Drop `sfz-asset-mgmt-dev` cluster name z komentára                                               |

**Phase C — milestones + session logy (~17 súborov):**

Milestone docs:

- `slice-1` — `@inventario/shared-types`, `api.inventario.estate` URL
- `slice-2` — Entra app registration names (SFZ→Inventario), DB collection name
- `slice-3` — `@inventario/shared-types` refs
- `phase-c` — `api.inventario.estate` URL v curl príkladoch
- `phase-d` — `api.inventario.estate` URL
- `slice-4` — `app.inventario.estate` URL (3× výskyty)
- `slice-6c` — "Ready for pilot tenant", "Tenant security requirement"

Session logy:

- `2026-05-15-design-pivot.md` — title, section 1.1 reframe
- `2026-05-15-day-summary.md` — TL;DR, Fáza A, Strategický posun, Highlights, Ďakovanie
- `2026-05-15-pricing-strategy.md` — "post-pivot" verzia, URL
- `docs/sessions/README.md` — popis design-pivot session

Commit: `docs: remove SFZ from config, code comments, milestones and session logs`

---

## Čo zostalo (zámerné odloženie)

### Infra rename (Atlas cluster + DB)

Live infra sa stále volá `sfz-asset-mgmt-prod`, `sfz-asset-mgmt-dev`, DB `sfz_asset_management`. Toto je interné meno — neprezrádza sa verejnosti. Rename vyžaduje plánovaný downtime slot:

1. Vytvor cluster `inventario-prod` (Flex, rovnaký región)
2. `mongodump` → `mongorestore`
3. Update `MONGO_URI` v Vercel env vars
4. Verify health check
5. Drop starý cluster

**Odporúčanie:** spraviť ako separátny ~30 min slot keď bude vhodný čas. Nie blocker pre pilot.

### Session logy 2026-05-16 až 2026-05-22

Denné záznamy z implementačných session-ov (slice #4 cez #7) obsahujú infra refs (`sfz-asset-mgmt-dev` v Vercel URLs, connection strings) — ale to sú historické provozné záznamy, nie narratívne texty. Nechané as-is; pri Atlas rename sa dajú doplniť jedno-riadkovou poznámkou.

### `urn:sfz-test:dev` JWT issuer

Testovacia cesta v `auth.ts` rozlišuje test tokens podľa `iss=urn:sfz-test:dev`. Toto je interný identifikátor (nevychádza z prod). Môže zostať alebo sa premenovať na `urn:inventario-test:dev` — nie je to blocker.

---

## Denné metriky

```
Commits dnes:     3 (doménová migrácia + sub-processors + SFZ cleanup Phase A-C)
Súbory zmenené:  ~60
Session trvanie: ~5 hodín
Backend testy:   962/962 (nezmenené)
```

---

### D. Marketing site → app prepojenie + MCP server reframe

Marketing site dostal kompletnú CTA migráciu na live appku `app.inventario.estate`:

**`shared.js`:**

- Pridaný `EXTERNAL_LINKS.app = 'https://app.inventario.estate'`
- Nav tlačidlo "Vyskúšať" → "Otvoriť aplikáciu" (GitHub → app)

**`index.html`:**

- Stat: 257 → 962 Backend testov
- Hero "Vyskúšať zadarmo" CTA → `app.inventario.estate/register`
- REUSE badge: "175/175" odstránené (zastarané číslo)
- EU compliance karta: odstránené "(175/175 súborov)" a "v plánoch"
- "SFZ, hokejový zväz" → "Športové zväzy, hokejový zväz"
- Bottom CTA: "Otvor si vlastný účet" → "Vyskúšaj Inventario už dnes" + primary CTA na `/register`

**`pricing.html`:**

- Free "Začať zadarmo" → `app.inventario.estate/register`
- Pro Small "Začať 14-dňový trial" → `app.inventario.estate/register`

**`technology.html` — MCP server reframe:**

Marketing site sľuboval **MCP server** ako hotovú technológiu (tech stack karta + API & integrácie sekcia). V repe však `apps/mcp-server` neexistuje. Riesenie:

- Obe spomenutia označené ako **"V roadmape"** badge
- Tech stack karta: pridaný badge "V roadmape · v0.7"
- API & integrácie karta: pridaný inline badge + spresnené "Plánované vo v0.7 (Q1 2027)"

**`ROADMAP.md` — dve opravy:**

- Odstránený `apps/mcp-server` z **Done** sekcie (workspace neexistuje) — nahradený `apps/docs`
- v0.7 sekcia MCP servera prepracovaná z "expansion" na "nový workspace" s konkrétnymi týmami:
  - Bootstrap `apps/mcp-server` (TypeScript + MCP SDK)
  - Production endpoint na `mcp.inventario.estate`
  - OpenAPI 3.1 → MCP tools auto-generovanie
  - Tenant-scoped auth (bearer JWT, rovnaký RBAC ako REST)
  - RAG chatbot nad `docs.inventario.estate`
  - Anthropic Claude API integration
- Opravená docs URL: `docs.inventario.sportup.sk` → `docs.inventario.estate`

Commit: `feat(marketing): connect marketing site to live app + reframe MCP server as v0.7 roadmap`

---

## Stav projektu na konci dňa

| Oblasť                                | Status                     |
| ------------------------------------- | -------------------------- |
| Backend (962 testov)                  | ✅ Zelený                  |
| Production deploy (inventario.estate) | ✅ LIVE                    |
| Docs (docs.inventario.estate)         | ✅ LIVE                    |
| Email + MFA v produkcii               | ✅ Nakonfigurované         |
| Sub-processors stránka                | ✅ LIVE                    |
| SFZ naratívna migrácia                | ✅ Hotová (kľúčové súbory) |
| Atlas cluster rename                  | ⏳ Planned downtime neskôr |
| Právny review compliance docs         | ⏳ Externý advokát         |
| Disaster recovery test                | ⏳ Manuálny, ~30 min       |

**Zapísané:** 2026-05-22
**Autor:** Claude Sonnet 4.6 + Opus 4.7 + Ján Letko

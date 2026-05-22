<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Doménová migrácia: `inventario.sportup.sk` → `inventario.estate` — Audit

**Dátum:** 2026-05-22
**Status:** Audit hotový, rewrite pending user approval
**Súvisiace ADR:** [ADR-0014 Passkeys (RP ID `inventario.estate`)](../decisions/0014-passkeys-webauthn.md)

---

## Kontext

Doména **`inventario.estate`** je odteraz primárna doména produktu Inventario. Plánované subdomény:

| Subdoména                | Účel                                                 |
| ------------------------ | ---------------------------------------------------- |
| `inventario.estate`      | Marketing site, legal docs, apex (WebAuthn RP ID)    |
| `app.inventario.estate`  | Aplikácia (Next.js frontend)                         |
| `api.inventario.estate`  | API (Fastify backend)                                |
| `docs.inventario.estate` | Documentation site (Nextra) — _planned, čaká na DNS_ |

Predchádzajúce hostname-y na `*.inventario.sportup.sk` ostávajú LIVE počas tranzície, potom sa zrušia.

---

## Kategorizačné pravidlo

| Kategória             | Stratégia                                                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Live state**        | Kód, config, current docs (NEXT.md, ROADMAP, CHANGELOG Unreleased), live web (marketing-site), deploy guides → **REWRITE na `inventario.estate`**                                       |
| **Historical record** | `docs/sessions/2026-05-{15..21}-*.md`, milestones `docs/milestones/slice-*.md`, `phase-*.md`, CHANGELOG release notes pre v0.3.0 a staršie → **NECHAŤ ako je** (audit trail rozhodnutí) |
| **Edge cases**        | BRAND.md fork-attribution example, GitHub repo URLs (`Slovensky-futbalovy-zvaz/Asset-Management`) → **user's call** (viď nižšie)                                                        |

---

## A. Súbory už na `inventario.estate` ✅ (no changes needed)

### Compliance docs (kompletná Phase 1 už migrovaná)

- `docs/compliance/README.md`
- `docs/compliance/breach-notification-plan.md`
- `docs/compliance/disaster-recovery-plan.md`
- `docs/compliance/gdpr-article-30.md` (v2.0)
- `docs/compliance/gdpr-article-30-controller.md`
- `docs/compliance/threshold-assessment.md`
- `docs/compliance/legal/dpa-template.md`
- `docs/compliance/legal/sub-processors.md`
- `docs/compliance/legal/privacy-policy.md`
- `docs/compliance/legal/terms-of-service.md`
- `docs/compliance/legal/tos-template.md`

### Config (žiadne sportup refs)

- `.env.example` (root) — má `noreply@inventario.estate`
- `apps/api/vercel.json`
- `apps/web/vercel.json`
- `apps/docs/vercel.json`
- `apps/web/src/lib/api-client.ts`
- `apps/web/src/lib/msal-config.ts` (placeholder, MSAL sa odstraňuje)

---

## B. Súbory s `inventario.sportup.sk` — TREBA REWRITE

### B.1 Config / kód (Priority 1 — deploy critical)

| Súbor                            | Výskyt                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `apps/web/.env.example`          | `NEXT_PUBLIC_API_BASE_URL` comment `https://api.inventario.sportup.sk`                                               |
| `apps/api/src/plugins/config.ts` | Komentár `OAUTH_REDIRECT_BASE_URL: ... E.g. https://api.inventario.sportup.sk/v1/auth/callback`                      |
| `apps/api/.env.example`          | CORS comment `https://app.sfz.sk, https://sfz-asset-management.vercel.app` — _legacy SFZ alias, treba prediskutovať_ |
| `.env.example` (root)            | Žiadny `inventario.sportup.sk`, ale spomenutá legacy `app.sfz.sk` v iných častiach session — _treba grep_            |

### B.2 Live project docs (Priority 1)

| Súbor                                                   | Výskyt                                                                                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/sessions/NEXT.md`                                 | "Production deploy: LIVE — inventario.sportup.sk + docs"                                                                                      |
| `docs/decisions/0013-multi-provider-auth-self-serve.md` | **20+ výskytov** — cookie domain `.inventario.sportup.sk`, `app.inventario.sportup.sk`, `api.inventario.sportup.sk`, register URLs v examples |
| `BRAND.md`                                              | 1× `https://inventario.sportup.sk` v EUPL fork attribution example                                                                            |
| `ROADMAP.md`                                            | `docs.inventario.sportup.sk` (4×), `app.inventario.sportup.sk` (1×), `staging.inventario.sportup.sk` (1×)                                     |
| `CHANGELOG.md`                                          | `docs.inventario.sportup.sk` (1×) v `[Unreleased]` sekcii                                                                                     |
| `docs/compliance/wcag-2.1-aa-audit.md`                  | 1× "marketing site (`inventario.sportup.sk`)" v intro tabuľke                                                                                 |

### B.3 apps/docs/content (LIVE documentation site)

| Súbor                                   | Výskyt                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `apps/docs/content/index.mdx`           | 1× `inventario.sportup.sk` v intro                                          |
| `apps/docs/content/getting-started.mdx` | 1× `inventario.sportup.sk`                                                  |
| `apps/docs/content/deployment.mdx`      | `inventario.sportup.sk` (3×), `vasa-org.inventario.sportup.sk` (1×)         |
| `apps/docs/content/about.mdx`           | `inventario.sportup.sk` (3×)                                                |
| `apps/docs/content/api.mdx`             | `api.inventario.sportup.sk` (8×) — všetky API URL príklady                  |
| `apps/docs/content/architecture.mdx`    | `inventario.sportup.sk`, `docs.inventario.sportup.sk` v deployment diagrame |
| `apps/docs/content/product-ui-tour.mdx` | 5+ výskytov `{tenant}.inventario.sportup.sk`, `inventario.sportup.sk/...`   |

### B.4 Marketing site + infra docs (Priority 1 — assumed LIVE references)

> **Pozor:** tieto súbory som v rámci tohto auditu nestiahol kompletne (cieľ: nezahltiť context). Vieme však, že:
>
> - `docs/marketing-site/*.html` je **production marketing site** zverejnený na `inventario.sportup.sk`. Bude obsahovať desiatky odkazov na sportup.sk a self-references.
> - `infra/vercel/*.md` sú **deploy guides** ktoré dokumentujú production URLs.
>   Pri samotnom rewrite-e treba každý súbor prejsť a nahradiť všetky `*.inventario.sportup.sk` → `*.inventario.estate`.

Súbory v scope (treba prejsť pri rewrite):

```
docs/marketing-site/
├── about.html
├── demo.html
├── index.html
├── interactive-demo.html
├── og-image.html
├── pricing.html
├── technology.html
├── use-cases.html
└── assets/
    ├── shared.css
    └── shared.js

infra/
├── README.md
└── vercel/
    ├── APP-DEPLOYMENT.md
    ├── DEPLOYMENT.md
    ├── DNS-SETUP.md
    ├── DOCS-DEPLOYMENT.md
    ├── README.md
    └── marketing-site.vercel.json
```

---

## C. Edge cases — vyžadujú rozhodnutie

### C.1 GitHub repo URLs (`github.com/Slovensky-futbalovy-zvaz/Asset-Management`)

Repo je aktuálne hostnutý na GitHub username **`Slovensky-futbalovy-zvaz`**. Otázka: zostáva tam, alebo sa presunie na `ltksolutions` (alebo iný namespace pri open-source publikácii)?

Súbory ktoré referencujú GitHub URL:

- `README.md` (mnohonásobne — clone URL, REUSE badge, contributing links)
- `BRAND.md` (footer, GitHub link)
- `SECURITY.md` (security disclosure link)
- `docs/decisions/*.md` (1-2 výskyty v ADR-0010 atď.)
- `apps/docs/content/*.mdx` (`Slovensky-futbalovy-zvaz/Asset-Management` v ~10 odkazoch)

**Rozhodnutie potrebné:** ostáva `Slovensky-futbalovy-zvaz/Asset-Management`, alebo migrácia na `ltksolutions/inventario`?

### C.2 SFZ-specific config (`app.sfz.sk`)

- `apps/api/.env.example` — CORS comment: `https://app.sfz.sk, https://sfz-asset-management.vercel.app`
- Root `.env.example` má `EMAIL_FROM_ADDRESS=noreply@inventario.estate` ale aj `MONGO_URI` s `sfz-asset-management` DB name a `app.sfz.sk` v iných príkladoch

**Rozhodnutie potrebné:** treba upraviť tieto CORS examples na nový multi-tenant model (`app.inventario.estate, https://*.inventario.estate`)?

### C.3 `inventario.sk` (NOT sportup) v `SECURITY.md`

`SECURITY.md` riadok 80 obsahuje:

> "Verejne dostupné inštancie projektu (po nasadení, napr. `inventario.sk`)"

Toto bola pôvodne plánovaná doména pred pivotom na `.estate`. Treba updatnúť na `inventario.estate`.

### C.4 Database / cluster names (`sfz_asset_management`, `sfz-asset-mgmt-prod`)

- MongoDB DB názov v configu: `sfz_asset_management`
- Atlas cluster mená: `sfz-asset-mgmt-prod`, `sfz-asset-mgmt-dev`

**Rozhodnutie potrebné:** nechať (sú to interné cluster/DB identifikátory, nie user-facing) alebo premenovať pri rebrand-e? Premenovanie by vyžadovalo migráciu live DB.

### C.5 BRAND.md fork attribution example

`BRAND.md` má v sekcii [§9 Forks & derivatives] vzorovú attribution správu:

> "Tento produkt je založený na projekte Inventario (https://inventario.sportup.sk)..."

Toto je príklad pre fork-erov ako majú citovať Inventario. Pri rewrite-e prepísať na `https://inventario.estate`.

---

## D. Historical records — NECHAŤ AS-IS

Súbory ktoré dokumentujú stav v minulosti a obsahujú `inventario.sportup.sk` zo svojej epochy — **nechať bez zmeny** (audit trail):

- `docs/sessions/2026-05-15-day-summary.md` až `2026-05-21-day-summary.md`
- `docs/sessions/2026-05-15-design-pivot.md`
- `docs/sessions/2026-05-15-pricing-strategy.md`
- `docs/sessions/2026-05-20-night-slice-6c-progress.md`
- `docs/sessions/2026-05-20-slice-6c-k18-design.md`
- `docs/milestones/slice-*.md`
- `docs/milestones/phase-*.md`
- `CHANGELOG.md` sekcie `[0.3.0]`, `[0.2.0]`, `[0.1.5]`, `[0.1.0]`, `[0.0.1]` (released)

> Iba sekcia `[Unreleased]` v `CHANGELOG.md` sa updatne (je to current state).

---

## E. Sumár rewrite work

| Skupina           | Súborov           | Effort      | Model              |
| ----------------- | ----------------- | ----------- | ------------------ |
| Config / kód      | 3                 | ~10 min     | Haiku 4.5          |
| Live project docs | 6                 | ~15 min     | Haiku 4.5          |
| apps/docs/content | 7 (~30 výskytov)  | ~20 min     | Haiku 4.5          |
| Marketing site    | 8 HTML + 2 assets | ~25 min     | Haiku 4.5          |
| Infra docs        | 6 markdown        | ~15 min     | Haiku 4.5          |
| **Celkom**        | **~32 súborov**   | **~85 min** | Haiku alebo Sonnet |

Pri rewrite-e si stačí jeden globálny prístup: `inventario.sportup.sk` → `inventario.estate`. **`sportup.sk` (bez prefixu inventario)** ostáva kde sa odkazuje na celý SportUp ekosystém ako sesterský projekt.

---

## F. Otázky pre usera pred rewriteom

1. **GitHub URL:** Migrovať `Slovensky-futbalovy-zvaz/Asset-Management` → `ltksolutions/inventario` v dokumentácii? (Reálny repo move môže prísť neskôr.)
2. **CORS / `app.sfz.sk`:** Nechať legacy SFZ aliasy v env example, alebo prepísať na multi-tenant `*.inventario.estate`?
3. **DB / cluster names** (`sfz_asset_management`, `sfz-asset-mgmt-prod`): nechať alebo premenovať? (Druhé vyžaduje migráciu live DB.)
4. **`inventario.sk` v SECURITY.md:** OK na update na `inventario.estate`?
5. **Docs domain:** Plánujeme `docs.inventario.estate` ako finálny hostname pre apps/docs? (Aktuálne odkazuje na `docs.inventario.sportup.sk`.)

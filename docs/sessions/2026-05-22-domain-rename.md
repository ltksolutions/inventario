<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-05-22 — Doménová migrácia a GitHub rename

**Dátum:** 2026-05-22
**Trvanie:** ~3 hodiny (2 session-y)
**Model:** Sonnet 4.6
**Výsledok:** ✅ Kompletná migrácia `inventario.sportup.sk` → `inventario.estate` + GitHub docs na `ltksolutions/inventario`

---

## Kontext

Po doménovom audite (zapísanom v `docs/sessions/2026-05-22-domain-rename-audit.md`) boli odklepnuté 5 rozhodnutí:

| #   | Otázka                        | Rozhodnutie                                      |
| --- | ----------------------------- | ------------------------------------------------ |
| F1  | GitHub URL v docs             | Migrácia na `ltksolutions/inventario`            |
| F2  | CORS / `app.sfz.sk`           | Prepísať na `*.inventario.estate` (multi-tenant) |
| F3  | DB/cluster names              | Plánovať rename (nie live zmena)                 |
| F4  | `inventario.sk` v SECURITY.md | Áno — update na `inventario.estate`              |
| F5  | Docs domain                   | `docs.inventario.estate`                         |

---

## Súbory upravené (~35 súborov)

### Config / kód (3)

- `apps/web/.env.example` — API URL comment
- `apps/api/.env.example` — CORS production comment
- `apps/api/src/plugins/config.ts` — OAuth callback example URL

### Live project docs (7)

- `SECURITY.md` — `inventario.sk` → `inventario.estate`
- `BRAND.md` — fork attribution URL + GitHub link (×4 výskyty)
- `docs/sessions/NEXT.md` — production deploy URL
- `ROADMAP.md` — subdomény v plánoch (×4)
- `CHANGELOG.md` — docs URL + GitHub compare/release links (×6)
- `docs/compliance/wcag-2.1-aa-audit.md` — marketing site scope
- `docs/decisions/0013-multi-provider-auth-self-serve.md` — cookie domain, OAuth URLs (20+ výskytov)

### apps/docs/content MDX (7)

- `index.mdx`, `getting-started.mdx`, `deployment.mdx`, `about.mdx`
- `api.mdx`, `architecture.mdx`, `product-ui-tour.mdx`

### Infra docs (6)

- `infra/vercel/README.md`
- `infra/vercel/DEPLOYMENT.md`
- `infra/vercel/DNS-SETUP.md` — bol už migrovaný ✅
- `infra/vercel/APP-DEPLOYMENT.md`
- `infra/vercel/DOCS-DEPLOYMENT.md`
- `infra/README.md` — bez zmien (iba sfz-\* bucket mená, interné)

### Marketing site (10)

- `docs/marketing-site/assets/shared.js` — EXTERNAL_LINKS objekt
- `docs/marketing-site/assets/shared.css` — bez zmien
- `docs/marketing-site/index.html` — og:url, og:image, GitHub link
- `docs/marketing-site/about.html` — og:url, og:image, GitHub links
- `docs/marketing-site/use-cases.html` — og:url, og:image
- `docs/marketing-site/pricing.html` — og:url, og:image, GitHub link
- `docs/marketing-site/technology.html` — og:url + 5 ďalších URL
- `docs/marketing-site/interactive-demo.html` — og:url, GitHub link, demo URL
- `docs/marketing-site/og-image.html` — URL text v dolnom riadku
- `docs/marketing-site/demo.html` — komentáre

### Root

- `README.md` — REUSE badge, clone URL

---

## Čo sa nemenilo (zámer)

- `docs/sessions/2026-05-*.md` — historické záznamy, nechané as-is
- `docs/milestones/slice-*.md` — historické, as-is
- `CHANGELOG.md` sekcie `[0.3.0]` a staršie — released, as-is (ale bottom links aktualizované)
- DB/cluster mená (`sfz_asset_management`, `sfz-asset-mgmt-prod/dev`) — plánovať rename neskôr
- Fyzický GitHub repo move — riadi Ján manuálne (repo ostáva na `Slovensky-futbalovy-zvaz` kým sa nepresunie)

---

## Poznámka k DB rename

Rozhodnutie F3: plánovať rename Atlas clusterov a DB názvov pre budúcnosť:

- `sfz-asset-mgmt-prod` → `inventario-prod`
- `sfz-asset-mgmt-dev` → `inventario-dev`
- `sfz_asset_management` (DB name) → `inventario`

Toto vyžaduje migráciu live dát, takže sa robí separátne. Env vars na Vercel prod treba aktualizovať pri rename.

---

**Zapísané:** 2026-05-22
**Autor:** Claude Sonnet 4.6 + Ján Letko

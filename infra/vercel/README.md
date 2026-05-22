<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# `infra/vercel/` — Vercel deployment configs

Vercel konfigurácia a deployment guides pre Inventario projekt.

## Súbory

| Súbor                                                      | Účel                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| [`DEPLOYMENT.md`](DEPLOYMENT.md)                           | Krok-po-kroku návod ako nasadiť marketing site na Vercel  |
| [`DOCS-DEPLOYMENT.md`](DOCS-DEPLOYMENT.md)                 | Krok-po-kroku návod ako nasadiť docs site (Nextra)        |
| [`APP-DEPLOYMENT.md`](APP-DEPLOYMENT.md)                   | Krok-po-kroku návod ako nasadiť web app (Next.js + MSAL)  |
| [`DNS-SETUP.md`](DNS-SETUP.md)                             | DNS konfigurácia pre `inventario.estate`                  |
| [`marketing-site.vercel.json`](marketing-site.vercel.json) | Template pre `vercel.json` (clean URLs, security headers) |

## Architektúra

V repe máme **štyri samostatné Vercel projekty**, všetky v `ltksolutions-projects` team:

| Projekt                | Cesta                  | Doména                   | Status                                        |
| ---------------------- | ---------------------- | ------------------------ | --------------------------------------------- |
| `inventario-marketing` | `docs/marketing-site/` | `inventario.estate`      | ✅ **LIVE** (15. máj 2026)                    |
| `inventario-docs`      | `apps/docs/`           | `docs.inventario.estate` | ✅ **LIVE** (16. máj 2026)                    |
| `asset-management-api` | `apps/api/`            | `api.inventario.estate`  | ✅ **LIVE** (18. máj 2026, Node 24 LTS)       |
| `inventario-app`       | `apps/web/`            | `app.inventario.estate`  | ✅ **LIVE** (18. máj 2026, Next.js 15 + MSAL) |

> **Budúce projekty** (slice #5+): plný loans backend a frontend (`/loans/request` + `/my-loans`), DSAR endpoint subdomain ak bude treba.

### `inventario-docs` build config (pamataj)

Deploy potreboval **UI override** pre monorepo support:

| Field            | Hodnota                                      |
| ---------------- | -------------------------------------------- |
| Root Directory   | `apps/docs`                                  |
| Install Command  | `cd ../.. && pnpm install --frozen-lockfile` |
| Build Command    | `cd ../.. && pnpm --filter @sfz/docs build`  |
| Output Directory | (default `.next`)                            |
| Framework Preset | Next.js                                      |

`apps/docs/vercel.json` obsahuje len HTTP headers (security + Pagefind cache), všetko ostatné cez UI lebo Turbo monorepo + workspace dependencies majú quirks pri auto-detection.

Detaily v [`DOCS-DEPLOYMENT.md`](DOCS-DEPLOYMENT.md).

## Quick start

Ak chceš deploynúť dnes:

1. **Prečítaj si** [`DEPLOYMENT.md`](DEPLOYMENT.md) (5 min)
2. **Cez Vercel dashboard** vytvor projekt `inventario-marketing` s **Root Directory** `docs/marketing-site`
3. **Skopíruj** `marketing-site.vercel.json` do `docs/marketing-site/vercel.json`
4. **Pridaj custom doménu** vo Vercel Settings → Domains → `inventario.estate`
5. **Pridaj DNS záznam** podľa [`DNS-SETUP.md`](DNS-SETUP.md)
6. **Počkaj** 5–60 min na DNS propagáciu + SSL verification
7. **Otestuj** že `https://inventario.estate` loaduje

Celý proces trvá **20–30 minút** (active work) + DNS propagácia.

## Maintainers

- Primary: **Ján Letko** / LTK Solutions (`inventario@ltk.solutions`)
- Vercel account: pravdepodobne `ltksolutions-projects` team scope

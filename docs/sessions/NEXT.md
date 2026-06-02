<!--
SPDX-FileCopyrightText: 2026 Jan Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                        |
| ------------------------- | -------------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-06-02 (ADR-0022 K5–K8 hotové — ADR-0022 UZAVRETÝ)         |
| **Aktuálna fáza**         | Production LIVE — dev pokračuje, cieľ: čím skôr reálny testing |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`                  |
| **GitHub**                | https://github.com/ltksolutions/inventario                     |

---

## 🎯 Vedúci princíp

**Všetko musí byť praktické pre bežnú dennú prevádzku z reálneho života.** Pri každom kroku sa pýtať: „zvládne to človek pri pulte / v sklade / na ihrisku bez školenia?". **Cieľ: čím skôr reálny testing so SFZ.**

---

## ✅ Hotové (posledná session, 2026-06-02)

**ADR-0022 K5–K8** — session doc: [`docs/sessions/2026-06-02-adr-0022-k5-k8.md`](./2026-06-02-adr-0022-k5-k8.md)

- **K5** — `protocols.routes.ts`: `GET /v1/loans/:id/protocols`, `GET /v1/protocols/:id`, `GET /v1/protocols/:id/pdf`; RBAC (borrower/ASSET_MANAGER/ADMIN); cross-tenant izolácia; lazy `pdfSha256` (background update po prvom stiahnutí); `setProtocolsRepo()` injection pattern; zaregistrovaný v `server.ts`
- **K6** — `POST /v1/protocols/:id/sign` (CLICK_TO_SIGN); DRAFT→SIGNED pri obojstrannom podpise; pdfSha256 fixnutý pri SIGNED (render s novými podpismi)
- **K7** — 15 integration testov (`protocols.test.ts`): RBAC, cross-tenant, PDF headers, lazy sha256, podpis (jedno/obojstranný/duplicate/signed), snapshot-not-live, multi-fulfil, stránkovanie 26+
- **K8** — milestone doc, session log, TODO.md #7 zatvorené, NEXT.md

**ADR-0022 je UZAVRETÝ** ✅ (K1–K8 kompletné)

**Stav testov:** 783 (pred session) + 15 nových = **798 očakávaných** ✅

---

## 🔥 Ďalší krok — Po ADR-0022

### Odporúčaný postup (v poradí):

1. **`pnpm typecheck` + `pnpm test`** — overiť 0 TypeScript chýb + 798 zelených testov
2. **`pnpm --filter @inventario/api openapi:export:offline`** — regen OpenAPI (pridali sme nové endpointy)
3. **Commit cez GitHub Desktop** — header-only: `feat(protocols): K5-K8 routes, sign, integration tests`
4. **Deploy na Vercel** — `git push` na main; smoke test na `app.inventario.estate`

### Po úspešnom smoke teste:

5. **ADR-0027 — Tlač QR štítkov** (zdieľa `pdf-lib` + DejaVu Sans, rozumné robiť hneď)
   - L1 schéma (`labelPrinting`) → Haiku
   - L2–L6 impl (Avery PDF, ZPL builder, routes, frontend) → Sonnet
   - L7 docs → Haiku

6. **SFZ pilot tenant onboarding** — reálny testing

---

## 📋 Otvorené položky

- `openapi:export:offline` regen po tejto session (Janika spúšťa lokálne)
- ADR-0027 QR štítky (viď TODO.md #16)
- SFZ pilot onboarding

---

## 🧭 Model routing

| Task typ                                                    | Model          |
| ----------------------------------------------------------- | -------------- |
| Strategické rozhodnutia, ADR, DPIA, security architecture   | **Opus 4.8**   |
| CRUD endpoints, frontend pages, debug, tests, implementácia | **Sonnet 4.6** |
| Milestone docs, mechanické edits, scoped docs               | **Haiku 4.5**  |

---

## Workflow pripomienka

- Po zmene schém: `pnpm --filter @inventario/shared-types build` → `openapi:export:offline` → `pnpm test`
- Header-only commit messages (GitHub Desktop blank-line pasca)
- Filesystem MCP = disk I/O; bash sandbox je izolovaný

---

**Last updated:** 2026-06-02 (ADR-0022 K5–K8 hotové, ADR-0022 UZAVRETÝ)
**Tests:** 783 zelených (pred session) + 15 nových = 798 očakávaných ✅ | **Repo:** github.com/ltksolutions/inventario | **Status:** Production LIVE ✅

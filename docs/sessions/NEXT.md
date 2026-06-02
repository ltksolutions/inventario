<!--
SPDX-FileCopyrightText: 2026 Jan Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                        |
| ------------------------- | -------------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-06-02 (ADR-0027 L1–L4+L6–L7 backend hotový)               |
| **Aktuálna fáza**         | Production LIVE — dev pokračuje, cieľ: čím skôr reálny testing |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`                  |
| **GitHub**                | https://github.com/ltksolutions/inventario                     |

---

## 🎯 Vedúci princíp

**Všetko musí byť praktické pre bežnú dennú prevádzku z reálneho života.**

---

## ✅ Hotové (posledná session, 2026-06-02)

**ADR-0022 K5–K8** — uzavretý ✅ (viď session doc K5–K8)

**ADR-0027 L1–L4 + L6–L7** (backend QR štítky) — session doc: [`docs/sessions/2026-06-02-adr-0027-l1-l7-backend.md`](./2026-06-02-adr-0027-l1-l7-backend.md)

- **L1** — `OrganisationLabelSettingsSchema` (mode, pdfPreset, ZPL params, finderText); `labelPrinting: null` do JIT + register + oauth + test fixtures
- **L2** — `renderLabelSheetPdf()`: Avery L7160/L7163, QR + invNum + názov + finderText, logo v strede QR, DejaVu Sans
- **L3** — `renderLabelZpl()`: vlastný ZPL builder, `^CI28` UTF-8, `^BQ` QR, finderText, rozmery z configu
- **L4** — routes: `GET /v1/labels/sheet`, `GET /v1/assets/:id/label?format=zpl`, `POST /v1/labels/zpl`; EMPLOYEE+; registrácia v `server.ts`
- **L6** — 27 testov (unit ZPL ×8, unit PDF ×7, integration ×12)
- **L7** — session doc, TODO.md aktualizovaný

**Stav testov:** 798 (pred session) + 27 nových = **825 očakávaných** ✅

---

## 🔥 Ďalší krok

### 1. Overiť a commitnúť

```bash
pnpm typecheck
pnpm test
pnpm --filter @inventario/api openapi:export:offline
```

Commit (header-only):

```
feat(labels): ADR-0027 L1-L4+L6-L7 QR label printing backend
```

### 2. ADR-0027 L5 — Frontend (separátna session, Sonnet)

- Tlačidlo na detaile assetu (detail page v `apps/web`)
- Dávková tlač zo zoznamu (checkbox selection → Print)
- PDF: `window.open('/v1/labels/sheet?assetIds=...')` → OS tlačový dialóg
- ZPL: Zebra Browser Print JS API (agent); fallback na PDF ak agent nebeží
- UI hint: "Zapnite finderText spolu s publicAssetLookup"

### 3. SFZ pilot onboarding

Reálny testing s prvým tenantom.

---

## 📋 Otvorené položky (z TODO.md)

- ADR-0027 L5 frontend (viď TODO.md #16)
- SFZ pilot onboarding
- Migrations at deploy-time (TODO.md dlhodobé)

---

## 🧭 Model routing

| Task typ                                                    | Model          |
| ----------------------------------------------------------- | -------------- |
| Strategické rozhodnutia, ADR, DPIA, security architecture   | **Opus 4.8**   |
| CRUD endpoints, frontend pages, debug, tests, implementácia | **Sonnet 4.6** |
| Milestone docs, mechanické edits, scoped docs               | **Haiku 4.5**  |

---

**Last updated:** 2026-06-02 (ADR-0027 L1–L4+L6–L7 backend hotový)
**Tests:** 798 zelených + 27 nových = 825 očakávaných | **Repo:** github.com/ltksolutions/inventario | **Status:** Production LIVE ✅

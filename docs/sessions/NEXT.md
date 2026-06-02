<!--
SPDX-FileCopyrightText: 2026 Jan Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

| Atribút                   | Hodnota                                                        |
| ------------------------- | -------------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-06-02 (ADR-0027 L5 frontend — ADR-0027 UZAVRETÝ)          |
| **Aktuálna fáza**         | Production LIVE — dev pokračuje, cieľ: čím skôr reálny testing |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`                  |
| **GitHub**                | https://github.com/ltksolutions/inventario                     |

---

## 🎯 Vedúci princíp

**Všetko musí byť praktické pre bežnú dennú prevádzku z reálneho života.**

---

## ✅ Hotové (posledná session, 2026-06-02)

**ADR-0027 L5** (frontend QR štítky) — session doc: [`docs/sessions/2026-06-02-adr-0027-l5-frontend.md`](./2026-06-02-adr-0027-l5-frontend.md)

- `LabelPrintButton` — detail page: PDF (window.open) alebo ZPL (Browser Print), fallback
- `BatchLabelPrintButton` — zoznam: preset dropdown, dávková ZPL tlač, max 200
- `AssetDetailContent` — `LabelPrintButton` vedľa Upraviť, `useCurrentOrganisation` hook
- `AssetsListContent` — multi-select (Vybrať všetky na strane), `BatchLabelPrintButton` v header
- `OrganisationSummary` rozšírená o `labelPrinting` typ

**ADR-0027 je UZAVRETÝ** ✅ (L1–L7 kompletné)

---

## 🔥 Ďalší krok

### 1. Typecheck + test + commit

```bash
pnpm typecheck
pnpm test
```

Frontend commit (header-only):

```
feat(labels): L5 frontend label printing (LabelPrintButton + batch)
```

### 2. Deploy + smoke test

Po push na main: Vercel deploy automaticky. Smoke test:

- Detail stránka assetu → viditeľné tlačidlo „Tlačiť štítok"
- PDF tlač → otvorí sa nová záložka s PDF
- Zoznam assetov → „Vybrať všetky na strane" → „Tlačiť N štítkov" button

### 3. SFZ pilot onboarding

Odporúčaný nasledujúci krok — reálny testing s prvým tenantom.

---

## 📋 Otvorené položky (z TODO.md)

- SFZ pilot onboarding
- Migrations at deploy-time (dlhodobé)
- ADR-0027 L5 Browser Print — reálny test so ZD420 počas pilotu

---

## 🧭 Model routing

| Task typ                                                    | Model          |
| ----------------------------------------------------------- | -------------- |
| Strategické rozhodnutia, ADR, DPIA, security architecture   | **Opus 4.8**   |
| CRUD endpoints, frontend pages, debug, tests, implementácia | **Sonnet 4.6** |
| Milestone docs, mechanické edits, scoped docs               | **Haiku 4.5**  |

---

**Last updated:** 2026-06-02 (ADR-0027 kompletný)
**Tests:** 825 zelených (backend) | **Repo:** github.com/ltksolutions/inventario | **Status:** Production LIVE ✅

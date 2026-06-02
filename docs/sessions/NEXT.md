<!--
SPDX-FileCopyrightText: 2026 Jan Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

| Atribút                   | Hodnota                                                                      |
| ------------------------- | ---------------------------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-06-03 (ADR-0028 v2 — preset palety + Blob upload + font enum kompletné) |
| **Aktuálna fáza**         | Production LIVE — ADR-0028 v2 uzavretý; SFZ pilot pripravený                 |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`                                |
| **GitHub**                | https://github.com/ltksolutions/inventario                                   |

---

## 🎯 Vedúci princíp

**Všetko musí byť praktické pre bežnú dennú prevádzku z reálneho života.**

---

## ✅ Hotové (posledná session, 2026-06-03)

**ADR-0028 v2 Per-tenant branding — preset palety, Blob upload, font enum**
Session doc: [`docs/sessions/2026-06-03-adr-0028-v2-branding-presets.md`](./2026-06-03-adr-0028-v2-branding-presets.md)

- v2-B0 — Vercel Blob store (manuálne): `inventario-api-blob`, Frankfurt fra1, Public, `BLOB_READ_WRITE_TOKEN`
- v2-B1 — `brand-presets.ts`: 10 WCAG paliet + font enum + `FONT_OPTIONS` s `var(--font-*)` CSS refs; 29 testov
- v2-B2 — Blob upload endpoint + preset→hex expanzia + gating zrušený; `updateLogoUrl()` v service
- v2-B3 — `next/font/google` (Inter/Open Sans/Roboto/Lato), CSS premenné, `BrandProvider` getFontCss
- v2-B4 — UI: file picker + preset karty grid + font select; `useUploadLogo()` hook
- v2-B5 — testy (8 upload + prepísané branding), ADR revízia, OpenAPI regen (84 endpoints), web build 28/28

**Testy:** 884/884 zelených

**Follow-up (živé testovanie večer):** brand hlavička — lišta v brand farbe (varianta A, logo na bielej dlaždici), auto-refresh brandu po uložení (bez reloadu), fix výšky vysokého/štvorcového loga. Commity `9c0e3d0` + `44d05d0`. Detaily v dodatku session docu.

---

## 🔥 Ďalší krok

### 1. Push + deploy

Commity tejto session pushnuté → Vercel auto-deploy.

### 2. SFZ pilot onboarding — nastaviť branding (manuálne)

Po deployi:

1. Prihlásiť sa ako SFZ admin → `/settings/organisation` → **Branding**
2. Kliknúť „Nahrať logo" → nahrať PNG logo SFZ (max 512 KB, nie SVG)
3. Vybrať farebnú paletu (napr. `royal-blue` alebo `inventario-navy`)
4. Vybrať font (odporúča sa `Inter` alebo default `system-ui`)
5. Uložiť → overiť že logo sa objaví v headeri, protokoloch (ADR-0022) aj štítkoch (ADR-0027)

### 3. SFZ pilot onboarding — reálny testing

- Zebra Browser Print + ZD420 (ZPL tlač + SK diakritika)
- Retention cron (`CRON_SECRET` nastavený vo Vercel)
- Forced MFA enforcement — smoke-test s kolegom (K12a/K12b implementované, test pending)

---

## 📋 Otvorené položky (z TODO.md)

- **SFZ pilot onboarding** (ďalší krok — viď vyššie)
- **P2: ADR-0022 K5–K8** — protokoly: download PDF, sign endpoint (ak ešte nie DONE — over TODO.md)
- **P3 compliance docs** — whitepaper, security policy, data retention schedule, DPIA pack
- **P4 podľa dopytu** — Slice #10 MCP server (Q1 2027), follow-up featury

---

## 🧭 Model routing

| Task typ                                                    | Model          |
| ----------------------------------------------------------- | -------------- |
| Strategické rozhodnutia, ADR, DPIA, security architecture   | **Opus 4.8**   |
| CRUD endpoints, frontend pages, debug, tests, implementácia | **Sonnet 4.6** |
| Milestone docs, mechanické edits, scoped docs               | **Haiku 4.5**  |

---

**Last updated:** 2026-06-03 (ADR-0028 v2 kompletný + brand hlavička follow-up)
**Tests:** 884/884 zelených | **Repo:** github.com/ltksolutions/inventario | **Status:** Production LIVE ✅

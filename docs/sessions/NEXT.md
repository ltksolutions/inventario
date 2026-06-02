<!--
SPDX-FileCopyrightText: 2026 Jan Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — čo robiť v ďalšej session

| Atribút                   | Hodnota                                                     |
| ------------------------- | ----------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-06-02 (ADR-0028 branding — B1–B10 kompletné, uzavretý) |
| **Aktuálna fáza**         | Production LIVE — ADR-0028 uzavretý; SFZ pilot pripravený   |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`               |
| **GitHub**                | https://github.com/ltksolutions/inventario                  |

---

## 🎯 Vedúci princíp

**Všetko musí byť praktické pre bežnú dennú prevádzku z reálneho života.**

---

## ✅ Hotové (posledná session, 2026-06-02)

**ADR-0028 Per-tenant branding** — session doc: [`docs/sessions/2026-06-02-adr-0028-branding.md`](./2026-06-02-adr-0028-branding.md)

- B1 — `HexColorSchema` do `common.ts`, `logoDot` do Zod, `brand-kit.schema.json` zladená
- B2 — `contrast.ts` WCAG util + 21 unit testov (sRGB linearizácia, exponent 2.4)
- B3 — `PATCH /v1/organisations/current`: `brandKit` + plán gating (FREE→403) + WCAG (<4.5:1→400) + SVG check (400) + audit `ORGANISATION_BRANDING_UPDATED`
- B4 — 21 integračných testov (`organisations-branding.test.ts`)
- B5 — `BrandProvider` (`data-tenant` + `<style id="inv-tenant-brand">`, čisté funkcie)
- B6 — `TenantLogo` v `AppShell` (`next/image unoptimized`, React `errored` state fallback)
- B7 — „Branding" sekcia v `/settings/organisation` (logo URL + náhľad, farby, font, plán gating)
- B8 — `ContrastBadge` — live WCAG AA indikátor (✓/✗ s pomerom) pod farebnými pármi
- B9 — openapi regen + shared-types build + full `pnpm typecheck` (7/7 zelené)
- B10 — session doc + NEXT.md + TODO.md (header + položka #17 označená DONE)

**Testy po session:** 877+ zelených (backend) + web build 28/28 stránok

---

## 🔥 Ďalší krok

### 1. Push + deploy

Commity tejto session pushnuté → Vercel auto-deploy.

### 2. SFZ pilot onboarding — nastaviť branding

Po deployi (manuálne, nie kód):

1. Prihlásiť sa ako SFZ admin → `/settings/organisation` → **Branding**
2. Vložiť `logoUrl` na PNG logo SFZ (HTTPS, nie SVG) — logo sa objaví v headeri, protokoloch aj štítkoch
3. Ak chce SFZ aj vlastné farby: dočasne nastaviť `plan: PRO` cez `/admin/tenants` (manuálne)
4. Overiť: protokol PDF (ADR-0022) a QR štítok (ADR-0027) zobrazujú SFZ logo

### 3. SFZ pilot onboarding — reálny testing

Systém je pripravený (auth, assets, číselníky, loans, protokoly, QR, stock, DSAR). Overiť v teréne:

- Zebra Browser Print + ZD420 (ZPL tlač + SK diakritika)
- Retention cron (CRON_SECRET nastavený)

---

## 📋 Otvorené položky (z TODO.md)

- **SFZ pilot onboarding** (ďalší krok — viď vyššie)
- **P3 compliance docs** — whitepaper, security policy, data retention schedule, DPIA pack
- **P4 podľa dopytu** — Slice #10 MCP server (Q1 2027), follow-up featury
- Migrations at deploy-time (dlhodobé)
- Zmazať staré SFZ Atlas clustre

---

## 🧭 Model routing

| Task typ                                                    | Model          |
| ----------------------------------------------------------- | -------------- |
| Strategické rozhodnutia, ADR, DPIA, security architecture   | **Opus 4.8**   |
| CRUD endpoints, frontend pages, debug, tests, implementácia | **Sonnet 4.6** |
| Milestone docs, mechanické edits, scoped docs               | **Haiku 4.5**  |

---

**Last updated:** 2026-06-02 (ADR-0028 branding kompletný)
**Tests:** 877+ zelených (backend) | **Repo:** github.com/ltksolutions/inventario | **Status:** Production LIVE ✅

<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session Documents

> Záznamy z working sessions na projekte Inventario.
> Slúžia ako trvalý kontext pre maintainer-ov a Claude pri budúcich sessions.

---

## 🚀 Pre Claude pri novej session

**Najprv si prečítaj:**

1. **[`NEXT.md`](NEXT.md)** — aktuálny stav projektu, najbližšie kroky, technical debt
2. **Najnovší day-summary** (najnovší dátum) — kde sme skončili

Tým získaš okamžitý kontext za 30 sekúnd.

---

## 📚 Indexovaný zoznam

### 2026-05

| Súbor                                                                            | Typ               | Popis                                                                                     |
| -------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| [`NEXT.md`](NEXT.md)                                                             | **Living**        | **Continuation plan** — vždy aktuálny stav projektu a plán ďalej                          |
| [`2026-05-23-day-summary.md`](2026-05-23-day-summary.md)                         | Day summary       | K12a Forced MFA setup + K12b Admin MFA reset — 511/511 testov                             |
| [`2026-05-22-day-summary.md`](2026-05-22-day-summary.md)                         | Day summary       | Vercel env vars + sub-processors page + SFZ naratívna migrácia (Phase A-C)                |
| [`2026-05-22-domain-rename.md`](2026-05-22-domain-rename.md)                     | Day summary       | Doménová migrácia inventario.estate + GitHub rename (~35 súbory)                          |
| [`2026-05-21-day-summary.md`](2026-05-21-day-summary.md)                         | Day summary       | Slice #6c K18 invite flow + Slice #7 TOTP MFA + DPIA strategia + 5 compliance dokumentov  |
| [`2026-05-20-night-slice-6c-progress.md`](2026-05-20-night-slice-6c-progress.md) | Day summary       | Slice #6c K17 Bearer cutover + K17.5 email provider abstraction (Ecomail + Resend + stub) |
| [`2026-05-20-slice-6c-k18-design.md`](2026-05-20-slice-6c-k18-design.md)         | Pre-session plan  | K18 invitations dizajn dokument (backend + frontend architektúra)                         |
| [`2026-05-20-evening-day-summary.md`](2026-05-20-evening-day-summary.md)         | Day summary       | Slice #6c K17 údržba + plan pre K18                                                       |
| [`2026-05-20-day-summary.md`](2026-05-20-day-summary.md)                         | Day summary       | Slice #6c K17 progress                                                                    |
| [`2026-05-18-day-summary.md`](2026-05-18-day-summary.md)                         | Day summary       | Slice #6c K15+K16 (Inventario JWT + frontend cookie auth)                                 |
| [`2026-05-17-day-summary.md`](2026-05-17-day-summary.md)                         | Day summary       | Slice #6a + K14 multi-provider auth foundation                                            |
| [`2026-05-16-day-summary.md`](2026-05-16-day-summary.md)                         | Day summary       | Marketing polish + interactive demo + Nextra docs deploy + clean URLs                     |
| [`2026-05-15-design-pivot.md`](2026-05-15-design-pivot.md)                       | Pre-session plan  | Plán dňa: multi-tenant white-label design exploration a brand systém                      |
| [`2026-05-15-day-summary.md`](2026-05-15-day-summary.md)                         | Day summary       | Súhrn celej session: pivot + design + brand + marketing + pricing                         |
| [`2026-05-15-pricing-strategy.md`](2026-05-15-pricing-strategy.md)               | Internal strategy | Cenová stratégia pre Sales calls (Free, Pro, Annual Contract)                             |

---

## 🗂️ Typy dokumentov

### **Pre-session plan** — plán pred working session

- Slúži na prípravu a štruktúrovanie session
- Obsahuje: ciele, kroky, rozhodnutia ktoré treba spraviť, otvorené otázky
- Vytvára sa pred session, neaktualizuje sa po nej

### **Day summary** — záznam po session

- Slúži ako trvalý záznam toho, čo sa reálne stalo
- Obsahuje: chronológiu, vytvorené súbory, rozhodnutia, lessons learned, metriky
- Vytvára sa na konci session, neaktualizuje sa neskôr

### **Internal strategy** — interný dokument pre business

- Slúži pre maintainer-ov / Sales / partnerov
- Obsahuje: stratégie, playbook, case studies, internal pricing
- Living document — aktualizuje sa keď sa stratégia mení

### **Prompt** — zadanie pre nasledujúcu session

- Slúži na predanie kontextu a zmeraných čísel do ďalšej session
- Pomenovanie: `PROMPT-<topic>.md`
- **Životnosť je jednorazová**: keď je práca hotová, prompt ide von.
  Obsah zostáva v git histórii (`git show <commit>:<cesta>`), trvalým
  záznamom je session log, nie zadanie. Prvé upratovanie 2026-09-01 —
  tri spotrebované prompty (ADR-0022 K2, ADR-0028 branding, OpenAPI 4xx).

### **Living document** — vždy aktuálne

- Slúži ako single source of truth pre stav projektu
- Príklad: `NEXT.md`
- Update protocol: aktualizuje sa na konci každej session

---

## 📝 Konvencie

### Pomenovanie

- **Pre-session plan**: `YYYY-MM-DD-<topic>.md` (napr. `2026-05-15-design-pivot.md`)
- **Day summary**: `YYYY-MM-DD-day-summary.md`
- **Internal strategy**: `YYYY-MM-DD-<topic>-strategy.md`
- **Living document**: bez dátumu (napr. `NEXT.md`, `ROADMAP.md` na root)

### Štruktúra každého dokumentu

```markdown
<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Title

> Metadata block (dátum, status, audience, atď.)

## TL;DR (pre pre-session plans a day summaries)

## Hlavné sekcie...

---

**Last updated**: YYYY-MM-DD
```

### Jazyk

- Slovenčina pre väčšinu obsahu
- Technické termíny môžu ostať anglické (SSO, API, RBAC, multi-tenant, ...)
- Čísla a meny formátované slovensky (1 990 €, nie 1.990€)

---

## 🤝 Príspevky

Session dokumenty pridáva primárne maintainer (Ján Letko) alebo Claude počas working sessions. Otázky či návrhy:

- 📧 inventario@ltk.solutions
- 🐙 GitHub Issues s tag-om `documentation`

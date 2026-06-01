<!--
SPDX-FileCopyrightText: 2026 Jan Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# NEXT — co robit v dalšej session

> **Living document.** Vždy aktuálny stav projektu a najbližšie kroky.

| Atribút                   | Hodnota                                                        |
| ------------------------- | -------------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-06-01 (ADR-0027 label printing prijatý)                   |
| **Aktuálna fáza**         | Production LIVE — dev pokračuje, cieľ: čím skôr reálny testing |
| **Lokálny adresár**       | `/Users/janletko/Documents/GitHub/inventario`                  |
| **GitHub**                | https://github.com/ltksolutions/inventario                     |

---

## 🎯 Vedúci princíp pre celý ďalší vývoj

**Všetko musí byť praktické pre bežnú dennú prevádzku z reálneho života.** Nie demo-ware,
ale nástroj, ktorý správca majetku reálne používa každý deň. Pri každom kroku sa pýtať:
„zvládne to človek pri pulte / v sklade / na ihrisku bez školenia?". **Cieľ: čím skôr
reálny testing so SFZ** — funkcionalita je hotová/rozpracovaná, teraz ju treba dostať
do rúk reálnemu používateľovi.

---

## ✅ Hotové (tento blok sessions, 2026-06-01)

- **DSAR čl. 16/17/18/20** — export, patch-me, erasure, restrict (kompletné, otestované)
- **Retention job #8** — live na prod, cron `0 3 1 * *` beží, smoke test 200
- **email_unique index** — prod má správne 4 indexy, SFZ pilot odblokovaný
- **ADR-0021 QR kódy** — K1–K7 kompletné
- **ADR-0022 Preberacie protokoly** — K1 hotový (schéma + paperSize snapshot + protocolSettings)
- **ADR-0027 Tlač QR štítkov** — prijaté (Avery PDF default + Zebra ZPL opt-in + text pod QR)

Smoke test prod (hotový): export, patch/me, retention cron — všetko zelené. Cron viditeľný
vo Vercel → Settings → Crons.

---

## 🔥 Zajtra pokračujeme s developom

Dve veľké featury čakajú impl, **zdieľajú render stack** (`pdf-lib` + embedovaný DejaVu Sans),
preto sa oplatí robiť ich blízko seba. Obe sú „po pilote / podľa potreby" v zmysle ADR, ale
Jan ich chce dorobiť pred reálnym testingom, aby pilot videl praktickú hodnotu.

### A. ADR-0022 Preberacie protokoly — K2–K8

**Plán:** [`docs/sessions/2026-06-01-loan-protocols-plan.md`](./2026-06-01-loan-protocols-plan.md)

Rozhodnutia R1–R3 sú **uzavreté** (diskusia 2026-06-01):

- **Font:** DejaVu Sans, jeden default, žiadny per-tenant výber
- **Papier:** A4 default, per-tenant A4/LETTER, snapshot na zázname (schéma hotová v K1)
- **Logo:** per-tenant z `brandKit.logoUrl`, bez cache, s timeout + fallback na default

K2 (renderer) = prvý krok, najväčší kus, **samostatná session s čistou hlavou** (determinizmus
renderu je kritický invariant — povinný byte-equality test). K3 číslo → K4 service integrácia
→ K5 routes → K6 podpis → K7 testy → K8 docs.

### B. ADR-0027 Tlač QR štítkov — L1–L7

**ADR:** [`docs/decisions/0027-qr-label-printing.md`](../decisions/0027-qr-label-printing.md)

- **Avery PDF hárok** = default (každý tenant, akákoľvek tlačiareň)
- **Zebra ZPL** = opt-in per tenant (`labelPrinting.mode`), doručenie cez Zebra Browser Print
  (lokálny agent), backend nikdy nekomunikuje s tlačiarňou
- **Vlastný ZPL builder** bez závisu; **sprievodný text pod QR** (opt-in, „naskenuj ma")
- **Pozor L1:** `labelPrinting: null` doplniť do všetkých org-create ciest — rovnaká pasca
  ako `protocolSettings` dnes (JIT, register, oauth, test fixtures)

> **Synergia:** L2 (label sheet PDF) zdieľa `pdf-lib` + DejaVu Sans s protokolmi K2. Keď
> postavíš renderer pre protokoly, label sheet je z veľkej časti ten istý stack. Rozumné
> poradie: protokoly K2–K4, potom label L1–L4 (recyklujú render), potom dokončiť oboje.

### Workflow pripomienka pre zajtra

- Po každej zmene schémy: `pnpm --filter @inventario/shared-types build` → `openapi:export:offline` → `pnpm test`
- Pre-commit hook chytá typecheck — ak pridáš required pole na `Organisation`, **doplň ho do
  všetkých org-create ciest** (5 miest: JIT service, register, oauth, 2× test fixtures)
- Header-only commit messages (GitHub Desktop blank-line pasca)
- Model: K2/L2 renderery = Sonnet; číslo/service/routes = Sonnet; docs/milestone = Haiku

---

## 🚀 Reálny testing — čím skôr

Cieľ po dorobení A+B (alebo aj priebežne). Plán hotový:
[`docs/sessions/2026-06-01-sfz-pilot-onboarding-plan.md`](./2026-06-01-sfz-pilot-onboarding-plan.md)

**Kritický gate (Fáza 0):** prejsť self-serve registráciu sám na testovacom konte, než pozveš
SFZ. Self-serve flow už existuje a je kompletný (overené v kóde) — „komplikované na Entra" je
config/verifikácia, nie chýbajúci kód. Overiť OAuth env vars na Verceli + redirect URI v
Google/Azure konzole.

**Praktický test so SFZ ZD420:** ZPL štítok naskenovať reálne z termotlačiarne — overiť QR
modul size pri 203 dpi (riziko z ADR-0027). Toto je presne ten „reálny život" test.

---

## 📋 Backlog po A+B (poradie podľa Jana)

1. **REUSE/EUPL technická compliance** — `reuse lint` zelený, SPDX hlavičky, LICENSES/ (kompletne dotiahnuť)
2. **Onboarding wizard** — až po pilote (pilot povie čo má riešiť; stavať naslepo = prerábka)
3. **EÚ fondy** — až keď bude konkrétna výzva (právna/dotačná oblasť, nie kódovanie)
4. **Compliance docs** (položky 9–12 v TODO.md)

---

## 🧭 Model routing

| Task typ                                                    | Model          |
| ----------------------------------------------------------- | -------------- |
| Strategické rozhodnutia, ADR, DPIA, security architecture   | **Opus 4.8**   |
| CRUD endpoints, frontend pages, debug, tests, implementácia | **Sonnet 4.6** |
| Milestone docs, mechanické edits, scoped docs               | **Haiku 4.5**  |

---

**Last updated:** 2026-06-01 (ADR-0027 label printing prijatý)
**Tests:** zelené ✅ | **Repo:** github.com/ltksolutions/inventario | **Status:** Production LIVE ✅

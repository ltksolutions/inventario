<!--
SPDX-FileCopyrightText: 2026 LTK Solutions, s.r.o.
SPDX-License-Identifier: CC-BY-4.0
-->

# Session log — 2026-06-11 · P3 Compliance Fáza 2 dokumenty + verejný web

Doplnenie 4 chýbajúcich compliance dokumentov (TODO #9–12) + verejné webové stránky a odkazy.

## Čo sa urobilo

### Nové compliance dokumenty (`docs/compliance/`)

1. **`data-retention-schedule.md`** — detailný per-category retenčný plán. Zdroj pravdy `retention.service.ts`: audit buckety 24/60/84 mes (pseudonymizácia, nie mazanie), soft-deleted users 24 m, evidenčné dáta 60 m, zálohy 90 dní, Vercel logy 7 dní, Ecomail 30 dní. + zákonné lehoty controller scope (10 r. účtovníctvo).
2. **`information-security-policy.md`** — interný riadiaci dokument (klasifikácia INTERNÉ): access control (argon2id, TOTP AES-256-GCM, RBAC), multi-tenant izolácia, šifrovanie, secure SDLC, vuln management, logovanie, BCP/DR, incident response, fyzická/org bezpečnosť. SOC 2 / ISO 27001 baseline.
3. **`security-privacy-whitepaper.md`** — verejný sales enabler: dátová lokalita EÚ, šifrovanie, izolácia, GDPR, sub-processori, retencia, threat model summary (32 hrozieb / 0 vysokých reziduálnych), DR (RPO ≤24h/RTO ≤8h), breach notifikácia.
4. **`dpia-reference-pack.md`** — verejná pomôcka pre prevádzkovateľa s DPIA (čl. 35): threshold test (EDPB WP248), predvyplnený popis spracovania, riziká↔opatrenia, práva osôb, konzultácia ÚOOÚ SR. Odvodené z `legal/dpia-template.md`.

Všetky fakty čerpané z existujúcich docs (ROPA, threat-model, DR plán, breach plán) + kódu — nič vymyslené.

### Verejný web (`docs/marketing-site/`)

- **`security.html`** → https://inventario.estate/security (cleanUrls) — whitepaper ako HTML stránka v štýle webu (hero + sekcie + tabuľky).
- **`dpia.html`** → https://inventario.estate/dpia — DPIA Reference Pack ako HTML stránka.
- **`assets/shared.js`** — footer „Právne" rozšírený o odkazy Bezpečnosť a súkromie (/security) a DPIA Reference Pack (/dpia).

### Dokumentácia

- `compliance/README.md` — Fáza 2 roadmap presunutá z „Pripravované" do „✅ hotové".
- `TODO.md` — #9–12 označené DONE.

## Overenie

- `reuse lint` = **632/632** compliant (6 nových súborov má SPDX hlavičky).
- Nové HTML stránky majú `<main id="main">`, `aria-hidden` na dekoratívnych emoji, `lang="sk"` — konzistentné s WCAG fixmi.

## Otvorené / ďalšie kroky

- Voliteľné: vygenerovať PDF verziu whitepaperu (sales) z HTML.
- Pred reálnym zákazníkom: právne pripomienkovanie dokumentov advokátom (štandardný disclaimer).
- Zvyšné pre-GA: `@axe-core/cli` v CI, súkromné blob URL, Zebra ZPL test, smoke/DR test, E2E protokolov.

## Referencie

- `docs/compliance/README.md` (roadmap) · `docs/TODO.md` #9–12
- Zdroje faktov: `gdpr-article-30.md`, `threat-model.md`, `disaster-recovery-plan.md`, `breach-notification-plan.md`, `legal/dpia-template.md`, `retention.service.ts`

<!--
SPDX-FileCopyrightText: 2026 LTK Solutions, s.r.o.
SPDX-License-Identifier: CC-BY-4.0
-->

# Compliance — Inventario

Tento adresár obsahuje compliance dokumentáciu LTK Solutions, s.r.o. pre platformu Inventario podľa GDPR, slovenského zákona č. 18/2018 Z. z. a ďalších relevantných predpisov.

> ⚠️ **Disclaimer**: Všetky dokumenty sú technicko-právne šablóny pripravené podľa GDPR a EDPB best practices. **Pred prvým použitím s reálnym zákazníkom musia byť pripomienkované slovenským advokátom** špecializujúcim sa na ochranu osobných údajov a IT právo.

---

## Štruktúra dokumentov

### Záznamy o spracovateľských činnostiach (čl. 30 GDPR)

| Dokument                                                           | Účel                                                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| [`gdpr-article-30.md`](./gdpr-article-30.md)                       | **Processor view** — LTK Solutions ako sprostredkovateľ pre Inventario tenant-ov (čl. 30 ods. 2)     |
| [`gdpr-article-30-controller.md`](./gdpr-article-30-controller.md) | **Controller view** — LTK Solutions ako prevádzkovateľ vlastných business operations (čl. 30 ods. 1) |

### Právne dokumenty pre tenant-ov

| Dokument                                                   | Účel                                                                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [`legal/privacy-policy.md`](./legal/privacy-policy.md)     | **Privacy Policy** — Ochrana súkromia pre navštevníkov webu a zákazníkov (čl. 13 GDPR)                                              |
| [`legal/dpa-template.md`](./legal/dpa-template.md)         | **DPA Template** — Zmluva o spracúvaní osobných údajov medzi LTK a tenant-om (čl. 28 GDPR)                                          |
| [`legal/terms-of-service.md`](./legal/terms-of-service.md) | **Terms of Service** — Všeobecné obchodné podmienky používania platformy Inventario (Hlavná zmluva v zmysle DPA), vrátane AUP a SLA |
| [`legal/sub-processors.md`](./legal/sub-processors.md)     | **Verejný register sub-processors** — publikovaný na https://inventario.estate/sub-processors                                       |
| [`legal/dpia-template.md`](./legal/dpia-template.md)       | **DPIA Template** — pred-vyplnená šablóna DPIA pre tenant-a (prevádzkovateľa), čl. 35 GDPR + čl. 28 ods. 3 písm. f (pomoc s DPIA)   |

### Interné procesné dokumenty

| Dokument                                                       | Účel                                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`breach-notification-plan.md`](./breach-notification-plan.md) | **Breach Notification Plan** — postup pri Porušení ochrany OÚ (čl. 33–34 GDPR)                              |
| [`disaster-recovery-plan.md`](./disaster-recovery-plan.md)     | **Disaster Recovery Plan** — obnova po havárii, RPO ≤ 24h, RTO ≤ 8h                                         |
| [`threat-model.md`](./threat-model.md)                         | **Threat Model (STRIDE)** — analýza hrozieb aplikačnej a infra vrstvy (32 hrozieb, 0 vysokých reziduálnych) |

### Posúdenie rizika

| Dokument                                               | Účel                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [`threshold-assessment.md`](./threshold-assessment.md) | **Threshold Assessment / DPIA Pre-screen** pre platformu Inventario ako celok (čl. 35 GDPR + EDPB WP248 + zoznam ÚOOÚ SR) |

### Accessibility

| Dokument                                         | Účel                                 |
| ------------------------------------------------ | ------------------------------------ |
| [`wcag-2.1-aa-audit.md`](./wcag-2.1-aa-audit.md) | Audit prístupnosti podľa WCAG 2.1 AA |

---

## Roadmap dokumentov

### ✅ Hotové (verzia 1.0)

- ROPA Processor view (`gdpr-article-30.md` v2.0)
- ROPA Controller view (`gdpr-article-30-controller.md`)
- DPA Template (`legal/dpa-template.md`)
- Breach Notification Plan (`breach-notification-plan.md`)
- Disaster Recovery Plan (`disaster-recovery-plan.md`)
- Privacy Policy (`legal/privacy-policy.md`)
- Terms of Service + AUP + SLA (`legal/terms-of-service.md`)
- Sub-processor list (`legal/sub-processors.md`)
- Threshold Assessment / DPIA Pre-screen (`threshold-assessment.md`)
- WCAG 2.1 AA audit
- **Threat Model (STRIDE)** (`threat-model.md`) — 32 hrozieb, 0 vysokých reziduálnych
- **DPIA Template pre tenant-ov** (`legal/dpia-template.md`) — pred-vyplnená šablóna

### ✅ Fáza 1 kompletná — všetky dokumenty pre go-live SFZ pilot

### ⏳ Pripravované — Fáza 2 (pred ďalšími tenant-mi po SFZ)

- **Security & Privacy Whitepaper** (verejný PDF — sales enabler, šetrí customer due diligence)
- **Data Retention Schedule** (detailný per-category dokument nad rámec sumáru v ROPA)
- **Information Security Policy** (interný)
- **DPIA Reference Pack** publikovaný na https://inventario.estate/dpia (verejná verzia DPIA template)
- **Audit log retention job** — automatická pseudonymizácia po 24/60/84 mes (impl. — viac v NEXT.md)

### 📅 Plánované v budúcnosti

- **SOC 2 Type II roadmap** — pri prvom enterprise zákazníkovi
- **ISO/IEC 27001 roadmap** — pri verejnom obstarávaní s touto požiadavkou
- **Trust Center stránka** — po 5+ tenant-och
- **DPO designation** — pri raste tímu / scope nad threshold

---

## Quick reference — kľúčové fakty

| Otázka                                       | Odpoveď                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| **Kto je controller pre tenant data?**       | Tenant (organizácia ktorá používa Inventario)                           |
| **Kto je processor pre tenant data?**        | LTK Solutions, s.r.o.                                                   |
| **Kto je controller pre LTK business data?** | LTK Solutions, s.r.o.                                                   |
| **Hlavná doména**                            | https://inventario.estate                                               |
| **Kontakt pre GDPR**                         | privacy@inventario.estate                                               |
| **Kontakt pre security incidents**           | security@inventario.estate                                              |
| **Kontakt pre právne otázky**                | legal@inventario.estate                                                 |
| **Lokalita primárnych dát**                  | EÚ — Vercel cdg1/fra1 + MongoDB Atlas eu-central-1                      |
| **Default email provider**                   | Ecomail.cz (EÚ)                                                         |
| **Voliteľný email provider**                 | Resend, Inc. (USA — per-tenant opt-in)                                  |
| **OAuth providers**                          | Microsoft Entra ID, Google, Apple (planned)                             |
| **MFA**                                      | TOTP (RFC 6238), per-tenant policy (DISABLED/OPTIONAL/REQUIRED)         |
| **Šifrovanie at rest**                       | MongoDB Atlas AES-256                                                   |
| **Šifrovanie hesiel**                        | argon2id KDF                                                            |
| **Šifrovanie MFA secrets**                   | AES-256-GCM s key v env                                                 |
| **Breach notification → tenant**             | Do 24 hodín od zistenia (DPA bod 3.7.1)                                 |
| **Audit retention — bežné akcie**            | 24 mesiacov                                                             |
| **Audit retention — security udalosti**      | 60 mesiacov                                                             |
| **DPA contact (tenant-side, podpisovateľ)**  | Štatutárny zástupca tenant-a — **nesmie mať konflikt záujmov voči LTK** |

---

## Workflow pri novom tenant onboardingu

1. **Pred podpisom čokoľvek**:
   - Tenant-side conflict of interest check (ak relevantné — napr. SFZ kde Ing. Ján Letko pôsobí v dvojakom postavení)
   - Tenant-side procurement decision trail (vendor selection rationale, schválenie orgánom tenant-a)
2. **Príprava zmluvných dokumentov**:
   - Vyplnenie DPA Template (`legal/dpa-template.md`) o údaje konkrétneho tenant-a
   - Príprava Order Form / Master Service Agreement (financiálne podmienky — samostatne)
3. **Podpis**:
   - DPA: konateľ LTK + štatutárny zástupca tenant-a (nesmie byť osoba s konfliktom záujmov)
   - Hlavná zmluva: rovnako
4. **Onboarding tenant-a v platforme**:
   - Vytvorenie Organisation dokumentu s nastavením `settings.invitations.enforceAllowedDomains`, `settings.mfa.policy`, `allowedAuthProviders`
   - Pozvanie prvého ADMIN-a tenant-a
5. **Notifikácie**:
   - Tenant je pridaný do listu komunikácie pri zmenách sub-processors (privacy@inventario.estate alebo verejná stránka)
6. **Ongoing**:
   - Mesačne — kontrola audit log na anomálie
   - Štvrťročne — disaster recovery test
   - Ročne — penetration testing
   - Pri zmene sub-processors — 30-day advance notification tenant-ovi
   - Pri Porušení ochrany — 24h notification tenant-ovi

---

## Súvisiace dokumenty mimo `docs/compliance/`

- [`docs/decisions/0010-multi-tenant-white-label.md`](../decisions/0010-multi-tenant-white-label.md) — ADR pre multi-tenant architektúru
- [`docs/decisions/0011-licensing-eupl-reuse.md`](../decisions/0011-licensing-eupl-reuse.md) — Licensing rozhodnutie (EUPL-1.2 + CC-BY-4.0 + REUSE 3.3)
- [`docs/decisions/0013-multi-provider-auth-self-serve.md`](../decisions/0013-multi-provider-auth-self-serve.md) — Multi-provider auth
- [`docs/milestones/slice-7-totp-mfa.md`](../milestones/slice-7-totp-mfa.md) — TOTP MFA implementácia
- `packages/shared-types/src/schemas/audit-log.ts` — Audit log Zod schéma s `legalBasis` a `dataCategories` enums

---

**Aktualizácie tohto README**: pri každom pridaní / odstránení / podstatnej úprave dokumentu v `docs/compliance/`.

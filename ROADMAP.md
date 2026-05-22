<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Roadmap — Inventario

> **Last updated:** 22. máj 2026
> **Status:** Active
> **Current version:** v0.3

---

## Filozofia roadmapy

Inventario je **dlhodobý open-source projekt** určený pre slovenský verejný a neziskový sektor. Roadmapa je preto **konzervatívna v termínoch** a **agresívna v kvalite**. Žiadne deadlines z marketingových dôvodov — ship-ujeme keď je to ready.

### Vodítka pre roadmapu

1. **Backend pred frontendom** — silný API foundation umožňuje rýchlejší frontend vývoj
2. **Compliance pred features** — EU public sector pripravenosť je core value
3. **Open source pred proprietárnou stratégiou** — všetko musí byť forkovateľné
4. **Tests pred speed** — backend má 962 testov, frontend bude mať Playwright E2E
5. **Slovak language native** — i18n je možnosť, ale SK má prioritu

---

## 🎯 Done — čo už máme (v0.3)

### Strategický foundation

- [x] Open-source strategia (EUPL-1.2 + CC-BY-4.0 + REUSE 3.3)
- [x] Multi-tenant white-label architektúra (ADR-0010)
- [x] Brand identita prevzatá zo SportUp ekosystému
- [x] Brand system v1.0 (BRAND.md, logo, pattern, palette)
- [x] Pricing strategy v1.0 (hybrid C + Annual Contract pre verejný sektor)

### Backend (slice #1 → #3 partial)

- [x] pnpm monorepo s Turborepo (apps/api, apps/web, apps/mcp-server, packages/shared-types, design-tokens)
- [x] Fastify + TypeScript + Zod backend
- [x] MongoDB Atlas Flex (dev + prod clustery)
- [x] Microsoft Entra ID SSO (JWT verifikácia + JWKS rotation + JIT user provisioning)
- [x] RBAC (3 roly: EMPLOYEE, ASSET_MANAGER, ADMIN)
- [x] Assets module (CRUD + audit log + transakcie + soft-delete)
- [x] Inventory number generator (PREFIX-YYYY-NNN)
- [x] Categories module (hierarchické, slug generation, cycle detection, max depth 5)
- [x] Locations module (paritný s categories)
- [x] FK protection v oboch smeroch (assets ↔ categories/locations)
- [x] Audit log s typmi pre všetky entity
- [x] 962 integration testov (CI green proti Atlas dev)
- [x] Pre-commit hooks (lint-staged + typecheck) + GitHub Desktop kompatibilita

### Design + Marketing + Docs

- [x] 6 P0 mockupov plne interaktívnych (Login, Dashboard, Assets, Detail, Loan, My loans)
- [x] 4 demo tenanti s vlastnými brand identitámi
- [x] Marketingový web (5 stránok + landing + demo wrapper)
- [x] **Interactive demo** stranka (interactive-demo.html, 6 obrazoviek, dual-mode sticky bar)
- [x] **Documentation site** (Nextra v4.6.0 + Next.js 15.5, 7 stránok, Pagefind search) — https://docs.inventario.sportup.sk
- [x] **Clean URLs** po celom marketing site (vrchná nav + footer + cross-page CTAs)
- [x] Favicon, Open Graph meta tags
- [x] Brand pattern overlay (CSS, scalable)

---

## 🚀 v0.4 — Frontend foundation (Q2 2026)

**Cieľ:** Funkčný frontend ktorý pripojí na existujúci backend.

### Backend (dokončenie slice #3)

- [ ] **K10**: Users admin module (ADMIN-only)
  - GET /v1/users (list + pagination + filtre)
  - GET /v1/users/:id
  - PATCH /v1/users/:id (role, isActive)
  - Edge cases: admin sa nemôže deaktivovať, posledný ADMIN je chránený
  - Audit log USER_ROLE_CHANGED
  - ~30-40 testov
- [ ] **K11**: Slice #3 milestone dokument

### Backend (slice #4 príprava)

- [ ] Migrácia: pridať `organisationId: ObjectId` field do všetkých kolekcií
- [ ] Tenant middleware (extrakcia organisationId z JWT)
- [ ] Repository auto-filter podľa organisationId
- [ ] CI: multi-tenant izolačné testy
- [ ] OpenAPI 3.1 spec export (auto-generated zo Zod schém)
- [ ] SBOM CycloneDX export

### Frontend (slice #4)

- [ ] Next.js 15 (App Router) setup v `apps/web`
- [ ] Design tokens import z `packages/design-tokens`
- [ ] Tailwind CSS s brand tokens
- [ ] Microsoft Entra ID OAuth flow
- [ ] Implementácia 6 P0 obrazoviek podľa mockupov:
  - [ ] Login
  - [ ] Dashboard (role-aware)
  - [ ] Assets list (live filter, grid/table toggle)
  - [ ] Asset detail (5 tabs, real QR)
  - [ ] Loan request wizard (3 steps)
  - [ ] My loans (tabs)
- [ ] Playwright E2E tests pre kritické flow-y
- [ ] WCAG 2.1 AA audit

### DevOps

- [ ] Vercel deploy pipeline pre `apps/web`
- [ ] Production doména `app.inventario.estate`
- [ ] Staging environment `staging.inventario.estate`

---

## 🌐 v0.5 — Multi-tenant + onboarding (Q3 2026)

**Cieľ:** Schopnosť spustiť reálnych tenantov v produkcii.

### Backend (slice #5)

- [ ] Tenant management API (Admin only)
- [ ] Tenant onboarding flow (create org, init demo data, invite first admin)
- [ ] Brand customization per tenant (logo upload, color picker)
- [ ] Email notifications (transakčné cez Resend / Postmark)
- [ ] Email templates (žiadosť o výpožičku, schválené, blízky termín, po-termíne)

### Frontend (slice #5)

- [ ] Onboarding flow UI pre nový tenant
- [ ] Admin panel pre tenant management
- [ ] Brand customization UI (Pro/Enterprise plan only)
- [ ] Notification preferences
- [ ] Email digest preferencie

### Compliance

- [ ] GDPR Article 30 hardening (extended audit log s data categories)
- [ ] DPIA (Data Protection Impact Assessment) dokument
- [ ] Data Processing Agreement (DPA) template pre Enterprise
- [ ] Privacy Policy + Terms of Service (SK + EN)

### Production readiness

- [ ] Prvý production tenant z founding contributors
- [ ] Sentry / Datadog monitoring
- [ ] Disaster Recovery Plan
- [ ] Backup strategy + recovery testing

---

## 📱 v0.6 — Mobile + integrácie (Q4 2026)

**Cieľ:** Mobile-first user experience + ekosystémové integrácie.

### Mobile

- [ ] Progressive Web App (PWA) — install on home screen
- [ ] Native mobile app v Flutter (`apps/mobile`)
- [ ] QR scan workflow optimalizovaný pre mobile
- [ ] Offline support (limited features)
- [ ] Push notifications

### Integrácie

- [ ] **SportUp identity** ako druhý SSO provider
- [ ] **Webhooks** (Slack, Microsoft Teams notifications)
- [ ] **OIDC / SAML** support pre Enterprise (Okta, Auth0, Keycloak)
- [ ] **REST API public docs** na `docs.inventario.estate`
- [ ] **Postman collection** export

### Frontend enhancements

- [ ] Inteligentný onboarding (info ikony, empty states, contextual nudges)
- [ ] Customizable dashboard widgets
- [ ] Bulk operations (multi-select pre actions)
- [ ] Advanced filtering (saved filters)
- [ ] Print-friendly views (asset cards, loan protocols)

---

## 🤖 v0.7 — AI + chatbot (Q1 2027)

**Cieľ:** AI-augmented user experience.

### MCP server expansion

- [ ] MCP server hostovaný (production endpoint)
- [ ] AI tools: search assets, request loan, approve, generate reports
- [ ] Documentation chatbot s RAG over docs.inventario.estate
- [ ] Anthropic Claude API integration

### Chatbot v aplikácii

- [ ] Chat UI komponent
- [ ] Vector embeddings v MongoDB Atlas Vector Search
- [ ] Markdown frontmatter pre docs (topics, concepts tagy)
- [ ] `/api/help/search` endpoint
- [ ] "Ask AI" button v každej sekcii

### Reporting + analytics

- [ ] AI-generated reports (monthly utilization, anomalies)
- [ ] Predictive insights (likely overdue, replacement timing)
- [ ] Smart suggestions (kde by sa hodilo pridať asset)

---

## 🏛️ v1.0 — Production GA (Q2 2027)

**Cieľ:** Verejne dostupné, plne produkčné.

### Pre-launch

- [ ] WCAG 2.1 AA audit hotový (external auditor)
- [ ] Penetration test (external security firm)
- [ ] DPIA finalizovaná
- [ ] Threat Model dokumentovaný
- [ ] Backup + DR plán otestovaný
- [ ] Public GitHub repo otvorenie
- [ ] Public documentation site live
- [ ] Marketing campaign

### Launch milestones

- [ ] Prvý production tenant z founding contributors
- [ ] 5 ďalších founding contributors (mestá, kluby, školy, športové zväzy)
- [ ] EU rozvojové fondy aplikácia (OPII / Digital Europe / Horizon)
- [ ] Verejná publikácia v Slovak tech press

### Post-launch (priebežne)

- [ ] Community building (Discord, GitHub Discussions)
- [ ] Quarterly releases (v1.1, v1.2, ...)
- [ ] User research + feature prioritization

---

## 🔮 Long-term ideas (Q3 2027+)

### Ekosystémové integrácie

- [ ] **ÚPVS** (Ústredný portál verejnej správy) integrácia
- [ ] **RPO** (Register právnických osôb) lookup
- [ ] **RFO** (Register fyzických osôb) lookup
- [ ] **Slovensko.sk** SSO

### Advanced features

- [ ] **Multi-region deployment** (US, EU East)
- [ ] **GraphQL API** popri REST
- [ ] **Real-time collaboration** (multiple users editing same asset)
- [ ] **Custom workflows** (visual workflow builder)
- [ ] **Audit trail blockchain anchoring** (pre extreme compliance cases)

### Ecosystem & partnerships

- [ ] **Inventario certified partners** (implementačné firmy)
- [ ] **Marketplace** pre custom plugins
- [ ] **Industry-specific templates** (športové kluby, mestá, školy, divadlá)

### Regulatory readiness

- [ ] **CRA** (EU Cyber Resilience Act) compliance — deadline 2027
- [ ] **NIS2** directive compliance
- [ ] **eIDAS 2.0** integration (qualified electronic signatures pre protokoly)

---

## 📊 Success metrics

Ako vieme, že nám projekt darí?

### Adopting metrics

- Počet aktívnych tenantov (target end of 2027: 50+)
- Počet aktívnych používateľov (target end of 2027: 5 000+)
- Počet zaevidovaných položiek majetku (target end of 2027: 100 000+)

### Quality metrics

- 99.9 % uptime (Enterprise SLA)
- Zero data leakage incidents
- WCAG 2.1 AA compliance maintained
- REUSE 3.3 compliance maintained (100 %)

### Community metrics

- GitHub stars (target end of 2027: 500+)
- GitHub forks (target: 20+)
- External contributors (target: 10+)

### Business metrics

- Annual Recurring Revenue (target end of 2027: €100 000+)
- Customer retention (target: > 90 %)
- Net Promoter Score (target: > 50)

---

## 🔄 Roadmap update protocol

Táto roadmapa sa **aktualizuje raz za quarter** alebo pri zásadných zmenách smerovania (napríklad pivot, partnership announcement).

Update history:

| Dátum      | Verzia | Zmena                                       |
| ---------- | ------ | ------------------------------------------- |
| 2026-05-15 | v1.0   | Initial roadmap                             |
| 2026-05-22 | v1.1   | Refresh — 962 testov, founding contributors |

---

## 🤝 Contribution & feedback

Roadmapa je **otvorený dokument**. Ak máte návrhy alebo otázky:

- 🐙 **GitHub Issues** s label-om `roadmap`
- 📧 **inventario@ltk.solutions**
- 💬 **GitHub Discussions** (po public open-source release)

---

**Disclaimer:** Roadmapa je orientačná. Konkrétne termíny a poradie features môžu sa zmeniť na základe feedback-u od zákazníkov, technologického vývoja, EU regulácií alebo strategických rozhodnutí. Žiadne tu uvedené tvrdenia nepredstavujú právne záväzný commitment.

<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Day summary — 2026-05-21

> Veľký produktívny deň. Tri samostatné bloky práce: dokončenie invite flow (Slice #6c K18), TOTP MFA (Slice #7), a začiatok compliance work (DPIA → DPA, ROPA refactor, sub-processor list).

| Atribút     | Hodnota                                                              |
| ----------- | -------------------------------------------------------------------- |
| **Dátum**   | 2026-05-21                                                           |
| **Trvanie** | Celý deň (ráno → noc)                                                |
| **Modely**  | Sonnet 4.6 (väčšina implementácie) + Opus 4.7 (compliance dokumenty) |
| **Testy**   | 454 → **480** (26 nových MFA testov)                                 |
| **Commity** | 8+ commitov                                                          |

---

## TL;DR

- ✅ **Slice #6c K18** invite flow (backend + frontend) — kompletný
- ✅ **Slice #7** TOTP MFA (backend + frontend + tests) — kompletný, 480/480 tests
- ✅ **DPIA strategická analýza** — zistené že plnú DPIA pre SFZ pilot nepotrebujeme; namiesto toho vyrobený širší compliance balík
- ✅ **5 compliance dokumentov** vyrobených pre LTK Solutions ako multi-tenant SaaS processor:
  - DPA Template
  - Sub-processor list (verejný)
  - ROPA Processor view (refactor existujúceho)
  - ROPA Controller view (nový)
  - Compliance README index
- 🎯 **Zásadné objasnenie:** Inventario nie je SFZ interný projekt, ale **komerčný produkt LTK Solutions, s.r.o.**, SFZ je iba prvý zákazník

---

## Blok 1 — Slice #6c K18 (invite flow)

### K18.1 – K18.4: Backend invitations

Pridaný modul `apps/api/src/modules/invitations/` s 5 endpointmi:

- `POST /v1/invitations` — vytvorenie pozvánky (ADMIN + ASSET_MANAGER)
- `GET /v1/invitations` — list pending invitations
- `DELETE /v1/invitations/:id` — revoke pending invite
- `GET /v1/auth/invitations/:token` — public preview pre invitee
- `POST /v1/auth/accept-invitation` — password-based accept

Kľúčové vlastnosti:

- Pending invitee = User dokument s `passwordHash=null` + `emailVerificationToken=<token>` (žiadna separátna collection)
- `Organisation.settings.invitations.enforceAllowedDomains` flag pre doménovú politiku
- ASSET_MANAGER nemôže pozvať ADMIN-a (sanity check)
- Audit events: `USER_INVITED`, `USER_INVITATION_REVOKED`, `USER_INVITATION_ACCEPTED`
- E-mail template `sendInvitationEmail` s Inventario brandingom

**Bug fix počas testov**: MongoDB sparse unique index na `entraOid` indexuje aj `null` hodnoty → druhý invite document s `entraOid:null` hodil E11000. Riešenie: `entraOid` field úplne vynechaný z invite dokumentov (nie `null`, ale nedefinovaný).

### K18.5 – K18.6: Frontend invite flow

Pridané stránky:

- `/accept-invite` — public preview + password setup form + Google/Microsoft SSO buttons
- `/settings/invitations` — admin UI: send form, pending table, debounced search, revoke action

Pridané do AppShell: nav item "Pozvánky" s Mail ikonkou.

**Status**: K18.3 (OAuth invite accept path) odložený — vyžaduje rozšírenie `oauth-state.ts` + úpravu callback handleru. ~2–3h práce, K7 mal prednosť pre pilot.

---

## Blok 2 — Slice #7 (TOTP MFA)

Komplexný feature: tenant-level optional TOTP MFA pre email-password používateľov.

### Architektúra

- **Organisation policy** (`Organisation.settings.mfa.policy`): `DISABLED` / `OPTIONAL` / `REQUIRED`
- **OAuth users** preskočia MFA challenge (Google/MS majú vlastné MFA)
- **TOTP** podľa RFC 6238: SHA-1, 6 digits, 30s period, ±1 step window, constant-time compare
- **Secrets at rest**: AES-256-GCM šifrovanie cez `MFA_SECRET_ENCRYPTION_KEY` (32-byte env)
- **Recovery codes**: 8× `XXXX-XXXX` formát, argon2id hashed, single-use

### Implementácia

Bez nových production závislostí — celé RFC 6238 + RFC 4648 base32 implementované na ~140 riadkov v `apps/api/src/lib/`:

- `base32.ts` — RFC 4648 encoder/decoder
- `totp.ts` — TOTP generation + verification
- `mfa-crypto.ts` — AES-256-GCM encryption + argon2id recovery codes

Backend endpointy v `apps/api/src/modules/auth/mfa/mfa.routes.ts`:

- `POST /v1/auth/mfa/setup` — generuje secret + QR + 8 recovery codes
- `POST /v1/auth/mfa/verify-setup` — potvrdí prvým TOTP kódom
- `POST /v1/auth/mfa/disable` — vyžaduje password re-entry
- `POST /v1/auth/mfa/challenge` — exchange `mfaSessionToken` + code → JWT cookies
- `GET /v1/auth/mfa/status`

**Login flow zmena**: ak `user.mfaEnabled=true`, login vracia `202 { mfaRequired, mfaSessionToken }` namiesto cookies. Frontend uloží token do `sessionStorage` a presmeruje na `/login/mfa`.

### Frontend

- `/login/mfa` — TOTP challenge page, auto-submit pri 6 číslicach, toggle na recovery code mode
- `/settings/security` — MFA management: setup flow (QR + recovery codes display once) + disable s password re-entry
- Update `LoginPage` — handle 202 response
- AppShell — pridaný "Bezpečnosť" nav item

### Tests + bug fix

- 24 nových MFA integration testov pokrývajúcich celé flow
- Bug fix: `org.allowedAuthProviders` je `undefined` na legacy/test org docs → `undefined.includes(...)` TypeError → 500. Oprava: `allowedProviders ?? []` s `length > 0` check.
- Test fixtures: `resolveTestTenantId` org dokument dopelnený o `allowedAuthProviders`, `memberJoinPolicy`, `autoJoinDomains`

**Total**: 480/480 testov OK.

Milestone doc: [`docs/milestones/slice-7-totp-mfa.md`](../milestones/slice-7-totp-mfa.md)

---

## Blok 3 — Compliance work (DPIA strategická analýza + balík dokumentov)

### Strategická analýza — potrebujeme DPIA?

User sa opýtal "potrebujeme vobec DPIA?". Detailná analýza podľa GDPR čl. 35 ods. 3 + EDPB Guidelines WP248 (9 kritérií):

- Žiadne automatické triggers (čl. 35 ods. 3) sa neaplikujú
- Iba 1–2 hraničné EDPB kritériá (systematic monitoring cez audit log; vulnerable subjects = zamestnanci v power imbalance)
- **Záver**: DPIA nie je striktne povinná pre SFZ pilot

### Kontextová zmena — KRITICKÁ

User vyjasnil: **Inventario nie je SFZ interný projekt, ale komerčný produkt LTK Solutions, s.r.o.** SFZ je iba prvý zákazník (pilot).

Dôsledky:

1. LTK Solutions je súčasne **Controller** (vlastné business operations) **a Processor** (pre tenant-ov)
2. **DPA je POVINNÁ** pred go-live (čl. 28 GDPR) — bez nej je spracovanie nezákonné
3. ROPA je potrebná v dvojakej podobe (controller + processor view)
4. Sub-processor list musí byť verejný

### Conflict of Interest — ujasnenie

User je súčasne IT riaditeľ SFZ (mandátna zmluva) + konateľ LTK Solutions. Riešenie: **recusal-by-design** — user **nerozhoduje na SFZ strane** ktorý SW vybrať. To rieši self-dealing problém čisto.

Záznamy ktoré ale musia byť na SFZ strane:

- Disclosure konfliktu pred orgánom SFZ (výkonný výbor)
- Vendor selection rationale (prečo Inventario, aké alternatívy, ceny)
- DPA podpisuje iný štatutár SFZ (gen. sekretár alebo iný), nie user

### Vyrobené dokumenty

| Súbor                                                                                          | Účel                                                                               |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`docs/compliance/README.md`](../compliance/README.md)                                         | Index všetkých compliance dokumentov + roadmap + quick reference                   |
| [`docs/compliance/gdpr-article-30.md`](../compliance/gdpr-article-30.md) **(v2.0 rewrite)**    | ROPA Processor view — multi-tenant SaaS kontext, multi-provider auth, MFA, loans   |
| [`docs/compliance/gdpr-article-30-controller.md`](../compliance/gdpr-article-30-controller.md) | ROPA Controller view — LTK Solutions vlastné business operations (3 zamestnanci)   |
| [`docs/compliance/legal/dpa-template.md`](../compliance/legal/dpa-template.md)                 | DPA Template podľa EDPB SCC Module 2 — 600+ riadkov, slovenský jazyk               |
| [`docs/compliance/legal/sub-processors.md`](../compliance/legal/sub-processors.md)             | Verejný register sub-procesorov pre publikáciu na inventario.estate/sub-processors |

**~50 strán právno-technickej dokumentácie** v slovenčine.

### Kľúčové dáta v DPA / sub-processors

- LTK Solutions, s.r.o., IČO 45 949 310, DIČ 2023148017, IČ DPH SK2023148017
- Sídlo: Banícka 1894/17, 968 01 Nová Baňa
- OR: Okresný súd Banská Bystrica, oddiel Sro, vložka 19280/S
- Konateľ: Ing. Ján Letko
- Doména platformy: https://inventario.estate
- Kontakty: privacy@inventario.estate, security@inventario.estate, legal@inventario.estate
- Sub-processors (default): Vercel, MongoDB Atlas (AWS eu-central-1 Frankfurt), Ecomail.cz, Microsoft Entra ID, Google, Apple (planned)
- Sub-processors (per-tenant opt-in): Resend
- Anthropic explicitly **nie je sub-processor** — dev-only nástroj

---

## Vytvorené / významne upravené súbory

### Backend (kód)

- `apps/api/src/modules/invitations/invitations.repository.ts` (new)
- `apps/api/src/modules/invitations/invitations.routes.ts` (new)
- `apps/api/src/modules/auth/mfa/mfa.routes.ts` (new)
- `apps/api/src/lib/base32.ts` (new)
- `apps/api/src/lib/totp.ts` (new)
- `apps/api/src/lib/mfa-crypto.ts` (new)
- `apps/api/src/plugins/email.ts` — pridaný `sendInvitationEmail` + `invitationEmailHtml`
- `apps/api/src/plugins/inventario-jwt.ts` — pridaný `issueMfaSessionToken` + `verifyMfaSessionToken`
- `apps/api/src/plugins/config.ts` — pridaný `MFA_SECRET_ENCRYPTION_KEY` env var
- `apps/api/src/modules/auth/email-auth.routes.ts` — MFA gate (202 response) + bug fix `allowedAuthProviders ?? []`
- `apps/api/src/modules/users/users.repository.ts` — `PUBLIC_PROJECTION` rozšírená o MFA secrets
- `apps/api/src/modules/users/users.service.ts` — User construction s MFA defaults
- `apps/api/src/server.ts` — registrácie nových plugins
- `apps/api/tests/setup.ts` — ephemeral MFA encryption key per test run
- `apps/api/tests/helpers/test-fixtures.ts` — org dokument doplnený o `allowedAuthProviders`, `memberJoinPolicy`, `autoJoinDomains`
- `packages/shared-types/src/schemas/user.ts` — pridané MFA fields
- `turbo.json` — `MFA_SECRET_ENCRYPTION_KEY` v globalEnv

### Tests

- `apps/api/tests/integration/invitations-post.test.ts` (new)
- `apps/api/tests/integration/invitations-accept.test.ts` (new)
- `apps/api/tests/integration/mfa.test.ts` (new — 24 testov)

### Frontend

- `apps/web/src/app/accept-invite/page.tsx` (new) + `AcceptInvitePage.tsx` component
- `apps/web/src/app/settings/invitations/page.tsx` (new) + `InvitationsContent.tsx`
- `apps/web/src/app/settings/security/page.tsx` (new) + `SecurityContent.tsx`
- `apps/web/src/app/login/mfa/page.tsx` (new) + `MfaChallengePage.tsx`
- `apps/web/src/components/LoginPage.tsx` — 202 response handling
- `apps/web/src/components/AppShell.tsx` — pridané "Pozvánky" + "Bezpečnosť" nav items

### Documentation

- `docs/milestones/slice-7-totp-mfa.md` (new)
- `docs/compliance/README.md` (new)
- `docs/compliance/gdpr-article-30.md` (v2.0 rewrite)
- `docs/compliance/gdpr-article-30-controller.md` (new)
- `docs/compliance/legal/dpa-template.md` (new)
- `docs/compliance/legal/sub-processors.md` (new)
- `docs/sessions/NEXT.md` — aktualizované

---

## Lessons learned

1. **MongoDB sparse unique indexy indexujú aj `null` hodnoty** — nedefinovaný field = mimo indexu, ale explicit `null` = v indexe. Pre invite docs s `entraOid` to znamená že field musí byť **úplne vynechaný**, nie nastavený na null.

2. **`exactOptionalPropertyTypes: true`** v tsconfig prísne kontroluje že optional fields nemôžu mať explicit `undefined`. Pri spread operatoroch s podmienkami treba používať `...(value !== undefined ? { field: value } : {})` pattern.

3. **Test fixtures musia byť kompletné** — `resolveTestTenantId` pôvodne nevracal `allowedAuthProviders`, čo lámalo MFA testy. Memo for future: keď pridávam novú policy / settings field, treba aktualizovať aj test fixtures, nielen production code.

4. **Strategická hodnota čestnej DPIA analýzy** — namiesto písania 30-stranového dokumentu "lebo to treba", odhalili sme že DPIA nie je striktne povinná a vyrobili sme efektívnejší 5-dokumentový balík (DPA + 2× ROPA + sub-processors + README). Ušetrené ~15 hodín práce.

5. **Konflikt záujmov sa rieši "by design", nie post-hoc disclosure** — user sa od začiatku vyhol konfliktu tým, že na SFZ strane nerozhoduje. Toto je čistejšie riešenie ako conflict-of-interest waivers.

6. **Compliance dokumenty sú multi-tenant aktívum** — DPA template a sub-processor list napísané raz, použijú sa pri každom budúcom tenant-ovi. Investícia ~5 hodín ušetrí ~50 hodín pri 10 tenant-och.

---

## Akčné body pre teba pred SFZ podpisom

| #   | Úloha                                                                                          | Kto                          | Termín           |
| --- | ---------------------------------------------------------------------------------------------- | ---------------------------- | ---------------- |
| 1   | Vytvoriť mailboxy `privacy@`, `security@`, `legal@` na inventario.estate (domain catch-all OK) | Ty                           | Pred podpisom    |
| 2   | Zaznamenať konflikt záujmov SFZ↔LTK — zápis výkonného výboru SFZ                               | SFZ-strana                   | Pred podpisom    |
| 3   | Vendor selection rationale dokument na SFZ strane                                              | SFZ-strana                   | Pred podpisom    |
| 4   | **Právny review všetkých 5 compliance dokumentov** slovenským GDPR/IT advokátom                | Externý advokát (~300–500 €) | Pred podpisom    |
| 5   | Pripraviť stránku `https://inventario.estate/sub-processors` (publikovať sub-processors.md)    | Frontend / marketing site    | Pred podpisom    |
| 6   | Pripraviť stránku `https://inventario.estate/dpia` s DPIA Reference Pack                       | Fáza 2 compliance            | Pred 2. tenantom |

---

## Status na konci dňa

| Oblasť                         | Stav                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| **Slice #6c (auth migration)** | ✅ K17.5 + K18.1–K18.6 done. K18.3 OAuth invite accept odložené.                                  |
| **Slice #7 (TOTP MFA)**        | ✅ Kompletne done, 480/480 tests.                                                                 |
| **Compliance Fáza 1**          | ⏳ 5/9 dokumentov done. Zostáva: Privacy Policy, ToS, Breach Plan, DR Plan, Threshold Assessment. |
| **Compliance Fáza 2**          | ⏳ 0/4 dokumentov done.                                                                           |
| **Pilot ready**                | ❌ Nie — chýba právny review, zvyšok Fázy 1, env vars na Vercel prod                              |

---

**Posledná aktualizácia**: 2026-05-21 (večer)

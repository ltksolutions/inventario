<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# TODO — implementačný backlog Inventario

> **Účel.** Zdroj pravdy pre „čo treba dorobiť". Položky, kde je rozhodnutie spravené
> (ADR Accepted) alebo právna povinnosť identifikovaná, ale **kód/dokument ešte nie je**.
>
> Tento súbor je **backlog**, nie denný plán. Aktuálny stav a najbližšie 2–3 kroky drží
> [`docs/sessions/NEXT.md`](./sessions/NEXT.md). Testovanie sa rieši priebežne pri každej
> položke (workflow pravidlo: testy s každou zmenou) — preto tu nie je samostatná „testovacia" sekcia.

| Atribút                   | Hodnota                                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Posledná aktualizácia** | 2026-06-15 (#25 marketing screenshoty + `/screenshots`, demo odstránené; zosúladené stale checkboxy — ADR-0028/0030/0031 + member extras overené DONE priamo v kóde) |
| **Stav projektu**         | Production LIVE ✅ — SFZ pilot aktívne testovaný                                                                                                                     |
| **Legenda priorít**       | 🔴 P0 pilot · 🟠 P1 GDPR práva · 🟡 P2 ADR impl · 🟢 P3 docs · 🔵 P4 neskôr                                                                                          |
| **Legenda modelu**        | Opus = architektúra/ADR/security · Sonnet = impl/CRUD/frontend · Haiku = scoped docs                                                                                 |

---

## 🔴 P0 — pred / krátko po SFZ pilote

### 1. ADR-0021 — QR kódy majetku ✅ DONE (2026-06-01)

- **Stav:** K1-K7 kompletné
- **Session:** [`docs/sessions/2026-06-01-adr-0021-qr-k1-k3.md`](./sessions/2026-06-01-adr-0021-qr-k1-k3.md)
- **Čo bolo implementované:**
  - [x] `publicToken` na `AssetSchema` + generovanie pri POST (K1+K2)
  - [x] `inventoryNumberFormat` per tenant (K2)
  - [x] on-demand QR render `GET /v1/assets/:id/qr?format=svg|png` (K3)
  - [x] verejný `GET /v1/public/scan/:token` — opt-in, `PublicAssetView` whitelist, rate-limited (K4)
  - [x] frontend: `/scan/[token]` route + QR na detaile + Settings foundContactInfo (K5)
  - [x] whitelist test pre `PublicAssetViewSchema` (K6)
  - [x] openapi regen (K7)

### 23. BULK asset create — RECEIPT pohyb pri vytvorení ✅ DONE (2026-06-07)

- **Stav:** ✅ implementované 2026-06-06, otestované na prode 2026-06-07 (príjem +10 ks na `SFZ-2026-00002`, ledger = cache = UI, Reconciliation OK; overené aj priamo v DB cez inventario-prod MCP)
- **Session:** [`docs/sessions/2026-06-07-sklad-test-receipt.md`](./sessions/2026-06-07-sklad-test-receipt.md)
- **Kontext:** `ApiCreateAssetBodySchema` + `CreateAssetSchema` majú `initialQuantity`, frontend posiela hodnotu, ale `assets.service.ts` `create()` ho ignoruje — `quantityOnHand` zostane `null` a nevytvorí sa `StockMovement` RECEIPT záznam.
- **Čo treba:**
  1. `assets.routes.ts` — injektnúť `StockMovementsRepository` do `AssetsService` konštruktu (pridať `new StockMovementsRepository(fastify.mongo.db)` a odovzdať ako 7. argument)
  2. `assets.service.ts` — revertovať `_stockMovementsRepo` removal, obnoviť import, a po inserte BULK assetu v transakcii:
     - `stockMovementsRepo.insert({ type: 'RECEIPT', quantity: initialQty, balanceAfter: initialQty, locationId, ... }, session)`
     - `repo.update(tenantId, assetId, { quantityOnHand: initialQty, updatedAt: now, updatedBy: userId }, session)`
  3. Testy: BULK create s `initialQuantity: 5` → `quantityOnHand: 5`, RECEIPT záznam v `stock_movements`
- **Model:** Sonnet
- **Blocker:** ÁNO — bez tohto BULK majetok nefunguje správne (množstvo je vždy 0)

### 2. email_unique index — reziduálny globálny index ✅ DONE (2026-06-01)

- **Stav:** ✅ vyriešené (manuálny drop na prod + nová migrácia ako poistka)
- **Session:** [`docs/sessions/2026-06-01-email-index-fix.md`](./sessions/2026-06-01-email-index-fix.md)
- **Root cause:** migrácia `2026-05-29c` mala fixný zoznam mien (`email_unique`, `email_1`, `users_email_unique`), ale reálny index na prod sa volal `users_email_global_unique` → drop ho minul, migrácia sa zapísala ako completed (už sa nespustí znova). Reziduálny globálny `{ email: 1 } UNIQUE` by spôsobil E11000 pri 2. tenantovi (rovnaký email v dvoch orgoch).
- **Čo bolo spravené:**
  - [x] manuálny drop `users_email_global_unique` na prod Atlas → users má teraz správne 4 indexy
  - [x] nová migrácia `2026-06-01b-drop-residual-email-index` — inšpektuje živý zoznam indexov, dropne ANY single-field unique index na `email` bez ohľadu na meno; composite `organisationId_email_unique` nechá; idempotentná
  - [x] zaregistrovaná v `runner.ts` (poistka pre dev cluster + budúce forky, self-healing)
  - [x] 6 unit testov `migration-drop-residual-email-index.test.ts`
- **Cieľový stav prod (overené):** `_id_`, `organisationId_isActive_deletedAt`, `entraOid_unique_partial`, `organisationId_email_unique` — žiadny globálny email index

---

## 🟠 P1 — GDPR práva dotknutých osôb (DSAR)

> ROPA ich deklaruje ([`gdpr-article-30.md`](./compliance/gdpr-article-30.md) sekcia 3), ale
> v `apps/api/src/modules/users/users.routes.ts` reálne **nie sú**. Sú to **právne záväzky**,
> nie nice-to-have — musia fungovať skôr, než príde tenant so živými dátami subjektov.

### 3. Right to data portability (čl. 20) ✅ DONE (2026-06-01)

- **Stav:** ✅ implementované
- **Session:** [`docs/sessions/2026-06-01-dsar-export-patch-me.md`](./sessions/2026-06-01-dsar-export-patch-me.md)
- **Čo bolo implementované:**
  - [x] `AuditLogRepository.findByActor(userId)` — efektívny lookup cez existujúci `actor_userId` index
  - [x] `UsersService.exportSelf()` — paralelný fetch memberships + audit logov, `toSafeProfileShape` (secrets strip), fire-and-forget `DATA_EXPORT_REQUESTED` audit event
  - [x] `GET /v1/me/export` endpoint — RBAC: každý autentifikovaný používateľ (self)
  - [x] 10 integračných testov v `users-export.test.ts`

### 4. Self-service oprava profilu (čl. 16) ✅ DONE (2026-06-01)

- **Stav:** ✅ implementované
- **Session:** [`docs/sessions/2026-06-01-dsar-export-patch-me.md`](./sessions/2026-06-01-dsar-export-patch-me.md)
- **Čo bolo implementované:**
  - [x] `UpdateSelfInput` typ — `Partial<Pick<User, 'firstName' | 'lastName' | 'displayName' | 'preferences'>>`
  - [x] `UsersService.updateSelf()` — auto-derivácia `displayName`, `toSafeProfileShape`, fire-and-forget `USER_UPDATED` audit event
  - [x] `PatchMeBodySchema` so `.strict().partial()` — zakazáné polia (roles, email, isActive) vrátia 400
  - [x] `PATCH /v1/me` endpoint — RBAC: každý autentifikovaný používateľ (self)
  - [x] 16 integračných testov v `users-patch-me.test.ts`

### 5. Right to erasure / hard delete (čl. 17) ✅ DONE (2026-06-01)

- **Stav:** ✅ implementované (okamžitá pseudonymizácia)
- **Session:** [`docs/sessions/2026-06-01-dsar-erasure-restrict.md`](./sessions/2026-06-01-dsar-erasure-restrict.md)
- **Čo bolo implementované:**
  - [x] `DELETE /v1/auth/me` (už existoval z K17) — okamžitá pseudonymizácia User + soft-delete všetkých memberships v transakcii
  - [x] last-admin guard (`assertNotLastAdminForDeletion` per-org) — sólo admin sa nedá zmazať
  - [x] audit `DATA_DELETION_REQUESTED` refaktorovaný na `AuditLogService` (legalBasis, dataCategories, plný actor snapshot)
  - [x] testy `auth-erasure.test.ts` (endpoint predtým nemal žiadne)
- **Pozn.:** 30-dňový grace period pre admin soft-delete pokrýva `RetentionService.pseudonymizeSoftDeletedUsers` (#8).

### 6. Right to restrict (čl. 18) ✅ DONE (2026-06-01)

- **Stav:** ✅ implementované
- **Session:** [`docs/sessions/2026-06-01-dsar-erasure-restrict.md`](./sessions/2026-06-01-dsar-erasure-restrict.md)
- **Čo bolo implementované:**
  - [x] `isRestricted` + `restrictedAt` + `restrictionReason` na User schéme (samostatné od `isActive`)
  - [x] `POST /v1/users/:id/restriction` (admin) — set/clear flag, idempotencia (400), audit `USER_RESTRICTED`/`USER_UNRESTRICTED`
  - [x] enforcement v auth middleware: restricted user = read-only (mutujúce metódy → 403, GET povolené; erasure čl. 17 má prednosť)
  - [x] testy `users-restriction.test.ts`

---

## 🟡 P2 — Accepted ADR čakajúce na implementáciu

### 7. ADR-0022 — Preberacie protokoly (on-demand PDF) — ✅ DONE (2026-06-02)

- **Stav:** ✅ K1–K8 kompletné — ADR-0022 uzavretý
- **Session K2–K4:** [`docs/sessions/2026-06-02-adr-0022-k2-k4.md`](./sessions/2026-06-02-adr-0022-k2-k4.md)
- **Session K5–K8:** [`docs/sessions/2026-06-02-adr-0022-k5-k8.md`](./sessions/2026-06-02-adr-0022-k5-k8.md)
- **Milestone:** [`docs/milestones/2026-06-02-adr-0022-complete.md`](./milestones/2026-06-02-adr-0022-complete.md)
- **Čo bolo implementované:**
  - [x] K1 — schéma: odstránený `pdfAttachmentId`; openapi regen ✅
  - [x] K2 — `pdf-lib` + DejaVu Sans; `renderProtocolPdf()` deterministický; `loadLogo()`; 9 unit testov ✅
  - [x] K3 — `generateProtocolNumber()` race-safe; 7 unit testov ✅
  - [x] K4 — `LoanProtocolsRepository`; `insertDraftProtocol()` v `LoansService`; HANDOVER+RETURN v transakciách ✅
  - [x] K5 — `protocols.routes.ts`: 3 GET endpointy (zoznam, metadata, PDF), RBAC, cross-tenant ✅
  - [x] K6 — `POST /v1/protocols/:id/sign` (CLICK_TO_SIGN); DRAFT→SIGNED; pdfSha256 fixnutý ✅
  - [x] K7 — 15 integration testov (RBAC, cross-tenant, PDF, podpis, snapshot, stránkovanie) ✅
  - [x] K8 — milestone doc + session log ✅
- **Web UI + E2E (2026-06-07):** detail výpožičky `/loans/[id]`, stránka `/protocols` + menu (managerOnly), CLICK_TO_SIGN modal, PDF/Tlač, backfill endpoint `POST /v1/loans/:id/protocols`, `GET /v1/protocols`. E2E otestované na prode (PROT-2026-000001 → SIGNED). Hotfixy: podpis druhej strany pri rovnakom userovi, JPEG logo v PDF (embedJpg podľa magic bytes). Session [`2026-06-07-loan-detail-protokoly-ui.md`](./sessions/2026-06-07-loan-detail-protokoly-ui.md)

### 8. Audit log retention job — automatická pseudonymizácia ✅ DONE (2026-06-01)

- **Stav:** ✅ implementované
- **Session:** [`docs/sessions/2026-06-01-retention-job.md`](./sessions/2026-06-01-retention-job.md)
- **Čo bolo implementované:**
  - [x] `RetentionRepository` — jediný povolený UPDATE na `audit_logs`; `pseudonymizeAuditLogs(actions, cutoff)` + `pseudonymizeSoftDeletedUsers(cutoff)`; append-only invariant zachovaný (samostatná trieda od `AuditLogRepository`)
  - [x] `RetentionService.run(now?)` — 3 buckety: CRUD (24m), security/GDPR (60m), org lifecycle (84m); soft-deleted users (24m); sekvenčné kroky; idempotentné; testovateľné cez `now` parameter
  - [x] `POST /v1/system/retention/run` — chránený `CRON_SECRET` headerom; 503 ak nekonfigurovaný; 401 na zlý token; 200 + `RetentionRunResult` JSON
  - [x] `vercel.json` cron: `0 3 1 * *` (1. každého mesiaca o 03:00 UTC)
  - [x] `CRON_SECRET` do `config.ts` + `turbo.json` globalEnv
  - [x] unit testy `retention.test.ts` (16 testov) + integračné `retention-cron.test.ts` (4 testy)
- **Po deployi treba:** ✅ HOTOVO — `CRON_SECRET` nastavený vo Vercel → Settings → Environment Variables (2026-06-02)

### 16. ADR-0027 — Tlač QR štítkov (Avery PDF + Zebra ZPL) — ✅ DONE (2026-06-02)

- **Stav:** ✅ L1–L7 kompletné — ADR-0027 uzavretý (backend + frontend); frontend session [`docs/sessions/2026-06-02-adr-0027-l5-frontend.md`](./sessions/2026-06-02-adr-0027-l5-frontend.md)
- **Session:** [`docs/sessions/2026-06-02-adr-0027-l1-l7-backend.md`](./sessions/2026-06-02-adr-0027-l1-l7-backend.md)
- **Čo bolo implementované:**
  - [x] L1 — `OrganisationLabelSettingsSchema` + `labelPrinting: null` do 4 org-create ciest + fixtures ✅
  - [x] L2 — `renderLabelSheetPdf()` Avery mrižky, finderText, logo v strede QR ✅
  - [x] L3 — `renderLabelZpl()` ZPL builder, `^CI28`, finderText ✅
  - [x] L4 — routes: GET /v1/labels/sheet, GET /v1/assets/:id/label?format=zpl, POST /v1/labels/zpl ✅
  - [x] L5 — frontend: `LabelPrintButton` + `BatchLabelPrintButton` (PDF / Zebra Browser Print) ✅
  - [x] L6 — 27 testov (unit ZPL + unit PDF + integration) ✅
  - [x] L7 — session doc ✅

### 17. ADR-0028 — Per-tenant branding ✅ DONE (v1: 2026-06-02, v2: 2026-06-03)

- **Stav:** ✅ v1 B1–B10 + v2 B0–B5 kompletné
- **Session v1:** [`docs/sessions/2026-06-02-adr-0028-branding.md`](./sessions/2026-06-02-adr-0028-branding.md)
- **Session v2:** [`docs/sessions/2026-06-03-adr-0028-v2-branding-presets.md`](./sessions/2026-06-03-adr-0028-v2-branding-presets.md)
- **v2 zmeny:** 10 WCAG preset palít · Vercel Blob upload (magic bytes validácia, 512 KB) · font enum (next/font/google) · gating zrušený (všetky plány) · UI: preset karty + file picker + font select
- **Manuálne po deployi:** SFZ nastaviť branding cez Settings → Branding (logo upload + paléta + font)
- **Rozhodnutia (Q1–Q6):** Zod = zdroj pravdy (+`logoDot`, žiadna migrácia) · logo v1 = externá HTTPS URL (upload v2) · farby/font klientsky cez `data-tenant` + injektovaný `<style>` (FOUC ok v1) · WCAG tvrdé odmietnutie <4.5:1 · logo=všetky plány, farby/font=Pro+ · v1 rozsah bez uploadu/SSR/favicon
- **Model:** Sonnet (B1–B9), Haiku/Sonnet (B10 docs)
- **Rozsah — 10 blokov v 4 fázach (detail v ADR-0028 „Implementačný plán“):**
  - [x] **Fáza 1 — schéma + backend:** B1 `HexColorSchema` + `logoDot` · B2 WCAG kontrast util (`apps/api/src/lib/contrast.ts`) + testy · B3 PATCH `brandKit` + WCAG + audit · B4 integračné testy (`organisations-branding.test.ts`) ✅
  - [x] **Fáza 2 — runtime:** B5 `BrandProvider` (`apps/web/src/lib/BrandProvider.tsx`, `data-tenant` + `<style>`) · B6 logo v `AppShell` headeri (fallback wordmark) ✅
  - [x] **Fáza 3 — admin UI:** B7 „Branding" sekcia v `OrganisationSettingsContent` (logo + farby + font) · B8 živý náhľad + kontrast indikátor ✅
  - [x] **Fáza 4 — testy + docs:** B9 frontend testy + openapi regen · B10 session 2026-06-02/03 + presety (`brand-presets.test.ts`) ✅
- **Pozn.:** nie je blocker pre pilot (default brand funguje), ale **logo na protokoloch/štítkoch je viditeľná pilotná bolesť**. Po dokončení SFZ nastaviť `logoUrl` (PNG, nie SVG). FREE pilot dostane logo; farby vyžadujú dočasné povýšenie plánu.
- **Zdieľa:** `loadLogo()` (ADR-0022) — featura ho len odomkne tým, že `logoUrl` sa dá nastaviť.

### 18. TECH-DEBT (ADR-0029): PATCH /v1/users/:id — legacy User.roles ✅ DONE (overené 2026-06-09)

- **Stav:** ✅ vyriešené — `PATCH /v1/users/:id` mutuje už len `isActive` (+profil), zmena rolí ide cez `PATCH /v1/memberships/:id`. Docstring aj admin PATCH schéma to potvrdzujú („Role changes go through PATCH /v1/memberships/:id (ADR-0029 cleanup)").
- **Kontext (pôvodný):** `PATCH /v1/users/:id` (admin mena rôl) bol zastaraný spôsob správy rôl — reálna správa ide cez `PATCH /v1/memberships/:id` (Membership.role). RBAC už čítal len Membership.role.

### 20. ADR-0030 — Registračné identity + Entra ako per-tenant doménová reštrikcia

- **Stav:** DONE 2026-06-03 (D1-D7 kompletné); ADR [`docs/decisions/0030-registration-providers-and-entra-domain.md`](./decisions/0030-registration-providers-and-entra-domain.md)
- **Kontext:** Reziduum z Entra-only začiatku (ADR-0004). Backend je už z ~80 % na cieľovom modeli (MS OAuth cez `organizations`, registrácia berie 4 providery, org-create má INVITE_ONLY + všetky providery). Reálne chýba: Apple (503), zapojenie `entraTenantId` ako doménovej reštrikcie do auth flow, admin UI, neutrálny frontend framing.
- **Rozhodnutia:** registrácia = e-mail + Google + Apple + Microsoft (rovnocenné, bez Entra framingu) · Entra → per-tenant doménová politika cez existujúce polia (`allowedAuthProviders`, `memberJoinPolicy`, `autoJoinDomains`, `entraTenantId`) — aditívne, žiadne nové polia · pozvánka má vždy prednosť (INVITE_ONLY default) · SFZ migrácia = dátová úprava 1 Organisation dokumentu bez odhlásenia členov · SAML/OIDC enterprise SSO = mimo rozsahu
- **Model:** Sonnet (D1–D6), Haiku (D7 docs)
- **Rozsah — 7 blokov (detail v ADR-0030 „Implementačný plán“):**
  - [x] **D1** — backend Apple Sign-In hotový (`apple-auth.routes.ts`, 768 r., Arctic `form_post`). ⚠️ Beží len keď sú nastavené `APPLE_CLIENT_ID/TEAM_ID/KEY_ID/PRIVATE_KEY` — inak korektný 503 fallback. **Zostáva ops krok: Apple Developer účet + env premenné** (nie kód).
  - [x] **D2** — auth flow: `entraTenantId` reštrikcia + `autoJoinDomains` (`apps/api/src/lib/auto-join.ts`) ✅
  - [x] **D3** — admin UI „Prihlasovanie a domény" (`AuthSettingsContent`, `/settings/auth`) ✅
  - [x] **D4** — frontend registračná obrazovka: neutrálne možnosti (`RegisterPage`) ✅
  - [x] **D5** — SFZ migrácia + overenie firemného MS prihlásenia ✅
  - [x] **D6** — testy (`entra-domain-restriction`, `auto-join`, `oauth-domain-autojoin`, `auth-register`, `apple-auth`) ✅
  - [x] **D7** — docs: ADR-0030 + session ✅
- **Riziká:** SFZ login regresiu overiť pred deployom · `tid` z id_token (nie Graph) · `accountType: ENTRA_ID` sa dnes mätúco nastavuje aj pre Google self-serve (drobný tech-debt)
- **Blocker:** NIE pre pilot (default funguje), ale rieši reálnu pilotnú bolesť (Entra dnes de-facto povinné pre SFZ)

### 22. ADR-0031 — Per-tenant OAuth credentials (Microsoft) so šifrovaním at-rest ✅ DONE 2026-06-04

- **Stav:** DONE 2026-06-04 (E1–E8 kompletné); ADR [`docs/decisions/0031-per-tenant-oauth-credentials.md`](./decisions/0031-per-tenant-oauth-credentials.md)
- **Kontext:** OAuth credentials sú dnes globálne (jedna platformová Microsoft app pre všetkých tenantov, z env premenných, boot-time `providers` mapa). Problémy: consent ide cez LTK app nie cez tenant app; jeden `MICROSOFT_CLIENT_SECRET` únik = blast radius cez všetky tenanty; žiadna tenant izolácia secretu. Pre SFZ pilot stačí platformová app, ale pri ďalších tenantoch s vlastným IT je to blokujúce.
- **Rozhodnutia:** per-tenant `oauthCredentials` (nullable) na Organisation · `clientSecret` šifrovaný AES-256-GCM (vzor `mfa-crypto`, nový `OAUTH_SECRET_ENCRYPTION_KEY`) · write-only cez API (read path strip, `hasSecret` boolean) · OAuth provider sa stavia per-request (koniec boot-time mapy) · env fallback pre tenantov bez vlastnej app (SFZ pilot sa nerozbije) · tenant routing pri logine cez `?org=<slug>` hint · Microsoft only (Google slot pripravený, Apple mimo rozsahu) · KMS mimo rozsahu (voliteľný budúci backend kľúča)
- **Model:** Sonnet (E1–E7), Haiku (E8 docs); E4 tenant routing prípadne Opus ak sa otvorí návrhová otázka
- **Rozsah — 8 blokov (detail v ADR-0031 „Implementačný plán“):**
  - [x] **E1** — shared-types: `OrgOAuthProviderCredentialsSchema` + `OrgOAuthCredentialsSchema`, `oauthCredentials` na Organisation ✅
  - [x] **E2** — `oauth-crypto.ts` (AES-256-GCM), `OAUTH_SECRET_ENCRYPTION_KEY` v configu ✅
  - [x] **E3** — `oauth-provider-resolver.ts` (per-request Arctic inštancia, koniec boot-time mapy) ✅
  - [x] **E4** — tenant routing: `?org=<slug>` hint, `orgId`+`source` v OAuth state ✅
  - [x] **E5** — API: `oauthCredentials` v patchi + šifrovanie + read path strip ✅
  - [x] **E6** — Admin UI „Microsoft aplikácia" v `/settings/auth` (`AuthSettingsContent`) ✅
  - [x] **E7** — testy (`oauth-crypto`, `oauth-provider-resolver`, `microsoft-oauth-credentials`) ✅
  - [x] **E8** — docs: ADR-0031 + go-live session 2026-06-04 ✅
- **Riziká:** rotácia `OAUTH_SECRET_ENCRYPTION_KEY` = re-encrypt migračný skript · redirect URI mismatch v tenant Azure App · callback musí postaviť identickú Arctic inštanciu (orgId+source v state) · bez `?org` hintu spadne na platformovú app (mätúce pri tenante s entraTenantId)
- **Blocker:** NIE pre pilot (env fallback drží SFZ login); rieši škálovanie na tenantov s vlastným Entra/IT
- **Go-live (2026-06-04):** nasadzovanie do reálu — nová Azure app (platformová, multitenant), `User.Read` scope doplnený (fix 403 z Graph /me), openapi regen. Živý Microsoft login test prebieha. Session [`2026-06-04-microsoft-oauth-golive.md`](./sessions/2026-06-04-microsoft-oauth-golive.md)

---

## 🟢 P3 — Compliance Fáza 2 dokumenty ✅ DONE (2026-06-11)

> Nie kód, ale „dorobiť" v zmysle dopísať. Roadmap v [`compliance/README.md`](./compliance/README.md). Všetky 4 dokumenty hotové + verejný web (security.html, dpia.html) + odkazy vo footeri. Session: `docs/sessions/2026-06-11-p3-compliance-docs.md`.

### 9. Security & Privacy Whitepaper ✅ DONE (2026-06-11)

- `compliance/security-privacy-whitepaper.md` + verejná stránka https://inventario.estate/security

### 10. Data Retention Schedule (detail) ✅ DONE (2026-06-11)

- `compliance/data-retention-schedule.md` — per-category lehoty z `retention.service.ts` (24/60/84 m), pseudonymizácia, zálohy/logy

### 11. Information Security Policy ✅ DONE (2026-06-11)

- `compliance/information-security-policy.md` — interný (access control, šifrovanie, secure SDLC, DR, incident response)

### 12. DPIA Reference Pack ✅ DONE (2026-06-11)

- `compliance/dpia-reference-pack.md` + verejná stránka https://inventario.estate/dpia (z `legal/dpia-template.md`)

---

## 🔵 P4 — neskôr / podľa dopytu

### 13. Slice #6c follow-up featury (nový vývoj, NIE dlh)

- **Model:** Sonnet, podľa potreby
- **Pozn.:** nové funkčnosti nad rámec hotového Slice #6c (invitations) — otvoria sa, keď reálny tenant požiada. SFZ pilot ich nepotrebuje.
- **Rozsah:**
  - [x] Resend invitation (nový token pre expired/lost e-mail) — ✅ DONE 2026-06-03 (backend už existoval, doplnené frontend tlačidlo; session [`2026-06-03-post-deploy-fixes.md`](./sessions/2026-06-03-post-deploy-fixes.md))
  - [x] Per-email domain exception — ✅ DONE (`invitations.routes.ts`, `orgSettings.invitations.exceptions[]` oproti `allowedDomains`)
  - [x] Email change verification — ✅ DONE (`emailChangePendingTo/Token/ExpiresAt` v schéme, `/change-email` + `/confirm-email-change` routes, `EmailChangePanel` UI)
  - [ ] Bulk invite cez CSV — otvorené
  - [ ] Per-tenant email provider override (vlastný Resend namiesto default Ecomail) — otvorené; provider sa dnes volí globálne cez `EMAIL_PROVIDER` env, org schéma nemá override

### 14. Slice #10 — MCP server

- **Stav:** Design hotový a aktualizovaný (ADR-0017 rev 2026-06-02); implácia naplánovaná Q1 2027 (~10.5 dňa)
- **ADR:** [`docs/decisions/0017-mcp-server.md`](./decisions/0017-mcp-server.md) — tool catalog zosúladený s modulmi ADR-0020 až 0027
- **Rozhodnutia (Q1–Q7, nemenné):** remote HTTP/SSE na `mcp.inventario.estate` · manual token paste (v0.7) → OAuth 2.1 (v0.8) · single-tenant tokeny · curated tools · read + non-destructive writes · API gateway pattern · tools only
- **Tool catalog:** 18 read + 11 write = 29 nástrojov (vrátane stock, číselníky, protokoly, members; loan tools po ADR-0026)
- **Model:** Sonnet (K1–K20), Haiku (K21–K22 docs), Ján (K23 Vercel/DNS manuálne)
- **Rozsah — 24 K-blokov v 5 fázach (detail v ADR-0017 „Slice #10 implementačný plán“):**
  - [ ] **Fáza 1 — backend foundation (~2 dni):** K1 `mcp-access-token` schéma + audit enum + entityType · K2 repository (findByHash, indexy) · K3 `/v1/auth/mcp-tokens` CRUD endpointy + testy · K4 cleanup job pre expired tokeny
  - [ ] **Fáza 2 — MCP server scaffold (~2 dni):** K5 nový `apps/mcp-server` package · K6 token-resolver · K7 short-lived JWT issuer · K8 `openapi-fetch` client + build step · K9 MCP SDK server setup · K10 rate-limit (Vercel KV)
  - [ ] **Fáza 3 — tools (~3.5 dňa):** K11 asset read · K12 loan read (vrátane protokolov) · K13 číselníky + members · K13b stock read · K14 loan write (fulfil/direct/return/lost) · K15 asset + stock write · K16 `MCP_TOOL_INVOKED` audit
  - [ ] **Fáza 4 — frontend (~1.5 dňa):** K17 `/settings/integrations` page + token dialog · K18 revoke/rename + freshness indikátor
  - [ ] **Fáza 5 — testy + docs (~1.5 dňa):** K19 mcp-server integračné testy (~15) · K20 API token endpoint testy (~8) · K21 milestone + NEXT.md · K22 user guide + tools katalóg · K23 Vercel deploy + DNS (Ján)
- **Baseline testov pred Slice #10:** 825 → target ~848 po K19+K20
- **Pozn.:** nie je blocker pre launch ani SFZ pilot. Pred spustením Fázy 1 overiť, že endpointy v tool catalogu stále sedia (API sa medzičasom mohlo vyvíjať) a prečítať aktuálny ADR-0017.

### 21. Multi-language frontend (i18n)

- **Stav:** Otvorené (P4 — podľa dopytu)
- **Kontext:** Všetok UI text je hardcoded Slovak strings priamo v komponentoch. Nie je bloker pre SFZ pilot ani launch — SFZ je SK-only tenant. Riešiť až pri reálnej potrebe druhého jazyka.
- **Navrhované riešenie:** `next-intl` (de facto štandard pre Next.js 15 App Router, TypeScript-safe kľúče, Server Components podpora). Alternatíva `react-i18next` — menej integrované s App Routerom.
- **Rozsah keď čas priďde:**
  - Extrakcia všetkých hardcoded strings zo ~30 komponentov do `messages/sk.json`
  - Pridať `messages/en.json` (EN preklady)
  - Next.js middleware pre locale detection
  - URL stratégia: subpath-less (preferované pre B2B SaaS) vs `/sk/...`
- **Model:** Sonnet (mechanická extrakcia + wiring), Haiku (preklady)
- **Blocker:** NIE — spustiť keď priďde prvý nesk-tenant alebo keď SFZ požiada o EN verziu

- `Cmd+K` tenant picker · SOC 2 Type II roadmap · dashboard štatistiky · QR štítky PDF (batch tlač)

### 19. TECH-DEBT: Unique index `memberships_userId_organisationId_unique` — partial filter ✅ DONE (overené 2026-06-09)

- **Stav:** ✅ implementované — migrácia `2026-06-07-memberships-partial-index.ts` (drop + recreate s `partialFilterExpression: { deletedAt: null }`, názov indexu zachovaný), registrovaná v `runner.ts` (ADR-0029), `MembershipsRepository.ensureIndexes()` aktualizovaný. _(Potvrdiť dobehnutie migrácie na prod.)_
- **Kontext (pôvodný):** Index pokrýval všetky dokumenty vrátane soft-deleted; bez partial filtra mohol race v `reactivate()` fallbacku vyhodiť E11000.

### 24. TECH-DEBT: drobné kódové TODO (nízka priorita, žiadny blocker)

- **Stav:** evidované 2026-06-11 (skenom `TODO/FIXME` v `*.ts/tsx`). Žiadny nie je bug.
- **Rozsah:**
  - [ ] `apps/api/tests/helpers/test-jwt-loader.ts` — odstrániť helper + `createTokenSigner()` call sites, keď sa všetky testy zmigrujú na `provisionUser()` (testovací tech-debt, postupná migrácia).
  - [x] ✅ DONE (2026-06-15) — vytvorený `docs/user-guide/reference/role-opravnenia.md` (matica oprávnení per rola z reálnych `requireRole`/`requireMinRole` guardov), odstránený „(TODO: vytvoriť tento dokument)" odkaz v `user-role.ts`, README reference aktualizované.
- **Pozn.:** Dva ďalšie „TODO" v `memberships.routes.ts` (riadky ~25, ~398) NIE sú nedorobky — sú to opisné/meta komentáre potvrdzujúce, že audit event sa emituje inde a pre `post/:id/default` nie je potrebný. Neriešiť.
- **Model:** Sonnet/Haiku, podľa potreby pri najbližšom dotyku príslušných súborov.

### 25. Zosúladiť dokumentáciu + marketingový web so skutočnou appkou — ČIASTOČNE (2026-06-12)

- **Stav:** **HOTOVÉ** (2026-06-15). Audit + textové opravy webu (2026-06-12), reálne screenshoty + stránka `/screenshots` + odstránenie demo/mockupov (2026-06-15). Discrepancy report: `docs/sessions/2026-06-12-marketing-app-discrepancy-audit.md`. Zostáva už len voliteľné vyčistenie demo dát z prod.
- **Kontext:** appka sa vyvinula nad rámec pôvodných mockupov; marketingový web obsahoval overclaimy a zastarané čísla.
- **Hotové (2026-06-12):**
  - [x] Inventár reálnych funkcií appky + tvrdení webu → discrepancy report.
  - [x] Overclaimy označené „v roadmape" (bulk import CSV, export reportov CSV/PDF/XLSX, multi-level approval, webhooks, cross-org/child-tenant) — index, pricing, use-cases, interactive-demo.
  - [x] Opravené čísla: testy 257→962, REUSE 175→632, free tier zjednotený na 10, odstránená stará verzia v0.3.
  - [x] Google OAuth označený ako „Dostupné" (bol mylne „v roadmape").
  - [x] Demo tenanti — caveat „ilustračné scenáre" (SFZ = reálny pilot).
  - [x] „100 % Real UI" → „hi-fi mockupy" (interactive-demo).
  - [x] Bug v `demo.html` (prepínač stránok `${page}.html`).
- **Zostáva:**
  - [x] **Screenshoty:** vyriešené cez dedikovaný **demo tenant „ŠK Demo Inventário"** (fiktívne dáta, žiadne PII) — viď nižšie. SFZ prod tenant sa nepoužil (reálne mená/PII; GDPR).
  - [x] **Seed demo tenant skript** — `apps/api/scripts/seed-demo-tenant.ts` (`pnpm --filter @inventario/api seed:demo`). Idempotentný, dry-run default, `--confirm`/`--reset`, scoped len na demo org, pridá `jan.letko@futbalsfz.sk` ako ADMIN člena + fiktívnych členov; ~25 položiek (SERIALIZED+BULK so stock ledger), kategórie, lokality, 2 výpožičky, 1 PENDING žiadosť. (2026-06-12)
  - [x] **Seed spustený na prod** (2026-06-12) — demo org `6a2c40e51166ed11b3c31160` v DB `inventario`. Overené: 17 majetku, 7 členov (6 demo + admin jan.letko), 2 výpožičky, 5 stock movements, 1 PENDING žiadosť.
  - [x] **Reálne screenshoty HOTOVÉ** (2026-06-15) — 6 obrazoviek demo tenanta odfotené cez Chrome + macOS `screencapture` (page-only, orezané), zdroj `product-screens/real_*.png`, web-optimalizované JPG `assets/screens/` + hero `assets/hero-dashboard.jpg`.
  - [x] **Nová stránka `/screenshots`** (galéria + lightbox) + homepage hero pozadie (stmavený dashboard) + pás „Zo živej aplikácie"; nav/pätička „Demo"→„Screenshoty". (2026-06-15)
  - [x] **Odstránené interaktívne demo** — `interactive-demo.html`, 6 HTML mockupov v `product-screens/`, legacy `docs/design/screens/` (13 súborov) + `scripts/copy-product-screens.sh`. (2026-06-15)
  - [ ] **Vyčistiť demo z prod neskôr** (ak treba): `seed:demo -- --confirm --reset` zmaže len demo org dáta, alebo manuálne.
  - [x] **Apple Sign-In tlačidlo v appke** — env-gated (`NEXT_PUBLIC_APPLE_ENABLED`), skryté v RegisterPage + AuthSettingsContent kým nie je nakonfigurované (2026-06-12).
  - [x] `apps/docs` MDX (about, index, product-ui-tour) — opravené čísla (REUSE 632, odstránené v0.3), „Aktuálny stav" prepísaný na produkciu LIVE, export/i18n → roadmap (2026-06-12).
- **Model:** Sonnet (audit + copy), Haiku (mechanické úpravy).
- **Blocker:** NIE pre SFZ pilot, ÁNO pred marketingovým spustením.

---

## Ako čítať tento backlog

- **Najbližší balík pred pilotom:** ✅ hotový (QR + email index) — SFZ pilot je odomknutý
- **DSAR práva (čl. 16/17/18/20) + retention job:** ✅ hotové (položky 3–8)
- **Najväčšie featury v zálohe:** položka 7 (PDF protokoly, ADR-0022) a 16 (QR štítky, ADR-0027) — zdieľajú `pdf-lib` + DejaVu Sans render
- **Čisto dokumentácia, dá sa kedykoľvek:** položky 9–12

**Pravidlo aktualizácie:** položku zatvor (✅ / presun do „Hotové" v príslušnom milestone/session doc)
v tej istej session, v ktorej ju dokončíš. Nové položky pridávaj sem, nie do NEXT.md.

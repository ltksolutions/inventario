<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 2026-05-20 (night) — Slice #6c K17 + K17.5 + K18 design

## Súhrn

Dokončenie Slice #6c backend cutover (K17), pridanie platformovej email
abstrakcie (K17.5) a kompletný architektúrny plán pre K18 invite flow.

**Model routing:**

- Sonnet 4.6 (predchádzajúca session) → K17/K19/K20 implementácia + test
  migration na cookie auth (21 integration test súborov prepísaných)
- Opus 4.7 (táto session) → K17.5 design + implementácia, K18 architectural
  decisions, design doc pre K18 implementáciu

---

## Čo sa urobilo

### K17 — Entra Bearer cutover (commitnuté)

Po dlhej migračnej sérii (#6a backend JWT, #6b frontend cookies) sa
finálne odstránil legacy Entra Bearer path z `requireAuth`:

- `apps/api/src/plugins/auth.ts` — kompletne prepísaný na cookie-only.
  Odstránené: Entra JWKS, `verifyToken`/`verifyEntraToken`/
  `verifyTestToken`, `assertEntraClaims`, Bearer path, `jose` imports,
  `EntraClaims` interface, `TEST_JWT_ISSUER`. Zostalo: `requireAuth`
  (cookie) + `loadCurrentUser` + `requireRole`.
- `apps/api/src/plugins/config.ts` — `ENTRA_TENANT_ID`,
  `ENTRA_API_CLIENT_ID` zmenené na optional pre backward compat
  s existujúcimi `.env.local` súbormi. Log line robustný voči chýbajúcim
  Entra premenným.
- `apps/api/src/server.ts` — `inventarioJwtPlugin` registrovaný PRED
  `authPlugin` (dependency).
- `apps/api/src/modules/users/users.service.ts` — `EntraClaims` interface
  pre JIT provisioning presunutý do tohto súboru (auth.ts ho už neexportuje).
- `apps/api/tests/setup.ts` — odstránené `TEST_JWT_PUBLIC_KEY` +
  `TEST_KEYS_FILE` + `writeFileSync`. Iba MongoMemoryReplSet +
  Inventario RS256 keypair.
- `apps/api/tests/helpers/test-jwt-loader.ts` — deprecated stub
  (vracia no-op fn).
- `apps/api/tests/helpers/test-fixtures.ts` — nová `provisionUser(app,
{oid?, role, email?, ...})` → `{ user, token }`. Vkladá usera priamo
  do DB, volá `app.inventarioJwt.issueAccessToken(user, org)`.
- **21 integration test súborov prepísaných z `authorization: Bearer
${X}` na `cookie: inv_access=${X}`**:
  - `auth.test.ts` (kompletne prepísaný pre cookie tests)
  - `assets-{delete,patch,post}.test.ts`
  - `categories-{delete,patch,post}.test.ts`
  - `locations-{delete,patch,post}.test.ts`
  - `users-{get,list,patch}.test.ts`
  - `rbac.test.ts`, `audit.test.ts`, `cross-tenant-isolation.test.ts`
  - `loans-loans.test.ts`, `loans-loan-requests.test.ts`
  - `auth-email.test.ts`, `auth-register.test.ts` (žiadne zmeny — testujú
    auth flows, nepoužívajú Bearer)

### K19 — Silent token refresh (commitnuté)

- `apps/web/src/lib/api-client.ts` — openapi-fetch middleware zachytí
  401, zavolá `POST /v1/auth/refresh`, retry pôvodného requestu.
  Module-level singleton promise prevents concurrent refresh attempts
  (replay-attack protection).
- `apps/web/src/lib/auth-context.tsx` — `fetchMe()` na 401 skúsi silent
  refresh pred fallback na unauthenticated.

### K20 — Chýbajúce stránky (commitnuté)

- `apps/web/src/app/register/verify-email/page.tsx` — info stránka po
  registrácii ("Skontroluj email, klikni link")
- `apps/web/src/components/ForgotPasswordPage.tsx` +
  `apps/web/src/app/forgot-password/page.tsx`
- `apps/web/src/components/ResetPasswordPage.tsx` +
  `apps/web/src/app/reset-password/page.tsx`
- LoginPage update: `?passwordReset=true` banner + error keys
  `invalid_verification_token`, `verification_token_expired`
- Login a Register page wrappers v Suspense (Next.js
  `useSearchParams` requirement)

### K17.5 — Email provider abstrakcia (Ecomail + Resend + stub)

Pred K18 (invite flow) potreboval email service reálny SMTP/API
transport, nie len token v DB. Nahradili sme starý nodemailer/SMTP plugin
provider-agnostickou abstrakciou:

**Nové súbory:**

- `apps/api/src/plugins/email-providers/types.ts` — `EmailProvider`
  interface (`send(input) → Promise<void>`)
- `apps/api/src/plugins/email-providers/ecomail.provider.ts` — POST
  `api2.ecomailapp.cz/transactional/send-message`, header
  `key: <API_KEY>`. Tracking (click + open) vypnuté pre auth flows.
- `apps/api/src/plugins/email-providers/resend.provider.ts` — POST
  `api.resend.com/emails`, Bearer auth. Native fetch (bez resend SDK)
  pre lean dependencies.
- `apps/api/src/plugins/email-providers/stub.provider.ts` — log-only
  pre dev/test, extrahuje prvý URL z HTML pre easy copy-paste.

**Upravené:**

- `apps/api/src/plugins/email.ts` — refactor: templates + provider
  selection podľa `EMAIL_PROVIDER` env. Boot fail ak chýba API key
  pre zvolený provider. Warning ak `NODE_ENV=production` a provider=stub.
- `apps/api/src/plugins/config.ts` — odstránené `SMTP_*` premenné +
  `EMAIL_FROM`. Pridané: `EMAIL_PROVIDER`, `EMAIL_FROM_ADDRESS`,
  `EMAIL_FROM_NAME`, `EMAIL_REPLY_TO`, `ECOMAIL_API_KEY`,
  `RESEND_API_KEY`.
- `apps/api/package.json` — odstránené `nodemailer` + `@types/nodemailer`.
- `turbo.json` — pridané nové email env vars do `globalEnv` (memory
  rule: turbo globalEnv filtruje subprocess env).
- `.env.example` — email blok prepísaný (Ecomail/Resend, stub default).

**Defaultné správanie:**

- Dev/test: `EMAIL_PROVIDER=stub` → emaily idú do logu
- Prod: nastav `EMAIL_PROVIDER=ecomail` + `ECOMAIL_API_KEY` → boot fail
  ak chýba kľúč

**Rozhodnutia:**

- Platform-only teraz (jeden Ecomail účet pre celé Inventario, všetci
  tenanti posielajú cez `noreply@inventario.estate`). Per-tenant
  provider override sa pridá keď nastúpi prvý tenant ktorý si to bude
  vyžadovať (white-label so „From: noreply@sfz.sk").
- Iba raw HTML, žiadne Ecomail templates (`template_id`). Šablóny máme
  vlastné s Inventario brand colors v `email.ts`.
- SMTP/nodemailer plne odstránené (nie nechané ako fallback) —
  redukcia dependency surface.

### K18 — Invite flow design (žiadny kód)

Kompletný architektúrny plán pre K18 napísaný do
`docs/sessions/2026-05-20-slice-6c-k18-design.md`. Pripravený ako prompt
pre zajtrajšiu Sonnet implementačnú session.

**Kľúčové rozhodnutia:**

1. **Scope: iba noví používatelia.** Cross-tenant invites (existujúci
   Inventario user pozvaný do druhého tenantu) sú odložené — vyžaduje
   refactor `User.organisationId: string` na User ↔ Organisation
   many-to-many (Memberships table), čo je vlastný slice.

2. **Akceptácia: dedicated landing page.** Invitee klikne link → `/accept-invite?token=...` page načíta preview (tenantName, inviterName, role) → invitee si vyberie heslo alebo OAuth (Google/MS). Nie auto-join na klik — bezpečnosť + UX + audit clarity.

3. **Email je LOCKED, žiadna zmena pri accepte.** Detailná diskusia
   s userom: zmena emailu pri accepte by otvorila security/audit
   problémy, obchádzala by domain policy a komplikovala flow. Email
   change sa pridá ako separátny feature v user profile settings
   neskôr.

4. **Domain policy: nový `enforceAllowedDomains` toggle.** Pridá sa
   `Organisation.settings.invitations.enforceAllowedDomains: boolean`
   (default `false`). Ak `true`, `POST /v1/invitations` validuje email
   domain proti `autoJoinDomains` listu. SFZ pilot: `autoJoinDomains:
['futbalsfz.sk', 'sfzmarketing.sk']` + `enforceAllowedDomains: true`
   → ADMIN dostane 400 pri pokuse pozvať `@gmail.com`. Externí
   dodávatelia bez firemnej domény: ADMIN dočasne vypne flag.
   Per-email exception list je budúci feature.

5. **Roly:** ADMIN + ASSET_MANAGER môžu pozývať. ASSET_MANAGER NEMÔŽE
   pozvať ako ADMIN (sanity check v service layer).

6. **Data model: reuse `User` document.** Žiadna nová collection.
   Pending invite = User s `passwordHash=null`,
   `emailVerificationToken=<invite token>`, `emailVerified=false`,
   `invitationSentAt=<now>`. Filtrované z `GET /v1/users` listing
   (passwordHash null + emailVerified false). Cancelled invite =
   soft-delete User.

**Plánované K18 endpointy:**

- `POST /v1/invitations` (ADMIN+ASSET_MANAGER) — create
- `GET /v1/invitations` — list pending pre tenant
- `DELETE /v1/invitations/:id` — revoke
- `GET /v1/auth/invitations/:token` — public preview
- `POST /v1/auth/accept-invitation` — password path
- OAuth path → existing OAuth callbacks rozšírené o `invitationToken`
  v state

**Plánovaný breakdown (~3 Sonnet sessions):**

- Session 1: K18.1–K18.4 (backend complete — CRUD, accept flows,
  email template, ~30 testov)
- Session 2: K18.5–K18.6 (frontend `/accept-invite` + admin
  `/settings/invitations`)
- Session 3: K18.7 (milestone doc, NEXT.md update)

---

## Súbory zmenené dnes (cez všetky commits)

### K17 backend cutover

| Súbor                                         | Zmena                                     |
| --------------------------------------------- | ----------------------------------------- |
| `apps/api/src/plugins/auth.ts`                | cookie-only, odstránený Entra Bearer path |
| `apps/api/src/plugins/config.ts`              | ENTRA\_\* optional, log defensive         |
| `apps/api/src/server.ts`                      | plugin order (inventarioJwt pred auth)    |
| `apps/api/src/modules/users/users.service.ts` | lokálny `EntraClaims` interface           |
| `apps/api/tests/setup.ts`                     | bez TEST_JWT_PUBLIC_KEY                   |
| `apps/api/tests/helpers/test-jwt-loader.ts`   | deprecated stub                           |
| `apps/api/tests/helpers/test-fixtures.ts`     | nová `provisionUser`                      |
| `apps/api/tests/integration/*.test.ts`        | 21 súborov: Bearer → cookie               |

### K19 + K20 (frontend)

| Súbor                                             | Zmena                             |
| ------------------------------------------------- | --------------------------------- |
| `apps/web/src/lib/api-client.ts`                  | silent refresh middleware         |
| `apps/web/src/lib/auth-context.tsx`               | fetchMe 401 → refresh             |
| `apps/web/src/app/register/verify-email/page.tsx` | NOVÝ                              |
| `apps/web/src/components/ForgotPasswordPage.tsx`  | NOVÝ                              |
| `apps/web/src/app/forgot-password/page.tsx`       | NOVÝ                              |
| `apps/web/src/components/ResetPasswordPage.tsx`   | NOVÝ                              |
| `apps/web/src/app/reset-password/page.tsx`        | NOVÝ                              |
| `apps/web/src/components/LoginPage.tsx`           | passwordReset banner + error keys |
| `apps/web/src/app/login/page.tsx`                 | Suspense wrapper                  |
| `apps/web/src/app/register/page.tsx`              | Suspense wrapper                  |

### K17.5 (email provider abstrakcia)

| Súbor                                                      | Zmena                                          |
| ---------------------------------------------------------- | ---------------------------------------------- |
| `apps/api/src/plugins/email-providers/types.ts`            | NOVÝ — `EmailProvider` interface               |
| `apps/api/src/plugins/email-providers/ecomail.provider.ts` | NOVÝ — Ecomail.cz HTTP client                  |
| `apps/api/src/plugins/email-providers/resend.provider.ts`  | NOVÝ — Resend.com HTTP client                  |
| `apps/api/src/plugins/email-providers/stub.provider.ts`    | NOVÝ — log-only                                |
| `apps/api/src/plugins/email.ts`                            | refactor: templates + provider selection       |
| `apps/api/src/plugins/config.ts`                           | SMTP*\* → EMAIL_PROVIDER/ECOMAIL*\_/RESEND\_\_ |
| `apps/api/package.json`                                    | -nodemailer, -@types/nodemailer                |
| `turbo.json`                                               | +email env vars v globalEnv                    |
| `.env.example`                                             | email blok prepísaný                           |

### K18 design

| Súbor                                             | Zmena                       |
| ------------------------------------------------- | --------------------------- |
| `docs/sessions/2026-05-20-slice-6c-k18-design.md` | NOVÝ — kompletný design doc |

---

## Stav po session

- ✅ Slice #6c K17 commitnuté (Entra Bearer cutover, 21 test súborov)
- ✅ Slice #6c K19 commitnuté (silent refresh)
- ✅ Slice #6c K20 commitnuté (verify-email, forgot/reset-password pages)
- ⚠️ Slice #6c K17.5 (email provider) — súbory na disku, **commit
  pripravený, čaká na pre-commit hook overenie** (užívateľ spustil
  `pnpm install` po odstránení nodemailer)
- ✅ Slice #6c K18 design doc napísaný — pripravený na implementáciu
- ⏭️ **Ďalší krok: Slice #6c K18.1** (backend invitations CRUD)

---

## Pripomienky na zajtra

1. **Najprv overiť commit K17.5** ak ešte neprešiel. Commit message
   návrh (commitlint-safe, bez `Word:` patternov):

   ```
   feat(api): platform email provider abstraction — ecomail + resend + stub
   ```

   Detailný popis je v predchádzajúcom session message.

2. **Pred štartom K18.1 prepnúť na Sonnet 4.6.** K18 je primárne CRUD
   endpoints + frontend forms = Sonnet territory. Strategické
   rozhodnutia sú uzavreté v design dokumente.

3. **K18 implementačný entry point:** otvoriť
   `docs/sessions/2026-05-20-slice-6c-k18-design.md` ako prompt
   context. Začať s K18.1 (backend `POST/GET/DELETE /v1/invitations` +
   `Organisation.settings.invitations.enforceAllowedDomains` flag).

4. **EMAIL_FROM_ADDRESS pre dev:** ak chceš testovať invite email v
   dev s Ecomail accountom, potrebuješ pridať do `.env.local`:

   ```
   EMAIL_PROVIDER=ecomail
   ECOMAIL_API_KEY=<tvoj kľúč z Ecomail accountu>
   EMAIL_FROM_ADDRESS=noreply@inventario.estate
   ```

   Pre lokálne testovanie cookies-flow bez reálnych emailov stačí
   default `EMAIL_PROVIDER=stub`.

5. **Apple Sign-In (K4)** stále čaká na Apple Developer account — bez
   neho do K18 invite OAuth path pôjde iba Google + Microsoft. Apple
   sa pridá keď bude účet pripravený, je to dvojhodinová práca (arctic
   provider + callback handler), nezaraďovať do #6c.

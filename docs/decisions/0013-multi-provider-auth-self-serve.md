<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0013. Multi-provider auth + self-serve onboarding

|                   |                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Accepted                                                                                                                                                            |
| **Dátum**         | 2026-05-20                                                                                                                                                             |
| **Autori**        | Ján Letko, Claude Opus 4.7 (LTK Solutions)                                                                                                                             |
| **Súvisiace ADR** | [0004 Auth Entra ID](0004-auth-entra-id.md) (superseded), [0010 Multi-tenant white-label](0010-multi-tenant-white-label.md), [0012 Loans](0012-loans-state-machine.md) |

## Kontext

Inventario je feature-complete pre MVP (7/7 P0 stránok, loans flow end-to-end). Ďalší krok je onboarding prvého pilot tenanta. Aktuálny auth model (Microsoft Entra ID only via MSAL) vyžaduje:

1. Microsoft 365 / Entra ID tenant u zákazníka (eliminuje školy, malé kluby, obce bez M365)
2. Manuálny ADMIN promote cez MongoDB Atlas UI (nescalovateľné)
3. Žiadnu verejnú registráciu — každý tenant musí byť onboardovaný manuálne

Pre škálovateľný SaaS model potrebujeme **self-serve onboarding** od prvého kliknutia na cenníku po funkčného tenanta. To vyžaduje multi-provider auth (Google, Apple, Microsoft, email/heslo).

### Existujúci stav

User schema **už predvída** multi-provider auth (navrhnuté v Slice #1):

- `accountType: 'ENTRA_ID' | 'LOCAL'` — enum pre typ autentifikácie
- `entraOid: string | null` — nullable (null pre LOCAL účty)
- `passwordHash: string | null` — pripravené pre email/heslo auth
- `mustChangePassword`, `invitationSentAt` — helper polia pre LOCAL flow

Backend auth (`plugins/auth.ts`) validuje výlučne Microsoft Entra ID JWT (cez `get-jwks` + `jose`). Frontend (`apps/web`) používa `@azure/msal-react` + `@azure/msal-browser`.

### Obmedzenia

- **EUPL-1.2 projekt** — preferujeme open-source riešenia, vyhýbame sa vendor lock-in
- **White-label multi-tenant** — rôzni tenanti môžu chcieť rôznych providerov
- **Vercel hosting** — žiadny self-hosted server na extra služby (Keycloak/Authentik)
- **EU compliance** — dáta v EU, GDPR-compliant email handling
- **Existujúci users** — migrácia musí byť bezšvová (existujúci MSAL users sa nesmú stratiť)
- **Čas** — chceme prvého pilot tenanta v priebehu 2-3 týždňov

## Možnosti

### Možnosť A: Auth.js v5 (v Next.js)

OAuth handlovaný v Next.js middleware. Auth.js vydáva JWT session cookie. Fastify validuje Auth.js JWT.

- **Plus:** 50+ providerov z balíka, zero infra, community-maintained
- **Mínus:** Auth viazaný na Next.js — nefunguje s Flutter appkou, public API, CLI. Token exchange komplikácie. Dva zdroje pravdy (Next.js session vs Fastify).

### Možnosť B: OAuth v Fastify (Arctic + vlastný Inventario JWT)

Fastify implementuje OAuth2 authorization code flow cez Arctic (MIT, 0 závislostí, od Lucia auth teamu). Backend vydáva vlastný RS256-podpísaný **Inventario JWT**. Frontend je len klient — žiadna auth knižnica.

- **Plus:** Auth centralizovaný v backendu (single source of truth). Provider-agnostický JWT funguje s web, mobile, CLI, MCP. Plná kontrola, open-source, žiadna závislosť na frameworku. Clean migration z MSAL (existujúci `entraOid` sa stáva jedným z viacerých providerov).
- **Mínus:** Viac kódu per provider (ale Arctic to zjednodušuje na ~40 riadkov/provider). Musíme spravovať refresh tokens sami.

### Možnosť C: Keycloak / Authentik (self-hosted IdP)

Externý identity provider, všetci provideri konfigurovaní cez admin UI.

- **Plus:** Battle-tested, SAML pre enterprise, multi-tenant realms
- **Mínus:** Java/Python server na prevádzku. Na Vercel infre nespustiteľné bez samostatného hosting-u. Overkill pre MVP.

### Možnosť D: SaaS auth (Auth0, Clerk, Supabase Auth)

Delegovaná auth na tretiu stranu.

- **Plus:** Najrýchlejší štart, managed
- **Mínus:** Vendor lock-in (odporuje EUPL-1.2 filozofii), drahé at scale, US hosting default (GDPR komplikácie), nie open-source

## Rozhodnutie

Zvolili sme **Možnosť B: OAuth v Fastify cez Arctic + Inventario JWT**.

### Provideri na deň 1

| Provider    | OAuth typ          | Knižnica           | Poznámka                                                           |
| ----------- | ------------------ | ------------------ | ------------------------------------------------------------------ |
| Google      | OAuth 2.0 + OIDC   | `arctic`           | Google Cloud Console OAuth credentials                             |
| Apple       | OAuth 2.0 (custom) | `arctic`           | Apple Developer account ($99/rok), `form_post` response mode       |
| Microsoft   | OAuth 2.0 + OIDC   | `arctic`           | Existujúca Entra ID app registration, rozšíriť o consumer accounts |
| Email/heslo | —                  | `argon2` (hashing) | Vlastná implementácia, verifikačný email povinný                   |

### Inventario JWT

Backend vydáva vlastný JWT podpísaný RS256 kľúčovým párom:

```typescript
interface InventarioJwtPayload {
  sub: string; // Inventario user _id
  iss: 'inventario';
  aud: 'inventario-api';
  org: string; // organisationId
  roles: string[]; // ['ADMIN', 'ASSET_MANAGER', ...]
  email: string;
  name: string;
  iat: number;
  exp: number; // 15 minút
}
```

**Access token:** 15 min expiry, httpOnly cookie na `.inventario.sportup.sk`.
**Refresh token:** 30 dní, httpOnly cookie s `Path=/v1/auth/refresh`, uložený v DB (revokable). Refresh token rotation — každý refresh vydá nový refresh token a staý invaliduje.

Frontend nepotrebuje žiadnu auth knižnicu — cookies sa posielajú automaticky. Pre non-browser klientov (mobile, CLI, MCP) sa token posiela v `Authorization: Bearer` header.

### User schema zmeny

```typescript
// Nový enum (rozšírenie existujúceho AccountType)
type AuthProvider = 'google' | 'apple' | 'microsoft' | 'email';

// Nové pole na UserSchema
authProviders: z.array(z.object({
  provider: z.enum(['google', 'apple', 'microsoft', 'email']),
  providerId: z.string(),   // Google sub, Apple sub, Entra oid, email
  email: z.string().email(),
  linkedAt: z.string().datetime(),
})).default([]),

// Nové polia pre email auth
emailVerified: z.boolean().default(false),
emailVerificationToken: z.string().nullable().default(null),
emailVerificationExpiresAt: z.string().datetime().nullable().default(null),
passwordResetToken: z.string().nullable().default(null),
passwordResetExpiresAt: z.string().datetime().nullable().default(null),
```

Existujúci `entraOid` sa zachová pre backward compat. Migračný skript pridá `authProviders: [{ provider: 'microsoft', providerId: entraOid, email, linkedAt: createdAt }]` všetkým existujúcim users.

### Organisation schema zmeny

Organisation prestáva byť viazaná na Entra tenant ID. Nové polia:

```typescript
// Registrácia
registeredBy: ObjectIdSchema,        // userId prvého ADMIN-a
registrationMethod: z.enum(['self_serve', 'manual', 'invite']),

// Onboarding
onboardingCompletedAt: z.string().datetime().nullable().default(null),

// Auth + member policy
allowedAuthProviders: z.array(
  z.enum(['google', 'apple', 'microsoft', 'email'])
).default(['google', 'apple', 'microsoft', 'email']),
memberJoinPolicy: z.enum([
  'invite_only',        // default — len pozvaní (najbezpečnejšie)
  'domain_restricted',  // auto-join pre konfigurované domény
  'open',               // ktokoľvek s join linkom
]).default('invite_only'),
autoJoinDomains: z.array(z.string()).default([]),  // pre domain_restricted

// Billing (pripravené pre budúcnosť)
plan: z.enum(['free', 'starter', 'professional', 'enterprise']).default('free'),
planExpiresAt: z.string().datetime().nullable().default(null),

// DPA
dpaAcceptedAt: z.string().datetime().nullable().default(null),
dpaAcceptedBy: ObjectIdSchema.nullable().default(null),
```

Existujúce `entraTenantId` pole zostáva pre backward compat a pre Enterprise tenantov, ktorí chcú Entra-only auth.

### Auth endpoints

```
POST   /v1/auth/register           → vytvor Organisation + User(ADMIN) + redirect na OAuth/email
GET    /v1/auth/login/:provider    → redirect na OAuth provider consent screen
GET    /v1/auth/callback/:provider → handle OAuth callback, JIT provision, set cookies
POST   /v1/auth/login/email        → email + heslo → validate → set cookies
POST   /v1/auth/register/email     → register s email + heslom → verifikačný email
POST   /v1/auth/refresh            → refresh access token (httpOnly cookie)
POST   /v1/auth/logout             → revoke refresh token, clear cookies
POST   /v1/auth/forgot-password    → send password reset email
POST   /v1/auth/reset-password     → reset password with token
GET    /v1/auth/verify-email       → verify email address with token
GET    /v1/auth/me                 → current user (replaces /v1/me, alebo alias)
```

### Self-serve registration flow

```
inventario.sportup.sk/pricing
  → klik "Začať zadarmo"
  → app.inventario.sportup.sk/register

/register (pre-auth stránka):
  1. Org name (povinné)
  2. Contact email (povinné)
  3. IČO (voliteľné)
  4. DPA checkbox (povinné)
  5. Vybrať auth metódu:
     [Google] [Apple] [Microsoft] [Email + heslo]

SSO cesta:
  → POST /v1/auth/register { orgName, email, ico, dpaAccepted }
  → server uloží pending registration
  → redirect na /v1/auth/login/:provider
  → OAuth flow → callback
  → JIT provision: Organisation + User(roles: ['ADMIN'])
  → set httpOnly cookies
  → redirect na /onboarding

Email cesta:
  → POST /v1/auth/register/email { orgName, email, password, ico, dpaAccepted }
  → server: create Organisation + User(ADMIN, emailVerified: false)
  → server: send verification email
  → server: set cookies (limited access until verified)
  → redirect na /onboarding (s "Potvrďte email" bannerom)

/onboarding (post-auth wizard):
  Step 1: Potvrdiť org detaily (name, billing email, adresa)
  Step 2: Vybrať kategórie (predpripravené šablóny podľa odvetvia)
  Step 3: Pridať prvú lokalitu
  Step 4: Pozvať kolegov (voliteľné, email invite link)
  Step 5: → /dashboard 🎉
```

### Invite flow (existujúci tenant, nový user)

Pridanie do existujúcej organizácie je **výhradne cez pozvánku** (`memberJoinPolicy: 'invite_only'` default). Žiadna cesta "registruj sa a vyber si tenant" neexistuje — tenant ti buď založíš, alebo ťa pozvú.

```
ADMIN v /users → "Pozvať kolegu" → zadá email
  → server: POST /v1/invites { email, roles }
  → server: vytvorí invite record + odošle email s invite linkom
  → invite link: app.inventario.sportup.sk/invite/:code
  → nový user: klikne link → vyberie auth provider → OAuth / email register
  → server: overi že provider je v `org.allowedAuthProviders` (ak nie → error)
  → JIT provision: User s assigned roles v existujúcej Organisation
```

### Email sending

Pre MVP: **nodemailer** s SMTP (provider-agnostické, žiadny lock-in).

SMTP provider options:

- **Development:** Ethereal (fake SMTP, zachytáva emaily bez odoslania)
- **Production:** Amazon SES EU (Frankfurt region, $0.10/1000 emailov) alebo Resend (free tier 100/deň, EU region)

Konfigurácia cez env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`.

### Token transport — httpOnly cookies

```
Set-Cookie: inv_access=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.inventario.sportup.sk; Max-Age=900
Set-Cookie: inv_refresh=<token>; HttpOnly; Secure; SameSite=Lax; Path=/v1/auth/refresh; Domain=.inventario.sportup.sk; Max-Age=2592000
```

API prijíma token z cookie ALEBO z `Authorization: Bearer` header (pre non-browser klientov). Cookie má prednosť ak sú prítomné obe.

### Frontend zmeny

1. **Drop `@azure/msal-react` + `@azure/msal-browser`** — úplne odstrániť MSAL dependencies
2. **Drop `api-client.ts` MSAL token middleware** — cookies sa posielajú automaticky cez `credentials: 'include'`
3. **Nové stránky:** `/register`, `/login`, `/onboarding` (4 kroky), `/invite/:code`, `/forgot-password`, `/reset-password`, `/verify-email`
4. **`AuthGate` refactor** — namiesto MSAL `useIsAuthenticated()` kontroluje prítomnosť access cookie (cez `/v1/auth/me` endpoint)
5. **AppShell logout** — `POST /v1/auth/logout` namiesto MSAL logoutRedirect

### Migrácia existujúcich MSAL users

Jednorázový migračný skript (K-blok):

```javascript
// Pre každého existujúceho usera s entraOid:
db.users.updateMany(
  { entraOid: { $ne: null }, authProviders: { $exists: false } },
  [
    {
      $set: {
        authProviders: [
          {
            provider: 'microsoft',
            providerId: '$entraOid',
            email: '$email',
            linkedAt: '$createdAt',
          },
        ],
        emailVerified: true, // Entra users majú verified email
      },
    },
  ],
);
```

### Test JWT zmeny

Existujúci test JWT systém (`urn:sfz-test:dev` issuer) sa adaptuje na Inventario JWT formát. Test setup generuje Inventario JWT namiesto Entra JWT. `globalSetup.ts` sa zmení z RS256 JWKS mock na priamy Inventario JWT signing.

## Sub-task breakdown — Slice #6 (Auth Pivot)

### Fáza 1: Backend auth modul (Slice #6a, ~3-4 dni)

| Blok    | Popis                                                                                                        | Model  |
| ------- | ------------------------------------------------------------------------------------------------------------ | ------ |
| **K1**  | Schema zmeny: `authProviders[]`, email verification polia, Organisation onboarding polia. Regen types.       | Sonnet |
| **K2**  | RS256 key pair generation + Inventario JWT issue/verify (`jose`). Refresh token model + repository.          | Sonnet |
| **K3**  | OAuth routes: `/v1/auth/login/:provider`, `/v1/auth/callback/:provider` cez Arctic (Google + Microsoft).     | Sonnet |
| **K4**  | Apple Sign-In route (špeciálny `form_post` response mode, Apple Developer setup guide).                      | Sonnet |
| **K5**  | Email/password: register, login, verify-email, forgot-password, reset-password. Argon2id hashing.            | Sonnet |
| **K6**  | Email sending: nodemailer plugin, HTML email templates (verify, reset, invite), SMTP config.                 | Sonnet |
| **K7**  | Registration endpoint: `POST /v1/auth/register` (org creation + first-user ADMIN provisioning).              | Sonnet |
| **K8**  | Cookie transport: set httpOnly cookies na auth responses, refactor `requireAuth` na cookie+header dual-read. | Sonnet |
| **K9**  | Migračný skript: existujúci MSAL users → `authProviders[]`. Backward-compat: starý `requireAuth` + nový.     | Sonnet |
| **K10** | Testy: auth flow testy, registration E2E, OAuth mock, email/password, refresh rotation, cookie transport.    | Sonnet |

### Fáza 2: Frontend auth migration (Slice #6b, ~2-3 dni)

| Blok    | Popis                                                                                                                                       | Model  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **K11** | `/login` stránka: 4 provider buttons + email/password form. Drop MSAL, AuthGate refactor.                                                   | Sonnet |
| **K12** | `/register` stránka: org info + provider select + DPA checkbox. CTA z pricing page.                                                         | Sonnet |
| **K13** | `/onboarding` wizard: 4-krokový sprievodca (org detaily, kategórie, lokalita, pozvánka).                                                    | Sonnet |
| **K14** | `/forgot-password`, `/reset-password`, `/verify-email` utility stránky.                                                                     | Sonnet |
| **K15** | Drop MSAL dependencies: remove `@azure/msal-*`, `msal-config.ts`, MSAL token middleware z `api-client.ts`. Pridať `credentials: 'include'`. | Sonnet |
| **K16** | Pricing page CTA: link na `app.inventario.sportup.sk/register` z cenníka.                                                                   | Haiku  |

### Fáza 3: Cutover + docs (Slice #6c, ~1 deň)

| Blok    | Popis                                                                            | Model  |
| ------- | -------------------------------------------------------------------------------- | ------ |
| **K17** | Odstrániť starý Entra-only auth path z `plugins/auth.ts`. Cleanup env vars.      | Haiku  |
| **K18** | Invite flow: `POST /v1/invites`, email s invite linkom, `/invite/:code` stránka. | Sonnet |
| **K19** | ADR-0004 superseded note. Milestone doc. NEXT.md update. Day summary.            | Haiku  |

**Celkom:** ~6-8 pracovných dní (19 K-blokov).

## Dôsledky

### Pozitívne

- **Self-serve onboarding** — zákazník si založí tenant z cenníka bez manuálneho zásahu
- **Širšia základňa** — školy, kluby, obce bez Microsoft 365 sa môžu zaregistrovať cez Google/Apple/email
- **Provider-agnostický JWT** — funguje s web, mobile (Flutter), CLI, MCP bez zmien
- **Account linking** — user si môže prepojiť viacerých providerov (Microsoft v práci, Google doma)
- **Invite flow** — ADMIN pozýva kolegov emailom, nie manuálnym setup-om
- **No vendor lock-in** — Arctic je MIT, nodemailer je MIT, JWT je štandard
- **Security upgrade** — httpOnly cookies sú bezpečnejšie než localStorage token (XSS-resistant)
- **Backward-compatible** — existujúci MSAL users sa bezšvovo migrujú

### Negatívne / kompromisy

- **Apple Developer account** — $99/rok povinný pre Apple Sign-In
- **Email infra** — musíme prevádzkovať SMTP (SES/Resend), nový ops concern
- **Väčší attack surface** — password auth prinesa brute-force, credential stuffing riziká. Mitigácia: rate limiting, argon2id (memory-hard), email verification
- **MSAL removal** — strácame niektoré Entra-specific features (conditional access policies, device compliance). Pre enterprise tenantov v budúcnosti zvážime SAML/OIDC federation
- **Session management** — refresh token DB tabuľka + rotation + cleanup job. Viac moving parts než stateless MSAL
- **6-8 dní práce** — odkladá pilot onboarding o týždeň. Ale výsledok je self-serve (žiadne manuálne kroky nikdy potom)

### Riziká, ktoré treba sledovať

- **Apple Sign-In quirks** — `form_post` response mode, user name len pri prvom logine, sandbox testing je komplikovaný
- **Cookie cross-domain** — `api.inventario.sportup.sk` a `app.inventario.sportup.sk` zdieľajú `.inventario.sportup.sk` domain, ale `SameSite=Lax` blokuje cross-site POST requests. Treba overiť že refresh endpoint funguje z app subdomain-y
- **Rate limiting** — email/password login a registration endpointy musia byť rate-limited (bruteforce). Fastify `@fastify/rate-limit` plugin
- **Email deliverability** — verifikačné emaily nesmú skončiť v spam-e. SPF/DKIM/DMARC konfigurácia na `sportup.sk` DNS
- **Refresh token leak** — ak útočník získa refresh cookie, má 30-dňový prístup. Mitigácia: token rotation (každý refresh invaliduje starý), device fingerprinting (budúcnosť)
- **Concurrent sessions** — user prihlásený na 2 zariadeniach. Refresh token rotation musí byť per-device, nie global (inak logout na jednom zariadení odhlási všetky)

## Referencie

- [Arctic — lightweight OAuth2 client (MIT)](https://arcticjs.dev/)
- [jose — JWT/JWE/JWS library (MIT)](https://github.com/panva/jose)
- [ADR-0004 Auth Entra ID](0004-auth-entra-id.md) — superseded by this ADR
- [ADR-0010 Multi-tenant white-label](0010-multi-tenant-white-label.md) — Organisation schema
- [Google OAuth2 for Web Apps](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Sign in with Apple — REST API](https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_rest_api)
- [Microsoft identity platform — OAuth 2.0 auth code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)

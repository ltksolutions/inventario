# NEXT — čo robiť v ďalšej session

## Stav: Slice #6a DOKONČENÝ (2026-05-20)

Všetky K-bloky Slice #6a sú commitnuté a pushnuté.

### Čo bolo urobené

- K1 Schema (authProviders, emailVerified, passwordHash, RegistrationMethod, ...)
- K2 Inventario JWT plugin (RS256, refresh token rotation, reuse detection)
- K3 OAuth routes Google + Microsoft (PKCE, state cookie, provisionOrFindUser)
- K5 Email/password auth (argon2id, register/login/verify/forgot/reset)
- K6 Nodemailer email plugin (SMTP + console stub, branded HTML templates)
- K7 Unified POST /v1/auth/register + GET /v1/auth/me
- K8 Cookie transport (httpOnly, domain-scoped, integrované do K3)
- K9 Migračný skript migrate:auth-providers (backfill entraOid → authProviders)
- K10 Testy — 36 nových: unit (oauth-state), integration (auth-email, auth-register)

### ⚠️ MacOS duplikáty — zmazať ak existujú

```bash
rm -f "/Users/janletko/Documents/GitHub/Asset-Management/apps/api/src/modules/auth/oauth.routes 2.ts"
rm -f "/Users/janletko/Documents/GitHub/Asset-Management/apps/api/src/modules/auth/oauth-state 2.ts"
```

---

## Ďalší krok: Spustiť testy K10

Pred pokračovaním overiť, že nové testy prechádzajú:

```bash
cd /Users/janletko/Documents/GitHub/Asset-Management
pnpm --filter @inventario/api test
```

Očakávaný výsledok: 36+ nových testov (auth-oauth-state, auth-email, auth-register)
plus existujúcich 366 = ~402+ celkovo.

---

## Slice #6b — Frontend auth migration (Next.js)

Cieľ: zahodiť MSAL, nové auth stránky používajúce Inventario JWT + cookies.

### K11 — Odstrániť MSAL závislosti

- Zmazať `@azure/msal-browser`, `@azure/msal-react` z `apps/web/package.json`
- Zmazať `src/lib/msal-config.ts`, `src/components/MsalProvider.tsx`, `LogoutButton.tsx`

### K12 — Nová /login stránka

- Email + heslo form (POST /v1/auth/login/email)
- "Pokračovať s Google" / "Pokračovať s Microsoft" tlačidlá (POST /v1/auth/register → authUrl)
- Spracovanie ?error= query params z OAuth callbackov
- ?verified=true banner

### K13 — Nová /register stránka

- Org info form (orgName, contactEmail, IČO voliteľné, DPA checkbox)
- Provider výber (Google / Microsoft / Email)
- Email path: zobrazia sa polia password + submit
- SSO path: POST /v1/auth/register → redirect na authUrl

### K14 — /onboarding wizard

- Kroky: welcome → org info doplnenie → prvý asset (voliteľné) → hotovo
- PATCH /v1/organisations/:id (onboardingCompletedAt)

### K15 — Auth context refactor

- Nový `AuthProvider` namiesto MSAL — číta inv_access cookie cez GET /v1/auth/me
- `useAuth()` hook vracajúci { user, org, roles, isLoading, logout }
- Logout: POST /v1/auth/logout + redirect /login

### K16 — Milestone doc Slice #6b

---

## Slice #6c — Cutover (backend)

### K17 — Odstrániť starý Entra-only auth path

- Zmazať `src/plugins/auth.ts` (pôvodný MSAL JWT plugin)
- Odstrániť `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_JWKS_URI` z config
- Aktualizovať `requireAuth` middleware na Inventario JWT only

### K18 — Invite flow

- POST /v1/invitations (ADMIN only)
- GET /v1/auth/accept-invite?token=... → onboarding

### K19 — Milestone doc Slice #6c

---

## K4 — Apple Sign-In (čaká na Apple Developer account)

- POST callback (`form_post` response mode)
- `apps/api/src/modules/auth/apple-auth.routes.ts`
- Registrovať v server.ts

---

## Poznámky pre ďalšiu session

- `oauth-state.ts` TTL je 10 minút (hardcoded) — zvážiť či to stačí
- `email-auth.routes.ts` + `registration.routes.ts` obsahujú duplicitnú org/user creation logiku
  → zvážiť extrakciu do `create-org-with-admin.ts` helper funkcie pred K18
- Refresh token `JWT_REFRESH_TOKEN_TTL_DAYS` default = 30 (config.ts) ale v testoch = 7

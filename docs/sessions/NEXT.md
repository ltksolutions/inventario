# NEXT — čo robiť v ďalšej session

## Stav: Slice #6b DOKONČENÝ (2026-05-20)

Frontend auth migration z MSAL → Inventario JWT cookies je kompletná.

### Čo bolo urobené v #6b

- Backend `plugins/auth.ts` — cookie auth prerekvizita (inv_access cookie path v requireAuth + loadCurrentUser)
- K15 `src/lib/auth-context.tsx` — AuthProvider + useAuth() hook
- K11 — MSAL vymazané: api-client, api-hooks, providers, AuthGate, AppShell, LogoutButton, LoginScreen
- K12 — `/login` stránka (email + SSO Google/Microsoft, error/verified bannery)
- K13 — `/register` stránka (org info + DPA + provider výber)
- K14 — `/onboarding` wizard (welcome + redirect na dashboard)
- K16 — milestone doc `docs/milestones/slice-6b-frontend-auth.md`

### ⚠️ Manuálne kroky po merge

```bash
# 1. Odstrániť MSAL z node_modules (z apps/web/)
cd /Users/janletko/Documents/GitHub/Asset-Management
pnpm --filter @inventario/web remove @azure/msal-browser @azure/msal-react

# 2. Zmazať prázdne stub súbory
rm apps/web/src/lib/msal-config.ts
rm apps/web/src/components/LoginButton.tsx

# 3. Overiť build
pnpm --filter @inventario/web build
```

---

## Ďalší krok: Slice #6c — Cutover (backend)

Cieľ: odstrániť starý Entra-only auth path, ktorý zostal aktívny pre backward compat.

### K17 — Odstrániť starú Entra cestu z `requireAuth`

- `src/plugins/auth.ts`: odstrániť Bearer token verifikáciu, Entra JWKS fetcher,
  `verifyToken()`, `verifyEntraToken()`, `verifyTestToken()`, `assertEntraClaims()`
- Zmazať `src/plugins/auth.ts` a nahradiť čistou Inventario JWT verziou
- Odstrániť `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_ISSUER_RESOLVED`,
  `ENTRA_ACCEPTED_AUDIENCES` z `src/plugins/config.ts`
- Update `request.entraClaims` dekoráciu → zmazať (nahradené `inventarioClaims`)
- Aktualizovať integračné testy aby používali Inventario JWT namiesto test Entra JWT

### K18 — Invite flow (ADMIN only)

- `POST /v1/invitations` — ADMIN pošle pozvánku na email
- `GET /v1/auth/accept-invite?token=...` → onboarding

### K19 — Silent token refresh

- Frontend zachytí 401 → automaticky zavolá `POST /v1/auth/refresh` (inv_refresh cookie)
- Pri úspechu retry pôvodného requestu
- Pri neúspechu redirect na /login

### K20 — Chýbajúce stránky z #6b deferral listu

- `/register/verify-email` — info stránka po email registrácii
- `/forgot-password` — form na reset hesla
- `/reset-password?token=...` — nové heslo

### K21 — Milestone doc Slice #6c

---

## Poznámky

- `inv_access` TTL je 15 min (JWT_ACCESS_TOKEN_TTL_SECONDS). Bez K19 silent refresh
  budú používatelia presmerovaní na /login po 15 min nečinnosti.
- Integračné testy stále používajú test JWT (Bearer). Slice #6c K17 ich aktualizuje.
- Apple Sign-In (K4) čaká na Apple Developer account — nezaraďovať do #6c.

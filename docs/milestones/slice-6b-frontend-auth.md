<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Slice #6b — Frontend Auth Migration (Completed 2026-05-20)

## Cieľ

Nahradiť MSAL (Azure Entra ID redirect flow) za **Inventario JWT cookie-based auth** vo
frontende `apps/web`. Po tomto slice sa používatelia prihlasujú cez `/login` (email+heslo
alebo SSO Google/Microsoft) a API volania idú cez httpOnly `inv_access` cookie namiesto
Bearer tokenu.

**Vyžaduje Slice #6a** (Inventario JWT plugin, email/OAuth routes, cookie helpers).

---

## Výsledok

| K-krok               | Čo bolo urobené                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend prerekvizita | `plugins/auth.ts` — `requireAuth` kontroluje `inv_access` cookie pred Bearer headerom; `loadCurrentUser` má Inventario JWT cestu (načíta user + org priamo z MongoDB) |
| K15                  | `src/lib/auth-context.tsx` — `AuthProvider` + `useAuth()` hook (plain fetch GET /v1/me)                                                                               |
| K11                  | `src/lib/api-client.ts` — bez MSAL, `credentials: 'include'`, 401→redirect middleware                                                                                 |
| K11                  | `src/lib/api-hooks.ts` — `useIsAuthenticated()` → `useAuth().isAuthenticated` (10 hook funkcií)                                                                       |
| K11                  | `src/app/providers.tsx` — `<MsalProvider>` → `<QueryClientProvider><AuthProvider>`                                                                                    |
| K11                  | `src/components/AuthGate.tsx` — `useIsAuthenticated()` → `useAuth()` + loading state                                                                                  |
| K11                  | `src/components/AppShell.tsx` — `useMsal()/useAccount()` → `useAuth().user`                                                                                           |
| K11                  | `src/components/LogoutButton.tsx` — MSAL redirect logout → `useAuth().logout()`                                                                                       |
| K11                  | `src/components/LoginScreen.tsx` — aktualizovaný copy + linky na /login a /register                                                                                   |
| K11                  | `src/lib/msal-config.ts`, `LoginButton.tsx` — stubnuté (môžu byť zmazané po `pnpm remove`)                                                                            |
| K11                  | `apps/web/package.json` — odstránené `@azure/msal-browser`, `@azure/msal-react`                                                                                       |
| K12                  | `src/app/login/page.tsx` + `src/components/LoginPage.tsx` — email form + SSO tlačidlá, `?error=` a `?verified=true` bannery                                           |
| K13                  | `src/app/register/page.tsx` + `src/components/RegisterPage.tsx` — org info + DPA + provider výber                                                                     |
| K14                  | `src/app/onboarding/page.tsx` + `src/components/OnboardingPage.tsx` — welcome wizard                                                                                  |
| K16                  | Tento súbor                                                                                                                                                           |

---

## Architektúra auth flow (po slice #6b)

```
Nový používateľ:
  /register → POST /v1/auth/register → (email: verify email, SSO: redirect OAuth) → /onboarding → /

Existujúci používateľ:
  /login → POST /v1/auth/login/email alebo SSO → set inv_access cookie → /

Každý request:
  browser odošle inv_access cookie (httpOnly, credentials:'include')
  backend requireAuth: cookie path → inventarioJwt.verifyAccessToken()
                                   → loadCurrentUser (MongoDB lookup)
  alebo Bearer path: Entra JWT (zostáva funkčný do Slice #6c K17)

Logout:
  useAuth().logout() → POST /v1/auth/logout → clear cookies → router.push('/login')
```

---

## Backend zmena (prerekvizita, nie v pôvodnom NEXT.md)

`plugins/auth.ts` bol aktualizovaný aby `requireAuth` aj `loadCurrentUser`
podporovali oba auth mechanizmy paralelne:

- **Inventario JWT cookie** (nová cesta): čítanie `inv_access` cookie, overenie cez
  `fastify.inventarioJwt.verifyAccessToken()`, načítanie user + org priamo z MongoDB.
- **Bearer token** (pôvodná Entra cesta): zostáva funkčná pre existujúce MSAL sessions
  a pre integračné testy, kým Slice #6c (K17) ju neodstráni.

Nie je potrebná žiadna zmena v `server.ts` ani v route pluginoch.

---

## Deferral list (čo NIE JE v Slice #6b)

- **Automatický refresh tokenu**: `inv_access` expiruje za 15 min (JWT TTL). Frontend
  zatiaľ nemá automatický silent refresh cez `inv_refresh` cookie. Po 15 min dostane
  používateľ 401 a je presmerovaný na `/login`. Silent refresh príde v Slice #6c.
- **Apple Sign-In (K4)**: čaká na Apple Developer account.
- **`/register/verify-email` stránka**: RegisterPage po email registrácii presmerúva
  na `/register/verify-email` ktorá ešte neexistuje — treba doplniť (info stránka).
- **`/forgot-password` a `/reset-password`**: LoginPage má linku na forgot-password
  ale stránka ešte neexistuje.
- **`pnpm remove @azure/msal-browser @azure/msal-react`**: ručný krok po merge —
  `msal-config.ts` a `LoginButton.tsx` sú prázdne stuby, môžu byť zmazané.
- **Slice #6c K17**: odstrániť Bearer/Entra cestu z `plugins/auth.ts`, updatovať
  `requireAuth` na Inventario JWT only.

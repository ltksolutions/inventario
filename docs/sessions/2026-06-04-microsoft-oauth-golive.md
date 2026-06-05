<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-06-04 — Microsoft OAuth go-live (ADR-0031 nasadenie + User.Read fix)

## Cieľ

Dotiahnuť ADR-0031 z „implementované" do „reálne funguje na produkcii": nastaviť
Microsoft OAuth credentials, otestovať prihlásenie člena cez Microsoft na
`app.inventario.estate`, a vyriešiť chyby, ktoré sa pri prvom živom teste vynorili.

## Východiskový stav

ADR-0031 E1–E8 kód hotový a pushnutý (per-tenant `oauthCredentials`, AES-256-GCM
šifrovanie, per-request Arctic resolúcia, admin UI „Microsoft aplikácia"). Chýbalo
už len nastaviť env/credentials a otestovať živý login.

## Čo sa spravilo

### 1. Vyjasnenie troch nezávislých vrstiev (konfiguračné rozhodnutie)

Pri nastavovaní SFZ org sa ukázalo, že tri polia v `/settings/auth` riešia rôzne veci
a nie sú zameniteľné — zhrnuté pre budúcu referenciu:

- **Povolené firemné domény** (`autoJoinDomains`, napr. `@futbalsfz.sk`) — _join policy_:
  kto sa môže pripojiť bez individuálnej pozvánky. Pracuje s e-mailom, o membershipe.
- **Microsoft Entra ID — firemný adresár** (`entraTenantId`) — _security guard_: overuje
  `tid` claim z id_tokenu, že člen reálne patrí do daného Entra adresára (ADR-0030 D2).
  Silnejšie než doména (e-mail sa dá nahlásiť, `tid` je podpísaný Microsoftom).
- **Microsoft aplikácia (vlastná)** (`oauthCredentials.microsoft`) — _cez ktorú Azure app_
  ide consent/token exchange. Prázdne = platformová Inventario app (env fallback).

Záver: doména **nenahrádza** `entraTenantId`. Pre SFZ pilot dáva zmysel mať oboje
(doména na auto-join pohodlie + `entraTenantId` na uzamknutie na SFZ adresár), vlastnú
Microsoft app netreba — env fallback drží pilot.

### 2. Nová Azure App Registration (čistý rez)

Pôvodné dve dev app registrácie (slice #2 legacy: API app `7927aaa3-…` + CLI app
`40b94818-…`) sú v runtime nepoužívané. Rozhodnutie: vytvoriť novú app registráciu
a staré zmazať.

Konfigurácia novej app:

- Supported account types: Multitenant (`organizations`)
- Redirect URI (Web): `https://api.inventario.estate/v1/auth/callback/microsoft`
- API permissions → Microsoft Graph → Delegated: `User.Read`, `openid`, `profile`,
  `email`, `offline_access`

### 3. Fix 1 — 403 z Graph /me (User.Read scope)

Prvý živý test zlyhal: token exchange prešiel, ale `GET graph.microsoft.com/v1.0/me`
vrátil **403**. Root cause: access token nemal Graph oprávnenie `User.Read` — scopes
boli len OIDC (`openid profile email offline_access`).

Fix: pridané `User.Read` do Microsoft scopes na oboch miestach:

- `apps/api/src/modules/auth/oauth.routes.ts` — `buildAuthorizationUrl()`
- `apps/api/src/modules/auth/registration.routes.ts` — SSO scopes vetva

Aj v Azure ako delegated permission. Testy netreba meniť (arctic mockovaný).

### 4. Fix 2 — stale openapi.json (CI)

CI `openapi:export:offline --check` padol: `openapi.json` zastaraný po ADR-0031 E7.
Regen: `pnpm --filter @inventario/api openapi:export:offline` → commit `8c5ada8`.

### 5. Fix 3 — flaky test oauth-crypto (1/16 pravdepodobnosť)

`tests/unit/oauth-crypto.test.ts` — test „tampered ciphertext throws" bol flaky:
naivný flip `slice(0,-1) + 'f'` nepomôže ak posledný znak ciphertextu už je `'f'`
(~1/16 behov). Opravené na deterministický flip: `lastChar === '0' ? '1' : '0'`.

### 6. Fix 4 — invite_required (chýbajúci authProvider)

Po nasadení scope fixu login stále padal na `?error=invite_required`. Root cause:
user `jan.letko@futbalsfz.sk` bol vytvorený cez email/heslo flow a nemal nalinkovaný
Microsoft `authProvider`. Kód hľadá usera výhradne podľa
`authProviders[].{provider: 'MICROSOFT', providerId: '<GUID>'}`.

Microsoft Object ID (z Azure Portal → Entra ID → Users):
`0c437485-acfb-485b-a713-213897049c2f`

Oprava manuálne v Atlas Data Explorer — pridaný `authProviders` záznam s correct
`providerId` (GUID, nie email string — prvý pokus mal email namiesto GUID).

Po oprave: **Microsoft login funguje ✅**

## Súbory dotknuté (kód)

- `apps/api/src/modules/auth/oauth.routes.ts` — `User.Read` scope
- `apps/api/src/modules/auth/registration.routes.ts` — `User.Read` scope
- `apps/api/tests/unit/oauth-crypto.test.ts` — deterministický tamper flip
- `apps/api/openapi.json` — regen (commit `8c5ada8`)

## Stav na konci session

Microsoft login funguje na produkcii. SFZ pilot má funkčné prihlásenie cez Microsoft.

## Poznámky pre budúcnosť

**Account linking (P4):** keď existujúci email/heslo user chce pridať Microsoft login,
narazí na rovnaký `invite_required`. Treba feature „Prepojiť Microsoft účet" v nastaveniach
profilu (link existing authProvider). Zatiaľ riešiť manuálne cez Atlas pre admina.

**Cleanup (ostatok):**

- Zmazať staré Azure app registrácie (API `7927aaa3-…` + CLI `40b94818-…`)
- `.env.local` mŕtve premenné `ENTRA_CLI_CLIENT_ID` + `ENTRA_API_CLIENT_ID` — upratať pri príležitosti

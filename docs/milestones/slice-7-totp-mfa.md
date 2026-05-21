<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Slice #7 — TOTP MFA (tenant-level optional)

**Dátum:** 2026-05-21  
**Status:** ✅ DOKONČENÝ  
**Commit rozsah:** K7.1 – K7.8  
**Testy po dokončení:** 480 / 480

---

## Čo sme vyriešili

Pred Slice #7 nemal Inventario žiadny druhý faktor pre email-password
používateľov. OAuth users (Google/MS) mali MFA na strane providera,
ale LOCAL účty boli chránené iba heslom. Pred SFZ pilotom potrebujeme
aspoň voliteľné TOTP MFA — compliance a security posture to vyžadujú.

---

## Architektúrne rozhodnutia

### MFA policy na úrovni tenanta

`Organisation.settings.mfa.policy` s troma hodnotami:

- `'DISABLED'` (default) — žiadne MFA, backward kompatibilita
- `'OPTIONAL'` — používatelia si zapínajú dobrovoľne v profile
- `'REQUIRED'` — email-password users musia mať MFA (forced setup)

`skipForOauth: true` (default) — Google/MS users preskočia MFA challenge,
lebo majú vlastné MFA na strane providera.

### TOTP bez externých závislostí

Namiesto `@otplib` sme napísali RFC 6238 implementáciu v ~80 riadkoch
čistého Node.js (`node:crypto` HMAC-SHA1). Rovnako aj RFC 4648 base32
codec (~60 riadkov). Nula nových production závislostí.

Dôvod: TOTP algoritmus je jednoznačne špecifikovaný, testovateľný a
stabilný. `@otplib` by priniesol 3 tranzitívne závislosti bez žiadnej
funkčnej pridanej hodnoty.

### Šifrovanie TOTP secret v DB

TOTP secrets sú šifrované AES-256-GCM (`node:crypto`) pomocou
`MFA_SECRET_ENCRYPTION_KEY` (32 bytes / 64 hex chars z env).
Formát: `<iv-hex>:<authTag-hex>:<ciphertext-hex>`.

DB kompromitácia samotná nestačí na obídenie MFA — útočník by
potreboval aj server env. Recovery codes sú hashované argon2id
(rovnaké parametre ako heslá).

### Login flow 202 response

Po úspešnom email+heslo, ak `user.mfaEnabled === true`:

- Server nevydá auth cookies
- Vydá krátkodobý `mfaSessionToken` (5 min, JWT, audience
  `inventario-mfa-challenge` — odlišná od `inventario-api`)
- Vráti `202 { mfaRequired: true, mfaSessionToken }`
- Frontend uloží token do `sessionStorage` a presmeruje na `/login/mfa`
- User zadá TOTP / recovery kód → `POST /v1/auth/mfa/challenge` →
  normálne auth cookies

---

## Implementácia

### Backend

**Nové súbory:**

- `apps/api/src/lib/base32.ts` — RFC 4648 base32 encoder/decoder
- `apps/api/src/lib/totp.ts` — RFC 6238 TOTP (SHA-1, 6 digits, 30s period,
  ±1 step window, constant-time compare). `generateCodeForTesting()` export
  pre integračné testy.
- `apps/api/src/lib/mfa-crypto.ts` — AES-256-GCM encrypt/decrypt TOTP
  secrets, argon2id-hashed recovery codes (8 × `XXXX-XXXX`)
- `apps/api/src/modules/auth/mfa/mfa.routes.ts` — 5 endpointov (viz nižšie)

**Upravené:**

- `packages/shared-types/src/schemas/user.ts` — pridané `mfaEnabled`,
  `mfaSecret`, `mfaRecoveryCodes`, `mfaEnabledAt`. Excluded z
  `CreateUserSchema` + `UpdateUserSchema` (managed via /v1/auth/mfa endpoints)
- `apps/api/src/modules/users/users.repository.ts` — `PUBLIC_PROJECTION`
  rozšírená o `mfaSecret: 0, mfaRecoveryCodes: 0`. `insertNew()` destructures
  MFA secrets out of returned doc.
- `apps/api/src/modules/invitations/invitations.repository.ts` — list
  projection tiež excluduje MFA secrets
- `apps/api/src/modules/users/users.service.ts` — `buildUserFromClaims()`
  inicializuje MFA fields na false/null/[]
- `apps/api/src/modules/invitations/invitations.routes.ts` — pendingUser
  inicializuje MFA fields
- `apps/api/src/plugins/inventario-jwt.ts` — `issueMfaSessionToken(userId)`
  - `verifyMfaSessionToken(token)` (5 min TTL, audience inventario-mfa-challenge)
- `apps/api/src/plugins/config.ts` — `MFA_SECRET_ENCRYPTION_KEY` env var
- `apps/api/turbo.json` — `MFA_SECRET_ENCRYPTION_KEY` v globalEnv
- `apps/api/tests/setup.ts` — generuje ephemeral 32-byte key per test run
- `apps/api/src/modules/auth/email-auth.routes.ts` — login flow MFA gate
  (202 response s mfaSessionToken keď `user.mfaEnabled === true`)
- `apps/api/src/server.ts` — registrácia `mfaRoutesPlugin`

**Bug fix počas testov:**  
`org.allowedAuthProviders` je `undefined` na starých/testových org dokumentoch.
`undefined.includes(...)` → TypeError → 500. Oprava: `allowedProviders ?? []`
s podmienkou `length > 0` pred kontrolou.

### API endpointy

| Endpoint                         | Auth            | Správanie                                                                                                                                                                           |
| -------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/auth/mfa/setup`        | cookie          | Generuje secret + QR URL + 8 plaintext recovery codes. Uloží encrypted secret + hashed codes. `mfaEnabled` zostáva `false`. Volanie znova pred verify-setup prepíše pending secret. |
| `POST /v1/auth/mfa/verify-setup` | cookie          | Overí prvý TOTP kód → aktivuje `mfaEnabled=true` + `mfaEnabledAt`.                                                                                                                  |
| `POST /v1/auth/mfa/disable`      | cookie          | Password re-entry (LOCAL only) → clear všetkých MFA fielsdov.                                                                                                                       |
| `GET /v1/auth/mfa/status`        | cookie          | `{enabled, enabledAt, recoveryCodesRemaining}`                                                                                                                                      |
| `POST /v1/auth/mfa/challenge`    | mfaSessionToken | TOTP kód (6 číslic) alebo recovery code (XXXX-XXXX). Ak recovery: single-use (odstráni sa z array). Vydá access+refresh cookies.                                                    |

Boot guard: ak `MFA_SECRET_ENCRYPTION_KEY` nie je nastavený, endpointy
vracajú 503 namiesto odmietnutia štartu servera.

### Frontend

- `apps/web/src/app/login/mfa/page.tsx` + `MfaChallengePage.tsx` —
  TOTP challenge page. TOTP mode: large monospace input, auto-submit
  na 6. číslici. Recovery mode: toggle cez link. Token z `sessionStorage`,
  vymazaný po úspešnom challenge.
- `apps/web/src/app/settings/security/page.tsx` + `SecurityContent.tsx` —
  MFA management. Disabled state → Enable flow (2 kroky: QR + recovery
  codes → TOTP confirm). Enabled state → zelený status panel + disable
  form s password re-entry. Warning pri ≤2 zostávajúcich recovery kódoch.
- `apps/web/src/components/LoginPage.tsx` — handle 202 → uloží token
  do `sessionStorage` → redirect na `/login/mfa`
- `apps/web/src/components/AppShell.tsx` — pridaný "Bezpečnosť" nav item
  (Lock icon → `/settings/security`)

### Testy

`apps/api/tests/integration/mfa.test.ts` — 24 testov:

| Describe                       | Počet |
| ------------------------------ | ----- |
| POST /v1/auth/mfa/setup        | 5     |
| POST /v1/auth/mfa/verify-setup | 5     |
| POST /v1/auth/mfa/disable      | 3     |
| GET /v1/auth/mfa/status        | 2     |
| Login MFA gate                 | 2     |
| POST /v1/auth/mfa/challenge    | 7     |
| Full E2E flow                  | 1     |

Celkovo: **480 testov, 0 failov**.

---

## Čo NIE JE v Slice #7

- **REQUIRED policy enforcement** — org setting je k dispozícii v DB,
  ale login flow zatiaľ nevykonáva forced setup pri `policy=REQUIRED`.
  Pridá sa keď prvý pilot tenant bude chcieť mandatórne MFA.
- **SMS MFA** — out of scope, TOTP je priemyselný štandard
- **TOTP backup pri strate recovery kódov** — admin môže deaktivovať
  MFA priamo v DB ako emergency. Formal flow (admin reset cez UI) sa
  pridá keď nastúpi prvý tenant ktorý to bude potrebovať.
- **MFA pre OAuth flows** — `skipForOauth=true` je default. Konfigurovateľné
  cez `Organisation.settings.mfa.skipForOauth` ale UI na to zatiaľ nie je.
- **Passkeys / WebAuthn** — Slice #8, po pilot feedbacku

---

## Závislostiové zmeny

Žiadne nové production závislosti. Všetka kryptografia cez `node:crypto`
(built-in). `argon2` (už prítomné) použité pre recovery codes.

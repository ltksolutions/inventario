# NEXT — čo robiť v ďalšej session

## Stav: Slice #6c K17–K20 + K18 DOKONČENÉ (2026-05-21)

Cookie-based auth je end-to-end funkčné. Entra Bearer path je preč.
Email provider abstrakcia (Ecomail + Resend + stub) je v prevádzke.
Invite flow (K18) je kompletný — backend + frontend.

### Čo bolo urobené 2026-05-21 (ráno + popoludnie)

- **K17.5** Platform email provider abstrakcia — Ecomail.cz +
  Resend.com + stub. Nodemailer/SMTP plne odstránené.
- **K18.1–K18.4** Backend invitations — `POST/GET/DELETE /v1/invitations`,
  `GET /v1/auth/invitations/:token`, `POST /v1/auth/accept-invitation`
  (password path), audit eventy, `enforceAllowedDomains` flag,
  `sendInvitationEmail` template. **454 testov OK.**
  - Známy bug fix: MongoDB sparse unique index na `entraOid` indexuje
    aj null hodnoty → invite docs majú `entraOid` field úplne mimo,
    nie nastavený na null.
- **K18.5–K18.6** Frontend — `/accept-invite` public page (preview +
  password form + OAuth buttons + strength meter), `/settings/invitations`
  admin page (send form s role pills, pending tabuľka, debounced search,
  revoke). AppShell má "Pozvánky" nav item.

Predchádzajúci session log: `docs/sessions/2026-05-20-night-slice-6c-progress.md`
K18 design dokument: `docs/sessions/2026-05-20-slice-6c-k18-design.md`

---

## Ďalší krok: Slice #7 — TOTP MFA (tenant-level optional)

**Rozhodnutie (2026-05-21):** Pred SFZ pilotom doplníme TOTP MFA pre
email-password používateľov. OAuth users (Google/MS) majú MFA na strane
providera — preto skip pre nich. Tenant má voľbu cez policy.

### Architektúra

**Organisation policy** (`Organisation.settings.mfa`):

```ts
{
  policy: 'DISABLED' | 'OPTIONAL' | 'REQUIRED',  // default: 'DISABLED'
  skipForOauth: boolean,                          // default: true
}
```

- `DISABLED` — žiadne MFA v tenant (default, backward compat)
- `OPTIONAL` — používatelia si zapnú dobrovoľne v profile
- `REQUIRED` — email-password používatelia MUSIA mať MFA (forced setup
  pri prvom úspešnom logine ak ešte nemajú)

**User model rozšírenie**:

```ts
{
  mfaEnabled: boolean,             // default: false
  mfaSecret: string | null,        // AES-256-GCM encrypted base32 TOTP
  mfaRecoveryCodes: string[],      // argon2id hashed, single-use, ~8 ks
  mfaEnabledAt: string | null,
}
```

TOTP secret šifrovaný pomocou `MFA_SECRET_ENCRYPTION_KEY` (env, 32 bytes
hex). Recovery kódy hashované argon2id (rovnaké params ako heslá).

### Endpointy

| Endpoint                         | Auth                     | Behaviour                                                                                |
| -------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------- |
| `POST /v1/auth/mfa/setup`        | cookie                   | Generuje secret + QR URL + 8 recovery kódov, ESTE NEAKTIVUJE                             |
| `POST /v1/auth/mfa/verify-setup` | cookie                   | Zadanie prvého TOTP kódu → aktivuje (`mfaEnabled=true`, secret + recovery codes uložené) |
| `POST /v1/auth/mfa/disable`      | cookie                   | Vyžaduje password re-entry → clear secret + recovery codes                               |
| `POST /v1/auth/mfa/challenge`    | žiadna (mfaSessionToken) | Vymeň `{mfaSessionToken, code                                                            | recoveryCode}` za JWT cookies |
| `GET /v1/auth/mfa/status`        | cookie                   | Vráti `{enabled, enabledAt}` pre profile UI                                              |

### Login flow zmena

`POST /v1/auth/login/email`:

1. Verify email + password (existujúci flow)
2. **NOVÉ:** Ak `user.mfaEnabled === true`:
   - **Nevydaj** JWT cookies
   - Vytvor krátkodobý `mfaSessionToken` (5 min, JWT s claim `purpose: 'mfa_challenge'`)
   - Vráť `202 { mfaRequired: true, mfaSessionToken: '...' }`
   - Frontend pošle používateľa na `/login/mfa`
3. Ak `org.settings.mfa.policy === 'REQUIRED'` AND `!user.mfaEnabled`:
   - Force MFA setup: vráť `202 { mfaSetupRequired: true, mfaSetupSessionToken: '...' }`
   - Frontend redirect na `/login/mfa-setup`

`POST /v1/auth/mfa/challenge`:

1. Verify `mfaSessionToken` (purpose=mfa_challenge, not expired)
2. Try TOTP code first (otplib + decrypt secret)
3. Ak fail, try recovery code (argon2.verify proti každému stored hashu)
4. Ak fail oba → 401
5. Ak recovery code, mark consumed (remove z array)
6. Vydaj normálne JWT access + refresh cookies

OAuth login (`/v1/auth/callback/:provider`):

- Ak `org.settings.mfa.skipForOauth === true` (default), preskoč MFA
- Ak `false`, aplikuj rovnaký challenge flow ako email login

### Frontend stránky

- `/settings/security` — MFA management page (status, enable/disable, recovery codes view)
- `/login/mfa` — TOTP challenge page (input + "Use recovery code" link)
- `/login/mfa-setup` — forced setup pri REQUIRED policy
- Login page update — handle 202 response, redirect podľa typu

### Sub-slice breakdown

| Krok | Rozsah                                                             | Trvanie |
| ---- | ------------------------------------------------------------------ | ------- |
| K7.1 | Schema: User MFA fields + Organisation.settings.mfa                | ~30 min |
| K7.2 | `lib/totp.ts` (otplib wrapper) + `lib/mfa-crypto.ts` (AES-256-GCM) | ~30 min |
| K7.3 | Backend endpoints: setup, verify-setup, disable, status            | ~1 h    |
| K7.4 | Login flow integration: 202 response s mfaSessionToken             | ~30 min |
| K7.5 | `POST /v1/auth/mfa/challenge` endpoint                             | ~30 min |
| K7.6 | Tests (~25 nových integration testov)                              | ~1 h    |
| K7.7 | Frontend `/settings/security` + MFA challenge stránky              | ~1.5 h  |
| K7.8 | Milestone doc + NEXT.md update                                     | ~15 min |

**Total:** ~5.5 hodín. Sonnet 4.6 môže spraviť celé. Strategické
rozhodnutia uzavreté v tomto pláne.

### Závislosti

- `@otplib/core` + `@otplib/preset-default` — pridať do `apps/api/package.json`
- `MFA_SECRET_ENCRYPTION_KEY` v configu (32-byte hex, nový env var)
- Žiadne DB migrácie — existujúci users majú `mfaEnabled: false` po
  default-e (nový field, undefined → false v service layer)

---

## Po Slice #7 → Pilot tenant onboarding

Slice #7 uzatvára auth+security feature set pre pilot:

- **Pilot tenant onboarding** — onboard SFZ. `Organisation.settings`
  config (allowedDomains, mfa.policy, brandKit, plan), prvý ADMIN user,
  sandbox dáta na overenie loans flow end-to-end.
- **DPIA finalizácia** — Data Protection Impact Assessment dokument
  pred pilotom (compliance pre EUPL/GDPR open-source distribúciu).

---

## Poznámky / odložené veci

### Auth / Security (po Slice #7)

- **Passkeys (WebAuthn/FIDO2)** — moderný passwordless login cez Touch ID,
  Face ID, Windows Hello. Knižnice: `@simplewebauthn/server` +
  `@simplewebauthn/browser`. Vyžaduje novú `passkeys` kolekciu (credential
  ID, public key, counter per user), registration ceremony + authentication
  ceremony, challenge storage. **Slice #8 plán**, ~2–3 dni práce, pridať
  po pilot feedbacku. Použiteľné popri MFA — passkey môže nahradiť aj
  heslo aj druhý faktor (single-step strong auth).
- **Apple Sign-In (K4)** — čaká na Apple Developer account. ~2h práce
  keď bude pripravený (arctic provider + callback handler).
- **K18.3 OAuth invite accept** — invitee klikne "Prijať s Google" na
  /accept-invite. Vyžaduje rozšírenie `oauth-state.ts` o
  `invitationToken` + úpravu callback handleru. ~2–3 h práce, K7 má
  prednosť pre pilot.

### Multi-tenant / business

- **Cross-tenant invites** — User ↔ Organisation many-to-many refactor
  (Memberships table). Vlastný slice.
- **Email change v user profile** — invitee swap z osobného na firemný
  email po accepte. Samostatný feature s vlastným verification flow.
- **Per-tenant email provider override** — každý tenant si nastaví
  vlastný Ecomail/Resend account v `Organisation.settings.email`.
- **Per-email exception list** pre invitation domain policy —
  `Organisation.settings.invitations.exceptions: string[]`. Pridá sa
  keď SFZ pilot reálne narazí na externých dodávateľov.

---

## Šablóna pre štart ďalšej session

```
Pokračujeme Slice #7 — TOTP MFA (tenant-level optional).

Plán v docs/sessions/NEXT.md. Začneme K7.1 (schema zmeny pre User
mfaEnabled/mfaSecret/mfaRecoveryCodes + Organisation.settings.mfa).

Model: Sonnet 4.6.

Pred štartom: ak boli K17.5 + K18 commitnuté úspešne, prejdeme rovno
na implementáciu. Inak najprv commit chvostov.
```

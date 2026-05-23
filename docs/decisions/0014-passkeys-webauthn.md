<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0014. Passkeys / WebAuthn — phishing-resistant a passwordless auth

> ⚠️ **Partially superseded by [ADR-0016](0016-passkeys-implementation-plan.md)** (2026-05-25).  
> ADR-0016 nahrádza schema design, audit log strategy a recovery rules pre post-Slice #9 (cross-tenant memberships) sveť. Foundation rationale (Možnosť C, knižnice, WebAuthn config, login UX), kontext a tento dokument zostáva aktuálny pre historickú stopu rozhodnutia. Implementácia Slice #8 sa riadi ADR-0016.

|                   |                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Accepted                                                                                                                                                           |
| **Dátum**         | 2026-05-22                                                                                                                                                            |
| **Autori**        | Ján Letko, Claude Opus 4.7 (LTK Solutions)                                                                                                                            |
| **Súvisiace ADR** | [0013 Multi-provider auth](0013-multi-provider-auth-self-serve.md), [0010 Multi-tenant white-label](0010-multi-tenant-white-label.md) (Slice #7 TOTP MFA — milestone) |

## Kontext

Po dokončení Slice #6 (multi-provider auth) a Slice #7 (TOTP MFA) má Inventario tieto autentifikačné metódy:

- **OAuth** (Google, Microsoft) — provider's own MFA, zero additional friction
- **Email + heslo** — bez MFA (slabé) alebo s **TOTP** (RFC 6238, 6-digit kód každých 30s)
- **Recovery codes** (8 ks per user) ako fallback pri strate authenticator app-y

Tento stack je solídny pre v1 pilot, ale má dve známe slabiny:

1. **Phishing-zraniteľnosť hesiel a TOTP kódov.** Heslo aj TOTP kód sa dajú phishnúť (man-in-the-middle, fake login page). TOTP iba pridáva čas (kód platí ~30s), ale neeliminuje útok — pokročilé phishing kity (Modlishka, evilginx2) ukradnú aj TOTP code v real-time.
2. **UX trenice email-password používateľov.** Heslo si treba pamätať (alebo password manager), TOTP code prepisovať z phone-u. SFZ pilot bude mať ~30–50 používateľov, ale ďalší tenanti môžu mať 500+ — friction sa kumuluje.

WebAuthn / FIDO2 — známe pod commercial názvom **passkeys** — rieši oboje:

- **Phishing-resistant by design.** Credential je viazaný na presný RP ID (origin). Žiadny fake login page nedokáže získať podpísateľný challenge.
- **Passwordless UX.** User klikne "Sign in with passkey" → Touch ID / Face ID / Windows Hello → prihlásený. Žiadne heslo, žiadny TOTP kód.

Browser support je v 2026 universal: Chrome/Edge ≥108, Safari ≥16, Firefox ≥122, všetky iOS ≥16 a Android ≥9. iCloud Keychain a Google Password Manager passkey-y synchronizujú medzi zariadeniami toho istého user-a. Cross-device flow (QR code → mobile authenticator) je tiež štandardný.

Toto ADR rozhoduje **kedy, ako a v akej forme** passkey podporu zaviesť do Inventaria.

### Existujúci stav

Slice #7 dodal:

- `Organisation.settings.mfa.policy` enum (`DISABLED` / `OPTIONAL` / `REQUIRED`) — passkey policy môžeme zatiaľ zakomponovať pod tento policy enum alebo pridať separátny.
- `User.mfaEnabled`, `mfaSecret` (AES-256-GCM encrypted), `mfaRecoveryCodes` (argon2id hashed) — TOTP-specific polia. Passkey credentials budú **separátna collection** (rozhodnutie nižšie), nie ďalšie polia na user-i.
- `fastify.inventarioJwt.issueMfaSessionToken(userId)` + `verifyMfaSessionToken(token)` — short-lived (5 min) signed challenge token pattern. Passkey login-challenge flow ho **zrkadlí** s vlastným audience (`inventario-webauthn-authentication`).
- Login flow s 202 response (`{ mfaRequired, mfaSessionToken }`) — passkey login bude alternatívny entry point, ktorý 202 step preskočí (passkey IS MFA).

### Obmedzenia a kontext rozhodovania

- **EUPL-1.2 projekt** — preferujeme MIT/Apache OSS knižnice
- **Vercel hosting** — bez self-hosted komponentov
- **Multi-tenant** — passkey priestor je per-RP-ID; v budúcnosti pri custom tenant doménach (`tenant.inventario.sk`) automatický per-tenant izolovaný priestor
- **EU compliance** — public key + metadata sú viazané na user → spadajú pod GDPR. Musia sa mazať pri user deletion.
- **NIS2 + privilegované účty** — passkey + biometric splňuje "strong MFA" požiadavku
- **Pilot timeline** — Slice #8 NIE JE blockujúci pre SFZ pilot (TOTP MFA stačí). Cieľ Slice #8 je dlhodobá security posture a UX upgrade pre druhú vlnu tenant-ov

## Možnosti

### Možnosť A: Passkey ako 2FA alternatíva k TOTP (drop-in replacement)

User stále zadáva heslo, ale namiesto TOTP code-u dáva passkey assertion. Login flow je 2-step (heslo → passkey challenge).

- **Plus:** Najmenej zmien v existujúcom flow. Symetrické s TOTP — passkey nahrádza recovery code path.
- **Mínus:** Stratíme hlavnú výhodu passkey-u — passwordless UX. User stále musí pamätať heslo. Pre power-userov ktorí tlačia na "passwordless" je to sklamanie.

### Možnosť B: Passkey ako primárna metóda (passwordless-first)

`/login` page má jediné tlačidlo "Sign in with passkey" + autofill input. Email/password je schované pod "Iné možnosti".

- **Plus:** Najmodernejší UX, push na bezpečnejšiu metódu, jasná message "Inventario je passwordless-first"
- **Mínus:** **Disruptive pre legacy users.** Pri rollout-e nikto nemá passkey — všetci by skončili v "Iné možnosti" cul-de-sac. Friction prvých 6 mesiacov.

### Možnosť C: Passkey ako voliteľný doplnok s passwordless cestou (selected)

`/login` page ponúka **obe cesty paralelne** ako rovnoprávne tlačidlá: "Prihlásiť cez passkey" + "Email + heslo". User si v `/settings/security` pridá passkey-y kedy chce. Adoption je dobrovoľný a postupný. Po dosiahnutí ~80 % adopcie sa môže UX prepnúť na Možnosť B (passwordless-first) bez zmeny backend-u.

- **Plus:** Neprerušuje legacy users. Adoption postupný, organic. Backend logika je čistá — passkey path je independent entry point, neinterferuje s email/password.
- **Mínus:** Dve cesty na UI maintainnúť. Mierne väčšia komplexita login page-u (dve tlačidlá namiesto jedného).

### Možnosť D: Passkey iba ako step-up pre privilegované akcie

Login je email/password ako doteraz. Passkey sa vyžaduje až pri sensitivnych akciách (delete asset, change org settings, admin operácie).

- **Plus:** Granular security posture. Zachová klasický login flow.
- **Mínus:** Komplikovaná implementácia (per-endpoint step-up logic). Žiadny UX benefit pre bežný login. Nevyrieši hlavný motivačný problém (phishing-resistance pri logine).

## Rozhodnutie

Zvolili sme **Možnosť C: Passkey ako voliteľný doplnok s passwordless cestou.**

### Strategické rozhodnutia (5 vidiel)

| #   | Otázka                          | Rozhodnutie                                                                                                                                                  |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Architektonický model**       | Voliteľný doplnok, paralelné cesty na `/login`. Postupný adoption.                                                                                           |
| 2   | **Vzťah passkey ↔ TOTP**        | Passkey login **preskočí TOTP challenge** (passkey IS MFA). Heslo login zachová TOTP gate ak je MFA enabled.                                                 |
| 3   | **Recovery story (v1)**         | User musí mať **aspoň jeden iný auth method** (heslo alebo OAuth provider). Settings UI nedovolí remove last password / unlink last OAuth ak má len passkey. |
| 4   | **RP ID strategy**              | `inventario.estate` (apex), konfigurovateľné cez `WEBAUTHN_RP_ID` env var. Custom tenant domény (budúce) majú vlastný per-tenant priestor automaticky.       |
| 5   | **DB model passkey credential** | Separátna collection `passkeys` (nie embedded na User). Unique index na `credentialId`. Pattern konzistentný s `refresh_tokens`.                             |

### Knižnice

| Účel       | Knižnica                  | Licencia   | Verzia | Poznámka                                                |
| ---------- | ------------------------- | ---------- | ------ | ------------------------------------------------------- |
| Backend    | `@simplewebauthn/server`  | MIT        | `^13`  | FIDO Alliance reference impl, Lucia auth team           |
| Frontend   | `@simplewebauthn/browser` | MIT        | `^13`  | Thin wrapper okolo `navigator.credentials.{create,get}` |
| Crypto     | `node:crypto`             | (built-in) | —      | Pre challenge generation (kryptograficky random bytes)  |
| JWT (reuse | `jose`                    | MIT        | `^5`   | Challenge tokens (rovnaký pattern ako MFA session)      |

Zero nové DB závislosti (MongoDB driver už máme).

### WebAuthn konfigurácia

```typescript
// apps/api/src/plugins/config.ts — nové env vars
WEBAUTHN_RP_ID: z.string().default('inventario.estate'),
WEBAUTHN_RP_NAME: z.string().default('Inventario'),
WEBAUTHN_EXPECTED_ORIGINS: z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()))
  .default('https://app.inventario.estate'),
```

Default origin pre prod je `https://app.inventario.estate`. Staging a dev sa override-ujú cez env (`http://localhost:3000` v dev-e, `https://staging.app.inventario.estate` v stagingu).

WebAuthn `verifyRegistrationResponse` a `verifyAuthenticationResponse` parametre:

| Parameter                 | Hodnota               | Dôvod                                                                                                                   |
| ------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `attestationType`         | `'none'`              | Bez attestation requirements. `direct` / `enterprise` až keď bude tenant ktorý to vyžaduje (FedRAMP, military).         |
| `userVerification`        | `'required'`          | Vyžadujeme biometric / PIN pri každom logine. Bez UV by passkey degradoval na single-factor (len device possession).    |
| `residentKey`             | `'preferred'`         | Discoverable credential = passwordless autofill funguje. `'required'` by blokoval starostlivé YubiKey-y bez resi keys.  |
| `authenticatorAttachment` | (unset)               | User si vyberie platform (Touch ID, Windows Hello) alebo cross-platform (YubiKey). Nezasahujeme.                        |
| Challenge TTL             | 5 min                 | Konzistentné s MFA session token TTL. Replay-attack window je tým úzky.                                                 |
| Counter check             | Logujeme, neblokujeme | Synced platform passkeys (iCloud Keychain) majú counter = 0 vždy. Striktný check by ich falošne flagoval ako kompromis. |

### User schema zmeny

```typescript
// packages/shared-types/src/schemas/user.ts
// Pridáme jedno computed-style pole — convenience flag pre frontend.
// Nezdvojujeme dáta s passkeys collection; pole je tu len pre rýchlu otázku
// "má tento user aspoň jeden passkey?" bez join-u.

passkeyEnabled: z.boolean().default(false),
passkeyEnabledAt: TimestampSchema.nullable().default(null),
```

Žiadne ďalšie polia na User. Všetky credential dáta žijú v separátnej collection.

### Nová collection: `passkeys`

```typescript
// packages/shared-types/src/schemas/passkey.ts (new file)

export const PasskeyCredentialSchema = BaseDocumentSchema.merge(
  SoftDeleteSchema,
)
  .merge(OrganisationScopedSchema)
  .extend({
    /** Owner. Indexed for fast "list my passkeys" query. */
    userId: ObjectIdSchema,

    /** WebAuthn credential ID — base64url-encoded. Unique across all users. */
    credentialId: z.string().min(16).max(1023),

    /** WebAuthn public key — base64url COSE encoded. NEVER mutated after insert. */
    publicKey: z.string().min(1),

    /**
     * Signature counter. Incremented by authenticator on each use.
     * Synced platform passkeys may not increment — that's fine, we log
     * but don't block (see ADR rationale).
     */
    counter: z.number().int().nonnegative().default(0),

    /** WebAuthn transports advertised by authenticator. */
    transports: z
      .array(z.enum(['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card']))
      .default([]),

    /** Whether the credential is backup-eligible (synced across user's devices). */
    backupEligible: z.boolean().default(false),

    /** Whether the credential is currently backed up. */
    backedUp: z.boolean().default(false),

    /**
     * User-provided name ("MacBook Air", "iPhone 15", "YubiKey 5"). Editable.
     * Default: best-effort from User-Agent at registration time.
     */
    deviceName: z.string().min(1).max(100),

    /** Last successful authentication via this credential. */
    lastUsedAt: TimestampSchema.nullable().default(null),
  });
```

Indexy:

```typescript
// apps/api/src/modules/auth/passkeys.repository.ts
await passkeysCol.createIndex({ credentialId: 1 }, { unique: true });
await passkeysCol.createIndex({ userId: 1, deletedAt: 1 });
await passkeysCol.createIndex({ organisationId: 1, deletedAt: 1 });
```

`credentialId` je globálne unikátne (WebAuthn spec). Soft-delete pattern konzistentný s ostatnými collection-mi — keď user odstráni passkey, zachovávame audit trail.

### Challenge token (signed JWT, stateless)

Použijeme rovnaký pattern ako `mfaSessionToken` — krátkodobý RS256-signed JWT s vlastným audience:

```typescript
// apps/api/src/plugins/inventario-jwt.ts — rozšírenie
async issueWebauthnChallenge(
  userId: string | null,        // null pre passwordless discovery flow
  purpose: 'registration' | 'authentication',
): Promise<{ token: string; challenge: string }> {
  const challenge = randomBytes(32).toString('base64url');
  const token = await new SignJWT({ purpose, challenge, userId })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('inventario')
    .setAudience(`inventario-webauthn-${purpose}`)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  return { token, challenge };
}

async verifyWebauthnChallenge(
  token: string,
  purpose: 'registration' | 'authentication',
): Promise<{ challenge: string; userId: string | null }> { /* ... */ }
```

**Prečo JWT a nie MongoDB s TTL indexom:**

- Žiadny DB round-trip pri verifikácii
- Replay protection cez expiry (5 min)
- Konzistentný pattern s existujúcim MFA flow
- Stateless = bezstresový horizontal scale

Frontend dostane `token` aj `challenge` v response. `challenge` ide do `PublicKeyCredentialCreationOptions` pre prehliadač, `token` posiela späť pri verify request-e. Server overí token a porovná, či sa `challenge` claim zhoduje s tým, čo prehliadač podpísal.

### API endpoints

```
# Registration (auth required — user pridáva passkey k svojmu účtu)
POST   /v1/auth/passkeys/register/options    → { options, challengeToken }
POST   /v1/auth/passkeys/register/verify     → 201 { passkey: { _id, deviceName, createdAt } }

# Authentication (public — passwordless login)
POST   /v1/auth/passkeys/login/options       → { options, challengeToken }
                                                body: { email?: string }
                                                ak email → allowCredentials = user's passkeys
                                                ak no email → allowCredentials = [] (resident discovery)
POST   /v1/auth/passkeys/login/verify        → 204 + cookies

# Management (auth required)
GET    /v1/auth/passkeys                     → [{ _id, deviceName, createdAt, lastUsedAt, backedUp }]
PATCH  /v1/auth/passkeys/:id                 → 204  (rename only — { deviceName })
DELETE /v1/auth/passkeys/:id                 → 204
```

### Login flow integrácia

Existujúci email-password flow zostáva nedotknutý. Passkey je **paralelný entry point**:

```
┌─ Email/password cesta ──────────────────────────────────────────────┐
│                                                                       │
│  POST /v1/auth/login/email                                            │
│    → ak mfaEnabled=true → 202 { mfaSessionToken } → /login/mfa        │
│    → inak → 204 + cookies                                             │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘

┌─ OAuth cesta ────────────────────────────────────────────────────────┐
│                                                                       │
│  GET  /v1/auth/login/:provider                                        │
│  GET  /v1/auth/callback/:provider                                     │
│    → 302 redirect + cookies (no MFA — provider has own)               │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘

┌─ NEW: Passkey cesta ────────────────────────────────────────────────┐
│                                                                       │
│  POST /v1/auth/passkeys/login/options    { email? }                   │
│    → returns PublicKeyCredentialRequestOptions + challengeToken       │
│                                                                       │
│  [browser: navigator.credentials.get()]                               │
│                                                                       │
│  POST /v1/auth/passkeys/login/verify     { credential, challengeToken }│
│    → server verifies assertion + counter                              │
│    → finds user from credentialId                                     │
│    → 204 + cookies (NO MFA challenge — passkey IS MFA)                │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### Recovery story (v1)

**Pravidlo:** user musí mať vždy **aspoň jeden iný auth method** okrem passkey-ov.

Settings UI v `/settings/security` enforce-uje:

| Akcia                                    | Povolená?                                                  |
| ---------------------------------------- | ---------------------------------------------------------- |
| Add passkey                              | Vždy ✅                                                    |
| Remove passkey                           | Vždy ✅ (aj last passkey — user môže prejsť späť na heslo) |
| Disable password (set passwordHash=null) | Iba ak má aspoň 1 OAuth provider linked                    |
| Unlink last OAuth provider               | Iba ak má heslo nastavené                                  |
| Disable TOTP MFA                         | Vždy ✅ (TOTP je nezávislý concept)                        |

Settings UI ukazuje warning ak má user iba passkey-y plus jednu zálohu (napr. iba heslo + 1 passkey): "Ak stratíte zariadenia s passkey, prihlásite sa stále cez heslo." Pri 0 passkey-och bez warning.

**v2 (post-pilot, ak bude dopyt):** passkey-only s vlastnými recovery codes (zdieľané s TOTP codes, alebo separátne). Out of scope pre Slice #8.

### Frontend zmeny

#### `/login` page

```
┌──────────────────────────────────────────────┐
│   Inventario                                 │
│                                              │
│   [ Prihlásiť sa cez passkey  ]              │  ← navigator.credentials.get()
│                                              │     s mediation: 'conditional'
│   alebo                                      │     (autofill ak prehliadač má resi cred)
│                                              │
│   [ Email + heslo  ]                         │  ← existing flow
│   [ Google ]  [ Microsoft ]                  │  ← existing OAuth
│                                              │
└──────────────────────────────────────────────┘
```

Conditional UI (`mediation: 'conditional'` v WebAuthn API) umožní autofill: ak prehliadač má saved passkey pre `inventario.estate`, ponúkne ho proaktívne pri focus-e na email input. Tento UX je zlatý štandard 2026.

#### `/settings/security` — Passkeys sekcia

```
┌──────────────────────────────────────────────┐
│  Passkeys                                    │
│                                              │
│  Pridajte passkey pre rýchlejšie a           │
│  bezpečnejšie prihlasovanie cez Touch ID,    │
│  Face ID alebo bezpečnostný kľúč.            │
│                                              │
│  [ + Pridať passkey ]                        │
│                                              │
│  ┌─ Vaše passkey-y ─────────────────────┐    │
│  │ 📱 iPhone 15 Pro                     │    │
│  │    Pridané: 2026-05-22               │    │
│  │    Naposledy: pred 2 minútami        │    │
│  │    Synced cez iCloud Keychain        │    │
│  │    [Premenovať] [Odstrániť]          │    │
│  │                                       │    │
│  │ 🔐 YubiKey 5C                        │    │
│  │    Pridané: 2026-05-18               │    │
│  │    Naposledy: pred 3 dňami           │    │
│  │    [Premenovať] [Odstrániť]          │    │
│  └───────────────────────────────────────┘    │
│                                              │
└──────────────────────────────────────────────┘
```

### Audit events

Nové event types (extend existujúceho `AuditEventType` enum):

| Event                     | Trigger                                              |
| ------------------------- | ---------------------------------------------------- |
| `PASSKEY_REGISTERED`      | Successful `/passkeys/register/verify`               |
| `PASSKEY_REMOVED`         | Successful `DELETE /passkeys/:id`                    |
| `PASSKEY_RENAMED`         | Successful `PATCH /passkeys/:id`                     |
| `PASSKEY_LOGIN`           | Successful `/passkeys/login/verify`                  |
| `PASSKEY_LOGIN_FAILED`    | Failed verification (with reason)                    |
| `PASSKEY_COUNTER_WARNING` | Counter non-increment detected (logged, not blocked) |

Audit payload obsahuje `credentialId` (truncated to 12 chars pre PII protection), `deviceName`, IP, user-agent.

### Rate limiting

| Endpoint                                  | Limit | Window | Scope    |
| ----------------------------------------- | ----- | ------ | -------- |
| `POST /v1/auth/passkeys/register/options` | 5     | 15 min | per user |
| `POST /v1/auth/passkeys/register/verify`  | 10    | 15 min | per user |
| `POST /v1/auth/passkeys/login/options`    | 30    | 15 min | per IP   |
| `POST /v1/auth/passkeys/login/verify`     | 10    | 15 min | per IP   |
| `DELETE /v1/auth/passkeys/:id`            | 10    | 15 min | per user |

`/login/options` má vyšší limit, lebo conditional UI flow ho volá pri page load každého user-a (legitímny use case).

### Test strategy

Integrácia testy bez real authenticator-u sú netriviálne — WebAuthn vyžaduje kryptografické podpisovanie. Použijeme:

- **`@simplewebauthn/server` má `verifyRegistrationResponse` testable** s mock-overaným attestation object-om
- **Test fixtures**: synthetické attestation objects vytvorené cez `node:crypto` ECDSA P-256 pre simulovanie register + authenticate flow-u
- **Coverage cieľ:** ~20 testov pokrývajúcich register success, register error (invalid challenge, expired, bad signature), authenticate success (TOTP-style discovery aj allowCredentials), counter regression detection, management endpoints (list/rename/delete), rate limiting

## Sub-task breakdown — Slice #8

### Fáza 1: Backend (Slice #8a, ~2 dni)

| Blok    | Popis                                                                                                             | Model  |
| ------- | ----------------------------------------------------------------------------------------------------------------- | ------ |
| **K1**  | Install `@simplewebauthn/server` + zod schema `PasskeyCredentialSchema` v shared-types. Migration zoznam indexov. | Sonnet |
| **K2**  | Config: `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_EXPECTED_ORIGINS` env vars. Boot guard.                   | Sonnet |
| **K3**  | `passkeys.repository.ts` — CRUD + `findByCredentialId`, `findByUserId`, `countByUserId`.                          | Sonnet |
| **K4**  | Extend `inventarioJwt` plugin: `issueWebauthnChallenge`, `verifyWebauthnChallenge` (audience-scoped).             | Sonnet |
| **K5**  | Registration routes: `POST /v1/auth/passkeys/register/{options,verify}`. Audit events.                            | Sonnet |
| **K6**  | Authentication routes: `POST /v1/auth/passkeys/login/{options,verify}`. Sync s login flow (no MFA bypass).        | Sonnet |
| **K7**  | Management routes: `GET /v1/auth/passkeys`, `PATCH /:id`, `DELETE /:id`. Settings guard (last-auth-method check). | Sonnet |
| **K8**  | Update `User` schema: `passkeyEnabled`, `passkeyEnabledAt`. Repository projection update.                         | Sonnet |
| **K9**  | Rate limiting config + audit event types.                                                                         | Haiku  |
| **K10** | Integration testy: register flow, auth flow, counter regression, management endpoints, error paths. ~20 testov.   | Sonnet |

### Fáza 2: Frontend (Slice #8b, ~1.5 dňa)

| Blok    | Popis                                                                                                          | Model  |
| ------- | -------------------------------------------------------------------------------------------------------------- | ------ |
| **K11** | Install `@simplewebauthn/browser`. WebAuthn capability detection helper.                                       | Haiku  |
| **K12** | `/login` page — pridať "Prihlásiť cez passkey" button + conditional UI (`mediation: 'conditional'`) autofill.  | Sonnet |
| **K13** | `/settings/security` — nová sekcia "Passkeys" (list + add + rename + remove). Last-auth-method guard v UI.     | Sonnet |
| **K14** | Device-name autodetekcia z User-Agent pri registrácii ("MacBook Air", "iPhone", "Windows PC", "Security Key"). | Haiku  |
| **K15** | Error handling: WebAuthn cancel, NotAllowedError, NotSupportedError, InvalidStateError → friendly SK messages. | Sonnet |

### Fáza 3: Docs + cutover (Slice #8c, ~0.5 dňa)

| Blok    | Popis                                                                                                             | Model  |
| ------- | ----------------------------------------------------------------------------------------------------------------- | ------ |
| **K16** | User guide: `docs/user-guide/how-to/pouzit-passkey.md` + reference page `bezpecnost-passkey.md`.                  | Haiku  |
| **K17** | Milestone doc `docs/milestones/slice-8-passkeys.md`. Day summary. NEXT.md update.                                 | Haiku  |
| **K18** | Update privacy policy: passkey ako nový data category (public key + metadata). Sub-processors note (žiadny nový). | Sonnet |

**Celkom:** ~4 pracovné dni (18 K-blokov, väčšina Sonnet 4.6 implementácia, Opus 4.7 už spotrebovaný na ADR).

### Závislosti a podmienky

- **Domain migration na `inventario.estate`** musí byť hotová pred merge K6 (authentication routes), inak RP ID mismatch lomí flow v produkcii. ADR-0013 cookie domain referencie tiež treba updatnúť (separátny cleanup task v NEXT.md).
- **DPA template** spomína "TOTP MFA" ako bezpečnostné opatrenie — pri rollout passkey-ov sa text rozšíri o "WebAuthn / passkey". K18 to pokryje.
- **Privacy policy** musí spomenúť verejný kľúč + metadata ako data category. K18.

## Dôsledky

### Pozitívne

- **Phishing-resistant auth.** Aj keď user kliknu na fake login page, prehliadač odmietne podpísať challenge pre nesprávny RP ID. Žiadny prompt, žiadny credential leak. Toto je single najdôležitejší security upgrade Slice #8.
- **Passwordless UX pre adopters.** Touch ID / Face ID / Windows Hello → 1 click login. Žiadne heslo na pamätanie, žiadny TOTP code.
- **Lepšia compliance posture.** NIS2 vyžaduje "strong MFA" pre privileged accounts; passkey + biometric splňuje toto kritérium nedvojzmyselne (na rozdiel od TOTP, ktoré niektoré audity považujú za "weak factor" kvôli phishability).
- **eIDAS 2.0 / EUDI Wallet readiness.** EU Digital Identity Wallet bude používať FIDO2/WebAuthn. Naša implementácia nás pripravuje na budúcu integráciu (out of scope teraz, ale dobrá strategická pozícia).
- **Backend-agnostic implementácia.** `@simplewebauthn/server` je čistý OSS, žiadny vendor lock-in. Pri prípadnej budúcej migrácii frameworku zostáva logika prenositeľná.
- **Per-tenant izolácia v budúcnosti.** Custom tenant domény → automatický izolovaný passkey priestor (per-RP-ID). Žiadny extra effort pre multi-tenant security boundary.

### Negatívne / kompromisy

- **Komplexnejší login page.** Dve cesty namiesto jednej. UX musí byť veľmi explicitné, inak prvý-time user nevie čo vybrať. Mitigácia: clear copy + onboarding banner ("Pridajte si passkey v Nastaveniach → Bezpečnosť, prihlasovanie bude rýchlejšie").
- **Test infra effort.** WebAuthn flow sa testuje s mock crypto signing — netriviálne. K10 si vyžaduje ~3-4 hodiny extra oproti štandardnému CRUD test pattern-u.
- **Counter check je advisory, nie enforced.** Synced platform passkeys (iCloud Keychain) majú counter = 0 vždy. Striktný counter check by ich false-positive flagoval. Kompromis: logujeme `PASSKEY_COUNTER_WARNING`, ale neblokujeme login.
- **Žiadna passkey-only cesta v v1.** User vždy potrebuje druhý auth method. Niektorí passwordless-puristi to môžu vnímať ako "polovičatú" implementáciu. v2 to vyrieši ak bude dopyt.
- **Domain dependency.** Implementácia predpokladá hotovú `inventario.estate` migration. Ak sa domain rename oddiali, Slice #8 musí čakať alebo deploy iba na staging.

### Riziká, ktoré treba sledovať

- **Lost device → lost passkey.** User stratí Mac aj iPhone v jeden deň, oba mali platform passkey, nemá YubiKey. Fallback: prihlási sa heslom → /settings/security → odstráni dead passkey-y → pridá nové. **Riziko realizovateľné len ak má user iba platform passkey-y bez sync** (rare 2026, lebo iCloud aj Google Password Manager defaultne sync).
- **Compromise sync účtu.** Ak útočník prevezme Apple ID alebo Google account user-a, dostane sa k synced passkey-om. Mitigácia: tieto provideri majú vlastné MFA na ich účet. Náš threat model toto považuje za "compromise of upstream provider" = mimo našej kontroly. Recommended user education: 2FA na Apple ID / Google.
- **Conditional UI kompatibilita.** `mediation: 'conditional'` má v 2026 ~95 % browser support, ale starostlivé verzie (~5 %) flow nepodporujú. Graceful fallback: ak `conditional` zlyhá, ukážeme normálne tlačidlo "Prihlásiť cez passkey".
- **Counter regression false positives.** Synced platform passkeys nemajú reliable counter. Mitigácia (rozhodnutie): logujeme `PASSKEY_COUNTER_WARNING` audit event, ale neblokujeme. Pri suspicious cluster of warnings môže admin manually intervene.
- **WebAuthn v starých browseroch.** ~3 % user-ov môže mať browser bez WebAuthn API (Firefox ESR starostlivé, embedded WebView-y). Mitigácia: capability detection (`PublicKeyCredential` existence) → ak undefined, schovať passkey tlačidlo úplne.
- **Rate limit DoS.** Útočník volá `/login/options` v slučke pre target email-y → môže vyčerpať rate-limit budget. Mitigácia: per-IP limit (30/15min) + global per-email circuit breaker ak ten istý email má 5+ failed verify pokusov za 5 min.
- **Storage growth.** Každý user môže mať ~5-10 passkey-ov. Pre 10 000 user-ov to je ~100 000 passkey dokumentov, ~30 MB v MongoDB Atlas Flex — zanedbateľné, ale počítať s tým.

## Referencie

- [WebAuthn Level 3 W3C Recommendation](https://www.w3.org/TR/webauthn-3/)
- [FIDO Alliance — Passkeys](https://fidoalliance.org/passkeys/)
- [`@simplewebauthn/server` docs](https://simplewebauthn.dev/docs/packages/server)
- [`@simplewebauthn/browser` docs](https://simplewebauthn.dev/docs/packages/browser)
- [Conditional UI (autofill) explainer](https://github.com/w3c/webauthn/wiki/Explainer:-WebAuthn-Conditional-UI)
- [Apple — About the security of passkeys](https://support.apple.com/en-us/102195)
- [Google Identity — Passkeys docs](https://developers.google.com/identity/passkeys)
- [NIS2 Directive (EU) 2022/2555 — Article 21(2)(j) on MFA](https://eur-lex.europa.eu/eli/dir/2022/2555/oj)
- [eIDAS 2.0 (EU) 2024/1183 — EU Digital Identity Wallet](https://eur-lex.europa.eu/eli/reg/2024/1183/oj)
- [ADR-0013 Multi-provider auth](0013-multi-provider-auth-self-serve.md) — parent auth model
- [ADR-0010 Multi-tenant white-label](0010-multi-tenant-white-label.md) — tenant boundary
- Slice #7 milestone: [`docs/milestones/slice-7-totp-mfa.md`](../milestones/slice-7-totp-mfa.md)

<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0016. Passkeys / WebAuthn — implementačný plán Slice #8 (post-memberships)

|                   |                                                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Status**        | ✅ Accepted (supersedes [0014](0014-passkeys-webauthn.md) v schema + audit + recovery)                                                                                                                                                                       |
| **Dátum**         | 2026-05-25                                                                                                                                                                                                                                                   |
| **Autori**        | Ján Letko, Claude Opus 4.7 (LTK Solutions)                                                                                                                                                                                                                   |
| **Súvisiace ADR** | [0014 Passkeys / WebAuthn](0014-passkeys-webauthn.md) (foundational design — rationale, library choice, login UX), [0015 Cross-tenant memberships](0015-cross-tenant-memberships.md) (global identity model), [0013](0013-multi-provider-auth-self-serve.md) |

## Kontext

ADR-0014 (22. máj) rozhodol o **prečo** a **ako vysoko-úrovňovo** zaviesť passkey-y do Inventaria — phishing-resistance, passwordless UX, Možnosť C (paralelné cesty na `/login`), knižnice `@simplewebauthn/{server,browser}`, RP ID stratégia, broad WebAuthn config. Toto rozhodnutie zostáva platné.

ADR-0015 (23. máj) — o deň neskôr — však zásadne prerobil identitný model: **User je teraz globálna identita, per-tenant kontext žije na Membership**. Polia `organisationId`, `roles`, `organizationalUnit`, `teams`, per-tenant notifikácie sa presunuli z User na Membership. Slice #9 je v produkcii (553/553 testov).

ADR-0014 niektoré dôsledky tohto refactoru **nepokrýva**, lebo bol napísaný pred ním. Konkrétne:

1. `PasskeyCredentialSchema` v 0014 obsahuje `.merge(OrganisationScopedSchema)` — to je inkompatibilné s post-Slice #9 modelom, kde passkey je identity factor (per-user), nie tenant resource.
2. Audit log strategy pre passkey eventy nie je definovaná v 0014 — `audit_logs.organisationId` je povinný field, ale passkey events sú globálne.
3. Vzťah passkey ↔ forceMfa policy (Slice #7 K12a) nie je v 0014 spomenutý — `userSatisfiesMfa()` predicate musí brať passkey existence do úvahy.
4. Recovery rules v 0014 sa odvolávajú na "iný auth method" — po Slice #9 musíme presne definovať, čo to znamená v multi-tenant kontexte.
5. State machines pre registration/authentication ceremonies nie sú v 0014 detailne rozpísané.
6. Threat model je v 0014 stručný — pre security review pred prvým enterprise tenant-om potrebujeme rozšírenie (najmä bod 9: cross-tenant credential abuse, ktorý vznikol Slice #9 introduce-ovaním multi-tenant memberships).
7. Test strategy v 0014 menuje "synthetic attestations" ako abstraktný plán — Slice #8 implementácia potrebuje konkrétny fixtures výpis.

Toto ADR ich pokrýva. Pôvodný ADR-0014 zostáva ako **foundational rationale** (nikto by ho nemal mazať), ale **schéma, audit log strategy a recovery rules sú nahradené týmto dokumentom**. ADR-0014 dostane v hlavičke `Supersedes` note (viď post-merge cleanup K15 nižšie).

### Vzťah k existujúcemu auth modelu

Po Slice #9 má Inventario tieto autentifikačné cesty:

| Cesta              | Endpoint                              | Vydáva cookies?                 | Spúšťa MFA gate?              |
| ------------------ | ------------------------------------- | ------------------------------- | ----------------------------- |
| Email + heslo      | `POST /v1/auth/login/email`           | Áno (priamo / 202 ak MFA)       | Áno, ak `user.mfaEnabled`     |
| OAuth (Google)     | `GET /v1/auth/callback/google`        | Áno (priamo)                    | Nie (provider má vlastné MFA) |
| OAuth (Microsoft)  | `GET /v1/auth/callback/microsoft`     | Áno (priamo)                    | Nie                           |
| MFA challenge      | `POST /v1/auth/mfa/challenge`         | Áno (po úspešnom TOTP/recovery) | —                             |
| Forced MFA setup   | `POST /v1/auth/mfa/forced-verify`     | Áno                             | —                             |
| **Passkey (nový)** | `POST /v1/auth/passkeys/login/verify` | Áno (priamo)                    | Nie (passkey **IS** MFA)      |

Passkey login je samostatný entry point, ekvivalentný OAuth-u v tom, že:

- Vydá cookies priamo (žiadny 202 medzistav).
- Neaktivuje `forceMfa` gate, lebo passkey + UV (biometric/PIN) je samo o sebe multi-factor (something you have + something you are/know).

## Zmeny voči ADR-0014

### Zmena 1: `PasskeyCredentialSchema` je globálna, nie tenant-scoped

ADR-0014 navrhol:

```typescript
PasskeyCredentialSchema = BaseDocumentSchema
  .merge(SoftDeleteSchema)
  .merge(OrganisationScopedSchema)   // ← bude odstránené
  .extend({ userId, credentialId, ... });
```

**Nový stav:**

```typescript
PasskeyCredentialSchema = BaseDocumentSchema
  .merge(SoftDeleteSchema)
  .extend({ userId, credentialId, ... });   // NO OrganisationScopedSchema
```

**Dôvod:** passkey je viazaný na **(User identity, RP ID)** pár, nie na tenant. WebAuthn RP ID (`inventario.estate`) je global pre celú platformu. Jeden user s membershipmi v 3 tenantoch používa **rovnaký** passkey na login do všetkých — po úspešnej autentifikácii server vyberie default Membership (rovnako ako pri email login), JWT získa `mid` claim a frontend zobrazí tenant switcher ak `availableOrganisations.length > 1`.

Toto je tiež dôvod, prečo passkey je identity factor a nie tenant resource — patrí k tomu istému konceptuálnemu vrstveniu ako `passwordHash`, `mfaSecret`, `authProviders[]` (všetky globálne na User).

### Zmena 2: Indexy passkey collection

```typescript
// apps/api/src/modules/auth/passkeys.repository.ts (initIndexes)
await passkeysCol.createIndex(
  { credentialId: 1 },
  { unique: true }, // globally unique (WebAuthn spec)
);
await passkeysCol.createIndex(
  { userId: 1, deletedAt: 1 }, // list user's active passkeys
);
// NO organisationId index — passkeys aren't tenant-scoped
```

### Zmena 3: User schema deltas (žiadne zmeny voči 0014)

ADR-0014 navrhol pridať `passkeyEnabled` + `passkeyEnabledAt` na User. **Toto rozhodnutie zostáva platné**, jediný rozdiel — po Slice #9 User schema už nemerguje `OrganisationScopedSchema`, takže schema-level konflikt neexistuje.

```typescript
// packages/shared-types/src/schemas/user.ts — additions
passkeyEnabled: z.boolean().default(false),
passkeyEnabledAt: TimestampSchema.nullable().default(null),
```

Konvenčný pattern z Slice #9 — kvôli stale `.d.ts` po prvom builde shared-types: kde TypeScript narieka na "missing field", používame `as never` workaround pre return statements (presne ako sme robili pri `emailChangePendingTo` v slice email change). Toto je test-quirk známy, opraví sa rebuilom shared-types druhykrát po commitnutí schema zmien.

### Zmena 4: forceMfa policy interakcia (chýba v ADR-0014)

Slice #7 K12a (Forced MFA) blokuje login s 202 + `mfaSetupToken` ak:

- `org.settings.mfa.requireMfa === true`, AND
- `user.mfaEnabled !== true`

Po Slice #8 musí logika zohľadniť passkey ako alternatívny "strong factor". Pridáme helper:

```typescript
// apps/api/src/modules/auth/mfa/mfa-satisfaction.ts (new file)
import type { User } from '@inventario/shared-types';
import type { Db } from 'mongodb';

/**
 * Returns true if the user has at least one strong authentication factor
 * beyond email+password: TOTP MFA OR at least one active passkey.
 *
 * Used by the forceMfa policy gate in /v1/auth/login/email and the
 * future /v1/auth/passkeys/login flows (where it's always true by
 * definition — passkey login implies passkey existence).
 */
export async function userSatisfiesMfa(user: User, db: Db): Promise<boolean> {
  if (user.mfaEnabled === true) return true;
  if (user.passkeyEnabled !== true) return false;
  // Defense in depth: passkeyEnabled is a convenience flag; verify at
  // least one active passkey actually exists.
  const passkeysCol = db.collection('passkeys');
  const count = await passkeysCol.countDocuments({
    userId: String((user as { _id: unknown })._id),
    deletedAt: null,
  });
  return count > 0;
}
```

**V `email-auth.routes.ts` login flow** sa zmení riadok:

```typescript
// pred:
if (mfaRequired && !user.mfaEnabled) {
  /* issue mfaSetupToken */
}
// po:
if (mfaRequired && !(await userSatisfiesMfa(user, db))) {
  /* issue mfaSetupToken */
}
```

**UX dôsledok pre forceMfa users:** ak org nastaví `requireMfa=true`, používateľ ktorý má passkey ALE nemá TOTP **prejde** login flow bez forced setup. Toto je správanie, ktoré chceme — passkey + biometric je nedokázateľne silnejší faktor než TOTP.

**Out of scope pre Slice #8 MVP:** _forced passkey enrollment_ (passkey ekvivalent `mfaSetupToken` flow-u). Ak `mfaRequired=true` a user nemá ani TOTP ani passkey, naďalej dostane TOTP forced setup flow. Passkey enrollment cez forced flow doplníme v Slice #8b post-MVP iteration ak bude reálny dopyt.

### Zmena 5: Recovery rules — explicit definícia "iný auth method" (post-Slice #9)

ADR-0014 spomenul "user musí mať aspoň jeden iný auth method", ale nezadefinoval presne čo to znamená. V post-Slice #9 svete to znamená:

> **User má aspoň jeden alternatívny auth method, ak je splnená aspoň jedna z podmienok:**
>
> 1. `user.passwordHash !== null` (má aktívne heslo), ALEBO
> 2. `user.authProviders.some(p => p.provider !== 'EMAIL')` (má aspoň jeden OAuth provider linkovaný — Google, Microsoft, Apple v budúcnosti)

Passkey samotný **sa nepočíta** ako alternatívny — ide o jednu kategóriu faktorov. Recovery musí byť cez nezávislý kanál (e-mail-based password reset, OAuth provider login). Toto chráni proti scenáru "user stratí všetky zariadenia naraz" + "device cloud account (iCloud/Google) tiež nedostupný".

**Helper `userHasAlternativeAuth(user)` v frontende AJ v backende:**

```typescript
// shared logika, ale implementácia žije v oboch
function userHasAlternativeAuth(user: User): boolean {
  if (user.passwordHash) return true;
  if (user.authProviders?.some((p) => p.provider !== 'EMAIL')) return true;
  return false;
}
```

**Backend enforcement:**

| Operácia                                                                           | Povolené ak                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `POST /v1/auth/passkeys/register/verify`                                           | Vždy (registrácia passkey nie je destruktívna)               |
| `DELETE /v1/auth/passkeys/:id`                                                     | Vždy (aj posledný passkey — user prejde späť na heslo/OAuth) |
| `PATCH /v1/auth/passkeys/:id` (rename)                                             | Vždy                                                         |
| Disable password (set `passwordHash=null`) — _zatiaľ nie je endpoint, pre úplnosť_ | Iba ak má aspoň 1 non-EMAIL OAuth provider                   |
| Unlink last OAuth provider — _zatiaľ nie je endpoint_                              | Iba ak má `passwordHash`                                     |

Existujúce endpointy pre disable password / unlink OAuth zatiaľ nemáme, takže recovery enforcement v Slice #8 backend-e je primárne v passkey CRUD endpoint-och (kde guardrail je no-op — passkey CRUD nie je destruktívne pre recovery story).

**Frontend UX:** Settings panel `/settings/security` zobrazí warning, ak má user iba 1 zálohu mimo passkey-ov:

> "Ak stratíte všetky passkey-y, budete sa prihlasovať [heslom / cez {provider}]. Odporúčame nastaviť aspoň jeden ďalší záložný spôsob."

### Zmena 6: Audit log strategy pre passkey eventy

`AuditLogSchema.organisationId` je **povinný field** (NOT nullable) — viď `packages/shared-types/src/schemas/audit-log.ts`. Toto je problém pre passkey eventy, ktoré sú **globálne** (passkey nepatrí k tenantu).

Riešenie konzistentné s tým, ako Slice #9 ošetril GDPR delete: pre globálne identity events použijeme `organisationId = user's default Membership.organisationId`. Ak user nemá žiadnu aktívnu membership (rare — všetky vymazané), použijeme `'GLOBAL'` placeholder string a tolerujeme schema validation chybu (zatiaľ jediný edge case, dorobíme ak vznikne).

**Pridanie do `AuditLog.action` enum** (`packages/shared-types/src/schemas/audit-log.ts`):

```typescript
// Passkeys (slice #8)
'PASSKEY_REGISTERED',
'PASSKEY_REMOVED',
'PASSKEY_RENAMED',
'PASSKEY_LOGIN',
'PASSKEY_LOGIN_FAILED',
'PASSKEY_COUNTER_WARNING',
```

**Pridanie do `entityType` enum:**

```typescript
'Passkey',
```

**Payload konvencie (target.entityId je passkey.\_id):**

| Action                    | Severity | Metadata fields                                                                                 |
| ------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `PASSKEY_REGISTERED`      | INFO     | `deviceName`, `transports`, `backedUp`, `authenticatorAttachment`                               |
| `PASSKEY_REMOVED`         | WARNING  | `deviceName`, `removedSelf: boolean` (vs admin reset)                                           |
| `PASSKEY_RENAMED`         | INFO     | `oldName`, `newName`                                                                            |
| `PASSKEY_LOGIN`           | INFO     | `credentialIdPrefix` (first 12 chars), `counter`, `via: 'discovery' \| 'allow-credentials'`     |
| `PASSKEY_LOGIN_FAILED`    | WARNING  | `reason: 'unknown-credential' \| 'invalid-assertion' \| 'user-disabled' \| 'challenge-expired'` |
| `PASSKEY_COUNTER_WARNING` | WARNING  | `expected`, `received`, `credentialIdPrefix`                                                    |

**`dataCategories` field:** `['authentication']` pre login events, `['authentication', 'audit_metadata']` pre register/remove (snapshotujeme deviceName).

**`legalBasis` field:** `'legitimate_interest'` pre všetky passkey events (security accounting).

### Zmena 7: Frontend integrácia s tenant switcher (post-Slice #9)

Po úspešnom passkey login:

1. Server resolveuje **default Membership** usera.
2. Server vydá access+refresh JWT s `org=defaultMembership.organisationId` a `mid=defaultMembership._id`.
3. Frontend volá `GET /v1/auth/me` (existing post-K8) — dostane `activeMembership` + `availableOrganisations[]`.
4. `AppShell` zobrazí tenant switcher dropdown ak `availableOrganisations.length > 1` (rovnaká logika ako pri email login).

`PasskeysPanel` v `/settings/security` zobrazuje **globálny** zoznam passkey-ov (nezávisle od aktívneho tenantu). Pridanie/odstránenie passkey-u nemá tenant kontext — patrí ku globálnej identite. Toto je UX deviation od ostatných `/settings` stránok, ktoré sú tenant-scoped (members, organisation settings). Mitigácia: jasný copy v UI: _"Vaše passkey-y fungujú vo všetkých organizáciách, kde ste členom."_

## Final schémy

### `packages/shared-types/src/schemas/passkey.ts` (new file)

```typescript
// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { z } from 'zod';

import {
  BaseDocumentSchema,
  ObjectIdSchema,
  SoftDeleteSchema,
  TimestampSchema,
} from './common.js';

/**
 * Passkey credential — WebAuthn/FIDO2 credential bound to a global User identity.
 *
 * Per ADR-0016: passkeys are GLOBAL (no OrganisationScopedSchema merge).
 * A single passkey works across all tenants where the user has an active
 * membership. After successful authentication, the server resolves the
 * user's default membership and issues a JWT with that tenant active.
 */
export const PasskeyCredentialSchema = BaseDocumentSchema.merge(
  SoftDeleteSchema,
).extend({
  /** Owner. Indexed for fast "list my passkeys" query. */
  userId: ObjectIdSchema,

  /** WebAuthn credential ID — base64url-encoded. Globally unique. */
  credentialId: z.string().min(16).max(1023),

  /** WebAuthn public key — base64url COSE encoded. Never mutated after insert. */
  publicKey: z.string().min(1),

  /**
   * Signature counter. Incremented by authenticator on each use.
   * Synced platform passkeys may not increment reliably — logged but
   * not blocked (advisory only).
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

  /** Authenticator attachment hint at registration time. */
  authenticatorAttachment: z
    .enum(['platform', 'cross-platform'])
    .nullable()
    .default(null),

  /**
   * User-provided name. Default: best-effort from User-Agent at registration.
   * Editable via PATCH /v1/auth/passkeys/:id.
   */
  deviceName: z.string().min(1).max(100),

  /** Last successful authentication via this credential. */
  lastUsedAt: TimestampSchema.nullable().default(null),
});

export type PasskeyCredential = z.infer<typeof PasskeyCredentialSchema>;
```

### User schema additions

```typescript
// packages/shared-types/src/schemas/user.ts (extend existing schema)
passkeyEnabled: z.boolean().default(false),
passkeyEnabledAt: TimestampSchema.nullable().default(null),
```

Convenience flag pre rýchle "má user passkey-y?" otázky bez join-u. Bod-pravdy je `passkeys` collection (`countDocuments({ userId, deletedAt: null })`).

## Konfigurácia (env vars)

Identické s ADR-0014:

```typescript
// apps/api/src/plugins/config.ts
WEBAUTHN_RP_ID: z.string().default('inventario.estate'),
WEBAUTHN_RP_NAME: z.string().default('Inventario'),
WEBAUTHN_EXPECTED_ORIGINS: z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .default('https://app.inventario.estate'),
```

**Boot guard:** ak `WEBAUTHN_RP_ID` chýba, passkey routes registrujú stuby vracajúce `503 PASSKEYS_NOT_CONFIGURED` (rovnaký pattern ako MFA bez `MFA_SECRET_ENCRYPTION_KEY`). Default value pokrýva produkciu — lokálny dev override cez `.env.local`.

## WebAuthn parametre

| Parameter                 | Hodnota                | Dôvod                                                                                           |
| ------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| `attestationType`         | `'none'`               | Žiadny enterprise tenant zatiaľ nepotrebuje attestation overovanie.                             |
| `userVerification`        | `'required'`           | Biometric/PIN je povinný — passkey bez UV je iba single-factor.                                 |
| `residentKey`             | `'preferred'`          | Discoverable credential = autofill funguje, no roaming YubiKey-y bez resident keys neblokujeme. |
| `authenticatorAttachment` | (unset)                | User vyberie platform alebo cross-platform podľa preferencie.                                   |
| Challenge TTL             | 5 minút                | Konzistentné s `mfaSessionToken`. Replay window úzky.                                           |
| Counter check             | Advisory (log warning) | Synced platform passkeys nemajú reliable counter → striktný check by false-positive flagoval.   |

## State machines

### Registration ceremony

```
[idle]
  ↓ user kliknu "Pridať passkey" v /settings/security
  ↓
  POST /v1/auth/passkeys/register/options
  ├─ requireAuth + loadCurrentUser
  ├─ server: generate 32-byte random challenge
  ├─ server: issue challengeToken (5min JWT, audience=inventario-webauthn-registration, sub=userId, challenge claim)
  ├─ server: build PublicKeyCredentialCreationOptions
  │    rp: { id: WEBAUTHN_RP_ID, name: WEBAUTHN_RP_NAME }
  │    user: { id: bytesFromUserId, name: user.email, displayName: user.displayName }
  │    excludeCredentials: existing user's passkeys (prevent duplicate)
  │    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }
  │    attestation: 'none'
  └─ response: { options, challengeToken }
  ↓
[browser_prompted]
  ↓ navigator.credentials.create({ publicKey: options })
  ↓ user does biometric/PIN
  ↓ → AuthenticatorAttestationResponse
[browser_responded]
  ↓
  POST /v1/auth/passkeys/register/verify
    body: { credential, challengeToken, deviceName? }
  ├─ server: verifyWebauthnChallenge(challengeToken, 'registration') → { userId, challenge }
  ├─ server: verifyRegistrationResponse from @simplewebauthn/server with expectedChallenge, expectedOrigin, expectedRPID
  ├─ server: check passkeys.findOne({ credentialId }) — must be null
  ├─ server: insert passkey row { userId, credentialId, publicKey, counter, transports, backedUp, deviceName }
  ├─ server: update User { passkeyEnabled: true, passkeyEnabledAt: now }
  ├─ server: audit PASSKEY_REGISTERED (organisationId = defaultMembership)
  └─ response 201 { passkey: { _id, deviceName, createdAt, backedUp, transports } }
[registered]
```

**Error states (server):**

| HTTP | Code                  | Trigger                                                                                |
| ---- | --------------------- | -------------------------------------------------------------------------------------- |
| 400  | `CHALLENGE_EXPIRED`   | challengeToken JWT exp passed (>5 min)                                                 |
| 400  | `INVALID_ATTESTATION` | `verifyRegistrationResponse` returned `verified: false`                                |
| 400  | `RP_ID_MISMATCH`      | `expectedRPID` didn't match what's in attestation                                      |
| 400  | `ORIGIN_MISMATCH`     | `expectedOrigin` didn't match `clientDataJSON.origin`                                  |
| 409  | `CREDENTIAL_EXISTS`   | credentialId already exists in DB (rare; means user re-registering same authenticator) |

**Error states (browser side, frontend handles):**

| WebAuthn Error      | UX                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `NotAllowedError`   | User zrušil biometric prompt → "Registrácia bola zrušená."                                        |
| `InvalidStateError` | Authenticator už registrovaný → "Tento authenticator je už pridaný."                              |
| `NotSupportedError` | Browser nepodporuje WebAuthn → fallback: skry passkey tlačidlo                                    |
| `SecurityError`     | RP ID mismatch (zriedkavé, browser bug) → "Chyba bezpečnostných parametrov, kontaktujte podporu." |

### Authentication ceremony

```
[idle]
  ↓ user klikne "Prihlásiť cez passkey" alebo browser autofill ponúkne passkey
  ↓
  POST /v1/auth/passkeys/login/options
    body: { email?: string }
  ├─ NO auth required (public endpoint)
  ├─ if email provided:
  │    server queries: users.findOne({ email, deletedAt: null })
  │    if found: passkeys.find({ userId: found._id, deletedAt: null }) → allowCredentials
  │    if not found: still issue options (don't leak email enumeration) but allowCredentials = []
  ├─ if no email: allowCredentials = [] (discovery / resident credential flow)
  ├─ server: generate 32-byte random challenge
  ├─ server: issue challengeToken (5min JWT, audience=inventario-webauthn-authentication, sub=null OR userId, challenge claim)
  ├─ server: build PublicKeyCredentialRequestOptions
  │    rpId: WEBAUTHN_RP_ID
  │    allowCredentials: [...]
  │    userVerification: 'required'
  └─ response: { options, challengeToken }
  ↓
[browser_prompted]
  ↓ navigator.credentials.get({ publicKey: options, mediation: 'optional' | 'conditional' })
  ↓ user picks passkey + biometric/PIN
  ↓ → AuthenticatorAssertionResponse with userHandle (= userId binary)
[browser_responded]
  ↓
  POST /v1/auth/passkeys/login/verify
    body: { credential, challengeToken }
  ├─ server: verifyWebauthnChallenge(challengeToken, 'authentication') → { challenge, userId? }
  ├─ server: passkeys.findOne({ credentialId: credential.id, deletedAt: null })
  │    if not found: emit PASSKEY_LOGIN_FAILED + 401 UNKNOWN_CREDENTIAL
  ├─ server: load passkey.userId → users.findOne
  │    if !user || !user.isActive: emit PASSKEY_LOGIN_FAILED + 401 USER_DISABLED
  ├─ server: verifyAuthenticationResponse from @simplewebauthn/server
  │    expectedChallenge, expectedOrigin, expectedRPID, requireUserVerification: true
  │    if !verified: emit PASSKEY_LOGIN_FAILED + 401 INVALID_ASSERTION
  ├─ server: counter check
  │    if newCounter <= passkey.counter && newCounter !== 0:
  │      emit PASSKEY_COUNTER_WARNING audit (not blocking)
  │    update passkey.counter = newCounter
  ├─ server: find default Membership
  │    memberships.findOne({ userId, isDefault: true, status: 'ACTIVE', deletedAt: null })
  │    if not found: 401 NO_ACTIVE_TENANT
  ├─ server: load Organisation from membership.organisationId
  ├─ server: issue access JWT (with mid claim) + refresh JWT
  ├─ server: set httpOnly cookies (setAuthCookies helper)
  ├─ server: update passkey.lastUsedAt, user.lastLoginAt, membership.lastAccessedAt
  ├─ server: audit PASSKEY_LOGIN (organisationId = membership.organisationId)
  └─ response 204
[authenticated]
```

**Note:** Po authenticated stave je flow identický s email/OAuth login — frontend zavolá `GET /v1/auth/me`, dostane `availableOrganisations`, zobrazí tenant switcher ak treba.

### Removal ceremony

```
DELETE /v1/auth/passkeys/:id
  ├─ requireAuth + loadCurrentUser
  ├─ server: passkeys.findOne({ _id: id, userId: req.user.sub, deletedAt: null })
  │    if not found: 404 NOT_FOUND
  ├─ server: soft-delete passkey
  ├─ server: passkeys.countDocuments({ userId, deletedAt: null }) → remaining
  │    if remaining === 0: update User { passkeyEnabled: false }
  ├─ server: audit PASSKEY_REMOVED { removedSelf: true }
  └─ response 204
```

## API endpoints (full surface)

| Method   | Path                                 | Auth     | RBAC      | Rate limit        |
| -------- | ------------------------------------ | -------- | --------- | ----------------- |
| `POST`   | `/v1/auth/passkeys/register/options` | Required | any role  | 5/15min per user  |
| `POST`   | `/v1/auth/passkeys/register/verify`  | Required | any role  | 10/15min per user |
| `POST`   | `/v1/auth/passkeys/login/options`    | Public   | —         | 30/15min per IP   |
| `POST`   | `/v1/auth/passkeys/login/verify`     | Public   | —         | 10/15min per IP   |
| `GET`    | `/v1/auth/passkeys`                  | Required | any role  | 60/15min per user |
| `PATCH`  | `/v1/auth/passkeys/:id`              | Required | self only | 20/15min per user |
| `DELETE` | `/v1/auth/passkeys/:id`              | Required | self only | 10/15min per user |

`PATCH` body: `{ deviceName: string }` only — žiadne iné polia editovateľné z UI.

`GET /v1/auth/passkeys` response:

```typescript
{
  data: Array<{
    _id: string;
    deviceName: string;
    transports: string[];
    backedUp: boolean;
    authenticatorAttachment: 'platform' | 'cross-platform' | null;
    createdAt: string;
    lastUsedAt: string | null;
  }>;
}
```

Žiadny `credentialId` v response (PII redundancy — frontend ho nepotrebuje).

## Threat model

| #   | Útok                                                      | Obrana                                                                                                                                                                                                             | Reziduálne riziko                                                                                                                                 |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Phishing** — fake login page na `inventario-estate.com` | WebAuthn RP ID binding. Browser podpíše challenge len pre presný RP ID.                                                                                                                                            | Žiadne.                                                                                                                                           |
| 2   | **Replay** — útočník zachytí assertion v sieti            | Per-ceremony random challenge (32 bytes), 5-min TTL, jednorazové použitie (challengeToken consumed at verify).                                                                                                     | TLS musí byť nedotknuté.                                                                                                                          |
| 3   | **Authenticator cloning** (FIDO2 spec hrozba)             | Counter checking — server detekuje regresiu.                                                                                                                                                                       | Synced platform passkeys nemajú reliable counter → log warning, neblokujeme.                                                                      |
| 4   | **Lost device** — user stratí iPhone s passkey            | User revoke z iného zariadenia / heslom + email reset / OAuth login.                                                                                                                                               | Ak má iba 1 passkey a žiadny alternative auth method, je locked out → mitigujeme cez recovery rules (UI warning).                                 |
| 5   | **Credential theft from DB**                              | Public keys + counter NIE SÚ secret. Bez privátneho kľúča (v secure element / TPM) útočník nedokáže forgnúť assertion.                                                                                             | Žiadne pre login. CredentialIds môžu byť kombinované s social engineering.                                                                        |
| 6   | **Sync account compromise** (iCloud / Google hacked)      | Out-of-band. Mitigation: user education (silná auth na Apple ID / Google), notification email pri každom passkey login z nového zariadenia (planned post-MVP).                                                     | Limited — predpokladá compromise upstream providera.                                                                                              |
| 7   | **MITM**                                                  | TLS + RP ID + `expectedOrigin` check v `verifyAuthenticationResponse`.                                                                                                                                             | TLS compromise mimo scope.                                                                                                                        |
| 8   | **Conditional UI abuse** — silent sign                    | Browser vždy vyžaduje explicit user interaction (pick from autocomplete) pred signing.                                                                                                                             | Žiadne.                                                                                                                                           |
| 9   | **Cross-tenant credential abuse** (post-Slice #9 risk)    | Passkey je globálny identity factor — funguje vo všetkých tenant-och, kde má user aktívnu Membership. To je **by-design**, nie threat.                                                                             | Ak útočník dostane passkey + má cieľový tenant kde user má membership, prejde tam. Ale to platí o akejkoľvek auth metóde — passkey to nezhoršuje. |
| 10  | **Rate limit DoS**                                        | Per-IP limits na public endpoints (30/15min `/login/options`).                                                                                                                                                     | Útočník s rotujúcimi IP môže prekonať — out-of-scope pre app vrstvu (CDN/WAF zodpovednosť).                                                       |
| 11  | **Email enumeration cez `/login/options`**                | Endpoint vždy vráti rovnakú odpoveď (či email existuje alebo nie) — `allowCredentials` pole je len `[]` ak email nie je nájdený, ale štruktúra je identická. Timing-side-channel mitigated cez constant-time path. | Sofistikovaný útočník môže merať latenciu → akceptujeme ako known minor leak (Inventario nie je high-security target).                            |
| 12  | **Counter regression false positive**                     | Synced passkeys → log warning bez blokovania. Pri suspicious patterns (multiple warnings v krátkom čase) admin manual review.                                                                                      | Tradeoff false-positive vs blocking legit users.                                                                                                  |

## Test strategy

WebAuthn flow vyžaduje kryptograficky korektné `clientDataJSON` + `authenticatorData` + signature, čo je netriviálne bez real device. `@simplewebauthn/server` má v testoch helpers, ale nie sú exportované do public API.

**Riešenie: `apps/api/tests/fixtures/webauthn.ts` helper modul.**

```typescript
// Pseudocode skeleton (presne ~150 LoC implementácia v Slice #8d)
import { generateKeyPairSync, sign, createHash } from 'node:crypto';

interface SyntheticAuthenticator {
  credentialId: Buffer; // 32 bytes random
  publicKey: KeyObject; // ECDSA P-256
  privateKey: KeyObject;
  counter: number;
}

export function createSyntheticAuthenticator(): SyntheticAuthenticator {
  /* ... */
}

export function makeSyntheticAttestation(opts: {
  authenticator: SyntheticAuthenticator;
  challenge: string; // base64url, must match what server expects
  rpId: string; // 'localhost' for tests
  origin: string; // 'http://localhost:3001' for tests
}): {
  id: string; // credentialId base64url
  rawId: string;
  response: {
    clientDataJSON: string; // base64url(JSON.stringify(clientData))
    attestationObject: string; // base64url(CBOR(authenticatorData + fmt='none' + attStmt={}))
  };
  type: 'public-key';
  clientExtensionResults: {};
} {
  /* ... */
}

export function makeSyntheticAssertion(opts: {
  authenticator: SyntheticAuthenticator;
  challenge: string;
  rpId: string;
  origin: string;
  newCounter?: number; // for testing regression scenarios
}): {
  /* AuthenticatorAssertionResponse-like shape */
} {
  /* ... */
}
```

**Test coverage cieľ (~22 testov):**

| Skupina                   | Testy | Pokrýva                                                                                                                                           |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration happy path   | 2     | Platform attachment, cross-platform attachment                                                                                                    |
| Registration errors       | 6     | Expired challenge, invalid attestation, RP ID mismatch, origin mismatch, duplicate credentialId, unauthenticated request                          |
| Authentication happy path | 3     | Discovery flow (no email), allow-credentials flow (with email), conditional UI flow                                                               |
| Authentication errors     | 6     | Unknown credentialId, invalid assertion, expired challenge, user disabled, no active membership, counter regression (warning emitted)             |
| Management endpoints      | 3     | List own passkeys, rename, delete + auto-clear passkeyEnabled when empty                                                                          |
| Concurrency / edge        | 2     | Two simultaneous registers same authenticator (one wins, one gets 409), delete during active session (passkey gone, JWT still valid until expiry) |

## Slice #8 implementačný plán

### Fáza 1: Backend foundation (Slice #8a, ~1.5 dňa, Sonnet)

| Blok | Popis                                                                                                                                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1   | Install `@simplewebauthn/server@^13`. Add `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_EXPECTED_ORIGINS` do `config.ts` + `turbo.json` globalEnv. Boot guard pattern (registruje stub 503 endpointy ak config chýba).                                 |
| K2   | `packages/shared-types/src/schemas/passkey.ts` (NO `OrganisationScopedSchema` merge). User schema additions (`passkeyEnabled`, `passkeyEnabledAt`). Rozšírenie `audit-log.ts` action enum + entityType `'Passkey'`. Regen shared-types.                  |
| K3   | `apps/api/src/modules/auth/passkeys/passkeys.repository.ts` — CRUD + `findByCredentialId`, `findByUserId`, `countActiveByUserId`, `softDelete`. Indexy: `{credentialId: 1}` unique global, `{userId: 1, deletedAt: 1}`.                                  |
| K4   | Extend `inventario-jwt.ts`: `issueWebauthnChallenge(userId\|null, purpose)` + `verifyWebauthnChallenge(token, purpose)` s audience-scoped JWT. Audience: `inventario-webauthn-registration` / `inventario-webauthn-authentication`.                      |
| K5   | `apps/api/src/modules/auth/mfa/mfa-satisfaction.ts` — `userSatisfiesMfa(user, db)` helper. Update `email-auth.routes.ts` forced MFA check to use it. Žiadny behavior change pre users bez passkey-u; passkey users s `requireMfa=true` org prejdú login. |

### Fáza 2: Backend endpoints (Slice #8b, ~1.5 dňa, Sonnet)

| Blok | Popis                                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| K6   | `apps/api/src/modules/auth/passkeys/passkeys.routes.ts` registration endpoints (`/register/options`, `/register/verify`). `excludeCredentials` na options pre prevention duplicate. Audit `PASSKEY_REGISTERED`.                                                    |
| K7   | Authentication endpoints (`/login/options` { email? }, `/login/verify`). Default Membership resolution. Counter regression warning logic. Audit `PASSKEY_LOGIN` / `PASSKEY_LOGIN_FAILED` / `PASSKEY_COUNTER_WARNING`. Issue JWT s `mid` claim cez existing helper. |
| K8   | Management endpoints (`GET /v1/auth/passkeys`, `PATCH /:id` rename only, `DELETE /:id`). Auto-clear `User.passkeyEnabled` ak posledný passkey odstránený. Audit `PASSKEY_REMOVED` / `PASSKEY_RENAMED`.                                                             |
| K9   | Rate limiting config per ADR-0016 table. Integration s existing `@fastify/rate-limit`.                                                                                                                                                                             |

### Fáza 3: Frontend (Slice #8c, ~1.5 dňa, Sonnet)

| Blok | Popis                                                                                                                                                                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K10  | Install `@simplewebauthn/browser@^13`. Capability detection helper `apps/web/src/lib/webauthn.ts` (`isPasskeysSupported()`, `isConditionalUISupported()`). Device-name autodetekcia z User-Agent.                                              |
| K11  | `/login` page — pridať "Prihlásiť sa cez passkey" tlačidlo. Discovery flow + autofill (`mediation: 'conditional'`) na page mount. Graceful fallback ak browser nepodporuje (skry tlačidlo).                                                    |
| K12  | `/settings/security` — pridať `PasskeysPanel` komponent. List + add + rename inline + delete s confirm dialog. Alternative-auth warning ak user má iba `passwordHash=null` a žiadny non-EMAIL OAuth provider (predtým ako pridá prvý passkey). |
| K13  | Error handling: WebAuthn `NotAllowedError`, `NotSupportedError`, `InvalidStateError`, `SecurityError` → friendly SK messages. Skeleton state počas browser prompt.                                                                             |

### Fáza 4: Tests + docs (Slice #8d, ~1 deň)

| Blok | Popis                                                                                                                                                                                                                                                                   | Model  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| K14  | `apps/api/tests/fixtures/webauthn.ts` synthetic attestation/assertion helpers (~150 LoC). Integration testy: ~22 testov pokrývajúcich happy paths + 13 error scenarios (viď test strategy table). Cieľ: 575/575 → 597/597 testov.                                       | Sonnet |
| K15  | Milestone doc `docs/milestones/slice-8-passkeys.md`. NEXT.md update. User guide `docs/user-guide/how-to/pouzit-passkey.md` + reference `bezpecnost-passkey.md`. **Update ADR-0014 header s `Supersedes` note ukazujúcim na ADR-0016 v schema/audit/recovery častiach.** | Haiku  |
| K16  | Privacy policy update (passkey data category — public key + metadata + lastUsedAt). API reference docs (passkey endpoints). OpenAPI regenerácia.                                                                                                                        | Haiku  |

**Celkom:** 16 K-blokov, ~5.5 pracovných dní (1.5 + 1.5 + 1.5 + 1). Väčšina Sonnet 4.6 implementácia + dva Haiku 4.5 docs bloky.

**Target test count:** 553 (dnes) + 22 = ~575 testov post-Slice #8.

## Otvorené otázky / odložené veci

| #   | Otázka                                                                             | Decision (deferral)                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Forced passkey enrollment pre `requireMfa=true` orgs (analogické TOTP forced flow) | Out of scope Slice #8 MVP. Aktuálne: passkey users prejdú forced check, TOTP-only users prejdú existing flow. Pridáme keď bude reálny dopyt od enterprise tenanta. |
| 2   | Admin endpoint `POST /v1/users/:id/passkeys/reset` pre stratené zariadenia         | Out of scope Slice #8 MVP. Admin môže manuálne soft-delete passkey rows v Atlas UI. Endpoint dodáme pri prvom support tickete.                                     |
| 3   | Notification email pri každom passkey login z nového zariadenia                    | Deferred to Slice #8b post-MVP. Helpful pre detection sync account compromise.                                                                                     |
| 4   | Counter regression notification email                                              | Deferred to Slice #8b. Aktuálne: `PASSKEY_COUNTER_WARNING` audit event + admin manual review.                                                                      |
| 5   | Cross-device flow (QR code → mobile authenticator) UX testing                      | Testujeme v prod-e po deploy-i. Dokumentácia v Slice #8d K15.                                                                                                      |
| 6   | Custom tenant domains a passkey RP-per-tenant izolácia                             | No-op pre Slice #8 — všetci tenanti na `*.inventario.estate`. Riešime keď príde prvý custom-domain tenant.                                                         |
| 7   | WebAuthn Level 3 features (Conditional Mediation v3, hints, PRF extension)         | Out of scope 2026. Možno 2027 ak ekosystém adopti.                                                                                                                 |
| 8   | Bulk passkey export (GDPR DSAR)                                                    | Existing `/v1/auth/me` flow rozšírime o passkey list pri DSAR exportach. Trivial follow-up.                                                                        |

## Dôsledky

### Pozitívne

- **Phishing-resistant primary auth** pre tenantov s vyššími security requirements (SOC 2 type II audit-friendly, NIS2 compliant).
- **Lepší UX pre adopters** — Touch ID / Face ID / Windows Hello → 1-click login.
- **Globálne credentials** — užívateľ s viacerými tenant memberships používa 1 passkey naprieč všetkými (intuitívne, ladí s identitným modelom Slice #9).
- **`userSatisfiesMfa` predicate** dáva čistý integration point pre budúce strong-factor alternatives (WebAuthn step-up, hardware-bound credentials, EUDI Wallet v 2027).
- **Foundation pre eIDAS 2.0 EU Digital Identity Wallet** — budúca integrácia bude jednoduchá, lebo WebAuthn stack je už nasadený.
- **Postupný adoption** — Možnosť C z ADR-0014 zostáva: žiadny disruption pre legacy users, dobrovoľný organic adoption.
- **Recovery rules sú explicitné** — backend a frontend zdieľajú `userHasAlternativeAuth()` logiku, žiadne ambiguous scenarios.

### Negatívne / kompromisy

- **5.5 dní implementácie** — väčšina Sonnet po tomto ADR. Predtým ADR-0014 odhadoval ~4 dni; rozdiel je v dôslednejšom rozdelení a explicit testing fáze + integrácia s post-Slice #9 modelom.
- **Test infra effort** — synthetic WebAuthn attestations ~150 LoC fixtures. Tradeoff: bez nich nedokážeme integration-test register/auth ceremonies bez real device.
- **Counter check je advisory** — synced platform passkeys (iCloud Keychain) nemajú reliable counter. Striktný check by false-positive flagoval. Kompromis: log warning, manual review.
- **forceMfa interakcia neúplná v MVP** — passkey-only users s forced MFA org prejdú, ale users bez passkey/TOTP a s forced MFA stále musia TOTP setup (žiadny passkey-forced flow). Dorobíme post-MVP ak bude dopyt.
- **Audit log `organisationId` workaround** — globálne identity eventy používajú `defaultMembership.organisationId` ako proxy. Funguje, ale je sémanticky neideál. Cleaner cesta: rozšíriť `AuditLog.organisationId` na nullable + frontend "Global identity events" sekcia v Settings → Audit. Out of scope Slice #8.

### Riziká, ktoré treba sledovať

- **Domain dependency** — `WEBAUTHN_RP_ID=inventario.estate` musí ladiť s reálnym hosting setupom. Lokálny dev override cez env.
- **Conditional UI compatibility** — `mediation: 'conditional'` má v 2026 ~95% browser support. Frontend `isConditionalUISupported()` check + graceful fallback pre starostlivé Firefox ESR / embedded WebView.
- **`@simplewebauthn/server` v13 stability** — knižnica je v13, dlhodobo udržiavaná, ale watchnúť semver breaking changes pri budúcich updateoch.
- **Test fixtures churn** — ak `@simplewebauthn/server` vydá v14 s breaking changes v internal format-och CBOR/COSE, naše synthetic helpers môžu prestať fungovať. Sledovať changelog.
- **`mfa.routes.ts` stale references** — Slice #9 zabudol upratovať `user.organisationId` references v mfa.routes.ts forced-verify a challenge endpointoch. To je iný technický dlh, nie blocking pre Slice #8, ale fixne by sme to mali ako Slice #8d K15 follow-up cleanup task (TODO note v NEXT.md).
- **Audit log column drift** — pridávame nové action enum hodnoty. CI musí re-run shared-types build pre passkey events to fungovali. Mitigácia: K2 zahŕňa regen step a CI typecheck.

## Referencie

(Foundation references — viď ADR-0014 pre WebAuthn spec, FIDO Alliance, library docs, conditional UI explainer, NIS2.)

Dodatočné pre tento ADR:

- [ADR-0015 Cross-tenant memberships](0015-cross-tenant-memberships.md) — global identity model, defaultMembership pattern
- [Slice #7 milestone (TOTP MFA)](../milestones/slice-7-totp-mfa.md) — forceMfa K12a baseline
- [@simplewebauthn/server v13 changelog](https://github.com/MasterKale/SimpleWebAuthn/releases) — watch for breaking v14
- [WebAuthn Level 3 — Conditional Mediation](https://www.w3.org/TR/webauthn-3/#sctn-conditional-ui) — autofill flow spec
- [NIST SP 800-63B § 5.1.5](https://pages.nist.gov/800-63-3/sp800-63b.html#single-factor-cryptographic-software) — MFA classification of FIDO2 with UV

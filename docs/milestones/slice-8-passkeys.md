<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Slice #8 — Passkeys / WebAuthn

**Dátum:** 2026-05-25  
**Status:** ✅ DOKONČENÝ  
**Sub-slices:** #8a – #8d  
**K-bloky:** K1 – K16  
**Testy po dokončení:** 569 / 569 (+16 oproti 553 pred Slice #8)

---

## Čo sme vyriešili

Inventario malo pred Slice #8 dva faktory ochrany prihlásenia: heslo + TOTP MFA. Oba sú phishable — sofistikovaný útočník dokáže v reálnom čase presmerovať login na falošnú stránku a zachytiť aj TOTP kód.

Slice #8 zaviedol **WebAuthn / FIDO2 passkey-y** — phishing-resistant authentication:

- **Phishing-resistant by design.** Credential je kryptograficky viazaný na presný RP ID (`inventario.estate`). Podpis je platný len pre túto doménu — falošná login stránka nemôže credential zneužiť.
- **Passwordless UX.** Touch ID / Face ID / Windows Hello → prihlásenie bez hesla a bez TOTP kódu.
- **Globálna identita.** Passkey patrí Userovi, nie tenantu — jeden passkey funguje naprieč všetkými tenantmi kde má user aktívnu Membership.
- **Možnosť C (ADR-0014).** Paralelné cesty na login page — postupný dobrovoľný adoption bez prerušenia legacy users.

---

## Architektonické rozhodnutia

Plný design v [ADR-0016](../decisions/0016-passkeys-implementation-plan.md). Kľúčové rozhodnutia:

| Rozhodnutie         | Voľba                                      | Dôvod                                                           |
| ------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| Schema scope        | Globálna (žiadny OrganisationScopedSchema) | Passkey je identity factor, nie tenant resource                 |
| RP ID               | `inventario.estate` (konfigurovateľné)     | Produkčná doména; localhost pre dev/testy                       |
| Attestation         | `none`                                     | Žiadny enterprise tenant zatiaľ nevyžaduje attestation overenie |
| `userVerification`  | `required`                                 | Biometric/PIN povinný — bez UV degraduje na single-factor       |
| Counter regression  | Advisory (log warning, neblokujeme)        | Synced platform passkeys nemajú reliable counter                |
| forceMfa interakcia | `userSatisfiesMfa(user, db)`               | Passkey + biometric satisfies MFA requirement                   |

---

## Implementácia

### Backend (apps/api)

**Nové súbory:**

| Súbor                                              | Popis                                                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/auth/passkeys/passkeys.repository.ts` | CRUD + findByCredentialId + findByUserId + countActiveByUserId + softDelete. Global unique index na credentialId.                                  |
| `src/modules/auth/passkeys/passkeys.routes.ts`     | 7 endpointov: register/options, register/verify, login/options, login/verify, GET/PATCH/DELETE passkeys. Boot guard (503 ak WEBAUTHN_RP_ID chýba). |
| `src/modules/auth/mfa/mfa-satisfaction.ts`         | `userSatisfiesMfa(user, db)` — TOTP MFA OR aspoň 1 aktívny passkey.                                                                                |
| `tests/helpers/webauthn-fixtures.ts`               | Synthetic P-256 ECDSA attestation/assertion helpers (~280 LoC). Vlastný minimálny CBOR encoder (bez externých závislostí).                         |
| `tests/integration/passkeys.test.ts`               | 16 integračných testov: registration, authentication, management, counter regression.                                                              |

**Upravené súbory:**

| Súbor                                            | Zmena                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `packages/shared-types/src/schemas/passkey.ts`   | **Nový súbor.** `PasskeyCredentialSchema` — globálna schéma (ADR-0016 §1).           |
| `packages/shared-types/src/schemas/user.ts`      | `passkeyEnabled`, `passkeyEnabledAt` convenience fields.                             |
| `packages/shared-types/src/schemas/audit-log.ts` | 6 nových action enum values + entityType `Passkey`.                                  |
| `apps/api/src/plugins/config.ts`                 | `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_EXPECTED_ORIGINS` env vars.          |
| `apps/api/src/plugins/inventario-jwt.ts`         | `issueWebauthnChallenge()` + `verifyWebauthnChallenge()` — audience-scoped 5min JWT. |
| `apps/api/src/modules/auth/email-auth.routes.ts` | Forced MFA check: `!user.mfaEnabled` → `!(await userSatisfiesMfa(user, db))`.        |
| `apps/api/src/server.ts`                         | Registrácia `passkeysRoutes`.                                                        |
| `turbo.json`                                     | 3 nové globalEnv premenné pre WebAuthn.                                              |
| `tests/setup.ts`                                 | WebAuthn test config (RP ID = localhost, expected origin = http://localhost:3001).   |

### API endpointy (nové)

| Endpoint                                  | Auth   | RBAC      | Rate limit        |
| ----------------------------------------- | ------ | --------- | ----------------- |
| `POST /v1/auth/passkeys/register/options` | Req.   | any role  | 5/15min per user  |
| `POST /v1/auth/passkeys/register/verify`  | Req.   | any role  | 10/15min per user |
| `POST /v1/auth/passkeys/login/options`    | Public | —         | 30/15min per IP   |
| `POST /v1/auth/passkeys/login/verify`     | Public | —         | 10/15min per IP   |
| `GET /v1/auth/passkeys`                   | Req.   | any role  | —                 |
| `PATCH /v1/auth/passkeys/:id`             | Req.   | self only | 20/15min per user |
| `DELETE /v1/auth/passkeys/:id`            | Req.   | self only | 10/15min per user |

### Frontend (apps/web)

| Komponent/Súbor                      | Popis                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/webauthn.ts`                | Capability detection (`isPasskeysSupported`, `isConditionalUISupported`), device name autodetekcia, SK error messages, `registerPasskey()`, `authenticateWithPasskey()`. |
| `src/components/LoginPage.tsx`       | "Prihlásiť sa cez passkey" tlačidlo (viditeľné len ak browser podporuje). Conditional UI autofill (`mediation: 'conditional'`) pri page load.                            |
| `src/components/SecurityContent.tsx` | `PasskeysPanel` — list + add + rename + delete. Auto-hides ak browser nepodporuje WebAuthn.                                                                              |

### Testy

| Skupina                   | Počet | Pokrýva                                                                     |
| ------------------------- | ----- | --------------------------------------------------------------------------- |
| Registration happy path   | 2     | Platform + cross-platform attachment, excludeCredentials                    |
| Registration errors       | 4     | Expired/invalid challenge, RP ID mismatch, origin mismatch, unauthenticated |
| Authentication happy path | 2     | allow-credentials flow, discovery/resident-key flow                         |
| Authentication errors     | 4     | Unknown credential, invalid assertion, expired challenge, user disabled     |
| Management                | 3     | List, rename, delete + auto-clear passkeyEnabled                            |
| Counter regression        | 1     | Advisory — login succeeds s counter=0 (synced passkey)                      |

**Total: 553 + 16 = 569 testov, 0 failov.**

---

## Čo NIE JE v Slice #8

- **Forced passkey enrollment** (analog TOTP `mfaSetupToken` flow) — deferred, users bez TOTP/passkey stále dostanú TOTP forced setup
- **Admin endpoint `POST /v1/users/:id/passkeys/reset`** — deferred, admin môže manuálne soft-delete cez Atlas UI
- **Notification email pri passkey login z nového zariadenia** — deferred
- **Cross-device flow QR kód UX testing** — dokumentácia v user guide
- **Cmd+K tenant picker** — LOW priority, post-launch

---

## Závislosti

| Balíček                   | Verzia | Kde                         |
| ------------------------- | ------ | --------------------------- |
| `@simplewebauthn/server`  | `^13`  | `apps/api` (production dep) |
| `@simplewebauthn/browser` | `^13`  | `apps/web` (production dep) |

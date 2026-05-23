<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session Summary — 23. máj 2026

> **Typ session:** Backend feature work — MFA hardening
> **Dĺžka:** ~4 hodiny
> **Status:** ✅ Completed — 511/511 testov
> **Partneri:** Ján Letko (LTK Solutions) + Claude Sonnet 4.6

---

## TL;DR

Implementácia dvoch MFA bezpečnostných features: K12a (Forced MFA setup — org policy vynucuje MFA pre všetkých používateľov) a K12b (Admin MFA reset — admin vymaže MFA userovi ktorý stratil authenticator). Celkovo 20 nových integračných testov, 1 TS fix v teste, 511/511 zelených.

---

## Čo sme spravili

### A. ROADMAP.md — oprava zabudnutých checkboxov

K10 (Users admin module) a K11 (Slice #3 milestone doc) boli hotové od 2026-05-16 ale v ROADMAP.md zostali ako `[ ]`. Opravené na `[x]` s dátumom. Update history v1.3.

### B. K12a — Forced MFA setup

**Problém:** Ak org vyžaduje MFA (`org.settings.mfa.requireMfa: true`), email-password users bez nastaveného MFA sa mohli prihlásiť bez neho.

**Riešenie — 5 zmenených súborov:**

**`packages/shared-types/src/schemas/audit-log.ts`**

- Pridaná audit akcia `USER_MFA_RESET_BY_ADMIN` do enum (K12b potreba, rovnaký commit)

**`apps/api/src/plugins/inventario-jwt.ts`**

- `issueMfaSetupToken(userId)` — RS256, audience `inventario-mfa-setup`, TTL 15 min
- `verifyMfaSetupToken(token)` — verifikácia s purpose=mfa_setup claim
- Obe metódy pridané do `InventarioJwtService` interface aj stub implementácie

**`apps/api/src/modules/auth/email-auth.routes.ts`**

- Login endpoint: po existujúcom MFA gate pridaná kontrola forced MFA
- Ak `org.settings?.mfa?.requireMfa === true` a `!user.mfaEnabled` → 202 `{ mfaSetupRequired: true, mfaSetupToken }`
- Logika číta settings bezpečne cez `Record<string, unknown>` casting

**`apps/api/src/modules/auth/mfa/mfa.routes.ts`**

- Nové Zod schémy: `ForcedSetupSchema`, `ForcedVerifySchema`
- 503 stub pre oba endpointy (keď `MFA_SECRET_ENCRYPTION_KEY` nie je set)
- `POST /v1/auth/mfa/forced-setup` — verifikuje mfaSetupToken, vracia secret + otpauthUrl + recoveryCodes (rovnaký payload ako /setup)
- `POST /v1/auth/mfa/forced-verify` — verifikuje mfaSetupToken + 6-ciferný TOTP kód, aktivuje MFA, vydáva access + refresh cookies

**Guardrails v forced-verify:**

- Expired/invalid token → 401
- MFA already active → 400 "already active. Use /v1/auth/mfa/challenge"
- No pending setup → 400 "Call forced-setup first"
- Wrong code → 400 "Invalid code"

### C. K12b — Admin MFA reset

**Problém:** Používateľ stratil telefón/authenticator app, admin nemá spôsob ako mu vymazať MFA bez priameho DB prístupu.

**Riešenie — 4 zmenené súbory:**

**`apps/api/src/modules/users/users.repository.ts`**

- `clearMfa(organisationId, id, { updatedAt, updatedBy }, session?)` — atomicky nastaví `mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: [], mfaEnabledAt: null`
- Tenant-scoped (admin z tenanta A nemôže resetovať usera tenanta B)
- Parameter typovaný ako `{ updatedAt: string; updatedBy: string }` (nie Partial pre exactOptionalPropertyTypes)

**`apps/api/src/modules/users/users.service.ts`**

- `resetMfa(id, actor, request)` — self-reset guard (vracia 400 s odkazom na /v1/auth/mfa/disable), target must have MFA enabled (400), cross-tenant → 404
- Emituje `USER_MFA_RESET_BY_ADMIN` audit event severity WARNING v rovnakej transakcii ako clearMfa

**`apps/api/src/modules/users/users.routes.ts`**

- Kompletný prepis na čistú verziu (pôvodný edit pokazil štruktúru)
- `DELETE /v1/users/:id/mfa` — ADMIN only, preHandlers: requireAuth + loadCurrentUser + canAdmin
- `reply.code(204).send(null)` pre z.null() Zod schema

**`apps/api/src/modules/audit/audit.service.ts`**

- `USER_MFA_RESET_BY_ADMIN` → `legitimate_interest` legal basis
- `USER_MFA_RESET_BY_ADMIN` → `['authentication']` data categories

### D. Testy — 20 nových integračných testov

**`tests/integration/mfa-forced-setup.test.ts`** — 12 testov:

| Skupina       | Testy                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| Login gate    | 4 (requireMfa+noMFA→202, requireMfa=false→204, noSettings→204, MFA already enabled→mfaRequired nie mfaSetupRequired) |
| forced-setup  | 3 (happy path, bad token→401, already enabled→400)                                                                   |
| forced-verify | 5 (happy path+cookies+DB, wrong code, no pending setup, bad token, already active)                                   |
| E2E flow      | 1 (login→forced-setup→forced-verify→/v1/me)                                                                          |

**`tests/integration/users-mfa-reset.test.ts`** — 9 testov:

| Test             | Assertion                                                  |
| ---------------- | ---------------------------------------------------------- |
| Admin resets MFA | 204 + DB fields cleared                                    |
| Audit event      | USER_MFA_RESET_BY_ADMIN + WARNING severity + correct actor |
| Self-reset guard | 400 s /v1/auth/mfa/disable odkaz                           |
| Target bez MFA   | 400 "MFA is not enabled"                                   |
| ASSET_MANAGER    | 403                                                        |
| EMPLOYEE         | 403                                                        |
| No auth          | 401                                                        |
| Cross-tenant     | 404                                                        |
| Invalid ObjectId | 400                                                        |

### E. TS fix — 3 chyby po commit-e

Husky typecheck odhalil 3 chyby:

1. `users.repository.ts` — `clearMfa` patch typ `Pick<UserUpdatePatch, 'updatedAt' | 'updatedBy'>` obsahoval `string | undefined` (z Partial). Opravené na `{ updatedAt: string; updatedBy: string }`.
2. `users.routes.ts` line 314 — `reply.code(204).send()` → `send(null)` pre z.null() schema.
3. `users-mfa-reset.test.ts` — `email: options.email` pri `exactOptionalPropertyTypes`. Opravené na conditional spread.

### F. Test fix — 1 failing test

`forced-verify` test pre invalid token posielal `'bad.garbage.token'` (17 znakov < min(20) v Zod schema). Zod odmietol 400 pred JWT verify, test očakával 401. Opravené na 49-znakový invalid token.

---

## Commit history (dnešné)

```
docs: fix K10 and K11 ROADMAP.md checkboxes — mark as done 2026-05-16
feat(api): K12a forced MFA setup + K12b admin MFA reset
fix(api): resolve 3 TS errors from K12a/K12b typecheck (combined s predchádzajúcim)
test(api): fix forced-verify invalid token test — pad to min(20) chars
docs(sessions): add 2026-05-23 day summary, update NEXT.md
```

---

## Finálny stav

| Metrika       | Hodnota         |
| ------------- | --------------- |
| Backend testy | 511/511 ✅      |
| Test files    | 31              |
| Duration      | ~38s            |
| Launch ready  | 95%             |
| Legal review  | ⏳ Beží externe |

**Zapísané:** 2026-05-23
**Autor:** Claude Sonnet 4.6 + Ján Letko

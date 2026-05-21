<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Slice #6c — K18 Invitations

**Dátum:** 2026-05-20 až 2026-05-21
**Status:** ✅ DOKONČENÝ
**Commit rozsah:** K18.1 – K18.6 + K18.3
**Testy po dokončení:** 454 → 482 (28 nových testov)
**Frontend stránky:** `/accept-invite` + `/settings/invitations` (2 nové)

---

## Čo sme vyriešili

Pred K18 Inventario nemalo žiadny invite flow pre nových používateľov. ADMIN/ASSET_MANAGER nemohli pozvať kolegu emailom — všetci nový používatelia museli byť skopírovaní manuálne (cez MongoDB) alebo sa registrovali cez OAuth. Pre pilot tenanta (SFZ) s desiatkami zamestnancov je toto nepraktické.

K18 vytvára profesionálny invite flow:

- ADMIN/ASSET_MANAGER pošle pozvánku emailom
- Invitee vidí preview (kto ho pozval, do akého tenant-a)
- Nastaví heslo ALEBO sa pripojí cez Google/Microsoft
- Stane sa aktívnym členom tenant-a s priamo nastavenými rolami

---

## Architektúrne rozhodnutia

### 1. Pending users v User collection (nie separate table)

Invite token je uložený v `emailVerificationToken` pole existujúceho User dokumentu. Pending invitee = User s `passwordHash: null` + `emailVerified: false`. Benefity:

- **Žiadna nová collection** — reuse `User` model, `emails` unique index
- **Audit trail** — `createdBy` pole sleduje kto user invite-ol
- **Jednoduché štatistiky** — pending users sú normálne queryable
- **Backward compatible** — staré tenants majú `emailVerificationToken` z email-auth flows, pending invites sú paralelne

### 2. Email je locked; žiadna zmena pri accept-u

Invitee nemôže zmeniť email počas prijatia pozvánky. Dôvody:

- **Security** — token je viazaný na konkrétny email
- **Domain policy** — ak by sa dalo zmeniť, `enforceAllowedDomains` by sa dalo obísť
- **Audit integrity** — log hovorí "pozvaný X" a výsledný account je X

Zmena emailu neskôr ide cez iný flow (profile settings).

### 3. Domain whitelist: `enforceAllowedDomains`

`Organisation.settings.invitations.enforceAllowedDomains: boolean` (default `false`). Pri `POST /v1/invitations`:

```
if (enforceAllowedDomains && !autoJoinDomains.includes(emailDomain)) {
  throw BadRequest(`Domain ${domain} nie je povolená`)
}
```

Pre SFZ: `autoJoinDomains: ['futbalsfz.sk', 'sfzmarketing.sk']` a `enforceAllowedDomains: true` → ADMIN dostane jasné chybové hlásenie ak sa pokúsi pozvať Gmail.

Budúcnosť: per-email exception list (`invitations.exceptions: string[]`) pre dodávateľov bez corporate emailu.

### 4. RBAC na invite-e

`POST /v1/invitations` vyžaduje ADMIN alebo ASSET_MANAGER. Sanity check: ASSET_MANAGER nemôže pozvať s rolou ADMIN (iba ADMIN môže grant ADMIN).

`GET /v1/invitations` a `DELETE /v1/invitations/:id` — rovnaké permissions.

### 5. Invite token je 64-char hex, platnosť 7 dní

Token: `crypto.randomBytes(32).toString('hex')` (64 znakov). Expires: `now + 7 days`. Platnosť je konzervatívna (Slack má 30 dni, Notion 14 — 7 je podľa SFZ requirement pre "rýchly onboarding").

### 6. OAuth invite accept: invitationToken v podpísanom state cookie (K18.3)

`GET /v1/auth/login/:provider?invitationToken=<hex>` — token sa embedduje do HMAC-podpísaného OAuth state cookie. Na callback:

1. Nájde pending user by `emailVerificationToken`
2. Verifikuje `providerUser.email === pendingUser.email` (case-insensitive)
3. Aktivuje user document: `accountType=ENTRA_ID`, `authProviders=[...]`, `emailVerified=true`, clear token
4. Redirect → `/dashboard?invited=accepted`

Chybové kódy: `invite_not_found`, `invite_expired`, `invite_email_mismatch`.

---

## Implementácia

### Backend

**Nové súbory:**

- `apps/api/src/modules/invitations/invitations.repository.ts` — CRUD pending users, list pending, revoke
- `apps/api/src/modules/invitations/invitations.routes.ts` — 5 endpointov

**Upravené:**

- `packages/shared-types/src/schemas/user.ts` — `invitationSentAt` field
- `apps/api/src/modules/users/users.repository.ts` — `PUBLIC_PROJECTION` excluduje sensitive fields
- `apps/api/src/modules/auth/email-auth.routes.ts` — error message pre pending user login
- `apps/api/src/modules/auth/oauth-state.ts` — K18.3: `invitationToken?: string` do `OAuthStatePayload`
- `apps/api/src/modules/auth/oauth.routes.ts` — K18.3: `invitationToken` query param + `acceptInviteViaOAuth()` branch
- `apps/api/src/plugins/email.ts` — `sendInvitationEmail()` template
- `apps/api/src/server.ts` — registrácia `invitationsRoutesPlugin`
- `apps/web/src/components/AcceptInvitePage.tsx` — K18.3: `handleSso()` opravený na priamy redirect

### API Endpointy

#### Tenant-side (ADMIN + ASSET_MANAGER)

| Endpoint              | Metóda | Odpoveď | Čo robiť                                            |
| --------------------- | ------ | ------- | --------------------------------------------------- |
| `/v1/invitations`     | POST   | 201     | Vytvoriť pozvánku, odoslať email                    |
| `/v1/invitations`     | GET    | 200     | List pending invitations (filtrovateľné, paginácia) |
| `/v1/invitations/:id` | DELETE | 204     | Revoke pending invitation                           |

#### Accept-side (public)

| Endpoint                                       | Metóda | Odpoveď | Čo robiť                                |
| ---------------------------------------------- | ------ | ------- | --------------------------------------- |
| `/v1/auth/invitations/:token`                  | GET    | 200     | Public preview invitácie (bez auth)     |
| `/v1/auth/accept-invitation`                   | POST   | 204     | Accept s heslom                         |
| `/v1/auth/login/:provider?invitationToken=...` | GET    | 302     | Spustí OAuth + embedduje token do state |
| OAuth callback (rozšírený K18.3)               | GET    | 302     | Accept cez Google/Microsoft + redirect  |

### Testy

| Suite                                   | Počet  |
| --------------------------------------- | ------ |
| POST /v1/invitations                    | 7      |
| GET /v1/invitations                     | 4      |
| DELETE /v1/invitations/:id              | 3      |
| GET /v1/auth/invitations/:token         | 3      |
| POST /v1/auth/accept-invitation         | 4      |
| K18.3 state cookie generation           | 2      |
| K18.3 callback: happy path + activation | 3      |
| K18.3 callback: audit event             | 1      |
| K18.3 callback: email mismatch          | 1      |
| K18.3 callback: expired + unknown token | 2      |
| **Celkovo**                             | **28** |

**482 testov, 0 failov.**

---

## Čo NIE JE v K18

- **Resend invite** — temp workaround: revoke + create new. Future: `POST /v1/invitations/:id/resend`.
- **Per-email exception list** — `invitations.exceptions: string[]`. Future.
- **Email change at accept** — separate email-change-verification flow. Future.
- **Bulk invite CSV** — Future: `POST /v1/invitations/bulk`.

---

## Audit events

| Event                      | Severity | Meta                                                                |
| -------------------------- | -------- | ------------------------------------------------------------------- |
| `USER_INVITED`             | INFO     | `{ email, roles, invitedBy }`                                       |
| `USER_INVITATION_REVOKED`  | WARNING  | `{ email, revokedBy }`                                              |
| `USER_INVITATION_ACCEPTED` | INFO     | `{ email, via: 'password' \| 'oauth-google' \| 'oauth-microsoft' }` |

---

## Metriky

| Metrika                  | Hodnota              |
| ------------------------ | -------------------- |
| Backend endpointy (nové) | 5 + OAuth rozšírenie |
| Frontend stránky (nové)  | 2                    |
| Integračné testy (nové)  | 28                   |
| Audit events (nové)      | 3                    |
| Commit range             | K18.1–K18.6 + K18.3  |

---

## Závislostiové zmeny

Žiadne nové production závislosti.

---

**Status:** ✅ K18 KOMPLETNÝ — password accept (K18.1–K18.6) + OAuth accept Google/Microsoft (K18.3).

**Ďalšia**: Slice #7 TOTP MFA — viď [`slice-7-totp-mfa.md`](slice-7-totp-mfa.md).

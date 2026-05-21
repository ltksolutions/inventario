<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Slice #6c — K18 Invitations

**Dátum:** 2026-05-20 až 2026-05-21  
**Status:** ✅ DOKONČENÝ  
**Commit rozsah:** K18.1 – K18.6  
**Testy po dokončení:** 454 → 475 (21 nových testov)  
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

---

## Implementácia

### Backend

**Nové súbory:**

- `apps/api/src/modules/invitations/invitations.repository.ts` — CRUD pending users, list pending, revoke
- `apps/api/src/modules/invitations/invitations.routes.ts` — 5 endpointov (viď nižšie)

**Upravené:**

- `packages/shared-types/src/schemas/user.ts` — `invitationSentAt` field (ISO timestamp, kedy bola pozvánka odoslaná)
- `apps/api/src/modules/users/users.repository.ts` — `PUBLIC_PROJECTION` excluduje `passwordHash` + `emailVerificationToken` (pending users by neboli viditeľní v normálnom user listingu)
- `apps/api/src/modules/auth/email-auth.routes.ts` — nový error message: ak sa pending user pokúsi logovať bez hesla, `400 { message: 'Ešte ste nepotvrdili pozvánku. Kliknite na link v emaile.' }`
- `apps/api/src/plugins/email.ts` — nový template `sendInvitationEmail(to, opts: { inviterName, tenantName, roles, token })`
- `apps/api/src/server.ts` — registrácia `invitationsRoutesPlugin`
- `turbo.json` — žiadne nové env vars (email je cez existing emailService)

**Bug fix počas testov:**  
`Organisation` dokumenty nemali `settings.invitations` pole. Pridaný default: ak chýba, čítame ako `undefined` → defaultná hodnota `false` na `enforceAllowedDomains`.

### API Endpointy

#### Tenant-side (ADMIN + ASSET_MANAGER)

| Endpoint              | Metóda | Odpoveď | Čo robiť                                            |
| --------------------- | ------ | ------- | --------------------------------------------------- |
| `/v1/invitations`     | POST   | 201     | Vytvoriť pozvánku, odoslať email                    |
| `/v1/invitations`     | GET    | 200     | List pending invitations (filtrovateľné, paginácia) |
| `/v1/invitations/:id` | DELETE | 204     | Revoke pending invitation                           |

#### Accept-side (public)

| Endpoint                      | Metóda | Odpoveď | Čo robiť                                    |
| ----------------------------- | ------ | ------- | ------------------------------------------- |
| `/v1/auth/invitations/:token` | GET    | 200     | Public preview invitácie (bez auth)         |
| `/v1/auth/accept-invitation`  | POST   | 204     | Accept s heslo (bez auth, vyžaduje token)   |
| OAuth callback (existujúci)   | —      | —       | Accept cez Google/Microsoft (token v state) |

### Frontend

**Nové stránky:**

- `apps/web/src/app/accept-invite/page.tsx` + komponent `AcceptInvitePage.tsx`
  - Public route (bez auth)
  - Fetch preview cez `GET /v1/auth/invitations/:token` (URL parameter `?token=...`)
  - Zobrazí: "Pozvaný si do {tenantName} ako {roles} od {inviterName}"
  - Dve cesty: password form alebo OAuth buttons
  - Redirect na `/dashboard` po úspešnom accept-u

- `apps/web/src/app/settings/invitations/page.tsx` + komponent `InvitationsContent.tsx`
  - RBAC gated (ADMIN + ASSET_MANAGER only)
  - Form na "Poslať pozvánku": email, roles, optional firstName/lastName
  - Tabuľka pending invitations s debounced search
  - [Zrušiť] button na každý pending
  - Feedback: "Email domain nie je povolený" keď `enforceAllowedDomains=true` a domain nesedí
  - Loading + error states

**AppShell aktualizácia:**

- Nav item "Pozvánky" (Mail ikonka) → `/settings/invitations`

### Testy

`apps/api/tests/integration/invitations-*.test.ts` — 21 nových testov:

| Describe                        | Počet |
| ------------------------------- | ----- |
| POST /v1/invitations            | 7     |
| GET /v1/invitations             | 4     |
| DELETE /v1/invitations/:id      | 3     |
| GET /v1/auth/invitations/:token | 3     |
| POST /v1/auth/accept-invitation | 4     |

Celkovo: **475 testov, 0 failov**.

Pokrytie:

- Happy path: vytvoriť → send email → preview → accept
- RBAC: iba ADMIN/ASSET_MANAGER môžu pozvať
- Role sanity: ASSET_MANAGER nemôže pozvať ADMIN
- Domain policy: `enforceAllowedDomains` blok non-whitelisted domains
- Email uniqueness: nemožno pozvať existujúceho user-a
- Token validity: expired/invalid token → 410
- Audit events: USER_INVITED, USER_INVITATION_REVOKED, USER_INVITATION_ACCEPTED

---

## Čo NIE JE v K18

- **K18.3 OAuth invite accept** — OAuth callback state extension. Odložené pre pilot (ADMIN > cloud feature parity 28/33).
- **Resend invite** — temp workaround: revoke + create new. Future: `POST /v1/invitations/:id/resend`.
- **Per-email exception list** — tenants s `enforceAllowedDomains=true` ale potrebujúci invited outsiders. Future: `invitations.exceptions: string[]`.
- **Email change at accept** — invitee by chcel zmeniť email počas prijatia. Future: separate email-change-verification flow.
- **Bulk invite CSV** — SFZ neurčitý requirement. Future: `POST /v1/invitations/bulk`.

---

## Audit events (nové)

| Event                      | Severity | Meta                           |
| -------------------------- | -------- | ------------------------------ |
| `USER_INVITED`             | INFO     | `{ email, roles, invitedBy }`  |
| `USER_INVITATION_REVOKED`  | WARNING  | `{ email, revokedBy }`         |
| `USER_INVITATION_ACCEPTED` | INFO     | `{ email, via: 'password' }`\* |

- `via` sa rozšíri na `'oauth-google'` keď K18.3 bude hotový.

---

## Email template

Subject: `Pozvaný si do {tenantName}!`

Body:

```
Ahoj!

{inviterName} ťa pozval do {tenantName} ako {roles.join(', ')}.

[Prijať pozvánku] button → inventario.estate/accept-invite?token=...

Táto pozvánka platí 7 dní.
```

HTML template s Inventario brandingom (Navy #1A2D47 + Blue #388FC3).

---

## Metriky

| Metrika                   | Hodnota     |
| ------------------------- | ----------- |
| Backend endpointy (nové)  | 5           |
| API routes (nové)         | 1 file      |
| Repository methods (nové) | ~15         |
| Frontend stránky (nové)   | 2           |
| Komponenty (nové)         | 2           |
| Email templates (nové)    | 1           |
| Integračné testy (nové)   | 21          |
| Audit events (nové)       | 3           |
| Commit range              | K18.1–K18.6 |

---

## Závislostiové zmeny

Žiadne nové production závislosti. Email service a JWT / crypto cez existing libs.

---

## Follow-up pre future slices

| #   | Feature                           | Slice | Priorita |
| --- | --------------------------------- | ----- | -------- |
| 1   | K18.3 OAuth invite accept         | #6c   | HIGH     |
| 2   | Resend invitation endpoint        | #6c+  | MEDIUM   |
| 3   | Per-email domain exception list   | #6d   | MEDIUM   |
| 4   | Email change verification         | #6e   | LOW      |
| 5   | Bulk invite z CSV                 | #7    | MEDIUM   |
| 6   | Forced MFA setup pre pilot tenant | #7    | HIGH     |

---

**Status na konci K18:** ✅ K18.1–K18.6 KOMPLETNÉ. K18.7 = tento milestone doc. K18.3 (OAuth path) odložené pre later slice (nikoli blocking pre pilot).

**Ďalšia**: Slice #7 TOTP MFA (K7.1–K7.8) — kompletný, 480 testov. Viď [`slice-7-totp-mfa.md`](slice-7-totp-mfa.md).

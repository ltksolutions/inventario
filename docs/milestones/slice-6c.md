<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Slice #6c — Auth Migration: Email Provider + Invitations

**Dátum:** 2026-05-19 až 2026-05-21
**Status:** ✅ DOKONČENÝ
**Commit rozsah:** K17.5 + K18.1 – K18.6 + K18.3
**Testy po dokončení:** 433 → 482 (49 nových testov)
**Novo vytvoreného:** 1 plugin (email service), 2 moduly (invitations), 2 frontend pages, OAuth state extension

---

## Strategický kontext

Slice #6c je **auth migration story** — presúvame sa z jednorazových email-verifikácií (password reset, email verify) na **opakovane použiteľnú email infraštruktúru pre multi-tenant flows**.

Výsledok: kompletný invite flow (K18) so všetkými troma accept paths (heslo, Google OAuth, Microsoft OAuth) a flexibilným backend-om pre email (K17.5).

---

## Čo sme vyriešili

### K17.5 — Email service abstraction

Pred K17.5: email bol hardcoded cez Ecomail v rôznych miestach codebase. K17.5 vytvára **plugin architecture pre email**:

- Abstrakt interface: `EmailService`
- Konkrétna implementácia: `EcomailProvider` + `ResendProvider` (future) + `StubProvider` (dev/test)
- Configuration cez env: `EMAIL_PROVIDER` (default `'ecomail'`)
- Per-tenant provider override: `Organisation.settings.email.provider` (future)

### K18 — Invitations feature (K18.1–K18.6 + K18.3)

Kompletný invite flow — všetky tri accept paths:

**Password path (K18.1–K18.6):**

- `POST /v1/invitations` — ADMIN/ASSET_MANAGER pošle pozvánku emailom
- `GET /v1/auth/invitations/:token` — public preview (tenantName, inviterName, role)
- `POST /v1/auth/accept-invitation` — invitee nastaví heslo, dostane auth cookies

**OAuth path (K18.3):**

- `GET /v1/auth/login/:provider?invitationToken=<hex>` — token sa embedduje do HMAC-podpísaného state cookie
- Callback `acceptInviteViaOAuth()`: nájde pending user by token, verifikuje email match, aktivuje account, redirect `/dashboard?invited=accepted`
- `AcceptInvitePage.tsx`: SSO buttons robia priamy redirect na login endpoint s invitationToken

---

## Architektúrny diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ Slice #6c — Auth Migration Story                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────┐   ┌──────────────────────────────────┐
│ K17.5 — Email Service   │   │ K18 — Invitations                │
├─────────────────────────┤   ├──────────────────────────────────┤
│ • Plugin architecture   │   │ • Backend endpoints (K18.1–K18.4)│
│ • Ecomail provider      │ + │ • Frontend pages (K18.5–K18.6)   │
│ • Stub for dev/test     │   │ • OAuth accept path (K18.3)      │
│ • Mock testing support  │   │ • 3 accept paths: pwd/Google/MS  │
└─────────────────────────┘   └──────────────────────────────────┘
                                              ↓
                        ┌────────────────────────────────┐
                        │ Outcome:                       │
                        │ Production invite flow         │
                        │ Ready for SFZ pilot            │
                        └────────────────────────────────┘
```

---

## K17.5 — Email Service Abstraction

**Nový plugin:** `apps/api/src/plugins/email.ts`

```typescript
interface EmailService {
  sendPasswordResetEmail(to: string, opts): Promise<void>;
  sendEmailVerificationEmail(to: string, opts): Promise<void>;
  sendInvitationEmail(to: string, opts): Promise<void>;
}

class EcomailProvider implements EmailService { ... }
class ResendProvider implements EmailService { ... }  // future
class StubProvider implements EmailService { ... }    // dev/test
```

Defaultné správanie: dev/test → `EMAIL_PROVIDER=stub`, prod → `ecomail` (boot fail ak chýba kľúč).

---

## K18 — Invitations Feature

### API Endpointy (kompletné)

| Method | Path                                           | Auth        | Výsledok                        |
| ------ | ---------------------------------------------- | ----------- | ------------------------------- |
| POST   | `/v1/invitations`                              | ADMIN/ASSET | Create invite + send email      |
| GET    | `/v1/invitations`                              | ADMIN/ASSET | List pending                    |
| DELETE | `/v1/invitations/:id`                          | ADMIN/ASSET | Revoke                          |
| GET    | `/v1/auth/invitations/:token`                  | —           | Public preview                  |
| POST   | `/v1/auth/accept-invitation`                   | —           | Accept s heslom                 |
| GET    | `/v1/auth/login/:provider?invitationToken=...` | —           | Spustí OAuth (K18.3)            |
| GET    | `/v1/auth/callback/:provider` (rozšírený)      | —           | OAuth accept → activate (K18.3) |

### K18.3 — OAuth invite accept

**Backend (`oauth-state.ts` + `oauth.routes.ts`):**

`OAuthStatePayload` rozšírený o `invitationToken?: string`. Keď je prítomný v login query params, token sa embedduje do podpísaného state cookie a pri callbacku sa spustí `acceptInviteViaOAuth()`:

1. Nájde pending user by `emailVerificationToken`
2. Verifikuje email match (case-insensitive)
3. Aktivuje user: `accountType=ENTRA_ID`, `authProviders=[...]`, `emailVerified=true`, clear token
4. Emituje `USER_INVITATION_ACCEPTED` s `via: 'oauth-google'` / `'oauth-microsoft'`
5. Redirect → `/dashboard?invited=accepted`

Chybové kódy: `invite_not_found`, `invite_expired`, `invite_email_mismatch`.

**Frontend (`AcceptInvitePage.tsx`):**

`handleSso()` opravený — priamy `window.location.href` redirect namiesto chybného `fetch /v1/auth/register POST`:

```typescript
const loginUrl = new URL(`${API_BASE}/v1/auth/login/${provider}`);
loginUrl.searchParams.set('invitationToken', token);
window.location.href = loginUrl.toString();
```

### Testy (celkovo 49 nových)

| Suite                                        | Počet  |
| -------------------------------------------- | ------ |
| Email service abstraction                    | 12     |
| POST /v1/invitations                         | 7      |
| GET /v1/invitations                          | 4      |
| DELETE /v1/invitations/:id                   | 3      |
| GET /v1/auth/invitations/:token              | 3      |
| POST /v1/auth/accept-invitation              | 4      |
| K18.3 login state cookie generation          | 2      |
| K18.3 callback happy path                    | 3      |
| K18.3 audit event                            | 1      |
| K18.3 error cases (mismatch/expired/unknown) | 3      |
| **Celkovo**                                  | **49** |

**482 testov, 0 failov.**

---

## Architektonické rozhodnutia

| #   | Rozhodnutie                              | Dôvod                                                    |
| --- | ---------------------------------------- | -------------------------------------------------------- |
| 1   | Pending users v User collection          | Reuse `email` unique index, audit trail, backward compat |
| 2   | Email locked (žiadna zmena pri accept)   | Security token binding, domain policy, audit integrity   |
| 3   | Domain whitelist `enforceAllowedDomains` | SFZ security requirement, per-email exception future     |
| 4   | RBAC: ASSET_MANAGER nemôže pozvať ADMIN  | Privilege escalation prevention                          |
| 5   | 7-dní token lifetime                     | Konzervatívne vs SFZ "rýchly onboarding" requirement     |
| 6   | Email plugin pattern (K17.5)             | Flexibilita na multi-tenant, mock testing, future scale  |
| 7   | invitationToken v HMAC state cookie      | Kryptograficky bezpečné, bez server-side session store   |

---

## Metriky Slice #6c

| Metrika                  | Hodnota             |
| ------------------------ | ------------------- |
| Nový plugin (email)      | 1                   |
| Nový modul (invitations) | 1 (2 súbory)        |
| OAuth state rozšírenie   | 1 field             |
| API endpointy            | 5 + OAuth extension |
| Frontend stránky (nové)  | 2                   |
| Nové testy               | 49                  |
| Celkové testy (suite)    | 482                 |
| Test success rate        | 100%                |
| Milestone docs           | 2 (K18.7 + K21)     |

---

## Závislostiové zmeny

Žiadne nové production závislosti.

**Env variables:**

- `EMAIL_PROVIDER` (default: `'ecomail'`)
- `ECOMAIL_API_KEY`

**Nové pole v DB schema:**

- `User.invitationSentAt` (ISO timestamp)
- `Organisation.settings.invitations` (object)

---

## Session roadmap

| Deň  | Čo sa stalo                                        | Model  |
| ---- | -------------------------------------------------- | ------ |
| 5-19 | K17.5 design approval (email plugin pattern)       | Opus   |
| 5-20 | K18 design review + iterácia (invite architecture) | Opus   |
| 5-20 | K17.5 + K18.1–K18.4 backend implementation         | Sonnet |
| 5-21 | K18.5–K18.6 frontend + compliance work             | Sonnet |
| 5-21 | K18.7 + K21 milestone docs                         | Haiku  |
| 5-21 | K18.3 OAuth invite accept                          | Sonnet |

---

## Follow-up slices

| #   | Feature                            | Next slice | Priorita |
| --- | ---------------------------------- | ---------- | -------- |
| 1   | ~~K18.3 OAuth invite accept~~      | ~~#6c~~    | ✅ DONE  |
| 2   | Resend invitation endpoint         | #6d        | MEDIUM   |
| 3   | Per-email domain exception list    | #6d        | MEDIUM   |
| 4   | Email change verification          | #6e        | LOW      |
| 5   | Bulk invite CSV                    | future     | LOW      |
| 6   | Per-tenant email provider override | future     | LOW      |
| 7   | Passkeys / WebAuthn (Slice #8)     | #8         | HIGH     |

---

## Lessons learned

1. **Plugin pattern pre email** — malý refactor s veľkou payoff. 5 hodín teraz, 50 hodín ušetrených pri multi-tenant.
2. **invitationToken v signed state cookie** — elegantné riešenie bez server-side session store. Token putuje cez HMAC-podpísaný cookie, nie query param (CSRF-safe).
3. **Frontend SSO handler bol nesprávny** — pôvodne volal `/v1/auth/register` (!) namiesto login redirect. Dôvod: copy-paste z registration page bez úpravy. Opravené v K18.3.
4. **Email mismatch je kritická validácia** — bez nej by niekto s Google accountom mohol prijať pozvánku urobenú pre iný email.

---

**Status:** ✅ KOMPLETNÝ — K17.5 + K18 (všetky tri accept paths) + K18.3 OAuth.

**Nasledujúca:** Slice #7 TOTP MFA — viď [`slice-7-totp-mfa.md`](slice-7-totp-mfa.md).

---

## Viď aj

- [`slice-6c-k18-invitations.md`](slice-6c-k18-invitations.md) — detailný K18 milestone doc
- [`slice-6b-frontend-auth.md`](slice-6b-frontend-auth.md) — predošlá auth slice
- [`slice-7-totp-mfa.md`](slice-7-totp-mfa.md) — nasledujúca slice (MFA)

# Slice #6c K18 — Invite Flow (design)

**Date:** 2026-05-20
**Status:** Design approved, ready for implementation
**Recommended model for implementation:** Sonnet 4.6 (CRUD + frontend forms; strategic decisions are already done)
**Prerequisite:** Email provider abstraction (K17.5) committed

---

## Scope summary

ADMIN and ASSET_MANAGER invite new users to their tenant by email. Invitee receives a link, lands on an onboarding page, sets password (or uses OAuth), and becomes an active member with pre-assigned roles.

**Out of scope (deferred to later slices):**

- Cross-tenant invites (existing Inventario users joining another tenant)
- Email change at accept time (invitee swapping personal email for corporate)
- Email exception list for tenants with strict domain policy
- Bulk invite from CSV
- Invitee self-cancel flow (only ADMIN can revoke)

---

## Architectural decisions

### 1. Scope: new users only

The current `User` model has `organisationId: string` as a single value (1 user = 1 tenant). Cross-tenant membership would require a User ↔ Organisation many-to-many refactor (Memberships table), which is a separate slice. K18 only accepts invites for emails that do NOT already exist in the User collection.

Conflict handling: if `POST /v1/invitations` is called with an email that already exists anywhere in the User collection (active, pending, or in another tenant), return 400 with a clear message. Cross-tenant invitations are documented as a future feature.

### 2. Acceptance: dedicated landing page, not auto-join

When invitee clicks the email link, they land on `/accept-invite?token=...`. The page:

- Calls `GET /v1/auth/invitations/:token` to fetch preview (tenant name, inviter name, role)
- Shows a confirmation UI: "You've been invited to **{tenant}** as **{role}** by **{inviter}**"
- Offers two paths: "Set up with password" form OR "Continue with Google/Microsoft" buttons

Rationale:

- **Security:** server must verify the token before granting any rights. Auto-join on click would mean a forwarded email = instant membership.
- **UX:** invitee sees what they're joining before accepting. An unexpected tenant name = phishing signal.
- **Flexibility:** both auth methods supported on one page, reusing existing OAuth and password flows.

### 3. Email is locked; no email change at accept

The invite is tied to the specific email ADMIN entered. Invitee cannot swap it during acceptance. Rationale:

- **Security:** token-email binding prevents identity confusion
- **Audit integrity:** logs say "ADMIN invited X" and the resulting account is X (not Y)
- **Domain policy:** if invitee could switch email at accept, the domain whitelist (point 4 below) would be circumventable
- **Alternative path exists:** invitee can change/add email later via user profile settings (a separate future slice with its own verification flow)

### 4. Domain policy: `enforceAllowedDomains` flag

Add a new boolean to `Organisation.settings.invitations`:

```ts
Organisation.settings.invitations = {
  enforceAllowedDomains: boolean, // default: false
};
```

At `POST /v1/invitations`:

```
if (org.settings.invitations?.enforceAllowedDomains
    && !org.autoJoinDomains.includes(emailDomain)) {
  throw new BadRequestError(
    `Email domain '${emailDomain}' is not allowed for this organisation. ` +
    `Allowed domains: ${org.autoJoinDomains.join(', ')}`
  );
}
```

For SFZ pilot: `autoJoinDomains: ['futbalsfz.sk', 'sfzmarketing.sk']` and `enforceAllowedDomains: true`. ADMIN gets a clear error when trying to invite a Gmail address.

External suppliers without a corporate email: ADMIN temporarily disables `enforceAllowedDomains`. A future feature will add a per-email exception list (`Organisation.settings.invitations.exceptions: string[]`) so the flag can stay on while specific addresses bypass it. Not in K18 scope.

### 5. Roles: ADMIN + ASSET_MANAGER can invite

`POST /v1/invitations` requires `ADMIN` or `ASSET_MANAGER` role. Both roles can also `GET /v1/invitations` (list pending) and `DELETE /v1/invitations/:id` (revoke).

The role(s) being granted to the invitee are validated against a sanity allowlist: ASSET_MANAGER cannot create an ADMIN invitation (only ADMIN can grant ADMIN). ADMIN can grant any role.

---

## Data model

### Option chosen: pre-created `User` with invitation token

Reuse the existing `User` document with these states:

| Field                        | Value when invited (pending)                              | Value after accept                                   |
| ---------------------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| `email`                      | invited email                                             | same                                                 |
| `organisationId`             | tenant id                                                 | same                                                 |
| `roles`                      | as set by inviter                                         | same                                                 |
| `passwordHash`               | `null`                                                    | argon2id hash (password path) or `null` (OAuth-only) |
| `emailVerified`              | `false`                                                   | `true`                                               |
| `emailVerificationToken`     | 64-char hex (invite token)                                | `null`                                               |
| `emailVerificationExpiresAt` | now + 7 days                                              | `null`                                               |
| `invitationSentAt`           | ISO now (already exists in model)                         | preserved for audit                                  |
| `accountType`                | `LOCAL` (will change to MICROSOFT/GOOGLE on OAuth accept) | per accept method                                    |
| `authProviders`              | `[]`                                                      | populated after accept                               |
| `isActive`                   | `true`                                                    | same                                                 |
| `lastLoginAt`                | `null`                                                    | set on first login (i.e. accept)                     |
| `createdBy`                  | inviter's user `_id`                                      | same                                                 |

**Why reuse `User` instead of a separate `invitations` collection:**

- The `email` unique constraint on User already prevents double-invites and conflicting registrations
- Login flow already finds users by email; pending users (no password) just fail login with a helpful message
- `emailVerificationToken` field is semantically identical ("click this link to activate this email") — no new token field needed
- Cancelling an invite = soft-delete the User (same machinery as deactivation)
- Smaller diff: no new collection, no new repository, fewer moving parts

**Trade-off accepted:** pending invites show up in `users` collection. Filter them out of `GET /v1/users` listing with `passwordHash: null AND emailVerified: false`. List them explicitly via `GET /v1/invitations`.

### Organisation settings schema update

Extend `Organisation.settings` (currently `Record<string, unknown>`) with a typed structure for known keys. For K18:

```ts
interface OrganisationSettings {
  invitations?: {
    enforceAllowedDomains?: boolean;
  };
  // other future settings keys go here
}
```

Migration: existing orgs have `settings: {}` so reading `settings.invitations?.enforceAllowedDomains` returns `undefined`, treated as `false`. No DB migration needed for backward compat.

---

## API endpoints

### Tenant-side (authenticated, ADMIN or ASSET_MANAGER)

**`POST /v1/invitations`** — Create invitation

Request body:

```ts
{
  email: string,         // lowercase, validated email
  roles: UserRole[],     // at least one role
  firstName?: string,    // optional pre-fill for accept page
  lastName?: string,
}
```

Response 201:

```ts
{
  _id: string,
  email: string,
  roles: UserRole[],
  invitedBy: string,
  invitedAt: string,
  expiresAt: string,
}
```

Validation:

- Email format
- Email not already in `users` collection (any tenant, any state)
- Roles non-empty, all valid `UserRole` values
- If org has `enforceAllowedDomains=true`, email domain must match `autoJoinDomains`
- Inviter cannot grant ADMIN unless they are ADMIN themselves

Side effects:

- Insert pending User document
- Generate invite token (32 bytes hex), expires in 7 days
- Send invitation email via `emailService.sendInvitationEmail(...)`
- Emit audit event `USER_INVITED` (severity INFO)

**`GET /v1/invitations`** — List pending invitations for current tenant

Query params: `limit`, `skip`, `q` (text search on email)

Response:

```ts
{
  data: [
    { _id, email, roles, invitedBy, invitedAt, expiresAt },
    ...
  ],
  pagination: { total, limit, skip, hasMore }
}
```

Filter: `passwordHash: null AND emailVerified: false AND deletedAt: null AND organisationId: <tenant>`.

**`DELETE /v1/invitations/:id`** — Revoke pending invitation

Soft-deletes the pending User. Returns 204. Returns 400 if the invitation has already been accepted (i.e. `passwordHash` or OAuth provider set).

Emit audit event `USER_INVITATION_REVOKED` (severity WARNING).

### Accept-side (unauthenticated, public)

**`GET /v1/auth/invitations/:token`** — Fetch invitation preview by token

Public endpoint, no auth required. Used by the accept page to show context before user commits.

Response 200:

```ts
{
  email: string,
  roles: UserRole[],
  organisation: {
    displayName: string,
    slug: string,
    brandKit: ... | null,    // for white-label theming on accept page
  },
  inviter: {
    displayName: string,     // "Pozval ťa Ján Letko"
  },
  expiresAt: string,
}
```

Response 410 (gone) if token invalid, expired, or already accepted. No email leak — same response for all failures.

**`POST /v1/auth/accept-invitation`** — Accept with password

Request body:

```ts
{
  token: string,             // 64 hex chars
  password: string,          // min 12 chars
  firstName: string,
  lastName: string,
}
```

Behaviour:

1. Find User by `emailVerificationToken` (= invite token), validate not expired
2. Hash password with argon2id (same params as email-auth)
3. Update User: `passwordHash`, `emailVerified=true`, `emailVerificationToken=null`, `emailVerificationExpiresAt=null`, `firstName`, `lastName`, `displayName=firstName + ' ' + lastName`, `accountType=LOCAL`, `authProviders=[{provider: EMAIL, providerId: email, email, linkedAt: now}]`, `lastLoginAt=now`
4. Issue JWT access + refresh, set cookies (reuse `setAuthCookies`)
5. Emit audit event `USER_INVITATION_ACCEPTED` (severity INFO)
6. Return 204

**OAuth path** — extend existing OAuth flows

When invitee clicks "Continue with Google" on accept page, frontend passes the invite token to the OAuth start endpoint. We extend the existing `oauth-state.ts` to include an optional `invitationToken` in the signed state payload. On OAuth callback:

1. If `invitationToken` is present in state, look up the pending User by token (same lookup as password path)
2. Verify the OAuth email matches the invitation email (case-insensitive). Mismatch → 400 with explanation.
3. Update User: set `accountType` per provider, add to `authProviders`, mark `emailVerified=true`, clear invitation token, `lastLoginAt=now`
4. Issue JWT, set cookies
5. Emit audit event `USER_INVITATION_ACCEPTED` with `via: 'oauth-google'` metadata
6. Redirect to `/dashboard?invited=accepted`

### Email template

Add to `EmailService`:

```ts
sendInvitationEmail(to: string, opts: {
  inviterName: string,
  tenantName: string,
  roles: UserRole[],
  token: string,
  frontendUrl: string,
}): Promise<void>;
```

Renders to `${frontendUrl}/accept-invite?token=${token}`. HTML template reuses Inventario brand colors (Navy #1A2D47, Blue #388FC3) and includes:

- Inviter name and tenant name in the body
- Role list (human-readable Slovak names)
- 7-day expiration notice
- Single CTA: "Prijať pozvánku"

---

## Frontend

### `/accept-invite` page (public)

Route: `apps/web/src/app/accept-invite/page.tsx`

States:

1. **Loading** — fetching `GET /v1/auth/invitations/:token` on mount
2. **Valid** — show preview + accept form (password) + OAuth buttons
3. **Expired/invalid** — show "This invitation is no longer valid" with link to `/login`
4. **Submitting** — disable form, show spinner
5. **Success** — redirect to `/dashboard?invited=accepted` (auth cookies set by backend)
6. **Error** — show inline error, allow retry

Password form fields: `firstName`, `lastName`, `password` (with strength meter), `passwordConfirm`. Pre-fill first/last name from invitation if available.

OAuth buttons: pass invitation token in OAuth state. On success, backend handles the link automatically.

### `/settings/invitations` admin page

Route: `apps/web/src/app/(authenticated)/settings/invitations/page.tsx`

Layout:

- "Send invitation" form at top: email input, role multi-select, optional firstName/lastName
- Table of pending invitations: email, roles, invited by, invited at, expires at, [Revoke] button
- Empty state: "No pending invitations"

RBAC gating: page accessible only to ADMIN and ASSET_MANAGER. EMPLOYEE sees 403.

Error handling for `POST /v1/invitations`:

- 400 "domain not allowed" → inline error with allowed domains listed
- 400 "email already exists" → inline error suggesting to check Users list
- 403 "ASSET_MANAGER cannot grant ADMIN" → disable ADMIN option in role picker if current user is ASSET_MANAGER

---

## Audit events (new)

| Action                     | Severity | When                                          |
| -------------------------- | -------- | --------------------------------------------- |
| `USER_INVITED`             | INFO     | After successful `POST /v1/invitations`       |
| `USER_INVITATION_REVOKED`  | WARNING  | After successful `DELETE /v1/invitations/:id` |
| `USER_INVITATION_ACCEPTED` | INFO     | After successful accept (password or OAuth)   |
| `USER_INVITATION_EXPIRED`  | INFO     | (later) emitted by cleanup job                |

Metadata included: `{ email, roles, via: 'password' | 'oauth-google' | 'oauth-microsoft' }`.

---

## Tests (planned)

Integration tests (`apps/api/tests/integration/`):

- `invitations-post.test.ts` — happy path, RBAC, domain validation, role validation, email uniqueness, audit event emission
- `invitations-list.test.ts` — pending only, tenant isolation, RBAC
- `invitations-delete.test.ts` — happy path, accepted invite cannot be revoked
- `invitations-accept-password.test.ts` — happy path, expired token, invalid token, weak password, audit event
- `invitations-accept-oauth.test.ts` — happy path with Google/MS mock, email mismatch rejection, audit event
- `invitations-public-preview.test.ts` — `GET /v1/auth/invitations/:token` returns preview, 410 for invalid

Target: ~30-35 new tests. Total suite should land around 290.

---

## Implementation breakdown

Suggested sub-slices for the Sonnet implementation session:

| Step  | Scope                                                                                          | Estimated test count |
| ----- | ---------------------------------------------------------------------------------------------- | -------------------- |
| K18.1 | Backend: `POST/GET/DELETE /v1/invitations` + audit + Organisation settings flag                | ~15                  |
| K18.2 | Backend: `GET /v1/auth/invitations/:token` + `POST /v1/auth/accept-invitation` (password path) | ~10                  |
| K18.3 | Backend: OAuth state extension + invitation accept via OAuth callback                          | ~5                   |
| K18.4 | Email template `sendInvitationEmail` + HTML                                                    | (no new tests)       |
| K18.5 | Frontend: `/accept-invite` page (both auth methods)                                            | (manual QA)          |
| K18.6 | Frontend: `/settings/invitations` admin page                                                   | (manual QA)          |
| K18.7 | Milestone doc `docs/milestones/slice-6c-k18-invitations.md`                                    | (no tests)           |

Recommended approach: do K18.1–K18.4 in one Sonnet session (fully backend, all testable), then K18.5–K18.6 in a separate session (frontend only). Keeps each session focused and reviewable.

---

## Open questions deferred to implementation

1. **Token lifetime** — currently 7 days. Confirm vs Slack's 30 days or Notion's 14 days. Default 7 days is fine for MVP, can extend later via env var.
2. **Resend invitation** — out of K18 scope. Workaround: revoke + create new. Add `POST /v1/invitations/:id/resend` in K18+ if frequently requested.
3. **Brand kit on accept page** — preview endpoint exposes `organisation.brandKit`. If null, fall back to Inventario default. Theme rendering details deferred to frontend implementation.

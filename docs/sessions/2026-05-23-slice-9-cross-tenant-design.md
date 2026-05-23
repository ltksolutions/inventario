# Slice #9 — Cross-tenant memberships (design)

**Date:** 2026-05-23
**Status:** Design approved, ready for implementation
**ADR:** [0015 Cross-tenant memberships](../decisions/0015-cross-tenant-memberships.md)
**Recommended model for implementation:** Sonnet 4.6 (mechanical CRUD + migration + tests; strategy already locked in ADR)
**Total estimate:** 6–7 working days, 25 K-blocks across 6 sub-slices

---

## Why this slice

Cross-tenant invitations are blocked today by two coupled limitations:

1. `User.organisationId` is single-valued — one User = one tenant.
2. Pending invitations live as ghost-User documents in the `users` collection, so the global `email` unique index rejects any second invitation to an address that already exists.

ADR-0015 resolves both by introducing a `memberships` join collection and migrating pending invites into their own `invitations` collection. After this slice, an existing Inventario user can be invited into a second tenant without identity duplication.

Out of scope (still deferred):

- Per-email invitation exceptions (`Organisation.settings.invitations.exceptions[]`) — separate ~1h Sonnet ticket
- Resend invitation endpoint — separate ~1h Sonnet ticket
- Email change verification flow — separate ~2h Sonnet ticket
- Per-tenant email provider override — separate ~2h Sonnet ticket
- Passkeys / WebAuthn — Slice #8 (independent track)

---

## Approved architectural decisions (from ADR-0015)

For full rationale see ADR-0015. The 8 Q&A decisions confirmed before writing the ADR:

1. **Field split User ↔ Membership** — global identity stays on User (email, name, phone, passwordHash, authProviders, MFA, language/timezone, isActive, lastLoginAt). Per-tenant context moves to Membership (roles, organizationalUnit, teams, notification prefs, invitationSentAt, mustChangePassword).

2. **Default tenant** — `Membership.isDefault: boolean` with a MongoDB partial unique index ensuring at most one `isDefault: true` per `userId`.

3. **JWT shape** — adds `mid` (membershipId) claim. New endpoint `POST /v1/auth/switch-organisation` issues fresh cookies with updated `org`/`mid`/`roles`.

4. **Invitations refactor** — ghost-user pattern abandoned. New `invitations` collection with `invitedUserId: ObjectId | null` to mark new-user vs cross-tenant invites.

5. **Email match logic at `POST /v1/invitations`** — new-user, rejoin (soft-deleted membership), cross-tenant existing user, or `409 ALREADY_MEMBER`. Domain policy (`enforceAllowedDomains`) still applies.

6. **Accept flow for existing user** — preview endpoint returns `acceptMode: 'new-user' | 'existing-user'`. Existing-user path either confirms in-session (matching logged-in cookie + token) or asks for re-login.

7. **Last admin protection** — shared `assertNotLastAdmin()` service used by `DELETE /v1/memberships/:id`, `PATCH /v1/memberships/:id` (role changes), and `DELETE /v1/auth/me`.

8. **Migration** — idempotent runner, runs at next API boot. Atlas snapshot pre-deploy as DR baseline. Smoke test post-deploy. Rollback < 1 min (validated by DR Test #1, 2026-05-23).

---

## Data model — collections after migration

### `users` (global identity, no tenant scoping)

```ts
{
  _id, email (unique global), firstName, lastName, displayName, phone,
  accountType, entraOid, authProviders[],
  emailVerified, emailVerificationToken, emailVerificationExpiresAt,
  passwordHash, passwordResetToken, passwordResetExpiresAt,
  mfaEnabled, mfaSecret, mfaRecoveryCodes, mfaEnabledAt,
  isActive,                              // global suspend
  lastLoginAt,
  preferences: { language, timezone },   // pruned: emailNotifications/pushNotifications moved
  createdAt, updatedAt, createdBy, updatedBy,
  deletedAt, deletedBy,                  // soft-delete = GDPR erasure
}
```

Removed fields (now on Membership): `organisationId`, `roles`, `organizationalUnit`, `teams`, `invitationSentAt`, `mustChangePassword`.

### `memberships` (NEW — User ↔ Organisation join)

```ts
{
  _id, userId, organisationId,
  roles: UserRole[],                     // per-tenant
  organizationalUnit, teams[],           // per-tenant
  status: 'ACTIVE' | 'SUSPENDED',
  isDefault: boolean,                    // max 1 true per userId
  invitedBy, invitedAt, acceptedAt,
  mustChangePassword,                    // per-tenant onboarding
  lastAccessedAt,
  notifications: { email, push },
  createdAt, updatedAt, createdBy, updatedBy,
  deletedAt, deletedBy,                  // soft-delete = leave tenant
}
```

Indexes:

- `{ userId: 1, organisationId: 1 }` unique
- `{ userId: 1, isDefault: 1 }` partial unique where `isDefault: true`
- `{ organisationId: 1, status: 1, deletedAt: 1 }`
- `{ userId: 1, deletedAt: 1 }`

### `invitations` (NEW — replaces ghost-user pattern)

```ts
{
  _id, email, organisationId, roles[],
  firstName, lastName,                   // optional pre-fill
  invitedUserId: ObjectId | null,        // null = new-user, set = cross-tenant
  token (64 hex chars),
  expiresAt,                             // now + 7d
  invitedBy,
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED',
  acceptedAt, membershipId,              // set on accept
  createdAt, updatedAt, createdBy, updatedBy,
  deletedAt, deletedBy,
}
```

Indexes:

- `{ token: 1 }` unique sparse
- `{ organisationId: 1, status: 1, deletedAt: 1 }`
- `{ email: 1, organisationId: 1, status: 1 }`
- `{ expiresAt: 1 }` for cleanup job

---

## Implementation breakdown — 25 K-blocks, 6 sub-slices

### Slice #9a — Schema + migration (~1.5 d, Sonnet)

| K   | Description                                                                                                             | Tests target |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------ |
| K1  | Schemas: `membership.ts`, `invitation.ts`, refactor `user.ts` (drop org fields, split preferences). Regen shared-types. | (types only) |
| K2  | Migration runner `apps/api/src/migrations/2026-05-XX-memberships.ts` + `migrations` collection flag.                    | (smoke test) |
| K3  | `MembershipsRepository` (CRUD + findActive + countAdmins + assertNotLastAdmin). `InvitationsRepository` rewrite.        | ~10          |
| K4  | Migration unit tests: idempotency, ghost-user → invitations, active user → 1 default membership. Backup fixtures.       | ~8           |

### Slice #9b — Auth + JWT (~1 d, Sonnet)

| K   | Description                                                                                             | Tests target |
| --- | ------------------------------------------------------------------------------------------------------- | ------------ |
| K5  | JWT shape: add `mid` claim to `issueAccessToken` + `verifyAccessToken`.                                 | ~3           |
| K6  | `plugins/auth.ts` refactor: fetch active membership, populate `req.user.roles` from membership (cache). | ~5           |
| K7  | `POST /v1/auth/switch-organisation`.                                                                    | ~6           |
| K8  | `GET /v1/auth/me` → `availableOrganisations[]`.                                                         | ~3           |
| K9  | OAuth/email register: create User + default Membership in transaction. Update K18.3 OAuth invite path.  | ~4           |

### Slice #9c — Cross-tenant invite logic (~1 d, Sonnet)

| K   | Description                                                                                          | Tests target |
| --- | ---------------------------------------------------------------------------------------------------- | ------------ |
| K10 | `POST /v1/invitations` refactor: email match logic (new-user / cross-tenant / rejoin / 409).         | ~8           |
| K11 | `GET /v1/auth/invitations/:token` extended preview (`acceptMode`, `existingUserPreview`).            | ~4           |
| K12 | `POST /v1/auth/accept-invitation` `acceptMode: 'existing-user'` path (no password, logged-in match). | ~6           |
| K13 | OAuth callback cross-tenant accept (logged-in user re-auth confirms invite).                         | ~4           |
| K14 | Audit events: `USER_JOINED_ORGANISATION` (cross-tenant), `USER_REJOINED_ORGANISATION`.               | ~3           |

### Slice #9d — Memberships CRUD + last-admin protection (~1 d, Sonnet)

| K   | Description                                                                                                         | Tests target |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------ |
| K15 | `GET/PATCH/DELETE /v1/memberships/:id`, `POST /v1/memberships/:id/default`. RBAC.                                   | ~10          |
| K16 | Shared `assertNotLastAdmin()` service. Transaction-safe count.                                                      | ~4           |
| K17 | `DELETE /v1/auth/me` update: per-membership LAST_ADMIN check, anonymize User + soft-delete memberships.             | ~5           |
| K18 | Audit events: `MEMBERSHIP_CREATED`, `MEMBERSHIP_ROLES_CHANGED`, `MEMBERSHIP_REMOVED`, `USER_SWITCHED_ORGANISATION`. | ~3           |

### Slice #9e — Frontend (~1.5 d, Sonnet)

| K   | Description                                                                                             | Tests target |
| --- | ------------------------------------------------------------------------------------------------------- | ------------ |
| K19 | `AppShell` tenant switcher dropdown (visible if `availableOrganisations.length > 1`).                   | (manual QA)  |
| K20 | `/accept-invite` page extended for `acceptMode: 'existing-user'`.                                       | (manual QA)  |
| K21 | `/settings/members` page (admin): list memberships, change roles, remove member, last-admin warning UX. | (manual QA)  |
| K22 | `/settings/organisations` page (user): own memberships list, mark default, leave-org button.            | (manual QA)  |

### Slice #9f — Docs + milestone (~0.5 d, Haiku)

| K   | Description                                                                              |
| --- | ---------------------------------------------------------------------------------------- |
| K23 | Milestone doc `docs/milestones/slice-9-cross-tenant-memberships.md`.                     |
| K24 | Update `docs/sessions/NEXT.md` — Slice #9 done, remove cross-tenant from roadmap MEDIUM. |
| K25 | API reference docs update (auth endpoints, memberships endpoints).                       |

**Total backend tests target:** ~85 new tests. Suite goes from 511 → ~595.

---

## Recommended session split

Sonnet works best on tightly-scoped slices. Suggested daily chunking:

- **Day 1:** K1–K4 (schemas + migration + repository skeletons). Pre-deploy Atlas snapshot at the end.
- **Day 2:** K5–K9 (JWT + auth middleware + switch-org). Smoke test with synthetic 2-tenant fixture.
- **Day 3:** K10–K14 (cross-tenant invite logic). End-to-end test: invite SFZ user into "Pezinok" demo tenant.
- **Day 4:** K15–K18 (memberships CRUD + last-admin protection). Bulk test suite update.
- **Day 5–6:** K19–K22 (frontend). Manual QA across both tenants.
- **Day 7 (half-day):** K23–K25 (docs + milestone). Production deploy + post-deploy smoke.

Each day ends with `pnpm test` green + commit. Opus 4.7 only re-engages if a structural surprise comes up (e.g. transaction edge case in MongoDB Flex tier, or audit log schema change).

---

## Pre-deploy checklist

- [ ] Atlas snapshot of `sfz-asset-mgmt-prod` (DR baseline)
- [ ] Vercel preview deploy of `apps/api` with migration runner enabled, dry-run against `sfz-asset-mgmt-dev` clone
- [ ] Smoke test on preview: login existing SFZ user, list assets, create loan, list memberships
- [ ] Verify migration is idempotent (run twice on dev, second run no-ops)
- [ ] Confirm `migrations` collection has `2026-05-XX-memberships: { completedAt }` after first run
- [ ] Rollback drill: Atlas restore from snapshot < 5 min wall clock
- [ ] Communicate ~5 min planned maintenance window to SFZ (already 1 tenant, low-impact)

## Post-deploy verification

- [ ] `GET /v1/auth/me` returns `availableOrganisations: [{ ..., isDefault: true }]` for every existing user
- [ ] `GET /v1/memberships` returns exactly 1 row per existing user
- [ ] `POST /v1/invitations` for an external Gmail address: succeeds with `acceptMode: 'new-user'`
- [ ] Old ghost-user invites have moved to `invitations` collection (count check)
- [ ] `users` collection no longer has `organisationId`, `roles`, etc. fields
- [ ] All 595 tests green in production CI
- [ ] No errors in Vercel runtime logs for 1 hour post-deploy

---

## Open questions deferred to implementation

1. **Membership cache implementation** — in-memory per-worker Map with 60s TTL is the simplest start. Future: Redis when scaling beyond single Vercel function. Document the trade-off in K6.
2. **Transaction support in Atlas Flex tier** — Flex supports multi-document transactions. Verify in K2 that migration runs in a single transaction (or batched with checkpoints if memory pressure).
3. **Frontend tenant switcher icon** — Slack-style coloured square with tenant initials, or per-tenant logo from `brandKit.logoUrl`? Default to logo if present, else initials. Spec in K19.
4. **Cross-tenant invite email copy** — Slovak templates need to distinguish "Boli ste pozvaný do X" (new) vs "Boli ste pozvaný do ďalšej organizácie X" (existing user). Localize in K10 email template update.
5. **DSAR export shape** — when a user requests their data, do we group by tenant or flatten? Group by tenant matches GDPR controller distinction. Confirm in K23 milestone doc with reference to existing compliance docs.
6. **Keyboard shortcut (`Cmd+K` tenant picker)** — deferred to a later UX polish session, not part of Slice #9. Estimated ~30 min Sonnet task once Slice #9 is shipped. Decided 2026-05-23 with user.

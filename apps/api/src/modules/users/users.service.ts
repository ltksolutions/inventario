// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Users service — business logic for user management.
 *
 * Slice #2 scope: just-in-time provisioning. When a request comes in with
 * a validated Entra ID JWT, we either:
 *   - find the existing user (matched by `entraOid`), or
 *   - create a new user record with sensible defaults
 *
 * Default role for JIT-provisioned users is `EMPLOYEE`. Admins promote
 * users to higher roles via the K10 admin endpoints (`PATCH /v1/users/:id`).
 *
 * Slice #3 K10 scope: admin endpoints for listing, fetching, and patching
 * users — primarily role and isActive management with two safety
 * guardrails:
 *   - Admins cannot deactivate / demote themselves
 *   - The last active ADMIN cannot be deactivated / demoted (would lock
 *     the system out of further admin actions)
 *
 * Phase C Blok 3 (multi-tenant):
 *   JIT provisioning now takes an `organisation: Organisation` argument
 *   resolved by the auth middleware before user lookup. The provisioned
 *   user gets the real tenant id, no more PENDING_TENANT_ID placeholder.
 *   Admin endpoints (`list`, `getById`, `update`) thread the actor's
 *   tenant through every repository call so cross-tenant reads / writes
 *   surface as 404.
 */

import { AccountType, UserRole, type Organisation, type User } from '@inventario/shared-types';

import { BadRequestError, NotFoundError } from '../../plugins/error-handler.js';
import { computeShallowDiff } from '../assets/assets-diff.js';

import type { UsersRepository, UserUpdatePatch } from './users.repository.js';
import type { AuditLogRepository } from '../audit/audit.repository.js';
import type { AuditLogService } from '../audit/audit.service.js';
import type { MembershipsRepository } from '../memberships/memberships.repository.js';
import type { FastifyRequest } from 'fastify';
import type { ClientSession, Filter, MongoClient, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

/**
 * Subset of Entra/OAuth JWT claims used for JIT user provisioning.
 * Kept here because `auth.ts` no longer exports this type after the
 * Inventario cookie auth cutover (Slice #6c K17).
 */
export interface EntraClaims {
  oid: string;
  tid: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  scp?: string;
  roles?: string[];
}

// ---------------------------------------------------------------------------
// Public API types (continued)
// ---------------------------------------------------------------------------

export interface ListUsersResponse {
  data: Record<string, unknown>[];
  pagination: {
    total: number;
    limit: number;
    skip: number;
    hasMore: boolean;
  };
}

/**
 * Shape returned by GET /v1/me/export (GDPR čl. 20 — prenositeľnosť údajov).
 *
 * Obsahuje:
 *   - `profile`     — celý user dokument (bez secrets)
 *   - `memberships` — všetky členstvá naprieč tenantmi
 *   - `auditLog`    — všetky záznamy kde je používateľ actor
 *   - `exportedAt`  — timestamp exportu
 */
export interface ExportSelfResult {
  exportedAt: string;
  profile: Record<string, unknown>;
  memberships: Record<string, unknown>[];
  auditLog: Record<string, unknown>[];
}

/**
 * Self-service profile update input (GDPR čl. 16).
 *
 * Only the fields a user is permitted to change for themselves. All other
 * User fields (roles, email, isActive, organisationId, …) are excluded at
 * the route schema level and never reach the service.
 */
export type UpdateSelfInput = Partial<
  Pick<User, 'firstName' | 'lastName' | 'displayName' | 'preferences'>
>;

/**
 * Service-layer parameters for the `list` endpoint. Tenant scope is
 * inferred from the actor and threaded through; callers pass
 * pagination / filter knobs only.
 *
 * `role` filters by Membership.role (authoritative per ADR-0029).
 * Do NOT use User.roles[] for filtering — it is a legacy stale field.
 */
export interface ListUsersServiceParams {
  limit?: number;
  skip?: number;
  filter?: Filter<User>;
  /** Filter by Membership.role. Routes pass this separately from the User filter. */
  role?: string;
}

/**
 * Service-layer input for updating a user.
 *
 * Mirrors the writable subset of `UserUpdatePatch` from the repository
 * but without the `updatedAt` / `updatedBy` audit columns — those are
 * controlled by the service.
 *
 * NOTE: `roles` is intentionally absent (ADR-0029 cleanup). Role changes
 * go through PATCH /v1/memberships/:id. This endpoint manages isActive
 * and profile fields only.
 */
export type UpdateUserInput = {
  [K in keyof Omit<UserUpdatePatch, 'updatedAt' | 'updatedBy'>]?: UserUpdatePatch[K] | undefined;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly auditLog: AuditLogService | null,
    private readonly mongoClient: MongoClient | null,
    private readonly membershipsRepo: MembershipsRepository | null = null,
    private readonly auditLogRepo: AuditLogRepository | null = null,
  ) {}

  // -------------------------------------------------------------------------
  // Auth-middleware path: JIT user provisioning
  // -------------------------------------------------------------------------

  /**
   * Find an existing user by their Entra OID, or provision a new one
   * from the JWT claims if no match is found.
   *
   * **Tenant binding:** the caller (auth middleware) has already resolved
   * the JWT `tid` claim to an Organisation document and passes it here.
   * A newly-provisioned user is permanently bound to that tenant. If the
   * user later authenticates through a different Entra tenant (e.g. a
   * cross-tenant guest invitation), we will NOT re-provision under the
   * new tenant — the existing row is returned as-is so the user retains
   * their original tenant home.
   *
   * Concurrency note: between `findByEntraOid` and `insert`, another
   * request from the same user could attempt the same provisioning. We
   * rely on the `entraOid` unique index to make the second insert fail
   * with code 11000 (duplicate key); we catch that and re-query.
   */
  async findOrProvision(
    claims: EntraClaims,
    organisation: WithId<Organisation>,
  ): Promise<WithId<User>> {
    const existing = await this.repo.findByEntraOid(claims.oid);
    if (existing) {
      // Fire-and-forget: don't await `touchLastLogin` to keep auth
      // latency low. Failures are logged inside the repository.
      void this.repo.touchLastLogin(claims.oid);
      return existing;
    }

    const newUser = this.buildUserFromClaims(claims, organisation);

    try {
      return await this.repo.insertNew(newUser);
    } catch (err) {
      // MongoDB error code 11000 = duplicate key. This happens if two
      // concurrent requests for the same first-time user race to
      // insert. The "loser" of the race should just re-fetch what the
      // "winner" inserted.
      if (isDuplicateKeyError(err)) {
        const existingAfterRace = await this.repo.findByEntraOid(claims.oid);
        if (existingAfterRace) {
          return existingAfterRace;
        }
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // K10 admin endpoints — read paths (no transaction)
  // -------------------------------------------------------------------------

  /**
   * List users within the actor's tenant with pagination + optional
   * filters. Soft-deleted users are always excluded.
   *
   * The route layer is responsible for translating query params into
   * the filter shape — the service just applies them. See
   * `users.routes.ts` for the supported query params (`role`,
   * `isActive`, `q`).
   */
  async list(params: ListUsersServiceParams, actor: WithId<User>): Promise<ListUsersResponse> {
    if (!this.membershipsRepo) {
      throw new Error('UsersService.list requires membershipsRepo.');
    }
    const tenantId = String(actor.organisationId);
    const limit = params.limit ?? 50;
    const skip = params.skip ?? 0;
    const filter = params.filter ?? {};

    // Resolve member userIds from memberships — cross-tenant users have
    // no organisationId on their User document, so filtering users directly
    // by organisationId misses them. We go via memberships instead.
    // `role` filter is applied HERE (on Membership.role — authoritative per
    // ADR-0029) rather than on the stale User.roles[] field.
    const roleByUserId = await this.membershipsRepo.findRolesByOrganisation(tenantId, params.role);
    const userIds = [...roleByUserId.keys()];

    const { items, total } = await this.repo.listByUserIds({
      userIds,
      limit,
      skip,
      filter,
    });

    // Overwrite `roles` with the authoritative Membership.role (same shape
    // as GET /v1/me). User.roles[] is a legacy stale field — on documents
    // created after the memberships migration it may be missing or null,
    // which crashed the admin list UI (user.roles.map on null).
    return {
      data: items.map((doc) => {
        const membershipRole = roleByUserId.get(String(doc._id));
        return {
          ...toApiShape(doc),
          roles: membershipRole ? [membershipRole] : [],
        };
      }),
      pagination: {
        total,
        limit,
        skip,
        hasMore: skip + items.length < total,
      },
    };
  }

  async getById(id: string, actor: WithId<User>): Promise<Record<string, unknown>> {
    const tenantId = String(actor.organisationId);

    // Tenant access is gated by ACTIVE membership (ADR-0029), NOT by the
    // User document's organisationId. Cross-tenant invited users carry
    // their ORIGINAL organisationId, so a tenant-scoped findById returns
    // null for them — even though they show up in the membership-based
    // list(). That mismatch made the admin edit dialog 404 on exactly
    // those users. We resolve the membership first (access gate) and then
    // load the user document unscoped.
    const membership = this.membershipsRepo
      ? await this.membershipsRepo.findActive({ userId: id, organisationId: tenantId })
      : null;

    // With membershipsRepo wired (normal path): membership is the access
    // gate — no membership means the user is not part of this tenant, so
    // 404 (don't leak the cross-tenant document). Without it (defensive
    // wiring only), fall back to the legacy tenant-scoped lookup.
    const doc = this.membershipsRepo
      ? membership
        ? await this.repo.findByIdUnscoped(id)
        : null
      : await this.repo.findById(tenantId, id);

    if (!doc) {
      throw new NotFoundError('User', id);
    }

    // Enrich with the authoritative Membership.role (ADR-0029) — same
    // reasoning as in list(): User.roles[] is legacy and may be null.
    // `membershipId` is included so the admin edit dialog can change
    // the role via PATCH /v1/memberships/:id without an extra lookup.
    return {
      ...toApiShape(doc),
      roles: membership?.role ? [membership.role] : [],
      membershipId: membership ? String(membership._id) : null,
    };
  }

  // -------------------------------------------------------------------------
  // GDPR: right to data portability (čl. 20)
  // -------------------------------------------------------------------------

  /**
   * Assemble a full personal data export for the authenticated user.
   *
   * Collected in parallel:
   *   1. User profile (already loaded as `actor` from request context)
   *   2. All memberships for this userId (across all tenants they ever joined)
   *   3. All audit log entries where this userId is the actor
   *
   * After collection, emits a DATA_EXPORT_REQUESTED audit event (fire-and-
   * forget — failure here must NOT abort the export response). This records
   * the exercise of the GDPR right per Art. 30 processing register.
   *
   * Secrets (passwordHash, mfaSecret, mfaRecoveryCodes) are excluded:
   *   - Profile: already stripped by UsersRepository (PUBLIC_PROJECTION)
   *   - Memberships + audit logs: contain no secrets
   *
   * Throws if membershipsRepo or auditLogRepo are not wired (programmer
   * error — routes plugin must pass them).
   */
  async exportSelf(actor: WithId<User>, request: FastifyRequest): Promise<ExportSelfResult> {
    if (!this.membershipsRepo || !this.auditLogRepo) {
      throw new Error(
        'UsersService.exportSelf requires membershipsRepo and auditLogRepo — ' +
          'instantiate the service via the routes plugin.',
      );
    }

    const userId = String(actor._id);

    // Fetch memberships and audit logs in parallel — both are read-only,
    // no transaction needed.
    const [memberships, auditEntries] = await Promise.all([
      this.membershipsRepo.findByUser(userId),
      this.auditLogRepo.findByActor(userId),
    ]);

    const result: ExportSelfResult = {
      exportedAt: new Date().toISOString(),
      profile: toSafeProfileShape(actor),
      memberships: memberships.map((m) => ({ ...m, _id: String(m._id) })),
      auditLog: auditEntries.map((e) => ({
        ...e,
        _id: String((e as Record<string, unknown>)['_id']),
      })),
    };

    // Fire-and-forget: record the export event for GDPR Art. 30 register.
    // We do NOT await — a logging failure must not break the export response.
    if (this.auditLog) {
      void this.auditLog
        .record(actor, request, {
          action: 'DATA_EXPORT_REQUESTED',
          target: {
            entityType: 'User',
            entityId: userId,
            snapshot: { email: actor.email, displayName: actor.displayName },
          },
          description: `User "${actor.displayName}" (${actor.email}) requested personal data export`,
          legalBasis: 'legal_obligation',
        })
        .catch((err: unknown) => {
          // Best-effort: log to stderr but do not surface to the user.
          console.error('[exportSelf] Failed to emit DATA_EXPORT_REQUESTED audit event:', err);
        });
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // GDPR: right to rectification (čl. 16) — self-service profile update
  // -------------------------------------------------------------------------

  /**
   * Self-service profile update for the authenticated user.
   *
   * Permitted fields: `firstName`, `lastName`, `displayName`, `preferences`.
   * Forbidden fields (silently excluded at route schema level, never reach here):
   *   roles, email, isActive, organisationId, accountType, entraOid, etc.
   *
   * `displayName` auto-derivation: if `firstName` or `lastName` is being
   * updated but `displayName` is NOT explicitly provided, the service
   * recomputes it as `"{newFirstName} {newLastName}"` so the display name
   * stays in sync automatically.
   *
   * Emits `USER_UPDATED` audit event with a shallow diff of changed fields
   * (same pattern as admin PATCH). Fire-and-forget — a logging failure must
   * NOT abort the profile update response.
   *
   * No transaction needed: this is a single-document update with no
   * cross-collection invariants to enforce.
   */
  async updateSelf(
    patch: UpdateSelfInput,
    actor: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    const actorId = String(actor._id);
    const now = new Date().toISOString();

    // Auto-derive displayName if name fields change but displayName is not
    // explicitly provided.
    const nextFirstName = patch.firstName ?? actor.firstName;
    const nextLastName = patch.lastName ?? actor.lastName;
    const nextDisplayName =
      patch.displayName ??
      (patch.firstName !== undefined || patch.lastName !== undefined
        ? `${nextFirstName} ${nextLastName}`
        : undefined);

    const repoPatch: UserUpdatePatch = {
      ...(patch.firstName !== undefined ? { firstName: patch.firstName } : {}),
      ...(patch.lastName !== undefined ? { lastName: patch.lastName } : {}),
      ...(nextDisplayName !== undefined ? { displayName: nextDisplayName } : {}),
      ...(patch.preferences !== undefined ? { preferences: patch.preferences } : {}),
      updatedAt: now,
      updatedBy: actorId,
    };

    const updated = await this.repo.updateSelfById(actorId, repoPatch);
    if (!updated) {
      // Should not happen — actor is the currently authenticated user.
      throw new NotFoundError('User', actorId);
    }

    // Fire-and-forget audit event.
    if (this.auditLog) {
      const changes = computeShallowDiff(actor, updated, ['updatedAt', 'updatedBy']);
      if (changes.length > 0) {
        void this.auditLog
          .record(actor, request, {
            action: 'USER_UPDATED',
            target: {
              entityType: 'User',
              entityId: actorId,
              snapshot: { email: updated.email, displayName: updated.displayName },
            },
            description: `User "${updated.displayName}" updated their profile (${changes.length} field${changes.length === 1 ? '' : 's'} changed)`,
            changes,
          })
          .catch((err: unknown) => {
            console.error('[updateSelf] Failed to emit USER_UPDATED audit event:', err);
          });
      }
    }

    return toSafeProfileShape(updated);
  }

  // -------------------------------------------------------------------------
  // K10 admin endpoints — write paths (transactional)
  // -------------------------------------------------------------------------

  /**
   * Admin update of a user within the actor's tenant. Records
   * (de)activation events to the audit log alongside the patch,
   * in a single transaction.
   *
   * NOTE: role changes now go through PATCH /v1/memberships/:id
   * (ADR-0029 cleanup). This endpoint manages isActive and profile
   * fields only. `User.roles[]` is a legacy stale field — RBAC uses
   * `Membership.role` exclusively.
   *
   * Guardrails enforced here:
   *   1. Admin cannot deactivate themselves.
   *   2. The patch must not leave zero active ADMINs in the tenant
   *      (deactivating the last admin would lock the system out).
   *      Per-tenant counting — tenant A having ADMINs does not protect
   *      tenant B. Admin role is read from Membership.role (authoritative).
   *
   * Cross-tenant access is blocked because every repo call is tenant-
   * scoped: an admin from tenant A trying to PATCH a user in tenant B
   * will get 404, not 403, so we do not leak the existence of the
   * cross-tenant document.
   *
   * Audit events emitted (one transaction, possibly multiple events):
   *   - `USER_DEACTIVATED` / `USER_REACTIVATED` — on isActive flip
   *   - `USER_UPDATED` — any other field change (name, preferences, etc.)
   */
  async update(
    id: string,
    patch: UpdateUserInput,
    actor: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    if (!this.auditLog || !this.mongoClient || !this.membershipsRepo) {
      // Programmer error: K10 admin write paths require audit + tx
      // helpers + membershipsRepo, wired up by users.routes.ts.
      throw new Error(
        'UsersService.update requires auditLog, mongoClient, and membershipsRepo — ' +
          'instantiate the service via the routes plugin, not directly.',
      );
    }

    // Bind to locals so TypeScript narrowing survives across the async
    // transaction callback.
    const auditLog = this.auditLog;
    const membershipsRepo = this.membershipsRepo;

    const actorId = String(actor._id);
    const tenantId = String(actor.organisationId);

    const updated = await this.runInTransaction(async (session) => {
      // ----- Step 1: load target, gated by ACTIVE membership -----
      // Tenant access is gated by membership (ADR-0029), not by the User
      // document's organisationId — cross-tenant invited users carry their
      // original organisationId, so a tenant-scoped findById/update would
      // 404 them (same fix as getById). Load unscoped, then require an
      // active membership in the actor's tenant as the access gate.
      const before = await this.repo.findByIdUnscoped(id, session);
      if (!before) {
        throw new NotFoundError('User', id);
      }

      const targetMembership = await membershipsRepo.findActive(
        { userId: String(before._id), organisationId: tenantId },
        session,
      );
      if (!targetMembership) {
        // Not a member of this tenant — 404, no cross-tenant leak.
        throw new NotFoundError('User', id);
      }

      const isSelfPatch = String(before._id) === actorId;
      const isActiveChanged = patch.isActive !== undefined && patch.isActive !== before.isActive;

      // ----- Step 2: guardrails -----

      // Self-deactivation: admin cannot deactivate themselves.
      if (isSelfPatch && before.isActive && patch.isActive === false) {
        throw new BadRequestError('Admins cannot deactivate themselves.');
      }

      // Last-admin deactivation guardrail. Runs in the same transaction
      // so a parallel deactivation can't sneak past this check.
      // Per-tenant scope (tenant A's admins do not protect tenant B).
      //
      // Trigger only when the patch actually deactivates the target
      // (self-patch is already rejected above, so this branch only runs
      // for admin-patches-other-user). We check the target's
      // Membership.role (authoritative per ADR-0029) — User.roles[] is
      // stale and must NOT be used here.
      if (patch.isActive === false && before.isActive) {
        // Reuse the membership resolved in Step 1 (same tenant + user).
        if ((targetMembership.role as string | undefined) === UserRole.ADMIN) {
          const remainingAdmins = await membershipsRepo.countActiveAdmins(
            tenantId,
            String(before._id),
            session,
          );
          if (remainingAdmins === 0) {
            throw new BadRequestError(
              'Cannot deactivate the last active ADMIN. Promote another user to ADMIN first.',
            );
          }
        }
      }

      // Email change guardrail (2026-07-14, detail+editácia používateľa).
      // Email can only be changed for LOCAL accounts — OAuth-linked
      // accounts (ENTRA_ID/GOOGLE) have their email managed by the
      // provider; overwriting User.email here would desynchronize the
      // record from what the provider actually authenticates against.
      // Duplicate-within-tenant is enforced by the
      // `organisationId_email_unique` index (see users.repository.ts) —
      // we let the write hit that index and catch E11000 below rather
      // than duplicating the uniqueness check outside the transaction.
      if (patch.email !== undefined && patch.email !== before.email) {
        if (before.accountType !== AccountType.LOCAL) {
          // accountType is binary today (LOCAL | ENTRA_ID) — in practice this
          // means Microsoft Entra ID SSO accounts. Mirrors the wording used
          // by the self-service change-email flow in email-auth.routes.ts.
          throw new BadRequestError(
            'Email je pri OAuth účtoch (napr. Microsoft) v správe providera a nedá sa zmeniť ručne.',
          );
        }
      }

      // ----- Step 3: build patch with audit columns -----
      // displayName auto-derivation mirrors updateSelf(): if firstName or
      // lastName changes without an explicit displayName, recompute it as
      // "{newFirstName} {newLastName}" so the two stay in sync.
      const nextFirstName = patch.firstName ?? before.firstName;
      const nextLastName = patch.lastName ?? before.lastName;
      const nextDisplayName =
        patch.displayName ??
        (patch.firstName !== undefined || patch.lastName !== undefined
          ? `${nextFirstName} ${nextLastName}`
          : undefined);

      const now = new Date().toISOString();
      const fullPatch: UserUpdatePatch = {
        ...this.buildRepoPatch({
          ...patch,
          ...(nextDisplayName !== undefined ? { displayName: nextDisplayName } : {}),
        }),
        updatedAt: now,
        updatedBy: actorId,
      };

      // Write unscoped — access already gated by the membership check in
      // Step 1 (cross-tenant invited users carry a foreign organisationId,
      // so the tenant-scoped update() would not match them).
      let after: WithId<User> | null;
      try {
        after = await this.repo.updateByIdUnscoped(id, fullPatch, session);
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          throw new BadRequestError('Táto e-mailová adresa je už používaná v tejto organizácii.');
        }
        throw err;
      }
      if (!after) {
        // Lost-update race: target was soft-deleted between the load
        // and the update. Surface as 404 to be consistent with the
        // load check.
        throw new NotFoundError('User', id);
      }

      // ----- Step 4: emit audit events -----

      // Activation flip.
      if (isActiveChanged) {
        await auditLog.record(
          actor,
          request,
          {
            action: after.isActive ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
            target: {
              entityType: 'User',
              entityId: String(after._id),
              snapshot: { email: after.email, displayName: after.displayName },
            },
            description: after.isActive
              ? `Reactivated user "${after.displayName}" (${after.email})`
              : `Deactivated user "${after.displayName}" (${after.email})`,
            severity: after.isActive ? 'INFO' : 'WARNING',
          },
          session,
        );
      }

      // Generic USER_UPDATED for any other changed field. Excludes
      // isActive (has its own event above), roles (legacy stale field —
      // ignored), and noise columns.
      const changes = computeShallowDiff(before, after, [
        'updatedAt',
        'updatedBy',
        'roles',
        'isActive',
        'lastLoginAt',
      ]);
      if (changes.length > 0) {
        await auditLog.record(
          actor,
          request,
          {
            action: 'USER_UPDATED',
            target: {
              entityType: 'User',
              entityId: String(after._id),
              snapshot: { email: after.email, displayName: after.displayName },
            },
            description: `Updated user "${after.displayName}" (${changes.length} field${changes.length === 1 ? '' : 's'} changed)`,
            changes,
          },
          session,
        );
      }

      return after;
    });

    return toApiShape(updated);
  }

  // -------------------------------------------------------------------------
  // K12b — Admin MFA reset
  // -------------------------------------------------------------------------

  /**
   * Load a target user for an admin write, gating tenant access by ACTIVE
   * membership (ADR-0029) rather than User.organisationId — cross-tenant
   * invited users carry a foreign organisationId, so a tenant-scoped lookup
   * would 404 them. Returns null if not found OR not a member of the tenant
   * (caller surfaces that as 404, no cross-tenant leak). Falls back to the
   * scoped lookup only when membershipsRepo isn't wired (defensive).
   */
  private async loadTenantMember(
    id: string,
    tenantId: string,
    session: ClientSession,
  ): Promise<WithId<User> | null> {
    if (!this.membershipsRepo) {
      return this.repo.findById(tenantId, id, session);
    }
    const membership = await this.membershipsRepo.findActive(
      { userId: id, organisationId: tenantId },
      session,
    );
    if (!membership) return null;
    return this.repo.findByIdUnscoped(id, session);
  }

  /**
   * Admin clears MFA for a target user within the same tenant.
   *
   * Use cases:
   *   - User lost their phone / authenticator app
   *   - Admin bulk-reset after security incident
   *
   * Guardrails:
   *   - Admin cannot reset their own MFA via this path (use /v1/auth/mfa/disable)
   *   - Target must have MFA enabled (clearing already-cleared MFA is a no-op / error)
   *   - Cross-tenant access blocked via tenant-scoped repo call (returns 404)
   *
   * Emits audit event MFA_RESET_BY_ADMIN.
   */
  async resetMfa(id: string, actor: WithId<User>, request: FastifyRequest): Promise<void> {
    if (!this.auditLog || !this.mongoClient) {
      throw new Error('UsersService.resetMfa requires auditLog and mongoClient.');
    }
    const auditLog = this.auditLog;
    const actorId = String(actor._id);
    const tenantId = String(actor.organisationId);

    // Self-reset guard: admin must use /v1/auth/mfa/disable for their own MFA
    if (id === actorId) {
      throw new BadRequestError('Use POST /v1/auth/mfa/disable to manage your own MFA.');
    }

    await this.runInTransaction(async (session) => {
      const target = await this.loadTenantMember(id, tenantId, session);
      if (!target) {
        throw new NotFoundError('User', id);
      }

      if (!target.mfaEnabled) {
        throw new BadRequestError('MFA is not enabled for this user.');
      }

      const now = new Date().toISOString();
      const mfaPatch = { updatedAt: now, updatedBy: actorId };
      const after = this.membershipsRepo
        ? await this.repo.clearMfaByIdUnscoped(id, mfaPatch, session)
        : await this.repo.clearMfa(tenantId, id, mfaPatch, session);
      if (!after) {
        throw new NotFoundError('User', id);
      }

      await auditLog.record(
        actor,
        request,
        {
          action: 'USER_MFA_RESET_BY_ADMIN',
          target: {
            entityType: 'User',
            entityId: String(after._id),
            snapshot: { email: after.email, displayName: after.displayName },
          },
          description: `Admin reset MFA for "${after.displayName}" (${after.email})`,
          severity: 'WARNING',
        },
        session,
      );
    });
  }

  // -------------------------------------------------------------------------
  // GDPR čl. 18 — right to restriction of processing (admin action)
  // -------------------------------------------------------------------------

  /**
   * Set or clear the GDPR čl. 18 processing-restriction flag on a user
   * within the actor's tenant. Admin action.
   *
   * When `restrict` is true:  isRestricted=true, restrictedAt=now,
   *   restrictionReason=reason (optional). Emits USER_RESTRICTED.
   * When `restrict` is false: isRestricted=false, restrictedAt=null,
   *   restrictionReason=null. Emits USER_UNRESTRICTED.
   *
   * Idempotent: setting an already-restricted user to restricted (or an
   * already-unrestricted one to unrestricted) is a BadRequest — the
   * caller should know the current state. This prevents spurious audit
   * noise and surfaces likely UI bugs.
   *
   * Cross-tenant access blocked via tenant-scoped repo call (404, not 403,
   * so we don't leak the existence of the cross-tenant document).
   *
   * Runs in a transaction so the flag flip and the audit event commit
   * atomically.
   */
  async setRestriction(
    id: string,
    restrict: boolean,
    reason: string | null,
    actor: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    if (!this.auditLog || !this.mongoClient) {
      throw new Error('UsersService.setRestriction requires auditLog and mongoClient.');
    }
    const auditLog = this.auditLog;
    const actorId = String(actor._id);
    const tenantId = String(actor.organisationId);

    const updated = await this.runInTransaction(async (session) => {
      const before = await this.loadTenantMember(id, tenantId, session);
      if (!before) {
        throw new NotFoundError('User', id);
      }

      const currentlyRestricted = before.isRestricted === true;
      if (currentlyRestricted === restrict) {
        throw new BadRequestError(
          restrict ? 'User is already restricted.' : 'User is not currently restricted.',
        );
      }

      const now = new Date().toISOString();
      const restrictionArgs = {
        isRestricted: restrict,
        restrictedAt: restrict ? now : null,
        restrictionReason: restrict ? reason : null,
        updatedAt: now,
        updatedBy: actorId,
      };
      const after = this.membershipsRepo
        ? await this.repo.setRestrictionByIdUnscoped(id, restrictionArgs, session)
        : await this.repo.setRestriction(tenantId, id, restrictionArgs, session);
      if (!after) {
        throw new NotFoundError('User', id);
      }

      await auditLog.record(
        actor,
        request,
        {
          action: restrict ? 'USER_RESTRICTED' : 'USER_UNRESTRICTED',
          target: {
            entityType: 'User',
            entityId: String(after._id),
            snapshot: { email: after.email, displayName: after.displayName },
          },
          description: restrict
            ? `Restricted processing for "${after.displayName}" (${after.email})${reason ? ` — ${reason}` : ''}`
            : `Lifted processing restriction for "${after.displayName}" (${after.email})`,
          severity: 'WARNING',
          ...(restrict && reason ? { metadata: { reason } } : {}),
        },
        session,
      );

      return after;
    });

    return toApiShape(updated);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Convert the public service input into the narrower repository patch.
   * NOTE: `roles` is intentionally absent — role changes go through
   * PATCH /v1/memberships/:id (ADR-0029).
   */
  private buildRepoPatch(input: UpdateUserInput): Omit<UserUpdatePatch, 'updatedAt' | 'updatedBy'> {
    const patch: Omit<UserUpdatePatch, 'updatedAt' | 'updatedBy'> = {};

    if (input.isActive !== undefined) patch.isActive = input.isActive;
    if (input.firstName !== undefined) patch.firstName = input.firstName;
    if (input.lastName !== undefined) patch.lastName = input.lastName;
    if (input.displayName !== undefined) patch.displayName = input.displayName;
    if (input.email !== undefined) patch.email = input.email;
    if (input.organizationalUnit !== undefined) patch.organizationalUnit = input.organizationalUnit;
    if (input.teams !== undefined) patch.teams = input.teams;
    if (input.mustChangePassword !== undefined) patch.mustChangePassword = input.mustChangePassword;
    if (input.preferences !== undefined) patch.preferences = input.preferences;

    return patch;
  }

  /**
   * Constructs a `User` document from validated Entra ID claims and
   * the resolved tenant Organisation.
   *
   * Email is required for provisioning — if the token lacks both
   * `email` and `preferred_username`, we cannot satisfy the unique-
   * email constraint. In that case we throw, which surfaces as a 401
   * to the caller. The fix is for the tenant admin to add `email` to
   * the optional claims of the API app registration (see Azure setup,
   * Krok 5).
   */
  private buildUserFromClaims(
    claims: EntraClaims,
    organisation: WithId<Organisation>,
  ): Omit<User, '_id'> {
    const email = claims.email ?? claims.preferred_username;
    if (!email) {
      throw new Error(
        'Entra token lacks `email` and `preferred_username` claims — ' +
          'cannot JIT-provision. Add `email` to optional claims in the API app registration.',
      );
    }

    const { firstName, lastName, displayName } = splitName(claims);
    const now = new Date().toISOString();

    return {
      organisationId: String(organisation._id),
      email: email.toLowerCase(),
      firstName,
      lastName,
      displayName,
      accountType: AccountType.ENTRA_ID,
      entraOid: claims.oid,
      // Multi-provider auth (ADR-0013): populate authProviders from Entra claim
      authProviders: [
        {
          provider: 'MICROSOFT' as const,
          providerId: claims.oid,
          email: email.toLowerCase(),
          linkedAt: now,
        },
      ],
      emailVerified: true, // Entra SSO = email already verified by Microsoft
      emailVerificationToken: null,
      emailVerificationExpiresAt: null,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
      passwordHash: null,
      roles: [UserRole.EMPLOYEE],
      organizationalUnit: null,
      teams: [],
      isActive: true,
      lastLoginAt: now,
      invitationSentAt: null,
      mustChangePassword: false,
      mfaEnabled: false,
      mfaSecret: null,
      mfaRecoveryCodes: [],
      mfaEnabledAt: null,
      preferences: {
        language: 'sk',
        timezone: 'Europe/Bratislava',
        emailNotifications: true,
        pushNotifications: false,
      },
      createdAt: now,
      updatedAt: now,
      createdBy: 'SYSTEM',
      updatedBy: 'SYSTEM',
      deletedAt: null,
      deletedBy: null,
    } as never;
  }

  // -------------------------------------------------------------------------
  // Transaction helper (mirrors CategoriesService / AssetsService)
  // -------------------------------------------------------------------------

  private async runInTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    if (!this.mongoClient) {
      throw new Error('Transaction requested without mongoClient — wiring error.');
    }
    const session = this.mongoClient.startSession();
    try {
      let result: T | undefined;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result as T;
    } finally {
      await session.endSession();
    }
  }
}

// ---------------------------------------------------------------------------
// Plain-function helpers (no class state needed)
// ---------------------------------------------------------------------------

/**
 * Best-effort name parsing from Entra claims.
 *
 * Order of preference:
 *   1. `given_name` + `family_name` — most accurate (when configured)
 *   2. Split `name` on first space
 *   3. Fall back to the email local part
 */
function splitName(claims: EntraClaims): {
  firstName: string;
  lastName: string;
  displayName: string;
} {
  if (claims.given_name && claims.family_name) {
    return {
      firstName: claims.given_name,
      lastName: claims.family_name,
      displayName: claims.name ?? `${claims.given_name} ${claims.family_name}`,
    };
  }

  if (claims.name) {
    const parts = claims.name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return {
        firstName: parts[0]!,
        lastName: parts.slice(1).join(' '),
        displayName: claims.name,
      };
    }
    return {
      firstName: parts[0] ?? 'Unknown',
      lastName: 'Unknown',
      displayName: claims.name,
    };
  }

  // Last resort: derive from email local part.
  const email = claims.email ?? claims.preferred_username ?? 'unknown@unknown';
  const localPart = email.split('@')[0] ?? 'unknown';
  return {
    firstName: localPart,
    lastName: 'Unknown',
    displayName: localPart,
  };
}

// Type guard for MongoDB duplicate-key errors.
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 11000
  );
}

function toApiShape(doc: WithId<User>): Record<string, unknown> {
  return {
    ...doc,
    _id: String(doc._id),
  };
}

/**
 * Like `toApiShape` but explicitly strips secret fields that must never
 * appear in a GDPR export or any user-facing response:
 *   - passwordHash   — bcrypt hash of the local-account password
 *   - mfaSecret      — TOTP shared secret
 *   - mfaRecoveryCodes — hashed backup codes
 *
 * `UsersRepository` already excludes these via `PUBLIC_PROJECTION` on
 * every DB read, so for documents loaded through the repository this is
 * a no-op safety net. For documents constructed in memory (e.g. from
 * request context populated before the projection takes effect in tests)
 * this guarantee is essential.
 */
function toSafeProfileShape(doc: WithId<User>): Record<string, unknown> {
  const {
    passwordHash: _pw,
    mfaSecret: _ms,
    mfaRecoveryCodes: _mc,
    ...rest
  } = doc as User & {
    passwordHash?: unknown;
    mfaSecret?: unknown;
    mfaRecoveryCodes?: unknown;
  };
  return {
    ...rest,
    _id: String(doc._id),
  };
}

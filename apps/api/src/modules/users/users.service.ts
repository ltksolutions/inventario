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
import type { AuditLogService } from '../audit/audit.service.js';
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
 * Service-layer parameters for the `list` endpoint. Tenant scope is
 * inferred from the actor and threaded through; callers pass
 * pagination / filter knobs only.
 */
export interface ListUsersServiceParams {
  limit?: number;
  skip?: number;
  filter?: Filter<User>;
}

/**
 * Service-layer input for updating a user.
 *
 * Mirrors the writable subset of `UserUpdatePatch` from the repository
 * but without the `updatedAt` / `updatedBy` audit columns — those are
 * controlled by the service. The route layer narrows further (K10 only
 * exposes `roles` and `isActive`; other fields are reserved for future
 * self-service / admin extensions).
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
    const tenantId = String(actor.organisationId);
    const limit = params.limit ?? 50;
    const skip = params.skip ?? 0;
    const filter = params.filter ?? {};

    const { items, total } = await this.repo.list({
      organisationId: tenantId,
      limit,
      skip,
      filter,
    });

    return {
      data: items.map(toApiShape),
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
    const doc = await this.repo.findById(tenantId, id);
    if (!doc) {
      throw new NotFoundError('User', id);
    }
    return toApiShape(doc);
  }

  // -------------------------------------------------------------------------
  // K10 admin endpoints — write paths (transactional)
  // -------------------------------------------------------------------------

  /**
   * Admin update of a user within the actor's tenant. Records role-
   * change and (de)activation events to the audit log alongside the
   * patch, in a single transaction.
   *
   * Guardrails enforced here (route schema validates shape; service
   * validates business invariants):
   *   1. Admin cannot patch themselves to remove ADMIN role.
   *   2. Admin cannot deactivate themselves.
   *   3. The patch must not leave zero active ADMINs in the tenant
   *      (catches "I'm not removing myself but I'm demoting the last
   *      other admin" and "I'm not deactivating myself but I'm
   *      deactivating the last admin"). Per-tenant counting — tenant A
   *      having ADMINs does not protect tenant B.
   *
   * Cross-tenant access is blocked because every repo call is tenant-
   * scoped: an admin from tenant A trying to PATCH a user in tenant B
   * will get 404, not 403, so we do not leak the existence of the
   * cross-tenant document.
   *
   * Audit events emitted (one transaction, possibly multiple events):
   *   - `USER_ROLE_GRANTED` — once per newly added role
   *   - `USER_ROLE_REVOKED` — once per removed role
   *   - `USER_DEACTIVATED` / `USER_REACTIVATED` — on isActive flip
   *   - `USER_UPDATED` — fallback for any other field change (name,
   *     preferences, etc.); not used yet in K10 but ready for K10+
   */
  async update(
    id: string,
    patch: UpdateUserInput,
    actor: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    if (!this.auditLog || !this.mongoClient) {
      // Programmer error: K10 admin write paths require both audit + tx
      // helpers, which are wired up by users.routes.ts. JIT-only
      // callers (auth flow during slice #2) construct the service
      // without them.
      throw new Error(
        'UsersService.update requires auditLog and mongoClient — ' +
          'instantiate the service via the routes plugin, not directly.',
      );
    }

    // Bind to a local so TypeScript narrowing survives across the async
    // transaction callback below. Without this, every call to
    // `this.auditLog.record(...)` inside the closure would re-widen to
    // `AuditLogService | null` and trip TS2531.
    const auditLog = this.auditLog;

    const actorId = String(actor._id);
    const tenantId = String(actor.organisationId);

    const updated = await this.runInTransaction(async (session) => {
      // ----- Step 1: load target within the tenant -----
      const before = await this.repo.findById(tenantId, id, session);
      if (!before) {
        throw new NotFoundError('User', id);
      }

      const isSelfPatch = String(before._id) === actorId;

      // ----- Step 2: normalize roles for diff (dedupe + stable order) ---
      //
      // The route schema allows duplicate role entries. We canonicalize
      // here so the diff doesn't show spurious "changes" caused by
      // reorder or duplicate input.
      const rolesAfter: UserRole[] =
        patch.roles !== undefined
          ? [...new Set<UserRole>(patch.roles)].sort()
          : [...new Set<UserRole>(before.roles)].sort();
      const rolesBefore: UserRole[] = [...new Set<UserRole>(before.roles)].sort();

      const rolesChanged = patch.roles !== undefined && !arraysEqual(rolesBefore, rolesAfter);
      const isActiveChanged = patch.isActive !== undefined && patch.isActive !== before.isActive;

      // ----- Step 3: guardrails -----
      this.assertNotLockingAdminOut({
        target: before,
        isSelfPatch,
        rolesAfter,
        nextIsActive: patch.isActive ?? before.isActive,
      });

      if (rolesAfter.length === 0) {
        // shared-types schema requires at least one role. We catch this
        // at the service so the error message is friendly.
        throw new BadRequestError('User must have at least one role.');
      }

      // Last-admin guardrail. Runs in the same transaction so a
      // parallel demotion can't sneak past this check. Per-tenant scope
      // (tenant A having ADMINs does not protect tenant B).
      //
      // Trigger only if the target is CURRENTLY an active ADMIN and
      // the patch either removes the ADMIN role or deactivates the
      // account. In either case, the target stops counting toward
      // active-admins, so we ask the repo whether any other admins
      // remain in the tenant.
      const targetWasActiveAdmin = before.isActive && rolesBefore.includes(UserRole.ADMIN);
      const removesAdmin = !rolesAfter.includes(UserRole.ADMIN);
      const deactivates = patch.isActive === false;

      if (targetWasActiveAdmin && (removesAdmin || deactivates)) {
        const remainingAdmins = await this.repo.countActiveAdminsExcluding(tenantId, id, session);
        if (remainingAdmins === 0) {
          throw new BadRequestError(
            'Cannot remove the last active ADMIN. Promote another user to ADMIN first.',
          );
        }
      }

      // ----- Step 4: build patch with audit columns -----
      const now = new Date().toISOString();
      const fullPatch: UserUpdatePatch = {
        ...this.buildRepoPatch(patch, rolesAfter),
        updatedAt: now,
        updatedBy: actorId,
      };

      const after = await this.repo.update(tenantId, id, fullPatch, session);
      if (!after) {
        // Lost-update race: target was soft-deleted between the load
        // and the update. Surface as 404 to be consistent with the
        // load check.
        throw new NotFoundError('User', id);
      }

      // ----- Step 5: emit audit events -----
      //
      // We emit specific events per business action (role grants /
      // revokes, activation flips) so the audit log is queryable and
      // meaningful — not just a sea of generic USER_UPDATED entries.

      // Role changes: one event per added role, one per removed role.
      if (rolesChanged) {
        const added = rolesAfter.filter((r) => !rolesBefore.includes(r));
        const removed = rolesBefore.filter((r) => !rolesAfter.includes(r));

        for (const role of added) {
          await auditLog.record(
            actor,
            request,
            {
              action: 'USER_ROLE_GRANTED',
              target: {
                entityType: 'User',
                entityId: String(after._id),
                snapshot: { email: after.email, displayName: after.displayName },
              },
              description: `Granted role ${role} to "${after.displayName}" (${after.email})`,
              metadata: { role },
            },
            session,
          );
        }

        for (const role of removed) {
          await auditLog.record(
            actor,
            request,
            {
              action: 'USER_ROLE_REVOKED',
              target: {
                entityType: 'User',
                entityId: String(after._id),
                snapshot: { email: after.email, displayName: after.displayName },
              },
              description: `Revoked role ${role} from "${after.displayName}" (${after.email})`,
              severity: 'WARNING',
              metadata: { role },
            },
            session,
          );
        }
      }

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

      // Fallback: any OTHER changed field gets a USER_UPDATED with
      // diff. Not exercised in K10 (route only allows roles +
      // isActive) but wired up so a future K10+ extension doesn't
      // need to revisit.
      const changes = computeShallowDiff(before, after, [
        'updatedAt',
        'updatedBy',
        // Role / isActive changes have their own events above; don't
        // duplicate them in the generic USER_UPDATED diff.
        'roles',
        'isActive',
        // lastLoginAt mutates on every login as fire-and-forget; not a
        // meaningful "admin updated this user" event.
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
      const target = await this.repo.findById(tenantId, id, session);
      if (!target) {
        throw new NotFoundError('User', id);
      }

      if (!target.mfaEnabled) {
        throw new BadRequestError('MFA is not enabled for this user.');
      }

      const now = new Date().toISOString();
      const after = await this.repo.clearMfa(
        tenantId,
        id,
        { updatedAt: now, updatedBy: actorId },
        session,
      );
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
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Convert the public service input into the narrower repository
   * patch. Roles are passed in pre-canonicalized (deduped + sorted) so
   * the stored array is stable for diffing.
   */
  private buildRepoPatch(
    input: UpdateUserInput,
    canonicalRoles: UserRole[],
  ): Omit<UserUpdatePatch, 'updatedAt' | 'updatedBy'> {
    const patch: Omit<UserUpdatePatch, 'updatedAt' | 'updatedBy'> = {};

    if (input.roles !== undefined) patch.roles = canonicalRoles;
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    if (input.firstName !== undefined) patch.firstName = input.firstName;
    if (input.lastName !== undefined) patch.lastName = input.lastName;
    if (input.displayName !== undefined) patch.displayName = input.displayName;
    if (input.organizationalUnit !== undefined) patch.organizationalUnit = input.organizationalUnit;
    if (input.teams !== undefined) patch.teams = input.teams;
    if (input.mustChangePassword !== undefined) patch.mustChangePassword = input.mustChangePassword;
    if (input.preferences !== undefined) patch.preferences = input.preferences;

    return patch;
  }

  /**
   * Self-patch guardrails: an admin cannot lock themselves out by
   * removing their own ADMIN role or deactivating themselves. Either
   * action would require another admin to undo, and in the worst case
   * (sole admin) is unrecoverable without DB access.
   */
  private assertNotLockingAdminOut(args: {
    target: WithId<User>;
    isSelfPatch: boolean;
    rolesAfter: UserRole[];
    nextIsActive: boolean;
  }): void {
    if (!args.isSelfPatch) return;

    const stillHasAdmin = args.rolesAfter.includes(UserRole.ADMIN);
    if (args.target.roles.includes(UserRole.ADMIN) && !stillHasAdmin) {
      throw new BadRequestError(
        'Admins cannot remove their own ADMIN role. Ask another admin to do it.',
      );
    }

    if (args.target.isActive && !args.nextIsActive) {
      throw new BadRequestError('Admins cannot deactivate themselves.');
    }
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
    };
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

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function toApiShape(doc: WithId<User>): Record<string, unknown> {
  return {
    ...doc,
    _id: String(doc._id),
  };
}

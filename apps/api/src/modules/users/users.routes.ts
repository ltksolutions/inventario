// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Users routes — endpoints for user management.
 *
 * Slice #2 scope: `GET /v1/me` — end-to-end verification of the auth
 * stack and JIT provisioning.
 *
 * Slice #3 K10 scope: admin endpoints for user management.
 *   - `GET    /v1/users`      ADMIN — paginated list with filters
 *   - `GET    /v1/users/:id`  ADMIN — single user
 *   - `PATCH  /v1/users/:id`  ADMIN — update isActive (roles → PATCH /v1/memberships/:id)
 *
 * K12b scope: admin MFA reset.
 *   - `DELETE /v1/users/:id/mfa` ADMIN — clear MFA enrollment for a user
 *
 * RBAC matrix:
 *   - `GET /v1/me`            any authenticated user (self)
 *   - `GET /v1/me/export`     any authenticated user (self) — GDPR čl. 20
 *   - `PATCH /v1/me`          any authenticated user (self) — GDPR čl. 16
 *   - admin endpoints         ADMIN only
 *
 * Audit:
 *   PATCH emits `USER_DEACTIVATED` / `USER_REACTIVATED` / `USER_UPDATED`
 *   per the diff. Role events (USER_ROLE_GRANTED/REVOKED) now come from
 *   PATCH /v1/memberships/:id. DELETE /mfa emits `MFA_RESET_BY_ADMIN`.
 */

import { USER_ROLE_VALUES } from '@inventario/shared-types';
import fp from 'fastify-plugin';
import { z } from 'zod';

import { AuditLogRepository } from '../audit/audit.repository.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';

import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

import type { UpdateSelfInput } from './users.service.js';
import type { User } from '@inventario/shared-types';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Filter } from 'mongodb';

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const UserIdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát ID (očakáva sa 24 hex znakov).'),
});

const UserResponseSchema = z.record(z.string(), z.unknown());

const MeResponseSchema = z.object({
  _id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  displayName: z.string(),
  accountType: z.string(),
  roles: z.array(z.string()),
  isActive: z.boolean(),
  lastLoginAt: z.string().nullable(),
  preferences: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

/**
 * Self-service profile update body (GDPR čl. 16).
 *
 * Only the fields a user is permitted to change for themselves.
 * All other fields (roles, email, isActive, …) are intentionally absent
 * from this schema — any extras in the request body are rejected by Zod
 * strict mode (via fastify-type-provider-zod strictness defaults).
 */
const PatchMeBodySchema = z
  .object({
    firstName: z.string().min(1).max(100).trim(),
    lastName: z.string().min(1).max(100).trim(),
    /**
     * If omitted, the server auto-derives `"{firstName} {lastName}"`
     * when either name field is being updated.
     */
    displayName: z.string().min(1).max(200).trim(),
    preferences: z.record(z.string(), z.unknown()),
  })
  .strict()
  .partial()
  .describe(
    'Self-service profile update (GDPR čl. 16); firstName, lastName, displayName, preferences.',
  );

const PatchMeResponseSchema = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------------------
// GDPR export schema
// ---------------------------------------------------------------------------

/**
 * Response schema pre GET /v1/me/export.
 * Lenient — jednotlivé polia (memberships, auditLog) sú pole záznamov
 * s neobmedzenou štruktúrou, preto z.array(z.record(...)).
 */
const ExportResponseSchema = z.object({
  exportedAt: z.string(),
  profile: z.record(z.string(), z.unknown()),
  memberships: z.array(z.record(z.string(), z.unknown())),
  auditLog: z.array(z.record(z.string(), z.unknown())),
});

// ---------------------------------------------------------------------------
// Admin: list / get schemas
// ---------------------------------------------------------------------------

const ListUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  role: z.enum(USER_ROLE_VALUES as unknown as [string, ...string[]]).optional(),
  /**
   * Filter by active flag.
   *
   * NOTE: We DON'T use `z.coerce.boolean()` here because that maps via
   * the JS `Boolean()` constructor — and `Boolean("false") === true`,
   * which would silently invert the filter for any caller passing
   * `?isActive=false`. Instead we accept the string form explicitly,
   * enumerate the accepted truthy / falsy values, and transform.
   */
  isActive: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1')),
  q: z.string().min(1).max(200).trim().optional(),
});

const ListUsersResponseSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  pagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    skip: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});

// ---------------------------------------------------------------------------
// Admin: GDPR cl. 18 restriction body
// ---------------------------------------------------------------------------

/**
 * Body for POST /v1/users/:id/restriction (GDPR Art. 18).
 *
 * `restrict: true`  sets the processing-restriction flag (optional reason).
 * `restrict: false` clears it.
 */
const RestrictionBodySchema = z
  .object({
    restrict: z.boolean(),
    reason: z.string().min(1).max(500).trim().nullable().optional(),
  })
  .describe('Set/clear processing restriction (GDPR Art. 18).');

// ---------------------------------------------------------------------------
// Admin: PATCH body
// ---------------------------------------------------------------------------

/**
 * Admin PATCH body. K10 exposes only `isActive` (and profile fields).
 * Role changes go through PATCH /v1/memberships/:id (ADR-0029 cleanup).
 * An empty body is a no-op (returns 200 with the existing user unchanged).
 */
const UpdateUserBodySchema = z
  .object({
    /** Whether the account is permitted to authenticate. */
    isActive: z.boolean(),
  })
  .partial()
  .describe(
    'Čiastočná aktualizácia používateľa (admin); isActive. Roly → PATCH /v1/memberships/:id.',
  );

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------
//
// NOTE: We wrap the plugin with `fastify-plugin` (`fp`) so the decorator
// `usersService` is registered on the ROOT Fastify instance, not just on
// this plugin's encapsulated scope. Without the wrap, `fastify.usersService`
// would be undefined from any other plugin (e.g. `loadCurrentUser` in
// auth.ts), even though it works from inside this file.

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Wire up dependencies. Service gets full set: audit log + mongoClient
  // for K10 admin write paths. JIT-provisioning (slice #2) still works
  // with these wired up — they're only used on the admin update path.
  // membershipsRepo + auditLogRepo are needed for GDPR export (K??).
  const repo = new UsersRepository(fastify.mongo.db);
  const membershipsRepo = new MembershipsRepository(fastify.mongo.db);
  const auditLogRepo = new AuditLogRepository(fastify.mongo.db);
  const service = new UsersService(
    repo,
    fastify.auditLog,
    fastify.mongo.client,
    membershipsRepo,
    auditLogRepo,
  );

  await repo.ensureIndexes();

  fastify.decorate('usersService', service);

  // RBAC pre-handlers.
  const canAdmin = fastify.requireRole(['ADMIN']);

  // --- GET /v1/me ----------------------------------------------------------
  app.get(
    '/v1/me',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser],
      schema: {
        tags: ['Users'],
        summary: 'Get the currently authenticated user',
        description:
          'Returns the user record corresponding to the JWT bearer. ' +
          'Creates a new user record on first call (JIT provisioning) with the default ' +
          '`EMPLOYEE` role and binds it to the tenant resolved from the JWT `tid` ' +
          'claim. Subsequent calls return the existing record and update `lastLoginAt`.',
        security: [{ bearerAuth: [] }],
        response: {
          200: MeResponseSchema,
        },
      },
    },
    async (request) => {
      const user = request.currentUser;
      // `user.role` (singular) is backfilled from Membership.role by
      // loadCurrentUser (auth.ts). User.roles[] is a legacy stale field
      // (ADR-0029) — always use the backfilled singular role here.
      const membershipRole = (user as unknown as { role: string }).role;
      return {
        _id: String(user._id),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: user.displayName,
        accountType: user.accountType,
        roles: membershipRole ? [membershipRole] : [],
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
        preferences: user.preferences as Record<string, unknown>,
        createdAt: user.createdAt,
      };
    },
  );

  // --- GET /v1/me/export ---------------------------------------------------
  app.get(
    '/v1/me/export',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser],
      schema: {
        tags: ['Users'],
        summary: 'Export personal data (GDPR Art. 20)',
        description:
          'Returns a structured JSON export of all personal data held for the ' +
          'currently authenticated user. Covers: full profile, all tenant memberships, ' +
          'and all audit log entries where the user is the actor. ' +
          'Secrets (passwordHash, mfaSecret, mfaRecoveryCodes) are always excluded. ' +
          'Emits a DATA_EXPORT_REQUESTED audit event (GDPR Art. 30). ' +
          'Any authenticated user may call this endpoint for their own data only.',
        security: [{ bearerAuth: [] }],
        response: {
          200: ExportResponseSchema,
        },
      },
    },
    async (request) => {
      return service.exportSelf(request.currentUser, request);
    },
  );

  // --- PATCH /v1/me --------------------------------------------------------
  app.patch(
    '/v1/me',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser],
      schema: {
        tags: ['Users'],
        summary: 'Update own profile (GDPR Art. 16)',
        description:
          "Self-service partial update of the authenticated user's profile. " +
          'Permitted fields: `firstName`, `lastName`, `displayName`, `preferences`. ' +
          'Forbidden fields (roles, email, isActive, …) are excluded from this schema — ' +
          'include them in the body and they will be rejected with 400. ' +
          'If `firstName` or `lastName` is updated without an explicit `displayName`, ' +
          'the server auto-derives `"{firstName} {lastName}"`. ' +
          'Emits a USER_UPDATED audit event with a diff of changed fields.',
        security: [{ bearerAuth: [] }],
        body: PatchMeBodySchema,
        response: {
          200: PatchMeResponseSchema,
        },
      },
    },
    async (request) => {
      return service.updateSelf(request.body as UpdateSelfInput, request.currentUser, request);
    },
  );

  // --- GET /v1/users -------------------------------------------------------
  app.get(
    '/v1/users',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canAdmin],
      schema: {
        tags: ['Users'],
        summary: 'List users (admin)',
        description:
          'Returns a paginated list of users sorted by displayName. Soft-deleted ' +
          'users are always excluded. Optional filters: role, isActive, q (free-text ' +
          'across email + displayName + firstName + lastName, case-insensitive). ' +
          'Requires ADMIN role.',
        security: [{ bearerAuth: [] }],
        querystring: ListUsersQuerySchema,
        response: {
          200: ListUsersResponseSchema,
        },
      },
    },
    async (request) => {
      const { limit, skip, role, isActive, q } = request.query;

      // Build the filter as a plain record and cast at the end. Mongo's
      // Filter<User> type is strict about array fields (roles) and the
      // $or operator shape, and the three small assignments below are
      // easier to reason about as a flat object than through a series
      // of typed assignments.
      // `role` is passed separately to the service — it maps to
      // Membership.role (authoritative per ADR-0029) via
      // membershipsRepo.findUserIdsByOrganisation(). Do NOT put it
      // into the User filter (User.roles[] is a legacy stale field).
      const filterObj: Record<string, unknown> = {};
      if (isActive !== undefined) {
        filterObj['isActive'] = isActive;
      }
      if (q !== undefined) {
        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = { $regex: escaped, $options: 'i' };
        filterObj['$or'] = [
          { email: re },
          { displayName: re },
          { firstName: re },
          { lastName: re },
        ];
      }

      return service.list(
        { limit, skip, filter: filterObj as Filter<User>, ...(role !== undefined ? { role } : {}) },
        request.currentUser,
      );
    },
  );

  // --- GET /v1/users/:id ---------------------------------------------------
  app.get(
    '/v1/users/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canAdmin],
      schema: {
        tags: ['Users'],
        summary: 'Get a single user by ID (admin)',
        description:
          'Returns one user by _id. 404 if not found or soft-deleted. Requires ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: UserIdParamsSchema,
        response: {
          200: UserResponseSchema,
        },
      },
    },
    async (request) => {
      return service.getById(request.params.id, request.currentUser);
    },
  );

  // --- PATCH /v1/users/:id -------------------------------------------------
  app.patch(
    '/v1/users/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canAdmin],
      schema: {
        tags: ['Users'],
        summary: 'Update a user (admin)',
        description:
          'Partial update of a user. Exposes `isActive` (and profile fields). ' +
          'Role changes go through PATCH /v1/memberships/:id (ADR-0029). ' +
          'Guardrails: admins cannot deactivate themselves, and the last active ' +
          'ADMIN cannot be deactivated (promote another user to ADMIN first). ' +
          'Records USER_DEACTIVATED / USER_REACTIVATED / USER_UPDATED audit events. ' +
          'Requires ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: UserIdParamsSchema,
        body: UpdateUserBodySchema,
        response: {
          200: UserResponseSchema,
        },
      },
    },
    async (request) => {
      return service.update(
        request.params.id,
        request.body as Parameters<typeof service.update>[1],
        request.currentUser,
        request,
      );
    },
  );

  // --- DELETE /v1/users/:id/mfa --------------------------------------------
  app.delete(
    '/v1/users/:id/mfa',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canAdmin],
      schema: {
        tags: ['Users'],
        summary: 'Reset MFA for a user (admin)',
        description:
          'Clears MFA enrollment for the target user. Use when a user has lost access ' +
          'to their authenticator app. The user must re-enroll on next login. ' +
          'Admin cannot reset their own MFA via this endpoint — use POST /v1/auth/mfa/disable. ' +
          'Records MFA_RESET_BY_ADMIN audit event. Requires ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: UserIdParamsSchema,
        response: {
          204: z.null().describe('MFA reset successfully'),
        },
      },
    },
    async (request, reply) => {
      await service.resetMfa(request.params.id, request.currentUser, request);
      return reply.code(204).send(null);
    },
  );

  // --- POST /v1/users/:id/restriction --------------------------------------
  app.post(
    '/v1/users/:id/restriction',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canAdmin],
      schema: {
        tags: ['Users'],
        summary: 'Set or clear processing restriction (admin, GDPR Art. 18)',
        description:
          'Sets (`restrict: true`) or clears (`restrict: false`) the GDPR Art. 18 ' +
          "processing-restriction flag on a user. A restricted user's data is retained " +
          'but further processing is blocked: the auth middleware rejects mutating ' +
          'requests (POST/PATCH/DELETE) with 403 while still allowing reads (GET). ' +
          'Optional `reason` is recorded for compliance. Emits USER_RESTRICTED or ' +
          'USER_UNRESTRICTED audit event. Idempotent calls (already in the requested ' +
          'state) return 400. Requires ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: UserIdParamsSchema,
        body: RestrictionBodySchema,
        response: {
          200: UserResponseSchema,
        },
      },
    },
    async (request) => {
      const { restrict, reason } = request.body;
      return service.setRestriction(
        request.params.id,
        restrict,
        reason ?? null,
        request.currentUser,
        request,
      );
    },
  );
};

// ---------------------------------------------------------------------------
// Fastify decoration declaration
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyInstance {
    usersService: UsersService;
  }
}

export default fp(usersRoutes, {
  name: 'users-routes',
  dependencies: ['mongo', 'audit', 'auth'],
});

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Users routes — endpoints for user management.
 *
 * Slice #2 scope: `GET /v1/me` — end-to-end verification of the auth
 * stack and JIT provisioning.
 *
 * Slice #3 K10 scope: admin endpoints for user management.
 *   - `GET    /v1/users`      ASSET_MANAGER+ADMIN — paginated list with filters
 *   - `GET    /v1/users/:id`  ASSET_MANAGER+ADMIN — single user
 *   - `PATCH  /v1/users/:id`  ADMIN — update isActive, firstName, lastName,
 *                              displayName, email (LOCAL účty len; roles →
 *                              PATCH /v1/memberships/:id)
 *
 * K12b scope: admin MFA reset.
 *   - `DELETE /v1/users/:id/mfa` ADMIN — clear MFA enrollment for a user
 *
 * Osoby/Používatelia merge (2026-07-14): GET /v1/users and GET /v1/users/:id
 * are now also reachable by ASSET_MANAGER (previously ADMIN-only), replacing
 * the standalone "Osoby" module UI. ASSET_MANAGER callers get a trimmed,
 * role-shaped response (toDirectoryShape) — same fields the old
 * GET /v1/users/directory* routes returned, still ADMIN+ASSET_MANAGER below
 * but unused by the frontend since the merge; kept temporarily, slated for
 * removal once verified in production (see docs/sessions/2026-07-14-*).
 *
 * RBAC matrix:
 *   - `GET /v1/me`            any authenticated user (self)
 *   - `GET /v1/me/export`     any authenticated user (self) — GDPR čl. 20
 *   - `PATCH /v1/me`          any authenticated user (self) — GDPR čl. 16
 *   - `GET /v1/users*`        ASSET_MANAGER+ADMIN (response shaped per role)
 *   - other admin endpoints   ADMIN only
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

/**
 * Osoby / person directory ("osobna karta majetku", 2026-07-06).
 *
 * Zamerne oddelene od ListUsersQuerySchema/ListUsersResponseSchema vyssie:
 * tento endpoint je pristupny ASSET_MANAGER-om (nie len ADMIN), takze
 * response smie obsahovat LEN minimalne polia potrebne na identifikaciu
 * osoby a prepojenie na jej vypozicky — nie cely User dokument (ktory
 * obsahuje MFA stav, audit-relevantne polia a pod., vyhradene pre ADMIN
 * cez GET /v1/users).
 */
const DirectoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  q: z.string().min(1).max(200).trim().optional(),
});

const DirectoryItemSchema = z.object({
  _id: z.string(),
  displayName: z.string(),
  email: z.string(),
  role: z.string().nullable(),
  isActive: z.boolean(),
});

const DirectoryListResponseSchema = z.object({
  data: z.array(DirectoryItemSchema),
  pagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    skip: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});

/** Trims a full service-layer user record down to the directory shape. */
function toDirectoryShape(doc: Record<string, unknown>): z.infer<typeof DirectoryItemSchema> {
  const roles = Array.isArray(doc['roles']) ? (doc['roles'] as unknown[]) : [];
  const role = roles.length > 0 ? String(roles[0]) : null;
  return {
    _id: String(doc['_id']),
    displayName: String(doc['displayName'] ?? ''),
    email: String(doc['email'] ?? ''),
    role,
    isActive: Boolean(doc['isActive']),
  };
}

/**
 * Manager-safe projection for GET /v1/users* used when the caller is
 * ASSET_MANAGER (Osoby/Používatelia merge, 2026-07-14). Deliberately NOT
 * the same as toDirectoryShape above (that one backs the now-legacy
 * GET /v1/users/directory* routes, kept temporarily — see task #35 — and
 * frozen so its declared response schema doesn't drift). This shape adds
 * `lastLoginAt` on top of the directory fields: ASSET_MANAGER pre-provisions
 * future employees (ADR-0034) and needs to see the "Očakáva nástup" state,
 * which the old directory endpoint never exposed. Still excludes MFA
 * status, GDPR restriction, entraOid, createdAt, preferences — those stay
 * ADMIN-only.
 */
function toManagerShape(doc: Record<string, unknown>): {
  _id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
  isActive: boolean;
  lastLoginAt: string | null;
} {
  const roles = Array.isArray(doc['roles']) ? (doc['roles'] as unknown[]).map(String) : [];
  return {
    _id: String(doc['_id']),
    displayName: String(doc['displayName'] ?? ''),
    // firstName/lastName added 2026-07-14 (detail+editácia používateľa) —
    // the /users/[id] detail page shows them separately in the header for
    // BOTH roles; no more sensitive than displayName+email already were.
    firstName: String(doc['firstName'] ?? ''),
    lastName: String(doc['lastName'] ?? ''),
    email: String(doc['email'] ?? ''),
    roles,
    isActive: Boolean(doc['isActive']),
    lastLoginAt: doc['lastLoginAt'] == null ? null : String(doc['lastLoginAt']),
  };
}

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
 * Admin PATCH body. Exposes `isActive` and profile fields (firstName,
 * lastName, displayName, email). Role changes go through
 * PATCH /v1/memberships/:id (ADR-0029 cleanup). An empty body is a
 * no-op (returns 200 with the existing user unchanged).
 *
 * `email` (2026-07-14, detail+editácia používateľa): only settable when
 * the target account's `accountType` is `LOCAL` — the service rejects
 * the patch with 400 for OAuth-linked accounts (ENTRA_ID/GOOGLE), whose
 * email is managed by the provider. Must be unique within the caller's
 * organisation; duplicates are rejected with 400.
 *
 * `firstName`/`lastName` without an explicit `displayName` cause the
 * server to auto-derive `displayName` as `"{firstName} {lastName}"`
 * (same behaviour as the self-service PATCH /v1/me).
 */
const UpdateUserBodySchema = z
  .object({
    /** Whether the account is permitted to authenticate. */
    isActive: z.boolean(),
    firstName: z.string().min(1).max(100).trim(),
    lastName: z.string().min(1).max(100).trim(),
    /** Auto-derived from firstName/lastName if omitted — see schema doc above. */
    displayName: z.string().min(1).max(200).trim(),
    /** LOCAL accounts only — see schema doc above. */
    email: z.string().email().toLowerCase().trim(),
  })
  .partial()
  .describe(
    'Čiastočná aktualizácia používateľa (admin); isActive, firstName, lastName, ' +
      'displayName, email (LOCAL účty len). Roly → PATCH /v1/memberships/:id.',
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
  // ASSET_MANAGER + ADMIN — pouzite pre "Osoby" adresar (GET /v1/users/directory*),
  // ktory je zamerne oddeleny od plnych admin GET /v1/users* endpointov nizsie.
  const canManage = fastify.requireRole(['ASSET_MANAGER', 'ADMIN']);

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
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canManage],
      schema: {
        tags: ['Users'],
        summary: 'List users (manager)',
        description:
          'Returns a paginated list of users sorted by displayName. Soft-deleted ' +
          'users are always excluded. Optional filters: role, isActive, q (free-text ' +
          'across email + displayName + firstName + lastName, case-insensitive). ' +
          'Requires ASSET_MANAGER or ADMIN role — but ASSET_MANAGER callers receive a ' +
          'trimmed shape (_id, displayName, firstName, lastName, email, roles, isActive, ' +
          'lastLoginAt), never ' +
          'the full document (MFA state, GDPR restriction flags, etc. stay ADMIN-only). ' +
          'See `toManagerShape` below.',
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
      // membershipsRepo.findRolesByOrganisation(). Do NOT put it
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

      const result = await service.list(
        { limit, skip, filter: filterObj as Filter<User>, ...(role !== undefined ? { role } : {}) },
        request.currentUser,
      );

      // ADMIN sees the full shape (as before). ASSET_MANAGER — newly
      // admitted to this endpoint by the Osoby/Používatelia merge
      // (2026-07-14) — gets the same trimmed shape the old, now-legacy
      // GET /v1/users/directory used to return. See toDirectoryShape().
      if (request.currentUser.role === 'ADMIN') {
        return result;
      }
      return {
        ...result,
        data: result.data.map((doc) => toManagerShape(doc)),
      };
    },
  );

  // --- GET /v1/users/:id ---------------------------------------------------
  app.get(
    '/v1/users/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canManage],
      schema: {
        tags: ['Users'],
        summary: 'Get a single user by ID (manager)',
        description:
          'Returns one user by _id. 404 if not found or soft-deleted. Requires ' +
          'ASSET_MANAGER or ADMIN role — ASSET_MANAGER callers receive the same ' +
          'trimmed shape as the list endpoint (see GET /v1/users above).',
        security: [{ bearerAuth: [] }],
        params: UserIdParamsSchema,
        response: {
          200: UserResponseSchema,
        },
      },
    },
    async (request) => {
      const result = await service.getById(request.params.id, request.currentUser);
      if (request.currentUser.role === 'ADMIN') {
        return result;
      }
      return toManagerShape(result);
    },
  );

  // --- GET /v1/users/directory ----------------------------------------------
  // Minimalisticky zoznam osob ("Osoby" modul) pre ASSET_MANAGER + ADMIN.
  // Zaregistrovany ako STATICKA cesta popri parametrickej /v1/users/:id —
  // find-my-way (Fastify router) uprednostnuje staticke segmenty pred
  // parametrickymi na rovnakej hlbke, takze "directory" sa nikdy
  // nevyhodnoti ako :id (rovnaky overeny vzor ako /v1/loans/my popri
  // /v1/loans/:id).
  app.get(
    '/v1/users/directory',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canManage],
      schema: {
        tags: ['Users'],
        summary: 'List persons directory (manager)',
        description:
          'Minimalny zoznam osob v ramci tenanta (meno, rola, e-mail, aktivita) ' +
          'pre modul "Osoby". Na rozdiel od GET /v1/users nevracia cely User ' +
          'dokument. Vyzaduje ASSET_MANAGER alebo ADMIN.',
        security: [{ bearerAuth: [] }],
        querystring: DirectoryQuerySchema,
        response: {
          200: DirectoryListResponseSchema,
        },
      },
    },
    async (request) => {
      const { limit, skip, q } = request.query;
      const filterObj: Record<string, unknown> = {};
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
      const result = await service.list(
        { limit, skip, filter: filterObj as Filter<User> },
        request.currentUser,
      );
      return {
        data: result.data.map(toDirectoryShape),
        pagination: result.pagination,
      };
    },
  );

  // --- GET /v1/users/directory/:id -------------------------------------------
  app.get(
    '/v1/users/directory/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canManage],
      schema: {
        tags: ['Users'],
        summary: 'Get a person directory entry by ID (manager)',
        description:
          'Minimalny profil jednej osoby (meno, rola, e-mail, aktivita) pre ' +
          '"osobnu kartu majetku". Vyzaduje ASSET_MANAGER alebo ADMIN.',
        security: [{ bearerAuth: [] }],
        params: UserIdParamsSchema,
        response: {
          200: DirectoryItemSchema,
        },
      },
    },
    async (request) => {
      const doc = await service.getById(request.params.id, request.currentUser);
      return toDirectoryShape(doc);
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
          'Partial update of a user. Exposes `isActive`, `firstName`, `lastName`, ' +
          '`displayName`, and `email`. Role changes go through ' +
          'PATCH /v1/memberships/:id (ADR-0029). ' +
          'Guardrails: admins cannot deactivate themselves, the last active ' +
          'ADMIN cannot be deactivated (promote another user to ADMIN first), and ' +
          '`email` can only be changed for LOCAL accounts (400 for OAuth-linked ' +
          'ENTRA_ID/GOOGLE accounts) and must be unique within the organisation ' +
          '(400 on duplicate). ' +
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

/**
 * Organisations routes — admin endpoints for tenant management.
 *
 * RBAC matrix:
 *   - GET    /v1/organisations         ADMIN only — list all tenants
 *   - GET    /v1/organisations/:id     ADMIN only — single tenant
 *   - POST   /v1/organisations         ADMIN only — onboard new tenant
 *   - PATCH  /v1/organisations/:id     ADMIN only — update settings
 *   - DELETE /v1/organisations/:id     ADMIN only — soft-delete (freeze)
 *
 * Why ADMIN-only:
 *   The Organisation collection is platform-level — it sits ABOVE the
 *   tenant scope, not within it. Only Inventario platform operators
 *   (the people running the SaaS) should touch this. A future
 *   "platform admin" role distinct from "tenant admin" may be added
 *   when we differentiate SaaS owner vs in-tenant administrator, but
 *   for now ADMIN covers both since only LTK Solutions has the
 *   role assigned.
 *
 * Slug + entraTenantId immutability:
 *   The route layer does not expose a PATCH endpoint for `slug` or
 *   `entraTenantId` — both are stable identifiers used by JWT
 *   resolution and URL routing. The body schema for PATCH omits them
 *   so even a hand-crafted client cannot try.
 *
 * JIT-provisioned tenants:
 *   Most tenants land in the database via the auth-middleware JIT
 *   path (first SSO request creates the row). These admin endpoints
 *   are for two cases: pre-onboarding a tenant before their first
 *   login, and post-hoc rename/rebrand of an existing tenant.
 */

import { ORGANISATION_PLAN_VALUES, ORGANISATION_STATUS_VALUES } from '@inventario/shared-types';
import fp from 'fastify-plugin';
import { z } from 'zod';

import { OrganisationsRepository } from './organisations.repository.js';
import { OrganisationsService } from './organisations.service.js';

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

/**
 * Path parameter for routes that take an organisation ID.
 * Format: 24-char hex (MongoDB ObjectId).
 */
const OrganisationIdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Neplatný formát ID (očakáva sa 24 hex znakov).'),
});

/**
 * Permissive response shape. We return the full Organisation document;
 * the service has already stripped any sensitive fields (none today,
 * but the type bound stays open for future additions).
 */
const OrganisationResponseSchema = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------------------
// List query schema
// ---------------------------------------------------------------------------

const ListOrganisationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  /** Filter by status (ACTIVE / SUSPENDED / ARCHIVED). */
  status: z.enum(ORGANISATION_STATUS_VALUES as unknown as [string, ...string[]]).optional(),
  /** Filter by plan (FREE / PRO / ENTERPRISE). */
  plan: z.enum(ORGANISATION_PLAN_VALUES as unknown as [string, ...string[]]).optional(),
  /**
   * Include soft-deleted organisations in the result. Default false.
   * Used by admin restore flows and forensic queries.
   *
   * Same `z.enum(['true', 'false', '1', '0'])` pattern as the users
   * routes — `z.coerce.boolean()` would invert "false" → true.
   */
  includeDeleted: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1')),
});

const ListOrganisationsResponseSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  pagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    skip: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});

// ---------------------------------------------------------------------------
// Brand kit sub-schema (matches OrganisationBrandKitSchema in shared-types)
// ---------------------------------------------------------------------------
//
// We duplicate this here rather than importing because the route schema
// has slightly looser semantics on POST (where all fields are optional
// and nullable, server fills defaults) versus PATCH (where the whole
// brand kit can be replaced with `null`).

const HexColorRegex = /^#[0-9a-fA-F]{6}$/;
const HexColorMessage = 'Farba musí byť hex (napr. #1A2D47).';

const BrandKitBodySchema = z
  .object({
    logoUrl: z.string().url().nullable().default(null),
    faviconUrl: z.string().url().nullable().default(null),
    primary: z.string().regex(HexColorRegex, HexColorMessage).nullable().default(null),
    primaryFg: z.string().regex(HexColorRegex, HexColorMessage).nullable().default(null),
    accent: z.string().regex(HexColorRegex, HexColorMessage).nullable().default(null),
    accentFg: z.string().regex(HexColorRegex, HexColorMessage).nullable().default(null),
    fontFamilySans: z.string().max(200).nullable().default(null),
  })
  .strict();

// ---------------------------------------------------------------------------
// Billing sub-schema (matches OrganisationBillingSchema in shared-types)
// ---------------------------------------------------------------------------
//
// Fakturačné a právne údaje tenanta. Všetky polia voliteľné / nullable —
// povinnosť pri platenom plane presadzuje billing flow, nie schéma.
// Duplikujeme tu (rovnako ako brandKit) kvôli looser POST/PATCH sémantike.

const AddressBodySchema = z
  .object({
    street: z.string().min(1).max(200).trim(),
    city: z.string().min(1).max(120).trim(),
    postalCode: z.string().min(1).max(16).trim(),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/, 'Kód krajiny musí byť ISO 3166-1 alpha-2 (napr. SK).')
      .default('SK'),
  })
  .strict();

const BillingBodySchema = z
  .object({
    legalName: z.string().max(200).trim().nullable().default(null),
    ico: z
      .string()
      .regex(/^\d{8}$/, 'IČO musí mať presne 8 číslic.')
      .nullable()
      .default(null),
    dic: z
      .string()
      .regex(/^\d{10}$/, 'DIČ musí mať presne 10 číslic.')
      .nullable()
      .default(null),
    isVatPayer: z.boolean().default(false),
    icDph: z
      .string()
      .transform((val) => val.replace(/\s/g, '').toUpperCase())
      .pipe(z.string().regex(/^SK\d{10}$/, 'IČ DPH musí byť vo formáte SK + 10 číslic.'))
      .nullable()
      .default(null),
    businessRegistration: z.string().max(300).trim().nullable().default(null),
    iban: z
      .string()
      .transform((val) => val.replace(/\s/g, '').toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, 'Neplatný formát IBAN.'))
      .nullable()
      .default(null),
    billingEmail: z.string().email('Neplatná e-mailová adresa.').nullable().default(null),
    registeredAddress: AddressBodySchema.nullable().default(null),
    mailingAddress: AddressBodySchema.nullable().default(null),
  })
  .strict();

// ---------------------------------------------------------------------------
// POST body schema
// ---------------------------------------------------------------------------
//
// Mirrors `CreateOrganisationSchema` from shared-types: slug + entraTenantId
// are required at creation time, status/plan default to ACTIVE/FREE.

const CreateOrganisationBodySchema = z
  .object({
    displayName: z.string().min(1).max(200).trim(),
    /**
     * Tenant URL slug. Lowercase ASCII letters, digits, hyphens, 2-40
     * chars. Cannot start or end with a hyphen. Globally unique.
     */
    slug: z
      .string()
      .min(2)
      .max(40)
      .regex(
        /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/,
        'Slug musí byť 2-40 znakov, lowercase ASCII písmená, číslice a pomlčky.',
      ),
    /**
     * Microsoft Entra ID directory id (UUID). Null for LOCAL-only
     * tenants (e.g. small municipalities without an Azure AD).
     */
    entraTenantId: z.string().uuid('entraTenantId musí byť platný UUID.').nullable().default(null),
    /** Optional custom domain for Pro/Enterprise. */
    customDomain: z
      .string()
      .max(253)
      .regex(
        /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/,
        'Custom doména musí byť platné FQDN.',
      )
      .nullable()
      .default(null),
    status: z
      .enum(ORGANISATION_STATUS_VALUES as unknown as [string, ...string[]])
      .default('ACTIVE'),
    plan: z.enum(ORGANISATION_PLAN_VALUES as unknown as [string, ...string[]]).default('FREE'),
    primaryContactEmail: z.string().email('Neplatná e-mailová adresa.').nullable().default(null),
    brandKit: BrandKitBodySchema.nullable().default(null),
    billing: BillingBodySchema.nullable().default(null),
    settings: z.record(z.string(), z.unknown()).default({}),
  })
  .describe('Telo pre vytvorenie organizácie (tenanta).');

// ---------------------------------------------------------------------------
// PATCH body schema
// ---------------------------------------------------------------------------
//
// Mirrors `UpdateOrganisationSchema` from shared-types: slug +
// entraTenantId are OMITTED (immutable). All other fields optional.

const UpdateOrganisationBodySchema = z
  .object({
    displayName: z.string().min(1).max(200).trim(),
    customDomain: z
      .string()
      .max(253)
      .regex(
        /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/,
        'Custom doména musí byť platné FQDN.',
      )
      .nullable(),
    status: z.enum(ORGANISATION_STATUS_VALUES as unknown as [string, ...string[]]),
    plan: z.enum(ORGANISATION_PLAN_VALUES as unknown as [string, ...string[]]),
    primaryContactEmail: z.string().email('Neplatná e-mailová adresa.').nullable(),
    brandKit: BrandKitBodySchema.nullable(),
    billing: BillingBodySchema.nullable(),
    settings: z.record(z.string(), z.unknown()),
  })
  .partial()
  .describe('Čiastočná aktualizácia organizácie; všetky polia voliteľné.');

// ---------------------------------------------------------------------------
// PATCH /current body schema (tenant self-service)
// ---------------------------------------------------------------------------
//
// Uvedome SAFE subset — tenant ADMIN smie meniť len identitu+billing svojej
// vlastnej org. plan / status / slug / customDomain / authProviders sú
// platform-operator concerns a do tohto endpointu NEpatria.

const UpdateOwnOrganisationBodySchema = z
  .object({
    displayName: z.string().min(1).max(200).trim(),
    primaryContactEmail: z.string().email('Neplatná e-mailová adresa.').nullable(),
    billing: BillingBodySchema.nullable(),
  })
  .partial()
  .describe('Tenant self-service: úprava vlastnej organizácie (názov, kontakt, billing).');

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------
//
// We wrap with fastify-plugin so `organisationsService` becomes a decorator
// on the root Fastify instance, available to the auth middleware for
// tenant resolution on every authenticated request.

const organisationsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const repo = new OrganisationsRepository(fastify.mongo.db);
  const service = new OrganisationsService(
    repo,
    fastify.auditLog,
    fastify.mongo.client,
    fastify.mongo.db,
  );

  await repo.ensureIndexes();

  fastify.decorate('organisationsService', service);

  // RBAC: all organisations endpoints are ADMIN-only.
  const canAdmin = fastify.requireRole(['ADMIN']);

  // Tenant-self read role — any member of the tenant. Used only for the
  // GET /current endpoint; the actor's own organisationId is the key.
  const canReadOwn = fastify.requireRole(['EMPLOYEE', 'ASSET_MANAGER', 'ADMIN', 'EXTERNAL']);

  // --- GET /v1/organisations/current ---------------------------------------
  //
  // Returns the actor's OWN organisation (resolved from their JWT-derived
  // organisationId, never from a URL parameter). Any authenticated member
  // may read it. Registered BEFORE `/:id` so the literal "current" segment
  // wins over the parametric route.
  app.get(
    '/v1/organisations/current',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canReadOwn],
      schema: {
        tags: ['Organisations'],
        summary: 'Get the current tenant (self)',
        description:
          "Returns the authenticated member's own organisation, including " +
          'billing and branding. The organisation id comes from the actor ' +
          'JWT claim, not a URL parameter — a member can only ever read their ' +
          'own tenant.',
        security: [{ bearerAuth: [] }],
        response: {
          200: OrganisationResponseSchema,
        },
      },
    },
    async (request) => {
      return service.getCurrent(String(request.currentUser.organisationId));
    },
  );

  // --- PATCH /v1/organisations/current -------------------------------------
  //
  // Tenant ADMIN updates their OWN organisation. SAFE subset only
  // (displayName, primaryContactEmail, billing). plan / status / slug are
  // platform-operator concerns and are not accepted here. The org id comes
  // from the actor JWT claim — a tenant admin cannot touch another tenant.
  app.patch(
    '/v1/organisations/current',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canAdmin],
      schema: {
        tags: ['Organisations'],
        summary: 'Update the current tenant (self, ADMIN)',
        description:
          "Tenant admin updates their own organisation's name, contact email " +
          'and billing details. plan/status/slug are NOT editable here ' +
          '(platform-operator only). Records an audit event with a per-field ' +
          'diff. Requires ADMIN role within the tenant.',
        security: [{ bearerAuth: [] }],
        body: UpdateOwnOrganisationBodySchema,
        response: {
          200: OrganisationResponseSchema,
        },
      },
    },
    async (request) => {
      return service.updateCurrent(
        String(request.currentUser.organisationId),
        request.body as Parameters<typeof service.updateCurrent>[1],
        request.currentUser,
        request,
      );
    },
  );

  // --- GET /v1/organisations ----------------------------------------------
  app.get(
    '/v1/organisations',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canAdmin],
      schema: {
        tags: ['Organisations'],
        summary: 'List organisations (admin)',
        description:
          'Returns a paginated list of organisations sorted by displayName. ' +
          'Soft-deleted are excluded by default; pass `includeDeleted=true` to ' +
          'see them. Optional filters: status, plan. Requires ADMIN role.',
        security: [{ bearerAuth: [] }],
        querystring: ListOrganisationsQuerySchema,
        response: {
          200: ListOrganisationsResponseSchema,
        },
      },
    },
    async (request) => {
      const { limit, skip, status, plan, includeDeleted } = request.query;

      const filter: Record<string, unknown> = {};
      if (status !== undefined) filter['status'] = status;
      if (plan !== undefined) filter['plan'] = plan;

      return service.list({
        limit,
        skip,
        filter,
        ...(includeDeleted !== undefined ? { includeDeleted } : {}),
      });
    },
  );

  // --- GET /v1/organisations/:id -------------------------------------------
  app.get(
    '/v1/organisations/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canAdmin],
      schema: {
        tags: ['Organisations'],
        summary: 'Get a single organisation by ID (admin)',
        description:
          'Returns one organisation by _id. 404 if not found or soft-deleted. Requires ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: OrganisationIdParamsSchema,
        response: {
          200: OrganisationResponseSchema,
        },
      },
    },
    async (request) => {
      return service.getById(request.params.id);
    },
  );

  // --- POST /v1/organisations ----------------------------------------------
  app.post(
    '/v1/organisations',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canAdmin],
      schema: {
        tags: ['Organisations'],
        summary: 'Create a new organisation (admin onboarding)',
        description:
          'Onboards a new tenant before their first SSO login. Slug + ' +
          'entraTenantId must both be globally unique. The alternative ' +
          'workflow is JIT provisioning on first contact, but explicit ' +
          'creation lets admins configure branding and plan upfront. ' +
          'Requires ADMIN role.',
        security: [{ bearerAuth: [] }],
        body: CreateOrganisationBodySchema,
        response: {
          201: OrganisationResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const created = await service.create(
        request.body as Parameters<typeof service.create>[0],
        request.currentUser,
        request,
      );
      return reply.status(201).send(created);
    },
  );

  // --- PATCH /v1/organisations/:id -----------------------------------------
  app.patch(
    '/v1/organisations/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canAdmin],
      schema: {
        tags: ['Organisations'],
        summary: 'Update an organisation (admin)',
        description:
          'Partial update — only provided fields are changed. Slug and ' +
          'entraTenantId are NOT updatable (stable identifiers). Custom ' +
          'domain uniqueness is revalidated on change. Records an audit ' +
          'event with a per-field diff. Requires ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: OrganisationIdParamsSchema,
        body: UpdateOrganisationBodySchema,
        response: {
          200: OrganisationResponseSchema,
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

  // --- DELETE /v1/organisations/:id ----------------------------------------
  app.delete(
    '/v1/organisations/:id',
    {
      preHandler: [fastify.requireAuth, fastify.loadCurrentUser, canAdmin],
      schema: {
        tags: ['Organisations'],
        summary: 'Soft-delete an organisation (admin)',
        description:
          'Marks the organisation as deleted. Tenant data remains in place ' +
          '(soft-delete is a tombstone, not a purge), but no user from this ' +
          'tenant can log in. Records a WARNING-severity audit event. ' +
          'Requires ADMIN role.',
        security: [{ bearerAuth: [] }],
        params: OrganisationIdParamsSchema,
        response: {
          204: z.null(),
        },
      },
    },
    async (request, reply) => {
      await service.delete(request.params.id, request.currentUser, request);
      return reply.status(204).send(null);
    },
  );
};

// ---------------------------------------------------------------------------
// Fastify decoration declaration
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Organisations service for tenant resolution and admin management.
     *
     * The auth middleware uses `organisationsService.findOrProvisionByEntraTenantId(claims)`
     * on every authenticated request to map the JWT `tid` claim onto an
     * Organisation document, populating `request.organisation` and
     * `request.organisationId` for downstream handlers.
     */
    organisationsService: OrganisationsService;
  }
}

export default fp(organisationsRoutes, {
  name: 'organisations-routes',
  dependencies: ['mongo', 'audit', 'auth'],
});

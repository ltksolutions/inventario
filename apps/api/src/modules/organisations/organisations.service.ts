/**
 * Organisations service — business logic for tenant management.
 *
 * The service has two distinct callers:
 *
 *   1. **Auth middleware** (high-frequency, low-privilege path)
 *      `findOrProvisionByEntraTenantId(tid, request)` is called on every
 *      authenticated request to resolve the actor's tenant from the JWT
 *      `tid` claim. JIT-provisions a new tenant on first contact for an
 *      unknown Entra directory. Returns the Organisation document used
 *      to populate `request.organisation` and `request.organisationId`.
 *
 *   2. **Admin API** (low-frequency, ADMIN-only path)
 *      `list`, `getById`, `create`, `update`, `delete` for the admin
 *      surface. These run inside transactions where appropriate so the
 *      audit log write is atomic with the data mutation.
 *
 * Auth-middleware path constraints:
 *   - No `actor` argument is available — we ARE the auth flow that
 *     resolves the actor. So no audit log entry on the JIT-provision
 *     side; the first user to log in for the new tenant records a
 *     SYSTEM audit entry on their own provisioning instead.
 *   - Fast path is "tenant already exists, return it" — exactly one
 *     index lookup, no transaction overhead.
 *
 * Cross-tenant invariants:
 *   - Slug is globally unique across the platform.
 *   - Entra tenant id is unique-or-null (sparse index).
 *   - Custom domain is unique-or-null (sparse index).
 *
 * Soft-deleted tenants:
 *   - All read methods (`findById`, `findBySlug`, `findByEntraTenantId`)
 *     return null for soft-deleted tenants. A deleted tenant cannot be
 *     resolved by JIT auth — the user gets a clear "tenant unavailable"
 *     401 instead of silently provisioning a new one.
 */

import {
  AuthProvider,
  MemberJoinPolicy,
  OrganisationPlan,
  OrganisationStatus,
  RegistrationMethod,
} from '@inventario/shared-types';

import { seedTenantDefaults } from '../../lib/seed-tenant-defaults.js';
import { BadRequestError, NotFoundError } from '../../plugins/error-handler.js';
import { computeShallowDiff } from '../assets/assets-diff.js';

import type {
  OrganisationsRepository,
  OrganisationUpdatePatch,
  ListOrganisationsParams,
} from './organisations.repository.js';
import type { AuditLogService } from '../audit/audit.service.js';
import type {
  CreateOrganisationInput,
  Organisation,
  UpdateOrganisationInput,
  User,
} from '@inventario/shared-types';
import type { FastifyRequest } from 'fastify';
import type { ClientSession, Db, MongoClient, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface ListOrganisationsResponse {
  data: Record<string, unknown>[];
  pagination: {
    total: number;
    limit: number;
    skip: number;
    hasMore: boolean;
  };
}

/**
 * Claims subset used by the JIT-tenant-provisioning path. We only need
 * the Entra tenant id and (optionally) a display name guess; the rest
 * of the OrganisationSchema fields get sensible defaults.
 *
 * The auth middleware passes these from the validated JWT claims.
 */
export interface TenantProvisionClaims {
  /** Entra directory id (JWT `tid` claim). Required. */
  entraTenantId: string;
  /** Optional human-friendly display name. The middleware may pass
   *  the user's `name` claim here as a best-effort label if the Entra
   *  directory exposes one; otherwise the slug is used as the display
   *  name and admins can rename later. */
  displayNameHint?: string | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OrganisationsService {
  constructor(
    private readonly repo: OrganisationsRepository,
    private readonly auditLog: AuditLogService | null,
    private readonly mongoClient: MongoClient | null,
    private readonly db: Db | null = null,
  ) {}

  // -------------------------------------------------------------------------
  // Auth-middleware path: tenant resolution
  // -------------------------------------------------------------------------

  /**
   * Find an organisation by its Entra tenant id, JIT-provisioning a new
   * one on first contact. Called by the auth middleware on every
   * authenticated request.
   *
   * Concurrency:
   *   Two concurrent first-time requests for the same Entra tenant id
   *   will both attempt to insert. The unique sparse index on
   *   `entraTenantId` makes one of them fail with code 11000; we catch
   *   that and re-query so the loser of the race gets the winner's
   *   document.
   *
   * Soft-delete:
   *   If the tenant exists but is soft-deleted, this returns null. The
   *   auth middleware translates that to a 401 "tenant unavailable"
   *   error rather than silently re-creating the tenant.
   */
  async findOrProvisionByEntraTenantId(
    claims: TenantProvisionClaims,
  ): Promise<WithId<Organisation> | null> {
    // Fast path: tenant already exists.
    const existing = await this.repo.findByEntraTenantId(claims.entraTenantId);
    if (existing) {
      // Tenant exists and is active. Return as-is. The auth middleware
      // will refuse to load users for SUSPENDED tenants if we add that
      // policy later, but the row itself is returned so the middleware
      // can decide.
      return existing;
    }

    // Slow path: provision a new tenant.
    const newOrg = this.buildOrganisationFromClaims(claims);

    try {
      const insertedOrg = await this.repo.insert(newOrg);
      // Seed default taxonomy (types + conditions) for the brand-new
      // tenant. Best-effort: a seed failure must not abort provisioning —
      // the migration runner and a retry on next request will backfill.
      await this.seedDefaultsForTenant(String(insertedOrg._id));
      return insertedOrg;
    } catch (err) {
      // MongoDB error code 11000 = duplicate key. Two concurrent requests
      // for the same first-time Entra tenant raced; the loser re-fetches
      // what the winner inserted.
      if (isDuplicateKeyError(err)) {
        const existingAfterRace = await this.repo.findByEntraTenantId(claims.entraTenantId);
        if (existingAfterRace) return existingAfterRace;
      }
      throw err;
    }
  }

  /**
   * Seed default taxonomy for a newly-created tenant. Best-effort and
   * idempotent (upsert on slug). Requires `db` to be wired (it is, via
   * the routes plugin); if not, seeding is silently skipped so unit
   * tests that construct the service without a db still work.
   */
  private async seedDefaultsForTenant(organisationId: string): Promise<void> {
    if (!this.db) return;
    try {
      await seedTenantDefaults(this.db, organisationId, 'SYSTEM');
    } catch {
      // Best-effort: a seed failure must never break tenant provisioning
      // or login. The migration runner backfills on next deploy, and the
      // upsert is idempotent so a later retry completes the seed.
    }
  }

  /**
   * Build an Organisation document from JIT-provision claims. The slug
   * is derived from the Entra tenant id (deterministic, collision-free
   * because Entra ids are globally unique UUIDs).
   *
   * Initial state:
   *   - status: ACTIVE
   *   - plan: FREE (admin upgrades manually)
   *   - brandKit: null (uses Inventario defaults)
   *   - customDomain: null
   *
   * The display name is best-effort: the Entra `name` claim if the
   * middleware passed one, else a slug-derived placeholder. Admins
   * rename via PATCH later.
   *
   * Tenant id format: lowercase 32 hex characters from the Entra UUID
   * minus the dashes. We avoid hyphens so the slug roundtrip into a
   * URL slug stays clean (Entra UUIDs contain a few "0000..." spans
   * which would otherwise generate "0000-0000-0000" runs).
   */
  private buildOrganisationFromClaims(claims: TenantProvisionClaims): Omit<Organisation, '_id'> {
    const slug = this.slugFromEntraTenantId(claims.entraTenantId);
    const now = new Date().toISOString();

    return {
      displayName: claims.displayNameHint ?? `Organisation ${slug}`,
      slug,
      entraTenantId: claims.entraTenantId,
      customDomain: null,
      status: OrganisationStatus.ACTIVE,
      plan: OrganisationPlan.FREE,
      primaryContactEmail: null,
      brandKit: null,
      billing: null,
      settings: {},
      // Auth + member policy defaults
      allowedAuthProviders: [
        AuthProvider.GOOGLE,
        AuthProvider.APPLE,
        AuthProvider.MICROSOFT,
        AuthProvider.EMAIL,
      ],
      memberJoinPolicy: MemberJoinPolicy.INVITE_ONLY,
      autoJoinDomains: [],
      // Registration: JIT = legacy manual provisioning
      registeredBy: null,
      registrationMethod: RegistrationMethod.MANUAL,
      onboardingCompletedAt: null,
      // DPA: not accepted during JIT provisioning
      dpaAcceptedAt: null,
      dpaAcceptedBy: null,
      // ADR-0021: QR + inventoryNumberFormat — tenant nakonfiguruje cez Settings po onboardingu
      appBaseUrl: null,
      publicAssetLookup: false,
      foundContactInfo: null,
      inventoryNumberFormat: null,
      createdAt: now,
      updatedAt: now,
      createdBy: 'SYSTEM',
      updatedBy: 'SYSTEM',
      deletedAt: null,
      deletedBy: null,
    };
  }

  /**
   * Derive a stable slug from an Entra tenant UUID.
   *
   * Strategy: lowercase the UUID, strip dashes. Output is always 32 hex
   * characters which fits the OrganisationSchema slug regex
   * (`/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/`, 2-40 chars).
   *
   * Example:
   *   Entra tenant `12345678-1234-1234-1234-123456789012`
   *   → slug `12345678123412341234123456789012`
   *
   * Admins can rename the slug later via a separate migration tool —
   * but since slug is unique and immutable through the API, we have
   * to live with the auto-generated form for the lifetime of the
   * tenant. That's acceptable because the slug is not surfaced in
   * URLs that humans type; it's only used as the `data-tenant`
   * attribute and the database join key.
   */
  private slugFromEntraTenantId(entraTenantId: string): string {
    return entraTenantId.toLowerCase().replace(/-/g, '');
  }

  // -------------------------------------------------------------------------
  // Admin API: read paths (no transaction)
  // -------------------------------------------------------------------------

  async list(params: ListOrganisationsParams): Promise<ListOrganisationsResponse> {
    const limit = params.limit ?? 50;
    const skip = params.skip ?? 0;

    const { items, total } = await this.repo.list({ ...params, limit, skip });

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

  async getById(id: string): Promise<Record<string, unknown>> {
    const doc = await this.repo.findById(id);
    if (!doc) {
      throw new NotFoundError('Organisation', id);
    }
    return toApiShape(doc);
  }

  /**
   * Lookup by slug. Used by the marketing/docs frontends and the future
   * tenant-resolver middleware that maps `data-tenant` URL parameters
   * to tenant ids.
   */
  async getBySlug(slug: string): Promise<Record<string, unknown>> {
    const doc = await this.repo.findBySlug(slug);
    if (!doc) {
      throw new NotFoundError('Organisation', `slug=${slug}`);
    }
    return toApiShape(doc);
  }

  // -------------------------------------------------------------------------
  // Tenant-self path: a tenant ADMIN manages their OWN organisation
  // -------------------------------------------------------------------------
  //
  // These mirror getById / update but the organisation id comes from the
  // authenticated actor's `organisationId` claim (resolved by the auth
  // middleware), NOT from a URL parameter. This is the security boundary:
  // a tenant admin can only ever read/write their own tenant row, never
  // another tenant's, because they cannot influence which id is used.

  /**
   * Read the actor's own organisation. Any authenticated member may call
   * this (the settings page shows billing read-only to non-admins via the
   * frontend, but the API returns the full row to any member of the org).
   */
  async getCurrent(organisationId: string): Promise<Record<string, unknown>> {
    const doc = await this.repo.findById(organisationId);
    if (!doc) {
      throw new NotFoundError('Organisation', organisationId);
    }
    return toApiShape(doc);
  }

  /**
   * Update the actor's own organisation. The route layer restricts the
   * patch to a SAFE subset of fields (displayName, primaryContactEmail,
   * billing) — a tenant admin must NOT be able to change their own plan,
   * status, slug, allowedAuthProviders, etc. through this path. Those are
   * platform-operator concerns handled by the admin `/:id` endpoint.
   *
   * Records ORGANISATION_UPDATED with a per-field diff, scoped to the
   * actor's own tenant.
   */
  async updateCurrent(
    organisationId: string,
    patch: UpdateOrganisationInput,
    actor: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    if (!this.auditLog || !this.mongoClient) {
      throw new Error('OrganisationsService.updateCurrent requires auditLog and mongoClient.');
    }
    const auditLog = this.auditLog;
    const actorId = String(actor._id);

    const updated = await this.runInTransaction(async (session) => {
      const before = await this.repo.findById(organisationId, session);
      if (!before) {
        throw new NotFoundError('Organisation', organisationId);
      }

      const now = new Date().toISOString();
      const fullPatch: OrganisationUpdatePatch = {
        ...(patch as OrganisationUpdatePatch),
        updatedAt: now,
        updatedBy: actorId,
      };

      const after = await this.repo.update(organisationId, fullPatch, session);
      if (!after) {
        throw new NotFoundError('Organisation', organisationId);
      }

      const changes = computeShallowDiff(before, after, ['updatedAt', 'updatedBy']);
      if (changes.length > 0) {
        await auditLog.record(
          actor,
          request,
          {
            action: 'ORGANISATION_UPDATED',
            target: {
              entityType: 'Organisation',
              entityId: String(after._id),
              snapshot: {
                displayName: after.displayName,
                slug: after.slug,
                status: after.status,
                plan: after.plan,
              },
            },
            description: `Tenant admin updated own organisation "${after.displayName}" (${changes.length} field${changes.length === 1 ? '' : 's'} changed)`,
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
  // Admin API: write paths (transactional)
  // -------------------------------------------------------------------------

  /**
   * Admin-create an organisation. Used by platform owners to onboard
   * a new tenant ahead of their first SSO login (the alternative is
   * JIT provisioning on first contact, but explicit creation lets
   * admins configure branding/plan upfront).
   *
   * Slug + entraTenantId uniqueness is enforced by the unique indexes;
   * collisions surface as BadRequestError with a clear message.
   */
  async create(
    input: CreateOrganisationInput,
    actor: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    if (!this.auditLog || !this.mongoClient) {
      throw new Error(
        'OrganisationsService.create requires auditLog and mongoClient — ' +
          'instantiate via the routes plugin.',
      );
    }
    const auditLog = this.auditLog;
    const actorId = String(actor._id);

    const inserted = await this.runInTransaction(async (session) => {
      // ----- Step 1: uniqueness pre-checks for friendlier errors ------
      //
      // The unique indexes are the source of truth — these reads are
      // defensive so the caller gets a "slug already exists" message
      // instead of a generic Mongo duplicate-key error. Race conditions
      // are still handled by the unique index at insert time.
      const slugCollision = await this.repo.findBySlug(input.slug, session);
      if (slugCollision) {
        throw new BadRequestError(`Organisation slug "${input.slug}" already exists.`);
      }

      if (input.entraTenantId !== null) {
        const entraCollision = await this.repo.findByEntraTenantId(input.entraTenantId, session);
        if (entraCollision) {
          throw new BadRequestError(
            `Organisation for Entra tenant ${input.entraTenantId} already exists.`,
          );
        }
      }

      // ----- Step 2: build document with audit fields ----
      const now = new Date().toISOString();
      const doc: Omit<Organisation, '_id'> = {
        ...input,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
        deletedAt: null,
        deletedBy: null,
      };

      // ----- Step 3: insert + audit ----
      const insertedDoc = await this.repo.insert(doc, session);

      await auditLog.record(
        actor,
        request,
        {
          action: 'ORGANISATION_CREATED',
          target: {
            entityType: 'Organisation',
            entityId: String(insertedDoc._id),
            snapshot: {
              displayName: insertedDoc.displayName,
              slug: insertedDoc.slug,
              status: insertedDoc.status,
              plan: insertedDoc.plan,
            },
          },
          description: `Created organisation "${insertedDoc.displayName}" (slug: ${insertedDoc.slug})`,
        },
        session,
      );

      return insertedDoc;
    });

    // Seed default taxonomy for the newly-created tenant (best-effort,
    // outside the create transaction so a seed hiccup doesn't roll back
    // the org). Idempotent upsert — safe even if retried.
    await this.seedDefaultsForTenant(String(inserted._id));

    return toApiShape(inserted);
  }

  /**
   * Admin-update an organisation. Slug and entraTenantId cannot be
   * updated through this endpoint — they are stable identifiers and
   * renaming them requires a separate migration.
   *
   * Records ORGANISATION_UPDATED with per-field diff.
   */
  async update(
    id: string,
    patch: UpdateOrganisationInput,
    actor: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    if (!this.auditLog || !this.mongoClient) {
      throw new Error('OrganisationsService.update requires auditLog and mongoClient.');
    }
    const auditLog = this.auditLog;
    const actorId = String(actor._id);

    const updated = await this.runInTransaction(async (session) => {
      // ----- Step 1: load current doc ----
      const before = await this.repo.findById(id, session);
      if (!before) {
        throw new NotFoundError('Organisation', id);
      }

      // ----- Step 2: custom-domain collision check (only if changing) -
      if (
        patch.customDomain !== undefined &&
        patch.customDomain !== null &&
        patch.customDomain !== before.customDomain
      ) {
        const collision = await this.repo.findByCustomDomain(patch.customDomain, session);
        if (collision && String(collision._id) !== id) {
          throw new BadRequestError(
            `Custom domain "${patch.customDomain}" is already in use by another organisation.`,
          );
        }
      }

      // ----- Step 3: apply patch with audit fields ----
      const now = new Date().toISOString();
      const fullPatch: OrganisationUpdatePatch = {
        ...(patch as OrganisationUpdatePatch),
        updatedAt: now,
        updatedBy: actorId,
      };

      const after = await this.repo.update(id, fullPatch, session);
      if (!after) {
        throw new NotFoundError('Organisation', id);
      }

      // ----- Step 4: diff + audit (only if real changes) ----
      const changes = computeShallowDiff(before, after, ['updatedAt', 'updatedBy']);
      if (changes.length > 0) {
        await auditLog.record(
          actor,
          request,
          {
            action: 'ORGANISATION_UPDATED',
            target: {
              entityType: 'Organisation',
              entityId: String(after._id),
              snapshot: {
                displayName: after.displayName,
                slug: after.slug,
                status: after.status,
                plan: after.plan,
              },
            },
            description: `Updated organisation "${after.displayName}" (${changes.length} field${changes.length === 1 ? '' : 's'} changed)`,
            changes,
          },
          session,
        );
      }

      return after;
    });

    return toApiShape(updated);
  }

  /**
   * Soft-delete an organisation. Records ORGANISATION_DELETED with
   * severity WARNING because tenant deletion is a high-impact action
   * that freezes all of the tenant's data.
   *
   * Defense in depth: this method does NOT cascade-delete the tenant's
   * scoped data (assets, categories, locations, users, audit logs).
   * Those rows remain in the database with their organisationId
   * pointing at the deleted tenant — soft-delete is a tombstone, not
   * a purge. A separate cleanup tool handles eventual purging if
   * required (legal hold, GDPR right to erasure).
   */
  async delete(id: string, actor: WithId<User>, request: FastifyRequest): Promise<void> {
    if (!this.auditLog || !this.mongoClient) {
      throw new Error('OrganisationsService.delete requires auditLog and mongoClient.');
    }
    const auditLog = this.auditLog;
    const actorId = String(actor._id);

    await this.runInTransaction(async (session) => {
      const existing = await this.repo.findById(id, session);
      if (!existing) {
        throw new NotFoundError('Organisation', id);
      }

      const deleted = await this.repo.softDelete(id, actorId, session);
      if (!deleted) {
        // Race: was deleted between findById and softDelete.
        throw new NotFoundError('Organisation', id);
      }

      await auditLog.record(
        actor,
        request,
        {
          action: 'ORGANISATION_DELETED',
          target: {
            entityType: 'Organisation',
            entityId: String(deleted._id),
            snapshot: {
              displayName: deleted.displayName,
              slug: deleted.slug,
              status: deleted.status,
            },
          },
          description: `Soft-deleted organisation "${deleted.displayName}" (slug: ${deleted.slug}). Tenant data remains in place but no user can log in.`,
          severity: 'WARNING',
        },
        session,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Transaction helper (mirrors other services)
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
// Helpers
// ---------------------------------------------------------------------------

function toApiShape(doc: WithId<Organisation>): Record<string, unknown> {
  return {
    ...doc,
    _id: String(doc._id),
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 11000
  );
}

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Locations service — business logic for location management.
 *
 * Mirrors `CategoriesService` precisely. The pattern is intentional:
 * both resources are slug-keyed, hierarchical, soft-deleted, audit-logged,
 * and tenant-scoped. Sharing the contract means the frontend can treat
 * them uniformly and the slugify + hierarchy utilities serve both
 * without per-module forks.
 *
 * Responsibilities:
 *   - Set audit fields (createdAt/updatedAt/createdBy/updatedBy)
 *   - Compute diffs for audit log on update
 *   - Wrap state-changing ops in transactions (location write + audit atomic)
 *   - Reject slug collisions on create and on slug-changing patches
 *
 * Phase C Blok 2:
 *   Every repository call takes `organisationId` as the first argument.
 *   The service threads it through from `actor.organisationId`. Slug
 *   uniqueness is per-tenant. Cross-tenant access surfaces as
 *   404/BadRequest depending on the operation.
 *
 * Slug handling (same semantics as categories — see categories.service.ts):
 *   POST: slug optional, derived from `name` with NFD diacritics stripping
 *   and silent `-2`, `-3` suffixing on collision within the tenant.
 *   Client-supplied slug is strict on collision (400, no rewrite).
 *
 *   PATCH: slug updated only if client sends it explicitly. Rename via
 *   `name` does NOT regenerate slug — URLs stay stable.
 *
 * Hierarchy handling (same as categories):
 *   POST and PATCH both run depth + corrupt-tree checks within the
 *   tenant. PATCH that changes parentId also runs cycle detection.
 *   No-op parentId patches skip the traversal. MAX_HIERARCHY_DEPTH = 4
 *   (root + 4 nested = 5 total levels).
 */

import {
  checkHierarchyOnReparent,
  MAX_HIERARCHY_DEPTH,
  type HierarchyCheckResult,
  type ParentLookup,
} from '../../lib/hierarchy.js';
import { isValidSlug, slugify, slugWithSuffix } from '../../lib/slugify.js';
import { BadRequestError, NotFoundError } from '../../plugins/error-handler.js';
import { computeShallowDiff } from '../assets/assets-diff.js';

import type { LocationsRepository, LocationUpdatePatch } from './locations.repository.js';
import type { AssetsRepository } from '../assets/assets.repository.js';
import type { AuditLogService } from '../audit/audit.service.js';
import type { CreateLocationInput, Location, User } from '@inventario/shared-types';
import type { FastifyRequest } from 'fastify';
import type { ClientSession, Filter, MongoClient, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface ListLocationsResponse {
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
 * pagination/filter knobs only.
 */
export interface ListLocationsServiceParams {
  limit?: number;
  skip?: number;
  filter?: Filter<Location>;
}

/**
 * Service-layer input for creating a location. Differs from
 * `CreateLocationInput` (shared-types) by making `slug` optional —
 * if absent, the service derives one from `name`.
 */
export type CreateLocationServiceInput = Omit<CreateLocationInput, 'slug'> & {
  slug?: string | undefined;
};

/**
 * Service-layer input for updating a location. Mirrors the categories
 * pattern: `{ [K in writable_keys]?: Location[K] | undefined }` for
 * compatibility with Zod `.partial()` under exactOptionalPropertyTypes.
 *
 * `organisationId` is intentionally excluded — tenant scope is
 * immutable post creation.
 */
export type UpdateLocationInput = {
  [
    K in keyof Omit<
      Location,
      | '_id'
      | 'organisationId'
      | 'createdAt'
      | 'updatedAt'
      | 'createdBy'
      | 'updatedBy'
      | 'deletedAt'
      | 'deletedBy'
    >
  ]?: Location[K] | undefined;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class LocationsService {
  constructor(
    private readonly repo: LocationsRepository,
    private readonly auditLog: AuditLogService,
    private readonly mongoClient: MongoClient,
    private readonly assetsRepo: AssetsRepository,
  ) {}

  // -------------------------------------------------------------------------
  // Read paths (no transaction)
  // -------------------------------------------------------------------------

  async list(
    params: ListLocationsServiceParams,
    actor: WithId<User>,
  ): Promise<ListLocationsResponse> {
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
      throw new NotFoundError('Location', id);
    }
    return toApiShape(doc);
  }

  // -------------------------------------------------------------------------
  // Write paths (transactional)
  // -------------------------------------------------------------------------

  async create(
    input: CreateLocationServiceInput,
    user: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    const userId = String(user._id);
    const tenantId = String(user.organisationId);

    const inserted = await this.runInTransaction(async (session) => {
      // ----- Step 1: resolve slug (client-provided OR auto-derived) -----
      const resolvedSlug = await this.resolveSlugForCreate(tenantId, input, session);

      // ----- Step 2: parent existence + hierarchy check -----
      if (input.parentId !== null) {
        const parent = await this.repo.findById(tenantId, input.parentId, session);
        if (!parent) {
          throw new BadRequestError(`Parent location ${input.parentId} does not exist.`);
        }

        const hierarchyResult = await checkHierarchyOnReparent(
          null, // editedId = null on create
          input.parentId,
          this.makeParentLookup(tenantId, session),
        );
        this.assertHierarchyOk(hierarchyResult);
      }

      // ----- Step 3: build document with audit fields -----
      const now = new Date().toISOString();
      const doc: Omit<Location, '_id'> = {
        ...input,
        organisationId: tenantId,
        slug: resolvedSlug,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
        deletedAt: null,
        deletedBy: null,
      };

      // ----- Step 4: insert + audit -----
      const insertedDoc = await this.repo.insert(doc, session);

      await this.auditLog.record(
        user,
        request,
        {
          action: 'LOCATION_CREATED',
          target: {
            entityType: 'Location',
            entityId: String(insertedDoc._id),
            snapshot: {
              name: insertedDoc.name,
              slug: insertedDoc.slug,
              type: insertedDoc.type,
            },
          },
          description: `Created location "${insertedDoc.name}" (slug: ${insertedDoc.slug})`,
        },
        session,
      );

      return insertedDoc;
    });

    return toApiShape(inserted);
  }

  /**
   * Resolve which slug to store on insert. Tenant-scoped: collisions
   * are checked within the actor's tenant only. See
   * categories.service.ts for the rationale — same logic applies here.
   */
  private async resolveSlugForCreate(
    tenantId: string,
    input: CreateLocationServiceInput,
    session: ClientSession,
  ): Promise<string> {
    // -- Path A: client supplied a slug -------------------------------------
    if (input.slug !== undefined && input.slug !== '') {
      if (!isValidSlug(input.slug)) {
        throw new BadRequestError(
          `Slug "${input.slug}" is not in the expected format (lowercase letters, digits, hyphens).`,
        );
      }

      const collision = await this.repo.findBySlug(tenantId, input.slug, session);
      if (collision) {
        throw new BadRequestError(
          `Slug "${input.slug}" already exists (location ${String(collision._id)}).`,
        );
      }
      return input.slug;
    }

    // -- Path B: derive from name + auto-suffix -----------------------------
    const base = slugify(input.name);
    if (base === '') {
      throw new BadRequestError(
        `Cannot derive a slug from name "${input.name}". Supply a slug explicitly.`,
      );
    }

    const MAX_ATTEMPTS = 100;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = attempt === 0 ? base : slugWithSuffix(base, attempt + 1);
      const collision = await this.repo.findBySlug(tenantId, candidate, session);
      if (!collision) return candidate;
    }

    throw new BadRequestError(
      `Could not derive a free slug from "${input.name}" after ${MAX_ATTEMPTS} attempts. Supply a slug explicitly.`,
    );
  }

  async update(
    id: string,
    patch: UpdateLocationInput,
    user: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    const userId = String(user._id);
    const tenantId = String(user.organisationId);

    const updated = await this.runInTransaction(async (session) => {
      // ----- Step 1: load current doc -----
      const before = await this.repo.findById(tenantId, id, session);
      if (!before) {
        throw new NotFoundError('Location', id);
      }

      // ----- Step 2: slug collision check (only if slug is changing) -----
      if (patch.slug !== undefined && patch.slug !== before.slug) {
        const slugCollision = await this.repo.findBySlug(tenantId, patch.slug, session);
        if (slugCollision && String(slugCollision._id) !== id) {
          throw new BadRequestError(
            `Slug "${patch.slug}" already exists (location ${String(slugCollision._id)}).`,
          );
        }
      }

      // ----- Step 3: parent existence + hierarchy check (only if changing) -----
      if (
        patch.parentId !== undefined &&
        patch.parentId !== before.parentId &&
        patch.parentId !== null
      ) {
        if (patch.parentId === id) {
          throw new BadRequestError('A location cannot be its own parent.');
        }
        const parent = await this.repo.findById(tenantId, patch.parentId, session);
        if (!parent) {
          throw new BadRequestError(`Parent location ${patch.parentId} does not exist.`);
        }

        const hierarchyResult = await checkHierarchyOnReparent(
          id,
          patch.parentId,
          this.makeParentLookup(tenantId, session),
        );
        this.assertHierarchyOk(hierarchyResult);
      }

      // ----- Step 4: apply patch with audit fields -----
      const now = new Date().toISOString();
      const fullPatch: LocationUpdatePatch = {
        ...(patch as LocationUpdatePatch),
        updatedAt: now,
        updatedBy: userId,
      };

      const after = await this.repo.update(tenantId, id, fullPatch, session);
      if (!after) {
        throw new NotFoundError('Location', id);
      }

      // ----- Step 5: diff + audit (only if real changes) -----
      const changes = computeShallowDiff(before, after, ['updatedAt', 'updatedBy']);
      if (changes.length > 0) {
        await this.auditLog.record(
          user,
          request,
          {
            action: 'LOCATION_UPDATED',
            target: {
              entityType: 'Location',
              entityId: String(after._id),
              snapshot: {
                name: after.name,
                slug: after.slug,
              },
            },
            description: `Updated location "${after.name}" (${changes.length} field${changes.length === 1 ? '' : 's'} changed)`,
            changes,
          },
          session,
        );
      }

      return after;
    });

    return toApiShape(updated);
  }

  async delete(id: string, user: WithId<User>, request: FastifyRequest): Promise<void> {
    const userId = String(user._id);
    const tenantId = String(user.organisationId);

    await this.runInTransaction(async (session) => {
      // ----- Step 1: load -----
      const existing = await this.repo.findById(tenantId, id, session);
      if (!existing) {
        throw new NotFoundError('Location', id);
      }

      // ----- Step 2: tree integrity — refuse if has children -----
      const childCount = await this.repo.countChildren(tenantId, id, session);
      if (childCount > 0) {
        throw new BadRequestError(
          `Cannot delete location "${existing.name}": ${childCount} child location${childCount === 1 ? '' : 's'} would be orphaned. Reparent or delete children first.`,
        );
      }

      // ----- Step 2b: FK integrity — refuse if assets reference this location -----
      //
      // Slice #3 K9: assets carry locationId. Removing the location here
      // would leave those assets pointing at a deleted document. Block
      // the delete with a count surfaced in the message.
      const assetCount = await this.assetsRepo.countByLocation(tenantId, id, session);
      if (assetCount > 0) {
        throw new BadRequestError(
          `Cannot delete location "${existing.name}": ${assetCount} asset${assetCount === 1 ? '' : 's'} reference${assetCount === 1 ? 's' : ''} it. Reassign or delete those assets first.`,
        );
      }

      // ----- Step 3: soft-delete -----
      const deleted = await this.repo.softDelete(tenantId, id, userId, session);
      if (!deleted) {
        throw new NotFoundError('Location', id);
      }

      // ----- Step 4: audit -----
      await this.auditLog.record(
        user,
        request,
        {
          action: 'LOCATION_DELETED',
          target: {
            entityType: 'Location',
            entityId: String(deleted._id),
            snapshot: {
              name: deleted.name,
              slug: deleted.slug,
            },
          },
          description: `Soft-deleted location "${deleted.name}" (slug: ${deleted.slug})`,
          severity: 'WARNING',
        },
        session,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Hierarchy helpers
  // -------------------------------------------------------------------------

  private makeParentLookup(tenantId: string, session: ClientSession): ParentLookup {
    return async (id: string) => {
      const doc = await this.repo.findById(tenantId, id, session);
      if (!doc) return undefined;
      return doc.parentId;
    };
  }

  private assertHierarchyOk(result: HierarchyCheckResult): void {
    if (result.kind === 'ok') return;

    if (result.kind === 'cycle') {
      throw new BadRequestError(
        `This parent assignment would create a cycle (chain via ${result.chain.join(' -> ')}).`,
      );
    }

    if (result.kind === 'too-deep') {
      throw new BadRequestError(
        `This parent assignment would exceed the maximum hierarchy depth of ${MAX_HIERARCHY_DEPTH + 1} levels (root + ${MAX_HIERARCHY_DEPTH} nested).`,
      );
    }

    // corrupt-tree
    throw new BadRequestError(
      `Detected pre-existing cycle in the location tree at node ${result.revisitedId} (chain: ${result.chain.join(' -> ')}). Please report this to an administrator.`,
    );
  }

  // -------------------------------------------------------------------------
  // Transaction helper
  // -------------------------------------------------------------------------

  private async runInTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
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

function toApiShape(doc: WithId<Location>): Record<string, unknown> {
  return {
    ...doc,
    _id: String(doc._id),
  };
}

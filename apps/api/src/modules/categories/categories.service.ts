/**
 * Categories service — business logic for category management.
 *
 * Responsibilities:
 *   - Set audit fields (createdAt/updatedAt/createdBy/updatedBy)
 *   - Compute diffs for audit log on update
 *   - Wrap state-changing ops in transactions (category write + audit atomic)
 *   - Reject slug collisions on create and on slug-changing patches
 *
 * Phase C Blok 2 changes:
 *   Every repository call now takes `organisationId` as the first
 *   argument. The service threads it through from `actor.organisationId`
 *   so the repository can enforce tenant scoping in filters and unique
 *   indexes. Slug uniqueness becomes per-tenant: two tenants can each
 *   have a category with slug "it-vybavenie" without collision.
 *
 * Slug handling (K3 scope):
 *   POST: slug is OPTIONAL in the request body. The service derives one
 *   from `name` via the slugify utility (diacritics stripped, lowercased,
 *   non-alphanumeric runs collapsed to hyphens). If the derived slug
 *   already exists within the tenant, the service tries `slug-2`,
 *   `slug-3`, ... until it finds one that's free. This auto-suffixing
 *   is silent — the client never sees a collision error for auto-
 *   generated slugs.
 *
 *   If the client DOES supply a slug explicitly, it's used as-is. A
 *   collision then throws 400 (client must resolve, the server doesn't
 *   silently rewrite client input).
 *
 *   PATCH: slug is updated only if the client explicitly sends one.
 *   Renaming via `name` does NOT regenerate the slug — URLs stay stable.
 *
 * Hierarchy handling (K4 scope):
 *   `parentId` forms a tree within a tenant. Both POST and PATCH check:
 *     - parent existence (if non-null) within the same tenant
 *     - max depth (CATEGORY_MAX_DEPTH = 1 → presne 2 úrovne: root +
 *       jeho priame deti = hodnoty; vnuk je odmietnutý)
 *     - cycle prevention on PATCH (the proposed parent must not have the
 *       edited category in its ancestor chain)
 *     - detection of pre-existing cycles in the DB (returns 400 with a
 *       distinct message so admins can investigate)
 *
 *   Traversal logic lives in `src/lib/hierarchy.ts` — pure, testable in
 *   isolation. The service wires it up by passing a session-aware
 *   ParentLookup callback that calls `repo.findById` inside the
 *   transaction.
 *
 * Zlúčený číselník (2026-06-08):
 *   Kategórie sú JEDINÝ klasifikačný číselník — root kategórie plnia
 *   rolu bývalých "typov majetku" a slúžia len na zoskupenie. Majetok
 *   sa zaraďuje výhradne do podkategórií (vynucuje AssetsService).
 */

import {
  checkHierarchyOnReparent,
  type HierarchyCheckResult,
  type ParentLookup,
} from '../../lib/hierarchy.js';
import { isValidSlug, slugify, slugWithSuffix } from '../../lib/slugify.js';
import { BadRequestError, NotFoundError } from '../../plugins/error-handler.js';
import { computeShallowDiff } from '../assets/assets-diff.js';

import type { CategoriesRepository, CategoryUpdatePatch } from './categories.repository.js';
import type { AssetsRepository } from '../assets/assets.repository.js';
import type { AuditLogService } from '../audit/audit.service.js';
import type { Category, CreateCategoryInput, User } from '@inventario/shared-types';
import type { FastifyRequest } from 'fastify';
import type { ClientSession, Filter, MongoClient, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximálna hĺbka stromu kategórií: presne 2 úrovne — ROOT (depth 0) a
 * jeho priame deti = HODNOTY (depth 1). Vnuk (depth 2) je odmietnutý.
 *
 * Pozn.: lokality používajú spoločnú `MAX_HIERARCHY_DEPTH` z hierarchy.ts;
 * kategórie majú vlastný, prísnejší limit nezávisle od lokalít.
 */
const CATEGORY_MAX_DEPTH = 1;

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface ListCategoriesResponse {
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
 * inferred from the actor and threaded through; callers pass pagination
 * and filter knobs only.
 */
export interface ListCategoriesServiceParams {
  limit?: number;
  skip?: number;
  filter?: Filter<Category>;
}

/**
 * Service-layer input for creating a category.
 *
 * Differs from `CreateCategoryInput` (shared-types) by making `slug` optional.
 * If omitted, the service derives it from `name` via slugify() and resolves
 * collisions by appending numeric suffixes (`-2`, `-3`, ...). The route layer
 * is responsible for normalizing `request.body.slug === ''` to undefined if
 * needed; the service treats `undefined` as "derive me one".
 */
export type CreateCategoryServiceInput = Omit<CreateCategoryInput, 'slug'> & {
  slug?: string | undefined;
};

/**
 * Service-layer input for updating a category. Mirrors `UpdateCategoryInput`
 * if we had one in shared-types; for now we accept a partial of the writable
 * fields, omitting audit + identity columns the service controls.
 *
 * `organisationId` is intentionally excluded from this surface — tenant
 * scope is immutable post creation.
 *
 * Note on `| undefined` in each field type: with TS `exactOptionalPropertyTypes`
 * enabled, `{ name?: string }` and `{ name?: string | undefined }` are
 * distinct types. The Zod `.partial()` schema produces the latter; the
 * service signature must match.
 */
export type UpdateCategoryInput = {
  [K in keyof Omit<
    Category,
    | '_id'
    | 'organisationId'
    | 'createdAt'
    | 'updatedAt'
    | 'createdBy'
    | 'updatedBy'
    | 'deletedAt'
    | 'deletedBy'
  >]?: Category[K] | undefined;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CategoriesService {
  constructor(
    private readonly repo: CategoriesRepository,
    private readonly auditLog: AuditLogService,
    private readonly mongoClient: MongoClient,
    private readonly assetsRepo: AssetsRepository,
  ) {}

  // -------------------------------------------------------------------------
  // Read paths (no transaction)
  // -------------------------------------------------------------------------

  async list(
    params: ListCategoriesServiceParams,
    actor: WithId<User>,
  ): Promise<ListCategoriesResponse> {
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
      throw new NotFoundError('Category', id);
    }
    return toApiShape(doc);
  }

  // -------------------------------------------------------------------------
  // Write paths (transactional)
  // -------------------------------------------------------------------------

  /**
   * Create a new category within the actor's tenant.
   *
   * Slug resolution (see service docstring for full semantics):
   *   - If `input.slug` is provided, validate format, then enforce
   *     uniqueness within the tenant (throw 400 on collision).
   *   - If `input.slug` is absent, derive from `input.name` via
   *     slugify(). If the derived base collides within the tenant, try
   *     `${base}-2`, `${base}-3`, ... transparently. If the name
   *     slugifies to an empty string (e.g. all non-Latin script), throw
   *     400 — client must supply a slug.
   *
   * Parent existence is checked if `parentId` is non-null. Cross-tenant
   * parent references return 400 "parent does not exist" because the
   * findById call passes tenantId.
   *
   * Records a `CATEGORY_CREATED` audit event atomically with the insert.
   */
  async create(
    input: CreateCategoryServiceInput,
    user: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    const userId = String(user._id);
    const tenantId = String(user.organisationId);

    const inserted = await this.runInTransaction(async (session) => {
      // ----- Step 1: resolve slug (client-provided OR auto-derived) -----
      const resolvedSlug = await this.resolveSlugForCreate(tenantId, input, session);

      // ----- Step 2: parent existence check (if applicable) -----
      if (input.parentId !== null) {
        const parent = await this.repo.findById(tenantId, input.parentId, session);
        if (!parent) {
          throw new BadRequestError(`Parent category ${input.parentId} does not exist.`);
        }

        // ----- Step 2b: depth check (no cycle possible — the new node
        //               doesn't exist yet, so it can't be in any chain) -----
        const hierarchyResult = await checkHierarchyOnReparent(
          null, // editedId = null on create
          input.parentId,
          this.makeParentLookup(tenantId, session),
          CATEGORY_MAX_DEPTH,
        );
        this.assertHierarchyOk(hierarchyResult);
      }

      // ----- Step 3: build document with audit fields -----
      const now = new Date().toISOString();
      const doc: Omit<Category, '_id'> = {
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
          action: 'CATEGORY_CREATED',
          target: {
            entityType: 'Category',
            entityId: String(insertedDoc._id),
            snapshot: {
              name: insertedDoc.name,
              slug: insertedDoc.slug,
              parentId: insertedDoc.parentId,
            },
          },
          description: `Created category "${insertedDoc.name}" (slug: ${insertedDoc.slug})`,
        },
        session,
      );

      return insertedDoc;
    });

    return toApiShape(inserted);
  }

  /**
   * Resolve which slug to store on insert. Tenant-scoped: collisions
   * are checked within the actor's tenant only.
   *
   * Strategy:
   *   - Client provided slug: must be valid format and unique within
   *     the tenant. Collision surfaces as 400.
   *   - Client omitted slug: derive `slugify(name)` as the base. Probe
   *     base, base-2, base-3, ... within the tenant until a free slug
   *     is found. Stops at 100 attempts to avoid infinite loops.
   *
   * Runs inside the caller's transaction so the read-then-write window
   * is protected against concurrent inserts. The unique index is
   * composite (`{organisationId, slug}`) so two tenants can each have
   * a "free" slug without contention.
   */
  private async resolveSlugForCreate(
    tenantId: string,
    input: CreateCategoryServiceInput,
    session: ClientSession,
  ): Promise<string> {
    // -- Path A: client supplied a slug -------------------------------------
    if (input.slug !== undefined && input.slug !== '') {
      // Format validation is also done by the route schema, but we defend
      // here in case the service is called directly (tests, future code).
      if (!isValidSlug(input.slug)) {
        throw new BadRequestError(
          `Slug "${input.slug}" is not in the expected format (lowercase letters, digits, hyphens).`,
        );
      }

      const collision = await this.repo.findBySlug(tenantId, input.slug, session);
      if (collision) {
        throw new BadRequestError(
          `Slug "${input.slug}" already exists (category ${String(collision._id)}).`,
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

    // Try base, base-2, base-3, ... up to a sanity cap.
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

  /**
   * Update an existing category within the actor's tenant.
   *
   * Validations:
   *   - Category must exist within the tenant and not be soft-deleted.
   *     Cross-tenant access surfaces as 404 (we deliberately do not
   *     leak the existence of cross-tenant documents).
   *   - If slug changes, the new slug must not collide with another
   *     category in the same tenant.
   *   - If parentId changes to a non-null value, that parent must
   *     exist in the same tenant. Hierarchy cycle + depth checks run.
   *
   * Records `CATEGORY_UPDATED` with per-field diff. No-op patches
   * don't write an audit entry.
   */
  async update(
    id: string,
    patch: UpdateCategoryInput,
    user: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    const userId = String(user._id);
    const tenantId = String(user.organisationId);

    const updated = await this.runInTransaction(async (session) => {
      // ----- Step 1: load current doc -----
      const before = await this.repo.findById(tenantId, id, session);
      if (!before) {
        throw new NotFoundError('Category', id);
      }

      // ----- Step 2: slug collision check (only if slug is changing) -----
      if (patch.slug !== undefined && patch.slug !== before.slug) {
        const slugCollision = await this.repo.findBySlug(tenantId, patch.slug, session);
        if (slugCollision && String(slugCollision._id) !== id) {
          throw new BadRequestError(
            `Slug "${patch.slug}" already exists (category ${String(slugCollision._id)}).`,
          );
        }
      }

      // ----- Step 3: parent existence + hierarchy check ---------------
      //   Only runs when parentId is changing to a non-null value. We also
      //   guard against the trivial self-parent here in case the parentId
      //   exists — the hierarchy check would catch it too, but throwing
      //   early gives a clearer error message.
      if (
        patch.parentId !== undefined &&
        patch.parentId !== before.parentId &&
        patch.parentId !== null
      ) {
        if (patch.parentId === id) {
          throw new BadRequestError('A category cannot be its own parent.');
        }
        const parent = await this.repo.findById(tenantId, patch.parentId, session);
        if (!parent) {
          throw new BadRequestError(`Parent category ${patch.parentId} does not exist.`);
        }

        const hierarchyResult = await checkHierarchyOnReparent(
          id,
          patch.parentId,
          this.makeParentLookup(tenantId, session),
          CATEGORY_MAX_DEPTH,
        );
        this.assertHierarchyOk(hierarchyResult);
      }

      // ----- Step 3b: root → child demotion guard ----------------------
      //   A root category being given a parent is fine UNLESS assets are
      //   forbidden on roots and... actually the reverse: a CHILD category
      //   being promoted to root would strand its assets (assets must live
      //   on non-root nodes). Block promotion to root if assets reference it.
      if (patch.parentId === null && before.parentId !== null) {
        const assetCount = await this.assetsRepo.countByCategory(tenantId, id, session);
        if (assetCount > 0) {
          throw new BadRequestError(
            `Cannot move category "${before.name}" to root level: ${assetCount} asset${assetCount === 1 ? '' : 's'} reference${assetCount === 1 ? 's' : ''} it and assets must live in a subcategory. Reassign them first.`,
          );
        }
      }

      // ----- Step 4: apply patch with audit fields -----
      const now = new Date().toISOString();
      const fullPatch: CategoryUpdatePatch = {
        ...(patch as CategoryUpdatePatch),
        updatedAt: now,
        updatedBy: userId,
      };

      const after = await this.repo.update(tenantId, id, fullPatch, session);
      if (!after) {
        throw new NotFoundError('Category', id);
      }

      // ----- Step 5: diff + audit (only if real changes) -----
      const changes = computeShallowDiff(before, after, ['updatedAt', 'updatedBy']);
      if (changes.length > 0) {
        await this.auditLog.record(
          user,
          request,
          {
            action: 'CATEGORY_UPDATED',
            target: {
              entityType: 'Category',
              entityId: String(after._id),
              snapshot: {
                name: after.name,
                slug: after.slug,
              },
            },
            description: `Updated category "${after.name}" (${changes.length} field${changes.length === 1 ? '' : 's'} changed)`,
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
   * Soft-delete a category within the actor's tenant.
   *
   * Defense in depth: refuses to delete if the category has any non-
   * deleted direct children within the tenant. Also refuses if any
   * non-deleted assets within the tenant reference it (slice #3 K9 FK
   * protection).
   *
   * Records `CATEGORY_DELETED` with severity WARNING.
   */
  async delete(id: string, user: WithId<User>, request: FastifyRequest): Promise<void> {
    const userId = String(user._id);
    const tenantId = String(user.organisationId);

    await this.runInTransaction(async (session) => {
      // ----- Step 1: load -----
      const existing = await this.repo.findById(tenantId, id, session);
      if (!existing) {
        throw new NotFoundError('Category', id);
      }

      // ----- Step 2: tree integrity — refuse if has children within tenant -----
      const childCount = await this.repo.countChildren(tenantId, id, session);
      if (childCount > 0) {
        throw new BadRequestError(
          `Cannot delete category "${existing.name}": ${childCount} child categor${childCount === 1 ? 'y' : 'ies'} would be orphaned. Reparent or delete children first.`,
        );
      }

      // ----- Step 2b: FK integrity — refuse if assets reference this category -----
      //
      // Slice #3 K9: assets carry categoryId. Removing the category here
      // would leave those assets pointing at a deleted document. We block
      // the delete with a count surfaced in the message so admins can find
      // and reassign the affected assets first.
      const assetCount = await this.assetsRepo.countByCategory(tenantId, id, session);
      if (assetCount > 0) {
        throw new BadRequestError(
          `Cannot delete category "${existing.name}": ${assetCount} asset${assetCount === 1 ? '' : 's'} reference${assetCount === 1 ? 's' : ''} it. Reassign or delete those assets first.`,
        );
      }

      // ----- Step 3: soft-delete -----
      const deleted = await this.repo.softDelete(tenantId, id, userId, session);
      if (!deleted) {
        throw new NotFoundError('Category', id);
      }

      // ----- Step 4: audit -----
      await this.auditLog.record(
        user,
        request,
        {
          action: 'CATEGORY_DELETED',
          target: {
            entityType: 'Category',
            entityId: String(deleted._id),
            snapshot: {
              name: deleted.name,
              slug: deleted.slug,
            },
          },
          description: `Soft-deleted category "${deleted.name}" (slug: ${deleted.slug})`,
          severity: 'WARNING',
        },
        session,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Hierarchy helpers
  // -------------------------------------------------------------------------

  /**
   * Build a `ParentLookup` closure that resolves a category's parentId
   * by id within the given tenant, using `repo.findById` inside the
   * given transaction session.
   *
   * Returns:
   *   - the parent id (as a string) when the node has a parent
   *   - null when the node is a root
   *   - undefined when the node doesn't exist in the tenant (treated
   *     as a terminating walk by checkHierarchyOnReparent)
   *
   * Why a closure: the hierarchy utility is generic and doesn't know
   * about MongoDB sessions or tenancy. We bind the session AND tenant
   * here so the traversal reads see the same transactional snapshot
   * scoped to the same tenant as the rest of the write.
   */
  private makeParentLookup(tenantId: string, session: ClientSession): ParentLookup {
    return async (id: string) => {
      const doc = await this.repo.findById(tenantId, id, session);
      if (!doc) return undefined;
      return doc.parentId;
    };
  }

  /**
   * Translate a `HierarchyCheckResult` into a thrown `BadRequestError` for
   * any non-`ok` outcome. Centralized so both `create` and `update` use
   * the same message phrasing.
   *
   * The three failure modes map to distinct messages:
   *   - cycle:        "would create a cycle (chain: ...)"
   *   - too-deep:     "exceeds maximum depth of N levels"
   *   - corrupt-tree: "detected pre-existing cycle in DB" (admin alert)
   */
  private assertHierarchyOk(result: HierarchyCheckResult): void {
    if (result.kind === 'ok') return;

    if (result.kind === 'cycle') {
      throw new BadRequestError(
        `This parent assignment would create a cycle (chain via ${result.chain.join(' -> ')}).`,
      );
    }

    if (result.kind === 'too-deep') {
      throw new BadRequestError(
        `Kategórie majú len 2 úrovne: root a jeho hodnoty. Hodnotu nie je možné vložiť pod inú hodnotu (max. ${result.max + 1} úrovne).`,
      );
    }

    // corrupt-tree
    throw new BadRequestError(
      `Detected pre-existing cycle in the category tree at node ${result.revisitedId} (chain: ${result.chain.join(' -> ')}). Please report this to an administrator.`,
    );
  }

  // -------------------------------------------------------------------------
  // Transaction helper (mirrors AssetsService.runInTransaction)
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

function toApiShape(doc: WithId<Category>): Record<string, unknown> {
  return {
    ...doc,
    _id: String(doc._id),
  };
}

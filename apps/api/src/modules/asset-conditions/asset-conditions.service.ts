// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { DEFAULT_ASSET_CONDITIONS } from '@inventario/shared-types';

import { isValidSlug, slugify, slugWithSuffix } from '../../lib/slugify.js';
import { BadRequestError, NotFoundError } from '../../plugins/error-handler.js';
import { computeShallowDiff } from '../assets/assets-diff.js';

import type {
  AssetConditionsRepository,
  AssetConditionUpdatePatch,
} from './asset-conditions.repository.js';
import type { AuditLogService } from '../audit/audit.service.js';
import type { AssetConditionEntry, User } from '@inventario/shared-types';
import type { FastifyRequest } from 'fastify';
import type { ClientSession, MongoClient, WithId } from 'mongodb';

export interface ListAssetConditionsResponse {
  data: Record<string, unknown>[];
  pagination: { total: number; limit: number; skip: number; hasMore: boolean };
}

export type CreateAssetConditionServiceInput = {
  name: string;
  slug?: string | undefined;
  icon?: string | null | undefined;
  color?: string | null | undefined;
  isActive?: boolean | undefined;
  sortOrder?: number | undefined;
};

export type UpdateAssetConditionServiceInput = Partial<
  Omit<
    AssetConditionEntry,
    | '_id'
    | 'organisationId'
    | 'createdAt'
    | 'updatedAt'
    | 'createdBy'
    | 'updatedBy'
    | 'deletedAt'
    | 'deletedBy'
  >
>;

export class AssetConditionsService {
  constructor(
    private readonly repo: AssetConditionsRepository,
    private readonly auditLog: AuditLogService,
    private readonly mongoClient: MongoClient,
  ) {}

  async list(
    params: { limit?: number; skip?: number },
    actor: WithId<User>,
  ): Promise<ListAssetConditionsResponse> {
    const tenantId = String(actor.organisationId);
    const limit = params.limit ?? 200;
    const skip = params.skip ?? 0;

    const { items, total } = await this.repo.list({ organisationId: tenantId, limit, skip });

    return {
      data: items.map(toApiShape),
      pagination: { total, limit, skip, hasMore: skip + items.length < total },
    };
  }

  async getById(id: string, actor: WithId<User>): Promise<Record<string, unknown>> {
    const tenantId = String(actor.organisationId);
    const doc = await this.repo.findById(tenantId, id);
    if (!doc) throw new NotFoundError('AssetCondition', id);
    return toApiShape(doc);
  }

  async create(
    input: CreateAssetConditionServiceInput,
    user: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    const userId = String(user._id);
    const tenantId = String(user.organisationId);

    const inserted = await this.runInTransaction(async (session) => {
      const resolvedSlug = await this.resolveSlug(tenantId, input, session);
      const now = new Date().toISOString();

      const doc: Omit<AssetConditionEntry, '_id'> = {
        organisationId: tenantId,
        name: input.name.trim(),
        slug: resolvedSlug,
        icon: input.icon ?? null,
        color: input.color ?? null,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
        deletedAt: null,
        deletedBy: null,
      };

      const insertedDoc = await this.repo.insert(doc, session);

      await this.auditLog.record(
        user,
        request,
        {
          action: 'ASSET_CONDITION_CREATED',
          target: {
            entityType: 'AssetCondition',
            entityId: String(insertedDoc._id),
            snapshot: { name: insertedDoc.name, slug: insertedDoc.slug },
          },
          description: `Created asset condition "${insertedDoc.name}"`,
        },
        session,
      );

      return insertedDoc;
    });

    return toApiShape(inserted);
  }

  async update(
    id: string,
    patch: UpdateAssetConditionServiceInput,
    user: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    const userId = String(user._id);
    const tenantId = String(user.organisationId);

    const updated = await this.runInTransaction(async (session) => {
      const before = await this.repo.findById(tenantId, id, session);
      if (!before) throw new NotFoundError('AssetCondition', id);

      if (patch.slug !== undefined && patch.slug !== before.slug) {
        const collision = await this.repo.findBySlug(tenantId, patch.slug, session);
        if (collision && String(collision._id) !== id) {
          throw new BadRequestError(`Slug "${patch.slug}" already exists.`);
        }
      }

      const now = new Date().toISOString();
      const fullPatch: AssetConditionUpdatePatch = {
        ...(patch as AssetConditionUpdatePatch),
        updatedAt: now,
        updatedBy: userId,
      };

      const after = await this.repo.update(tenantId, id, fullPatch, session);
      if (!after) throw new NotFoundError('AssetCondition', id);

      const changes = computeShallowDiff(before, after, ['updatedAt', 'updatedBy']);
      if (changes.length > 0) {
        await this.auditLog.record(
          user,
          request,
          {
            action: 'ASSET_CONDITION_UPDATED',
            target: {
              entityType: 'AssetCondition',
              entityId: String(after._id),
              snapshot: { name: after.name, slug: after.slug },
            },
            description: `Updated asset condition "${after.name}" (${changes.length} field${changes.length === 1 ? '' : 's'} changed)`,
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
      const existing = await this.repo.findById(tenantId, id, session);
      if (!existing) throw new NotFoundError('AssetCondition', id);

      const assetCount = await this.repo.countAssetsByConditionSlug(
        tenantId,
        existing.slug,
        session,
      );
      if (assetCount > 0) {
        throw new BadRequestError(
          `Cannot delete condition "${existing.name}": ${assetCount} asset${assetCount === 1 ? '' : 's'} reference${assetCount === 1 ? 's' : ''} it. Reassign or delete those assets first.`,
        );
      }

      const deleted = await this.repo.softDelete(tenantId, id, userId, session);
      if (!deleted) throw new NotFoundError('AssetCondition', id);

      await this.auditLog.record(
        user,
        request,
        {
          action: 'ASSET_CONDITION_DELETED',
          target: {
            entityType: 'AssetCondition',
            entityId: String(deleted._id),
            snapshot: { name: deleted.name },
          },
          description: `Soft-deleted asset condition "${deleted.name}"`,
          severity: 'WARNING',
        },
        session,
      );
    });
  }

  async seedDefaults(organisationId: string, createdBy: string): Promise<void> {
    const now = new Date().toISOString();

    for (const def of DEFAULT_ASSET_CONDITIONS) {
      const existing = await this.repo.findBySlug(organisationId, def.slug);
      if (existing) continue;

      const doc: Omit<AssetConditionEntry, '_id'> = {
        organisationId,
        name: def.name,
        slug: def.slug,
        icon: null,
        color: null,
        isActive: true,
        sortOrder: def.sortOrder,
        createdAt: now,
        updatedAt: now,
        createdBy,
        updatedBy: createdBy,
        deletedAt: null,
        deletedBy: null,
      };

      await this.repo.insert(doc);
    }
  }

  private async resolveSlug(
    tenantId: string,
    input: { name: string; slug?: string | undefined },
    session: ClientSession,
  ): Promise<string> {
    if (input.slug !== undefined && input.slug !== '') {
      if (!isValidSlug(input.slug)) {
        throw new BadRequestError(`Slug "${input.slug}" is not valid.`);
      }
      const collision = await this.repo.findBySlug(tenantId, input.slug, session);
      if (collision) throw new BadRequestError(`Slug "${input.slug}" already exists.`);
      return input.slug;
    }

    const base = slugify(input.name);
    if (base === '') {
      throw new BadRequestError(`Cannot derive slug from "${input.name}". Supply slug explicitly.`);
    }

    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = attempt === 0 ? base : slugWithSuffix(base, attempt + 1);
      const collision = await this.repo.findBySlug(tenantId, candidate, session);
      if (!collision) return candidate;
    }

    throw new BadRequestError(`Could not find free slug for "${input.name}" after 100 attempts.`);
  }

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

function toApiShape(doc: WithId<AssetConditionEntry>): Record<string, unknown> {
  return { ...doc, _id: String(doc._id) };
}

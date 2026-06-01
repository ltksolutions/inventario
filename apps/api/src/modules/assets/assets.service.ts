// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Assets service — business logic for asset management.
 *
 * Responsibilities:
 *   - Generate `inventoryNumber` server-side (tenant-level config —
 *     prefix, padding, includeYear, resetYearly z Organisation.inventoryNumberFormat)
 *   - Generate `publicToken` (CSPRNG via crypto.randomBytes + base32,
 *     ADR-0021) atomicky v tej istej transakcii ako inventoryNumber
 *   - Set tenant scope (`organisationId`) and audit fields
 *   - Compute diffs for audit log on update
 *   - Wrap state-changing ops in transactions (asset + audit atomic)
 *
 * ADR-0021 zmeny:
 *   - `CreateAssetServiceInput` už NEOBSAHUJE `inventoryNumberPrefix`.
 *     Prefix (aj formát) sa číta z `Organisation.inventoryNumberFormat`.
 *   - `publicToken` sa generuje VŽDY pri POST, nezávisle od toho, či
 *     má tenant zapnutý `publicAssetLookup`.
 *   - `AssetsService` dostane `OrganisationsRepository` cez konštruktor.
 */

import { randomBytes } from 'node:crypto';

import { base32Encode } from '../../lib/base32.js';
import { BadRequestError, NotFoundError } from '../../plugins/error-handler.js';

import { computeShallowDiff } from './assets-diff.js';

import type { AssetsRepository, AssetUpdatePatch } from './assets.repository.js';
import type { AuditLogService } from '../audit/audit.service.js';
import type { CategoriesRepository } from '../categories/categories.repository.js';
import type { LocationsRepository } from '../locations/locations.repository.js';
import type { OrganisationsRepository } from '../organisations/organisations.repository.js';
import type { Asset, CreateAssetInput, UpdateAssetInput, User } from '@inventario/shared-types';
import type { FastifyRequest } from 'fastify';
import type { ClientSession, MongoClient, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface ListAssetsResponse {
  data: Record<string, unknown>[];
  pagination: {
    total: number;
    limit: number;
    skip: number;
    hasMore: boolean;
  };
}

export interface ListAssetsServiceParams {
  limit?: number;
  skip?: number;
}

/**
 * Service-layer input pre vytvorenie assetu (ADR-0021 refactor).
 *
 * `inventoryNumberPrefix` bol ODSTRÁNENÝ — prefix (a celý formát) sa
 * číta z `Organisation.inventoryNumberFormat`. Kalkulovaný tenantom,
 * nie per-request. Ak tenant nemá `inventoryNumberFormat` nastavený,
 * `create()` vyhodí BadRequestError s jasnou správou.
 */
export type CreateAssetServiceInput = Omit<CreateAssetInput, 'inventoryNumber'>;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AssetsService {
  constructor(
    private readonly repo: AssetsRepository,
    private readonly auditLog: AuditLogService,
    private readonly mongoClient: MongoClient,
    private readonly categoriesRepo: CategoriesRepository,
    private readonly locationsRepo: LocationsRepository,
    private readonly orgsRepo: OrganisationsRepository,
  ) {}

  // -------------------------------------------------------------------------
  // Read paths (no transaction needed)
  // -------------------------------------------------------------------------

  async list(params: ListAssetsServiceParams, actor: WithId<User>): Promise<ListAssetsResponse> {
    const tenantId = String(actor.organisationId);
    const limit = params.limit ?? 20;
    const skip = params.skip ?? 0;

    const { items, total } = await this.repo.list({
      organisationId: tenantId,
      limit,
      skip,
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
      throw new NotFoundError('Asset', id);
    }
    return toApiShape(doc);
  }

  // -------------------------------------------------------------------------
  // Write paths (transactional)
  // -------------------------------------------------------------------------

  /**
   * Create a new asset.
   *
   * Server generates:
   *   - `inventoryNumber` z tenant-level `inventoryNumberFormat` (ADR-0021)
   *   - `publicToken` cez CSPRNG (crypto.randomBytes + base32, ADR-0021)
   *
   * Oboje sa generuje atomicky v rámci tej istej transakcie ako samotný insert.
   * Ak tenant nemá `inventoryNumberFormat` → BadRequestError.
   *
   * Records an `ASSET_CREATED` audit log event atomically with the insert.
   */
  async create(
    input: CreateAssetServiceInput,
    user: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    const userId = String(user._id);
    const tenantId = String(user.organisationId);

    // Načítaj org konfig PRED transakciou (read-only, netreba session).
    // Ak org neexistuje alebo nemá inventoryNumberFormat, failni rýchlo.
    const org = await this.orgsRepo.findById(tenantId);
    if (!org) {
      throw new NotFoundError('Organisation', tenantId);
    }
    if (!org.inventoryNumberFormat) {
      throw new BadRequestError(
        'Organizácia nemá nastavený formát inventárneho čísla (inventoryNumberFormat). ' +
          'Nastavte ho v Settings → Organizácia pred pridaním majetku.',
      );
    }

    const fmt = org.inventoryNumberFormat;

    const inserted = await this.runInTransaction(async (session) => {
      // ----- Step 0: FK validation (category + location must exist) ----
      await this.assertFkExists('category', tenantId, input.categoryId, session);
      await this.assertFkExists('location', tenantId, input.locationId, session);

      // ----- Step 1a: generate publicToken (CSPRNG, ADR-0021) -----
      // 20 náhodných bajtov → base32 → ~32 znakov URL-safe, globálne unikátny.
      // Generujeme VŽDY (nezávisle od publicAssetLookup) aby bol token stálý
      // ak tenant funkciu neskôr zapne, bez potreby migrácie.
      const publicToken = base32Encode(randomBytes(20));

      // ----- Step 1b: generate inventoryNumber (tenant-level config) -----
      const year = new Date().getFullYear();
      const yearOrNull = fmt.includeYear ? year : null;
      const highestSeq = await this.repo.findHighestInventorySequence(
        tenantId,
        fmt.prefix,
        yearOrNull,
        session,
      );
      const nextSeq = highestSeq + 1;
      const seqStr = String(nextSeq).padStart(fmt.padding, '0');
      const inventoryNumber = fmt.includeYear
        ? `${fmt.prefix}-${year}-${seqStr}`
        : `${fmt.prefix}-${seqStr}`;

      // ----- Step 2: build the full Asset document -----
      const now = new Date().toISOString();
      const doc: Omit<Asset, '_id'> = {
        ...(input as Omit<
          Asset,
          | '_id'
          | 'organisationId'
          | 'inventoryNumber'
          | 'publicToken'
          | 'createdAt'
          | 'updatedAt'
          | 'createdBy'
          | 'updatedBy'
          | 'deletedAt'
          | 'deletedBy'
          | 'currentLoanId'
        >),
        organisationId: tenantId,
        inventoryNumber,
        publicToken,
        currentLoanId: null,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
        deletedAt: null,
        deletedBy: null,
      };

      // ----- Step 3: insert + audit log, atomically -----
      const insertedDoc = await this.repo.insert(doc, session);

      await this.auditLog.record(
        user,
        request,
        {
          action: 'ASSET_CREATED',
          target: {
            entityType: 'Asset',
            entityId: String(insertedDoc._id),
            snapshot: {
              inventoryNumber: insertedDoc.inventoryNumber,
              name: insertedDoc.name,
              status: insertedDoc.status,
            },
          },
          description: `Created asset ${insertedDoc.inventoryNumber} — ${insertedDoc.name}`,
        },
        session,
      );

      return insertedDoc;
    });

    return toApiShape(inserted);
  }

  /**
   * Update an existing asset with a partial patch.
   * Records an `ASSET_UPDATED` audit log event with a per-field diff.
   */
  async update(
    id: string,
    patch: UpdateAssetInput,
    user: WithId<User>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    const userId = String(user._id);
    const tenantId = String(user.organisationId);

    const updated = await this.runInTransaction(async (session) => {
      const before = await this.repo.findById(tenantId, id, session);
      if (!before) throw new NotFoundError('Asset', id);

      const typedPatch = patch as Partial<{ categoryId: string; locationId: string }>;
      if (typedPatch.categoryId !== undefined && typedPatch.categoryId !== before.categoryId) {
        await this.assertFkExists('category', tenantId, typedPatch.categoryId, session);
      }
      if (typedPatch.locationId !== undefined && typedPatch.locationId !== before.locationId) {
        await this.assertFkExists('location', tenantId, typedPatch.locationId, session);
      }

      const now = new Date().toISOString();
      const fullPatch: AssetUpdatePatch = {
        ...(patch as AssetUpdatePatch),
        updatedAt: now,
        updatedBy: userId,
      };

      const after = await this.repo.update(tenantId, id, fullPatch, session);
      if (!after) throw new NotFoundError('Asset', id);

      const changes = computeShallowDiff(before, after, ['updatedAt', 'updatedBy']);

      if (changes.length > 0) {
        await this.auditLog.record(
          user,
          request,
          {
            action: 'ASSET_UPDATED',
            target: {
              entityType: 'Asset',
              entityId: String(after._id),
              snapshot: {
                inventoryNumber: after.inventoryNumber,
                name: after.name,
              },
            },
            description: `Updated asset ${after.inventoryNumber} (${changes.length} field${changes.length === 1 ? '' : 's'} changed)`,
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
   * Soft-delete an asset. Records an `ASSET_DELETED` audit event.
   */
  async delete(id: string, user: WithId<User>, request: FastifyRequest): Promise<void> {
    const userId = String(user._id);
    const tenantId = String(user.organisationId);

    await this.runInTransaction(async (session) => {
      const existing = await this.repo.findById(tenantId, id, session);
      if (!existing) throw new NotFoundError('Asset', id);

      if (existing.currentLoanId !== null) {
        throw new BadRequestError(
          `Cannot delete asset ${existing.inventoryNumber}: it is currently on loan. Return the loan first.`,
        );
      }

      const deleted = await this.repo.softDelete(tenantId, id, userId, session);
      if (!deleted) throw new NotFoundError('Asset', id);

      await this.auditLog.record(
        user,
        request,
        {
          action: 'ASSET_DELETED',
          target: {
            entityType: 'Asset',
            entityId: String(deleted._id),
            snapshot: {
              inventoryNumber: deleted.inventoryNumber,
              name: deleted.name,
              status: deleted.status,
            },
          },
          description: `Soft-deleted asset ${deleted.inventoryNumber} — ${deleted.name}`,
          severity: 'WARNING',
        },
        session,
      );
    });
  }

  // -------------------------------------------------------------------------
  // FK validation helper
  // -------------------------------------------------------------------------

  private async assertFkExists(
    kind: 'category' | 'location',
    organisationId: string,
    id: string,
    session: ClientSession,
  ): Promise<void> {
    const repo = kind === 'category' ? this.categoriesRepo : this.locationsRepo;
    const doc = await repo.findById(organisationId, id, session);
    if (!doc) {
      throw new BadRequestError(`Referenced ${kind} ${id} does not exist.`);
    }
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

function toApiShape(doc: WithId<Asset>): Record<string, unknown> {
  return {
    ...doc,
    _id: String(doc._id),
  };
}

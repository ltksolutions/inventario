// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Audit log repository — append-only writes to the `audit_logs` collection.
 *
 * Design constraints from shared-types/schemas/audit-log.ts:
 *   - Records are NEVER updated or deleted (only inserted)
 *   - Pseudonymization (GDPR) is handled by a separate retention job, not here
 *
 * Indexes (created lazily via `ensureIndexes`):
 *   - `at` descending             → time-range queries, newest first
 *   - `actor.userId`              → "what did user X do?" forensics
 *   - `target.entityType + target.entityId` → entity history ("show me all
 *                                              changes to asset Y")
 *   - `action`                    → filter by action type for reports
 *   - `severity`                  → alerting on ERROR/CRITICAL events
 *
 * NOTE on indexing strategy: we index `actor.userId` and the
 * `(target.entityType, target.entityId)` pair together because they're
 * the most common forensic lookup patterns. We do NOT index `description`,
 * `changes`, or `metadata` — those are read-on-demand only.
 */

import type { AuditLog } from '@inventario/shared-types';
import type { ClientSession, Collection, Db } from 'mongodb';

// ---------------------------------------------------------------------------
// Tenant-wide filters (GET /v1/audit-log)
// ---------------------------------------------------------------------------

/**
 * Voliteľné filtre pre `findByOrganisation` / `countByOrganisation`.
 * Všetky polia nepovinné — chýbajúci filter = bez obmedzenia. Dátumy sú
 * ISO stringy (rovnaký formát ako `AuditLog.at`), porovnávané lexikograficky
 * (ISO 8601 je na to bezpečné).
 */
export interface AuditLogFilters {
  action?: string | undefined;
  entityType?: string | undefined;
  actorUserId?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

function buildOrganisationFilter(
  organisationId: string,
  filters: AuditLogFilters,
): Record<string, unknown> {
  const filter: Record<string, unknown> = { organisationId };
  if (filters.action) filter['action'] = filters.action;
  if (filters.entityType) filter['target.entityType'] = filters.entityType;
  if (filters.actorUserId) filter['actor.userId'] = filters.actorUserId;
  if (filters.dateFrom || filters.dateTo) {
    const range: Record<string, string> = {};
    if (filters.dateFrom) range['$gte'] = filters.dateFrom;
    if (filters.dateTo) range['$lte'] = filters.dateTo;
    filter['at'] = range;
  }
  return filter;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class AuditLogRepository {
  private readonly collection: Collection<AuditLog>;

  constructor(db: Db) {
    this.collection = db.collection<AuditLog>('audit_logs');
  }

  /**
   * Creates indexes if they do not already exist. Idempotent.
   *
   * Called once at server startup from the audit routes/service plugin.
   */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ at: -1 }, { name: 'at_desc' }),
      this.collection.createIndex({ 'actor.userId': 1 }, { name: 'actor_userId' }),
      this.collection.createIndex(
        { 'target.entityType': 1, 'target.entityId': 1 },
        { name: 'target_entity' },
      ),
      this.collection.createIndex({ action: 1 }, { name: 'action' }),
      this.collection.createIndex({ severity: 1 }, { name: 'severity' }),
      // Tenant-wide prehľadávateľný audit log (2026-07-07, GET /v1/audit-log)
      // — hlavný prístupový vzor: "všetko pre tenant X, najnovšie prvé,
      // voliteľne filtrované". Kompound index nesie obe zaťaženia.
      this.collection.createIndex({ organisationId: 1, at: -1 }, { name: 'org_at_desc' }),
    ]);
  }

  /**
   * Find all audit log entries where the given userId is the actor.
   *
   * Used by GDPR right to data portability (GET /v1/me/export) to include
   * the user's activity history in their personal data export. Results are
   * sorted newest-first. No tenant filter — the userId is already globally
   * unique (ObjectId) and we want all entries across tenants (e.g. if the
   * user was ever a member of multiple tenants).
   *
   * Uses the `actor_userId` index for efficient lookup.
   */
  async findByActor(userId: string): Promise<AuditLog[]> {
    return this.collection
      .find({ 'actor.userId': userId })
      .sort({ at: -1 })
      .toArray() as unknown as AuditLog[];
  }

  /**
   * Find audit log entries for a specific target entity (tenant-scoped),
   * newest-first, with pagination. Used by entity history views (napr.
   * „Audit log" tab na detaile majetku).
   *
   * Uses the `target_entity` index. `organisationId` je vždy povinný —
   * audit log je tenant-scoped a cudzí tenant nesmie vidieť históriu.
   */
  async findByTarget(
    organisationId: string,
    entityType: string,
    entityId: string,
    opts: { limit: number; skip: number },
  ): Promise<AuditLog[]> {
    return this.collection
      .find({
        organisationId,
        'target.entityType': entityType,
        'target.entityId': entityId,
      } as unknown as Parameters<Collection<AuditLog>['find']>[0])
      .sort({ at: -1 })
      .skip(opts.skip)
      .limit(opts.limit)
      .toArray() as unknown as AuditLog[];
  }

  /**
   * Count audit log entries for a specific target entity (tenant-scoped).
   * Pre stránkovanie `findByTarget`.
   */
  async countByTarget(
    organisationId: string,
    entityType: string,
    entityId: string,
  ): Promise<number> {
    return this.collection.countDocuments({
      organisationId,
      'target.entityType': entityType,
      'target.entityId': entityId,
    } as unknown as Parameters<Collection<AuditLog>['countDocuments']>[0]);
  }

  /**
   * Voliteľné filtre pre tenant-wide prehľadávanie (`GET /v1/audit-log`).
   * Všetky polia sú nepovinné — chýbajúci filter = bez obmedzenia.
   */

  /**
   * Find audit log entries for the whole tenant (not scoped to one entity),
   * newest-first, with pagination and optional filters. Dátový zdroj pre
   * `GET /v1/audit-log` (kompletný prehľadávateľný audit log pre správcov,
   * 2026-07-07). Uses the `org_at_desc` index.
   */
  async findByOrganisation(
    organisationId: string,
    filters: AuditLogFilters,
    opts: { limit: number; skip: number },
  ): Promise<AuditLog[]> {
    return this.collection
      .find(
        buildOrganisationFilter(organisationId, filters) as unknown as Parameters<
          Collection<AuditLog>['find']
        >[0],
      )
      .sort({ at: -1 })
      .skip(opts.skip)
      .limit(opts.limit)
      .toArray() as unknown as AuditLog[];
  }

  /**
   * Count audit log entries for the whole tenant matching the same
   * filters as `findByOrganisation`. Pre stránkovanie.
   */
  async countByOrganisation(organisationId: string, filters: AuditLogFilters): Promise<number> {
    return this.collection.countDocuments(
      buildOrganisationFilter(organisationId, filters) as unknown as Parameters<
        Collection<AuditLog>['countDocuments']
      >[0],
    );
  }

  /**
   * Insert an audit log record.
   *
   * Optionally accepts a `session` for inclusion in a transaction. When
   * the caller passes a session, this insert is part of an atomic
   * multi-document write — if the transaction aborts, the audit record
   * is rolled back along with the business-data write it was paired with.
   *
   * Caller is responsible for providing a fully-validated `AuditLog`
   * document (minus `_id`, which Mongo generates). Use `AuditLogService`
   * for the higher-level "record an event" API.
   */
  async insert(record: Omit<AuditLog, '_id'>, session?: ClientSession): Promise<void> {
    // Cast through `unknown` for the same reason as users.repository:
    // shared-types declares `_id` as required in AuditLog, but at insert
    // time Mongo generates it. The driver's `insertOne` signature is
    // strict about this.
    await this.collection.insertOne(
      record as unknown as AuditLog,
      session ? { session } : undefined,
    );
  }
}

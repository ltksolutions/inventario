// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Retention service — GDPR audit log + user data retention.
 *
 * Retention schedule (docs/compliance/gdpr-article-30.md):
 *
 *   CRUD / business events          → 24 months
 *   Auth / security / GDPR rights  → 60 months (5 years)
 *   Organisation lifecycle          → 84 months (7 years)
 *
 *   Soft-deleted users              → pseudonymized 24 months after deletedAt
 *                                     (safety net; DELETE /v1/auth/me does it
 *                                      immediately for self-erasure requests)
 *
 * Pseudonymization replaces actor PII with anonymous placeholders.
 * Records are NEVER deleted — only pseudonymized. The forensic trail
 * (action, at, target, severity, legalBasis, dataCategories) is
 * preserved indefinitely.
 *
 * All steps are idempotent — re-running the job is safe. Already-
 * pseudonymized records are filtered out before each bulk write.
 */

import type { RetentionRepository } from './retention.repository.js';
import type { FastifyBaseLogger } from 'fastify';

// ---------------------------------------------------------------------------
// Retention buckets
// ---------------------------------------------------------------------------

/** Business/CRUD actions — retained 24 months. */
const CRUD_ACTIONS = [
  'ASSET_CREATED',
  'ASSET_UPDATED',
  'ASSET_DELETED',
  'ASSET_STATUS_CHANGED',
  'ASSET_LOCATION_CHANGED',
  'ASSET_DISPOSED',
  'ASSET_TYPE_CREATED',
  'ASSET_TYPE_UPDATED',
  'ASSET_TYPE_DELETED',
  'ASSET_CONDITION_CREATED',
  'ASSET_CONDITION_UPDATED',
  'ASSET_CONDITION_DELETED',
  'CATEGORY_CREATED',
  'CATEGORY_UPDATED',
  'CATEGORY_DELETED',
  'LOCATION_CREATED',
  'LOCATION_UPDATED',
  'LOCATION_DELETED',
  'LOAN_REQUEST_CREATED',
  'LOAN_REQUEST_APPROVED',
  'LOAN_REQUEST_REJECTED',
  'LOAN_REQUEST_CANCELLED',
  'LOAN_PICKED_UP',
  'LOAN_RETURNED',
  'LOAN_EXTENDED',
  'LOAN_MARKED_OVERDUE',
  'LOAN_MARKED_LOST',
  'LOAN_CREATED_DIRECT',
  'LOAN_REQUEST_FULFILLED',
  'LOAN_PROTOCOL_CREATED',
  'LOAN_PROTOCOL_SIGNED',
  'STOCK_RECEIVED',
  'STOCK_ISSUED',
  'STOCK_RETURNED',
  'STOCK_ADJUSTED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DEACTIVATED',
  'USER_REACTIVATED',
  'USER_ROLE_GRANTED',
  'USER_ROLE_REVOKED',
  'MEMBERSHIP_CREATED',
  'MEMBERSHIP_ROLES_CHANGED',
  'MEMBERSHIP_REMOVED',
  'USER_SWITCHED_ORGANISATION',
  'ORGANISATION_UPDATED',
  'BULK_IMPORT_EXECUTED',
  'SYSTEM_CONFIG_CHANGED',
  'INTEGRATION_TOKEN_CREATED',
  'INTEGRATION_TOKEN_REVOKED',
];

/** Auth / security / GDPR rights — retained 60 months. */
const SECURITY_ACTIONS = [
  'USER_LOGIN',
  'USER_LOGIN_FAILED',
  'USER_LOGOUT',
  'USER_PASSWORD_CHANGED',
  'USER_PASSWORD_RESET_REQUESTED',
  'USER_MFA_ENABLED',
  'USER_MFA_DISABLED',
  'USER_MFA_RESET_BY_ADMIN',
  'PASSKEY_REGISTERED',
  'PASSKEY_REMOVED',
  'PASSKEY_RENAMED',
  'PASSKEY_LOGIN',
  'PASSKEY_LOGIN_FAILED',
  'PASSKEY_COUNTER_WARNING',
  // GDPR rights — legal obligation, same 60-month bucket
  'DATA_EXPORT_REQUESTED',
  'DATA_DELETION_REQUESTED',
  'USER_PSEUDONYMIZED',
  'USER_RESTRICTED',
  'USER_UNRESTRICTED',
];

/** Organisation lifecycle — retained 84 months (7 years). */
const ORG_LIFECYCLE_ACTIONS = ['ORGANISATION_CREATED', 'ORGANISATION_DELETED'];

// Retention periods in milliseconds. Using 30-day months for simplicity
// (consistent with GDPR retention schedules expressed in "months").
const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface RetentionRunResult {
  /** ISO timestamp when the run started. */
  startedAt: string;
  /** ISO timestamp when the run completed. */
  completedAt: string;
  /** Audit log entries pseudonymized in the CRUD bucket (24m). */
  auditLogsCrud: number;
  /** Audit log entries pseudonymized in the security/GDPR bucket (60m). */
  auditLogsSecurity: number;
  /** Audit log entries pseudonymized in the org-lifecycle bucket (84m). */
  auditLogsOrgLifecycle: number;
  /** Total audit log entries pseudonymized (sum of all buckets). */
  totalAuditLogs: number;
  /** Soft-deleted users pseudonymized (24m after deletedAt). */
  usersPseudonymized: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RetentionService {
  constructor(
    private readonly repo: RetentionRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  /**
   * Run the full retention job.
   *
   * Steps (sequential — avoids overwhelming Atlas Flex):
   *   1. Pseudonymize CRUD audit logs older than 24 months.
   *   2. Pseudonymize security/GDPR audit logs older than 60 months.
   *   3. Pseudonymize org-lifecycle audit logs older than 84 months.
   *   4. Pseudonymize soft-deleted users older than 24 months from deletedAt.
   *
   * Pass `now` explicitly for testability (defaults to `new Date()`).
   */
  async run(now: Date = new Date()): Promise<RetentionRunResult> {
    const startedAt = now.toISOString();
    this.logger.info({ startedAt }, '[retention] Starting retention run');

    const crudCutoff = new Date(now.getTime() - 24 * MS_PER_MONTH);
    const securityCutoff = new Date(now.getTime() - 60 * MS_PER_MONTH);
    const orgCutoff = new Date(now.getTime() - 84 * MS_PER_MONTH);
    const userCutoff = new Date(now.getTime() - 24 * MS_PER_MONTH);

    // Step 1: CRUD bucket — 24 months
    this.logger.info({ cutoff: crudCutoff.toISOString() }, '[retention] CRUD bucket (24m)');
    const crudCount = await this.repo.pseudonymizeAuditLogs(CRUD_ACTIONS, crudCutoff);
    this.logger.info({ count: crudCount }, '[retention] CRUD bucket done');

    // Step 2: Security/GDPR bucket — 60 months
    this.logger.info(
      { cutoff: securityCutoff.toISOString() },
      '[retention] Security/GDPR bucket (60m)',
    );
    const securityCount = await this.repo.pseudonymizeAuditLogs(SECURITY_ACTIONS, securityCutoff);
    this.logger.info({ count: securityCount }, '[retention] Security/GDPR bucket done');

    // Step 3: Org lifecycle bucket — 84 months
    this.logger.info({ cutoff: orgCutoff.toISOString() }, '[retention] Org lifecycle bucket (84m)');
    const orgCount = await this.repo.pseudonymizeAuditLogs(ORG_LIFECYCLE_ACTIONS, orgCutoff);
    this.logger.info({ count: orgCount }, '[retention] Org lifecycle bucket done');

    // Step 4: Soft-deleted users — 24 months after deletedAt
    this.logger.info(
      { cutoff: userCutoff.toISOString() },
      '[retention] Soft-deleted users (24m after deletedAt)',
    );
    const usersCount = await this.repo.pseudonymizeSoftDeletedUsers(userCutoff);
    this.logger.info({ count: usersCount }, '[retention] Soft-deleted users done');

    const completedAt = new Date().toISOString();
    const totalAuditLogs = crudCount + securityCount + orgCount;

    const result: RetentionRunResult = {
      startedAt,
      completedAt,
      auditLogsCrud: crudCount,
      auditLogsSecurity: securityCount,
      auditLogsOrgLifecycle: orgCount,
      totalAuditLogs,
      usersPseudonymized: usersCount,
    };

    this.logger.info(result, '[retention] Retention run complete');
    return result;
  }
}

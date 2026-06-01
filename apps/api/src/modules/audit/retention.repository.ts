// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Retention repository — the ONLY write path that modifies existing records.
 *
 * Audit logs are append-only from the application's perspective. This
 * repository is the single, deliberately narrow exception: it may
 * pseudonymize records whose retention period has expired, replacing
 * actor PII with anonymous placeholders while preserving every other
 * field (action, at, severity, legalBasis, dataCategories, target,
 * description, changes, metadata).
 *
 * Design decisions:
 *   - Kept as a SEPARATE class from AuditLogRepository so that
 *     pseudonymization cannot accidentally be mixed with normal insert
 *     code paths. Any code importing AuditLogRepository cannot call a
 *     "modify" method — it does not exist there.
 *   - Operates cross-tenant (no organisationId filter) — retention is
 *     a system-level concern, not a per-tenant one.
 *   - All write methods are idempotent: they filter on
 *     `isPseudonymized: { $ne: true }` so re-running is safe.
 *   - Returns modifiedCount for logging/audit of the retention run.
 */

import type { Db } from 'mongodb';

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class RetentionRepository {
  constructor(private readonly db: Db) {}

  /**
   * Pseudonymize audit_log entries for a specific set of actions whose
   * `at` timestamp is older than `cutoffDate`.
   *
   * Replaces actor PII:
   *   - `actor.userId`      → 'PSEUDONYMIZED'
   *   - `actor.displayName` → 'Pseudonymized User'
   *   - `actor.ipAddress`   → null
   *   - `actor.userAgent`   → null
   *
   * Sets `isPseudonymized: true` and `pseudonymizedAt: now`.
   * Skips records already pseudonymized (`isPseudonymized: { $ne: true }`).
   *
   * @returns Number of records modified.
   */
  async pseudonymizeAuditLogs(actions: string[], cutoffDate: Date): Promise<number> {
    const now = new Date().toISOString();

    const result = await this.db.collection('audit_logs').updateMany(
      {
        action: { $in: actions },
        at: { $lt: cutoffDate.toISOString() },
        isPseudonymized: { $ne: true },
      },
      {
        $set: {
          'actor.userId': 'PSEUDONYMIZED',
          'actor.displayName': 'Pseudonymized User',
          'actor.ipAddress': null,
          'actor.userAgent': null,
          isPseudonymized: true,
          pseudonymizedAt: now,
        },
      },
    );

    return result.modifiedCount;
  }

  /**
   * Pseudonymize soft-deleted users whose `deletedAt` is older than
   * `cutoffDate` but who have NOT yet been pseudonymized by the
   * right-to-erasure flow (i.e. email does not start with 'deleted-').
   *
   * This catches users soft-deleted via admin paths that bypass the
   * self-service `DELETE /v1/auth/me` endpoint (future feature — admin
   * hard-delete). For now the primary path is `DELETE /v1/auth/me` which
   * pseudonymizes immediately, so this is a safety net.
   *
   * Applies the same pseudonymization as `DELETE /v1/auth/me`:
   *   email → `deleted-{userId}@deleted.inventario`
   *   firstName/lastName/displayName → 'Deleted'/'User'/'Deleted User'
   *   secrets → null, isActive → false, authProviders → []
   *
   * Each user is updated individually (not bulk updateMany) so that each
   * gets their own unique pseudoEmail (`deleted-{_id}@...`). Idempotent
   * per-user via the email regex check.
   *
   * @returns Number of users modified.
   */
  async pseudonymizeSoftDeletedUsers(cutoffDate: Date): Promise<number> {
    const cutoff = cutoffDate.toISOString();

    const users = await this.db
      .collection('users')
      .find({
        deletedAt: { $ne: null, $lt: cutoff },
        email: { $not: /^deleted-/ },
      })
      .project({ _id: 1 })
      .toArray();

    if (users.length === 0) return 0;

    const now = new Date().toISOString();
    let count = 0;

    for (const user of users) {
      const userId = String(user['_id']);
      const pseudoEmail = `deleted-${userId}@deleted.inventario`;

      const result = await this.db.collection('users').updateOne(
        {
          _id: user['_id'],
          email: { $not: /^deleted-/ }, // idempotency guard
        },
        {
          $set: {
            email: pseudoEmail,
            firstName: 'Deleted',
            lastName: 'User',
            displayName: 'Deleted User',
            passwordHash: null,
            isActive: false,
            authProviders: [],
            entraOid: null,
            emailVerified: false,
            emailVerificationToken: null,
            passwordResetToken: null,
            mfaSecret: null,
            mfaRecoveryCodes: [],
            updatedAt: now,
            updatedBy: 'SYSTEM',
          },
        },
      );
      count += result.modifiedCount;
    }

    return count;
  }

  /**
   * Count audit_log entries that would be pseudonymized for a given
   * action set and cutoff date. Used for dry-run / reporting.
   */
  async countPseudonymizable(actions: string[], cutoffDate: Date): Promise<number> {
    return this.db.collection('audit_logs').countDocuments({
      action: { $in: actions },
      at: { $lt: cutoffDate.toISOString() },
      isPseudonymized: { $ne: true },
    });
  }
}

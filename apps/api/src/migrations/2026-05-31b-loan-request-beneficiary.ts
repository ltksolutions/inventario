// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-05-31b — backfill beneficiaryId on LoanRequests (ADR-0023).
 *
 * ADR-0023 adds `beneficiaryId` to LoanRequest. For existing requests where
 * beneficiaryId is absent, it defaults to requesterId (loan was for self).
 * This migration sets `beneficiaryId = requesterId` on all existing documents
 * that are missing the field.
 *
 * Idempotent — documents already having beneficiaryId are skipped.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';

export async function migrate_2026_05_31b_loan_request_beneficiary(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const col = db.collection('loan_requests');

  // Only update documents missing the field entirely.
  const result = await col.updateMany({ beneficiaryId: { $exists: false } }, [
    { $set: { beneficiaryId: '$requesterId' } },
  ]);

  logger.info(
    { modified: result.modifiedCount },
    'Migration 2026-05-31b: backfilled beneficiaryId = requesterId on loan_requests',
  );
}

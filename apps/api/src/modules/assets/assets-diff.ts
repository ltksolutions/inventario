// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Pure functions for computing diffs between asset documents.
 *
 * Extracted from assets.service.ts so they can be unit-tested in
 * isolation (no Fastify, no MongoDB, no test database). The diff
 * logic is used by `AssetsService.update` to populate the audit log
 * with per-field change records.
 *
 * Design notes:
 *   - "Shallow" means top-level fields only. A change inside a nested
 *     object (e.g. `specs.cpu`) is detected and reported as a single
 *     change on the `specs` field, NOT as a path-specific diff. Deep
 *     diff is intentionally out of scope; if we ever need it, it goes
 *     in a separate function.
 *   - Skip list is for fields that mutate on EVERY update (the audit
 *     fields themselves: `updatedAt`, `updatedBy`). Including those
 *     would make the audit log noisy and meaningless.
 *   - The output schema (`{ field, before, after }`) matches the
 *     `AuditLog['changes']` type from shared-types, so service code
 *     can use it directly without further transformation.
 */

import type { AuditLog } from '@inventario/shared-types';
import type { WithId } from 'mongodb';

/**
 * Compute a shallow diff between two documents for audit logging.
 *
 * Returns an array of `{ field, before, after }` for each top-level
 * field that differs. Excludes fields listed in `skip` (typically the
 * audit fields themselves, which always change on update but don't
 * represent business-meaningful changes).
 *
 * `_id` is always skipped \u2014 it's an identifier, not a business field.
 *
 * Nested object changes are detected via shallow inequality but reported
 * as a single field change \u2014 deep diff is a future enhancement.
 *
 * Generic over the document type so it can be reused across modules
 * (assets, categories, locations, users, etc.). The audit log change
 * shape is the same regardless of which entity we're diffing.
 */
export function computeShallowDiff<T extends { _id: unknown }>(
  before: WithId<T>,
  after: WithId<T>,
  skip: readonly string[],
): NonNullable<AuditLog['changes']> {
  const skipSet = new Set(skip);
  const changes: NonNullable<AuditLog['changes']> = [];

  // Iterate keys of `after` \u2014 adds and modifications appear here.
  // Deletes (a field in `before` not in `after`) won't be caught by this,
  // but Mongo `$set` semantics don't unset fields anyway, so this is
  // accurate for our update path.
  for (const key of Object.keys(after) as (keyof WithId<T>)[]) {
    if (skipSet.has(key as string)) continue;
    if (key === '_id') continue;

    const beforeVal = before[key];
    const afterVal = after[key];

    if (!shallowEqual(beforeVal, afterVal)) {
      changes.push({
        field: key as string,
        before: beforeVal,
        after: afterVal,
      });
    }
  }

  return changes;
}

/**
 * Shallow equality check sufficient for diff detection:
 *   - Primitive equality via ===
 *   - Arrays compared element-by-element with ===
 *   - Objects compared via JSON.stringify (good enough for our schemas,
 *     where nested objects are small and have stable key order)
 *
 * Date instances appear as ISO strings in our docs (timestamps are stored
 * as strings per the shared-types convention), so === works for them.
 *
 * Exported (not just internal to this module) so unit tests can verify
 * its edge cases directly without going through `computeShallowDiff`.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

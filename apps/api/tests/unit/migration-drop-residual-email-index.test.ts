// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration unit tests — 2026-06-01b-drop-residual-email-index.
 *
 * Verifies that the migration drops ANY single-field unique index on
 * `email` (regardless of name) while leaving the composite per-tenant
 * index { organisationId, email } intact.
 *
 * Covered scenarios:
 *   1. Residual global unique index named `users_email_global_unique`
 *      (the real prod name 2026-05-29c missed) → dropped
 *   2. Composite { organisationId: 1, email: 1 } unique index → preserved
 *   3. Idempotency — second run is a no-op, no throw
 *   4. No matching index present → no-op, no throw
 */

import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { migrate_2026_06_01b_drop_residual_email_index } from '../../src/migrations/2026-06-01b-drop-residual-email-index.js';

let client: MongoClient;
let db: ReturnType<MongoClient['db']>;

const TEST_DB = `inv_migration_email_test_${Date.now()}`;

const noop = () => {};
const logger = {
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  trace: noop,
  fatal: noop,
  child: () => logger,
} as never;

beforeAll(async () => {
  const uri = process.env['MONGO_URI'];
  if (!uri) throw new Error('MONGO_URI not set — ensure tests run via vitest with globalSetup');
  client = new MongoClient(uri, { writeConcern: { w: 'majority' } });
  await client.connect();
  db = client.db(TEST_DB);
});

afterAll(async () => {
  if (db) {
    try {
      await db.dropDatabase();
    } catch {
      /* ignore */
    }
  }
  if (client) await client.close();
});

beforeEach(async () => {
  // Drop the users collection entirely so each test starts with a clean
  // index set (dropping indexes individually is what we're testing).
  try {
    await db.collection('users').drop();
  } catch {
    // Collection doesn't exist yet — fine
  }
});

async function indexNames(): Promise<string[]> {
  const idx = await db.collection('users').indexes();
  return idx.map((i) => i.name as string);
}

describe('migration 2026-06-01b — drop residual email index', () => {
  it('drops a single-field unique email index named users_email_global_unique', async () => {
    await db
      .collection('users')
      .createIndex({ email: 1 }, { unique: true, name: 'users_email_global_unique' });

    expect(await indexNames()).toContain('users_email_global_unique');

    await migrate_2026_06_01b_drop_residual_email_index(db, logger);

    expect(await indexNames()).not.toContain('users_email_global_unique');
  });

  it('drops a legacy single-field unique email index named email_1', async () => {
    await db.collection('users').createIndex({ email: 1 }, { unique: true, name: 'email_1' });

    await migrate_2026_06_01b_drop_residual_email_index(db, logger);

    expect(await indexNames()).not.toContain('email_1');
  });

  it('preserves the composite { organisationId, email } unique index', async () => {
    await db
      .collection('users')
      .createIndex(
        { organisationId: 1, email: 1 },
        { unique: true, name: 'organisationId_email_unique' },
      );
    // Also add the bad one to ensure only the bad one goes
    await db
      .collection('users')
      .createIndex({ email: 1 }, { unique: true, name: 'users_email_global_unique' });

    await migrate_2026_06_01b_drop_residual_email_index(db, logger);

    const names = await indexNames();
    expect(names).toContain('organisationId_email_unique');
    expect(names).not.toContain('users_email_global_unique');
  });

  it('does NOT drop a non-unique single-field email index', async () => {
    await db.collection('users').createIndex({ email: 1 }, { name: 'email_nonunique' });

    await migrate_2026_06_01b_drop_residual_email_index(db, logger);

    expect(await indexNames()).toContain('email_nonunique');
  });

  it('is idempotent — second run is a no-op', async () => {
    await db
      .collection('users')
      .createIndex({ email: 1 }, { unique: true, name: 'users_email_global_unique' });

    await migrate_2026_06_01b_drop_residual_email_index(db, logger);
    // Second run must not throw
    await expect(
      migrate_2026_06_01b_drop_residual_email_index(db, logger),
    ).resolves.toBeUndefined();
  });

  it('is a no-op when no matching index exists', async () => {
    // Only the composite index present
    await db
      .collection('users')
      .createIndex(
        { organisationId: 1, email: 1 },
        { unique: true, name: 'organisationId_email_unique' },
      );

    await expect(
      migrate_2026_06_01b_drop_residual_email_index(db, logger),
    ).resolves.toBeUndefined();

    expect(await indexNames()).toContain('organisationId_email_unique');
  });
});

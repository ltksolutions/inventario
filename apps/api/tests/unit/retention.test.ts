// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Unit tests for RetentionRepository + RetentionService.
 *
 * Tests run against a real MongoDB instance (from globalSetup) using a
 * dedicated test DB that is dropped after each test group.
 *
 * Covered:
 *   RetentionRepository.pseudonymizeAuditLogs:
 *     - pseudonymizes matching records (action + at < cutoff)
 *     - skips already-pseudonymized records (idempotency)
 *     - preserves records outside the action set
 *     - preserves records newer than cutoff
 *     - preserves non-PII fields (action, severity, target, description)
 *
 *   RetentionRepository.pseudonymizeSoftDeletedUsers:
 *     - pseudonymizes soft-deleted users older than cutoff
 *     - skips already-pseudonymized users (email starts with 'deleted-')
 *     - skips users not yet soft-deleted (deletedAt: null)
 *     - skips users soft-deleted after cutoff
 *
 *   RetentionService.run:
 *     - processes all three audit log buckets with correct cutoffs
 *     - returns accurate counts per bucket
 *     - is idempotent (second run returns 0 counts)
 */

import { ObjectId, MongoClient } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RetentionRepository } from '../../src/modules/audit/retention.repository.js';
import { RetentionService } from '../../src/modules/audit/retention.service.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let client: MongoClient;
let db: ReturnType<MongoClient['db']>;

const TEST_DB = `inv_retention_test_${Date.now()}`;

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
  try {
    await db.dropDatabase();
  } catch {
    /* ignore */
  }
  await client.close();
});

beforeEach(async () => {
  await Promise.all([
    db.collection('audit_logs').deleteMany({}),
    db.collection('users').deleteMany({}),
  ]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString();
}

function insertAuditLog(overrides: Record<string, unknown> = {}) {
  return db.collection('audit_logs').insertOne({
    _id: new ObjectId(),
    organisationId: 'org1',
    at: monthsAgo(25), // older than 24m by default
    actor: {
      userId: 'user123',
      displayName: 'Ján Letko',
      accountType: 'LOCAL',
      ipAddress: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
    },
    action: 'ASSET_CREATED',
    target: { entityType: 'Asset', entityId: 'asset1' },
    description: 'Created asset',
    changes: null,
    metadata: {},
    severity: 'INFO',
    legalBasis: 'contract',
    dataCategories: ['audit_metadata'],
    isPseudonymized: false,
    pseudonymizedAt: null,
    ...overrides,
  });
}

function insertUser(overrides: Record<string, unknown> = {}) {
  const id = new ObjectId();
  return db.collection('users').insertOne({
    _id: id,
    email: `user-${String(id)}@example.com`,
    firstName: 'Ján',
    lastName: 'Letko',
    displayName: 'Ján Letko',
    isActive: false,
    deletedAt: monthsAgo(25), // older than 24m by default
    passwordHash: 'hash',
    mfaSecret: 'secret',
    mfaRecoveryCodes: ['code1'],
    entraOid: 'oid123',
    authProviders: [{ provider: 'MICROSOFT' }],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// RetentionRepository tests
// ---------------------------------------------------------------------------

describe('RetentionRepository', () => {
  let repo: RetentionRepository;

  beforeEach(() => {
    repo = new RetentionRepository(db);
  });

  describe('pseudonymizeAuditLogs', () => {
    it('pseudonymizes matching records', async () => {
      await insertAuditLog({ action: 'ASSET_CREATED', at: monthsAgo(25) });

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 24);
      const count = await repo.pseudonymizeAuditLogs(['ASSET_CREATED'], cutoff);

      expect(count).toBe(1);

      const doc = await db.collection('audit_logs').findOne({});
      expect(doc!['actor']['userId']).toBe('PSEUDONYMIZED');
      expect(doc!['actor']['displayName']).toBe('Pseudonymized User');
      expect(doc!['actor']['ipAddress']).toBeNull();
      expect(doc!['actor']['userAgent']).toBeNull();
      expect(doc!['isPseudonymized']).toBe(true);
      expect(doc!['pseudonymizedAt']).not.toBeNull();
    });

    it('preserves non-PII fields after pseudonymization', async () => {
      await insertAuditLog({
        action: 'ASSET_CREATED',
        severity: 'WARNING',
        description: 'Created critical asset',
        legalBasis: 'contract',
      });

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 24);
      await repo.pseudonymizeAuditLogs(['ASSET_CREATED'], cutoff);

      const doc = await db.collection('audit_logs').findOne({});
      expect(doc!['action']).toBe('ASSET_CREATED');
      expect(doc!['severity']).toBe('WARNING');
      expect(doc!['description']).toBe('Created critical asset');
      expect(doc!['legalBasis']).toBe('contract');
    });

    it('skips already-pseudonymized records (idempotent)', async () => {
      await insertAuditLog({
        action: 'ASSET_CREATED',
        isPseudonymized: true,
        pseudonymizedAt: monthsAgo(1),
        'actor.userId': 'PSEUDONYMIZED',
      });

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 24);
      const count = await repo.pseudonymizeAuditLogs(['ASSET_CREATED'], cutoff);

      expect(count).toBe(0);
    });

    it('skips records not in the action set', async () => {
      await insertAuditLog({ action: 'USER_LOGIN', at: monthsAgo(25) });

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 24);
      const count = await repo.pseudonymizeAuditLogs(['ASSET_CREATED'], cutoff); // USER_LOGIN not included

      expect(count).toBe(0);

      const doc = await db.collection('audit_logs').findOne({});
      expect(doc!['isPseudonymized']).toBe(false);
    });

    it('skips records newer than cutoff', async () => {
      await insertAuditLog({ action: 'ASSET_CREATED', at: monthsAgo(1) }); // only 1 month old

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 24);
      const count = await repo.pseudonymizeAuditLogs(['ASSET_CREATED'], cutoff);

      expect(count).toBe(0);
    });
  });

  describe('pseudonymizeSoftDeletedUsers', () => {
    it('pseudonymizes soft-deleted users older than cutoff', async () => {
      const { insertedId } = await insertUser({ deletedAt: monthsAgo(25) });

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 24);
      const count = await repo.pseudonymizeSoftDeletedUsers(cutoff);

      expect(count).toBe(1);

      const doc = await db.collection('users').findOne({ _id: insertedId });
      expect(doc!['email']).toMatch(/^deleted-/);
      expect(doc!['firstName']).toBe('Deleted');
      expect(doc!['lastName']).toBe('User');
      expect(doc!['passwordHash']).toBeNull();
      expect(doc!['mfaSecret']).toBeNull();
      expect(doc!['entraOid']).toBeNull();
    });

    it('skips already-pseudonymized users (idempotent)', async () => {
      const { insertedId } = await insertUser({
        deletedAt: monthsAgo(25),
        email: `deleted-${new ObjectId()}@deleted.inventario`,
      });

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 24);
      const count = await repo.pseudonymizeSoftDeletedUsers(cutoff);

      expect(count).toBe(0);

      const doc = await db.collection('users').findOne({ _id: insertedId });
      // email unchanged
      expect(doc!['email']).toMatch(/^deleted-/);
    });

    it('skips active users (deletedAt: null)', async () => {
      await insertUser({ deletedAt: null, isActive: true });

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 24);
      const count = await repo.pseudonymizeSoftDeletedUsers(cutoff);

      expect(count).toBe(0);
    });

    it('skips users soft-deleted after cutoff (within grace)', async () => {
      await insertUser({ deletedAt: monthsAgo(1) }); // only 1 month ago

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 24);
      const count = await repo.pseudonymizeSoftDeletedUsers(cutoff);

      expect(count).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// RetentionService tests
// ---------------------------------------------------------------------------

describe('RetentionService', () => {
  let repo: RetentionRepository;
  let service: RetentionService;

  beforeEach(() => {
    repo = new RetentionRepository(db);
    service = new RetentionService(repo, logger);
  });

  it('processes all buckets and returns correct counts', async () => {
    // CRUD bucket (24m) — 2 records
    await insertAuditLog({ action: 'ASSET_CREATED', at: monthsAgo(25) });
    await insertAuditLog({ action: 'LOAN_RETURNED', at: monthsAgo(26) });

    // Security bucket (60m) — 1 record
    await insertAuditLog({ action: 'USER_LOGIN', at: monthsAgo(61) });

    // Org lifecycle bucket (84m) — 1 record
    await insertAuditLog({ action: 'ORGANISATION_CREATED', at: monthsAgo(85) });

    // Too new — should NOT be pseudonymized
    await insertAuditLog({ action: 'ASSET_CREATED', at: monthsAgo(1) });

    const result = await service.run();

    expect(result.auditLogsCrud).toBe(2);
    expect(result.auditLogsSecurity).toBe(1);
    expect(result.auditLogsOrgLifecycle).toBe(1);
    expect(result.totalAuditLogs).toBe(4);
    expect(result.usersPseudonymized).toBe(0);
    expect(result.startedAt).toBeTruthy();
    expect(result.completedAt).toBeTruthy();
  });

  it('is idempotent — second run returns 0 for already-processed records', async () => {
    await insertAuditLog({ action: 'ASSET_CREATED', at: monthsAgo(25) });

    await service.run();
    const second = await service.run();

    expect(second.auditLogsCrud).toBe(0);
    expect(second.totalAuditLogs).toBe(0);
  });

  it('pseudonymizes soft-deleted users via the users step', async () => {
    await insertUser({ deletedAt: monthsAgo(25) });

    const result = await service.run();

    expect(result.usersPseudonymized).toBe(1);

    const doc = await db.collection('users').findOne({});
    expect(doc!['email']).toMatch(/^deleted-/);
  });

  it('respects the now parameter for cutoff calculation', async () => {
    // Insert a record 25 months old
    await insertAuditLog({ action: 'ASSET_CREATED', at: monthsAgo(25) });

    // Run with "now" = 23 months from epoch of that record — too early for 24m cutoff
    const earlyNow = new Date();
    earlyNow.setMonth(earlyNow.getMonth() - 2); // effectively only 23m back

    const result = await service.run(earlyNow);

    // With earlyNow - 24m, the cutoff is 26m ago. Our record is 25m old → not yet expired
    expect(result.auditLogsCrud).toBe(0);
  });
});

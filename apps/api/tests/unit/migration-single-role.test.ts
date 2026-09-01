// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Unit tests — migration 2026-06-03-single-role (ADR-0029).
 *
 * Scenare:
 *   1. Membership s roles[] konvertuje na role (highestRole)
 *   2. Invitation s roles[] konvertuje na role (highestRole)
 *   3. Dokument, ktory uz ma role a nema roles, sa preskoci (idempotencia)
 *   4. Priorita pri zhode urovni: EMPLOYEE > EXTERNAL
 *   5. Prazdne roles[] -> EMPLOYEE (default)
 *   6. Viacero dokumentov v jednom behu
 */

import { MongoClient, ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { migrate_2026_06_03_single_role } from '../../src/migrations/2026-06-03-single-role.js';

let client: MongoClient;
let db: ReturnType<MongoClient['db']>;

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
  if (!uri) throw new Error('MONGO_URI not set');
  client = new MongoClient(uri, { writeConcern: { w: 'majority' } });
  await client.connect();
  db = client.db(`inventario_migration_single_role_test_${Date.now()}`);
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
  await Promise.all([
    db.collection('memberships').deleteMany({}),
    db.collection('invitations').deleteMany({}),
    db.collection('users').deleteMany({}),
  ]);
});

function makeMembership(roles: string[], extra: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    userId: new ObjectId().toString(),
    organisationId: new ObjectId().toString(),
    roles,
    status: 'ACTIVE',
    isDefault: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'test',
    updatedBy: 'test',
    deletedAt: null,
    deletedBy: null,
    ...extra,
  };
}

function makeInvitation(roles: string[], extra: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    email: `invite-${Date.now()}-${Math.random()}@example.com`,
    organisationId: new ObjectId().toString(),
    roles,
    status: 'PENDING',
    token: 'a'.repeat(64),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    firstName: null,
    lastName: null,
    invitedUserId: null,
    invitedBy: 'test',
    acceptedAt: null,
    membershipId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'test',
    updatedBy: 'test',
    deletedAt: null,
    deletedBy: null,
    ...extra,
  };
}

describe('migrate_2026_06_03_single_role', () => {
  describe('memberships', () => {
    it('ADMIN roles[] -> role: ADMIN', async () => {
      const m = makeMembership(['ADMIN']);
      await db.collection('memberships').insertOne(m);
      await migrate_2026_06_03_single_role(db, logger);
      const after = await db.collection('memberships').findOne({ _id: m._id });
      expect(after!['role']).toBe('ADMIN');
      expect(after!['roles']).toBeUndefined();
    });

    it('[ADMIN, EMPLOYEE] -> role: ADMIN', async () => {
      const m = makeMembership(['ADMIN', 'EMPLOYEE']);
      await db.collection('memberships').insertOne(m);
      await migrate_2026_06_03_single_role(db, logger);
      const after = await db.collection('memberships').findOne({ _id: m._id });
      expect(after!['role']).toBe('ADMIN');
    });

    it('[ASSET_MANAGER, EMPLOYEE] -> role: ASSET_MANAGER', async () => {
      const m = makeMembership(['ASSET_MANAGER', 'EMPLOYEE']);
      await db.collection('memberships').insertOne(m);
      await migrate_2026_06_03_single_role(db, logger);
      const after = await db.collection('memberships').findOne({ _id: m._id });
      expect(after!['role']).toBe('ASSET_MANAGER');
    });

    it('[EXTERNAL, EMPLOYEE] -> role: EMPLOYEE (EMPLOYEE vyhrava nad EXTERNAL)', async () => {
      const m = makeMembership(['EXTERNAL', 'EMPLOYEE']);
      await db.collection('memberships').insertOne(m);
      await migrate_2026_06_03_single_role(db, logger);
      const after = await db.collection('memberships').findOne({ _id: m._id });
      expect(after!['role']).toBe('EMPLOYEE');
    });

    it('prazdne roles[] -> role: EMPLOYEE', async () => {
      const m = makeMembership([]);
      await db.collection('memberships').insertOne(m);
      await migrate_2026_06_03_single_role(db, logger);
      const after = await db.collection('memberships').findOne({ _id: m._id });
      expect(after!['role']).toBe('EMPLOYEE');
    });

    it('idempotencia: dokument s role (bez roles) sa preskoci', async () => {
      const m = makeMembership([]);
      delete (m as Record<string, unknown>)['roles'];
      (m as Record<string, unknown>)['role'] = 'ASSET_MANAGER';
      await db.collection('memberships').insertOne(m);
      await migrate_2026_06_03_single_role(db, logger);
      const after = await db.collection('memberships').findOne({ _id: m._id });
      expect(after!['role']).toBe('ASSET_MANAGER');
      expect(after!['roles']).toBeUndefined();
    });

    it('migruje viacero dokumentov naraz', async () => {
      const m1 = makeMembership(['ADMIN']);
      const m2 = makeMembership(['EMPLOYEE']);
      const m3 = makeMembership(['ASSET_MANAGER', 'EMPLOYEE']);
      await db.collection('memberships').insertMany([m1, m2, m3]);
      await migrate_2026_06_03_single_role(db, logger);
      const all = await db.collection('memberships').find({}).toArray();
      expect(all.every((m) => m['roles'] === undefined)).toBe(true);
      expect(all.find((m) => String(m['_id']) === String(m1._id))?.['role']).toBe('ADMIN');
      expect(all.find((m) => String(m['_id']) === String(m2._id))?.['role']).toBe('EMPLOYEE');
      expect(all.find((m) => String(m['_id']) === String(m3._id))?.['role']).toBe('ASSET_MANAGER');
    });
  });

  describe('invitations', () => {
    it('invitation roles[] -> role', async () => {
      const inv = makeInvitation(['ASSET_MANAGER']);
      await db.collection('invitations').insertOne(inv);
      await migrate_2026_06_03_single_role(db, logger);
      const after = await db.collection('invitations').findOne({ _id: inv._id });
      expect(after!['role']).toBe('ASSET_MANAGER');
      expect(after!['roles']).toBeUndefined();
    });

    it('invitation [ADMIN, EMPLOYEE] -> ADMIN', async () => {
      const inv = makeInvitation(['ADMIN', 'EMPLOYEE']);
      await db.collection('invitations').insertOne(inv);
      await migrate_2026_06_03_single_role(db, logger);
      const after = await db.collection('invitations').findOne({ _id: inv._id });
      expect(after!['role']).toBe('ADMIN');
    });
  });

  describe('users ostava nedotknuta', () => {
    it('migracia nesiahne na kolekciu users', async () => {
      const userId = new ObjectId();
      await db
        .collection('users')
        .insertOne({ _id: userId, email: 'u@test.com', roles: ['ADMIN'] });
      await migrate_2026_06_03_single_role(db, logger);
      const after = await db.collection('users').findOne({ _id: userId });
      expect(after!['roles']).toEqual(['ADMIN']);
      expect(after!['role']).toBeUndefined();
    });
  });
});

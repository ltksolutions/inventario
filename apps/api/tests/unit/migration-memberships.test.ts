// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration unit tests — 2026-05-23-memberships (ADR-0015, K4).
 *
 * Testujú migration funkciu priamo cez MongoDB (in-memory replica set
 * z globalSetup). Každý test má vlastný unikátny collection prefix
 * (nie — používa rovnaké colekcie, ale čistí ich v beforeEach).
 *
 * Pokryté scenáre:
 *   1. Ghost user (pending invite) → invitations collection + fyzický delete z users
 *   2. Active user → 1 default Membership vytvorená + per-tenant polia stripped z User
 *   3. Idempotencia — druhý beh migration nič nezmení
 *   4. User bez organisationId (už migrovaný) — preskočí bez chyby
 *   5. User s mfaEnabled=true — MFA polia sa NEPRESUNÚ na Membership (zostanú na User)
 *   6. Preferences split — emailNotifications/pushNotifications → Membership.notifications
 */

import { ObjectId, MongoClient } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { migrate_2026_05_23_memberships } from '../../src/migrations/2026-05-23-memberships.js';

// ---------------------------------------------------------------------------
// Setup — priama MongoDB connection (nie cez Fastify app)
// ---------------------------------------------------------------------------

let client: MongoClient;
let db: ReturnType<MongoClient['db']>;

const TEST_DB = process.env['MONGO_URI'] ? `sfz_migration_test_${Date.now()}` : null;

const noop = () => {};
// Minimal logger stub
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
  db = client.db(TEST_DB!);
});

afterAll(async () => {
  if (db) {
    // Drop test DB after all tests
    try {
      await db.dropDatabase();
    } catch {
      /* ignore */
    }
  }
  if (client) await client.close();
});

beforeEach(async () => {
  // Clean collections before each test
  await Promise.all([
    db.collection('users').deleteMany({}),
    db.collection('memberships').deleteMany({}),
    db.collection('invitations').deleteMany({}),
    db.collection('migrations').deleteMany({}),
  ]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const now = new Date().toISOString();
const orgId = new ObjectId().toString();

function makeActiveUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    email: `user-${Date.now()}-${Math.random()}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    displayName: 'Test User',
    accountType: 'ENTRA_ID',
    entraOid: `00000000-0000-4000-8000-${randomHex(12)}`,
    authProviders: [
      { provider: 'MICROSOFT', providerId: 'oid123', email: 'u@example.com', linkedAt: now },
    ],
    emailVerified: true,
    emailVerificationToken: null,
    emailVerificationExpiresAt: null,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    passwordHash: null,
    // per-tenant fields (will be stripped after migration)
    organisationId: orgId,
    roles: ['EMPLOYEE'],
    organizationalUnit: null,
    teams: [],
    isActive: true,
    lastLoginAt: now,
    invitationSentAt: null,
    mustChangePassword: false,
    mfaEnabled: false,
    mfaSecret: null,
    mfaRecoveryCodes: [],
    mfaEnabledAt: null,
    preferences: {
      language: 'sk',
      timezone: 'Europe/Bratislava',
      emailNotifications: true,
      pushNotifications: false,
    },
    createdAt: now,
    updatedAt: now,
    createdBy: 'SYSTEM',
    updatedBy: 'SYSTEM',
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

function makeGhostUser(overrides: Record<string, unknown> = {}) {
  const token = randomHex(64);
  return {
    _id: new ObjectId(),
    email: `invite-${Date.now()}-${Math.random()}@example.com`,
    firstName: 'Invited',
    lastName: 'User',
    displayName: 'Invited User',
    accountType: 'LOCAL',
    entraOid: null,
    authProviders: [],
    emailVerified: false,
    emailVerificationToken: token,
    emailVerificationExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    passwordHash: null,
    organisationId: orgId,
    roles: ['EMPLOYEE'],
    organizationalUnit: null,
    teams: [],
    isActive: true,
    lastLoginAt: null,
    invitationSentAt: now,
    mustChangePassword: false,
    mfaEnabled: false,
    mfaSecret: null,
    mfaRecoveryCodes: [],
    mfaEnabledAt: null,
    preferences: { language: 'sk', timezone: 'Europe/Bratislava' },
    createdAt: now,
    updatedAt: now,
    createdBy: 'admin-user-id',
    updatedBy: 'admin-user-id',
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

function randomHex(n: number): string {
  const chars = '0123456789abcdef';
  return Array.from({ length: n }, () => chars[Math.floor(Math.random() * 16)]).join('');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('migrate_2026_05_23_memberships', () => {
  describe('ghost users (pending invites)', () => {
    it('moves a ghost user to invitations collection and deletes from users', async () => {
      const ghost = makeGhostUser();
      await db.collection('users').insertOne(ghost);

      await migrate_2026_05_23_memberships(db, logger);

      // Should be gone from users
      const userAfter = await db.collection('users').findOne({ _id: ghost._id });
      expect(userAfter).toBeNull();

      // Should exist in invitations
      const invitation = await db
        .collection('invitations')
        .findOne({ token: ghost.emailVerificationToken });
      expect(invitation).not.toBeNull();
      expect(invitation!['email']).toBe(ghost.email);
      expect(invitation!['organisationId']).toBe(orgId);
      expect(invitation!['status']).toBe('PENDING');
      expect(invitation!['invitedUserId']).toBeNull();
      expect(invitation!['roles']).toEqual(['EMPLOYEE']);
    });

    it('does NOT create a Membership for ghost users', async () => {
      const ghost = makeGhostUser();
      await db.collection('users').insertOne(ghost);

      await migrate_2026_05_23_memberships(db, logger);

      const membershipCount = await db.collection('memberships').countDocuments({});
      expect(membershipCount).toBe(0);
    });

    it('preserves firstName and lastName in invitation', async () => {
      const ghost = makeGhostUser({ firstName: 'Jana', lastName: 'Nováková' });
      await db.collection('users').insertOne(ghost);

      await migrate_2026_05_23_memberships(db, logger);

      const inv = await db.collection('invitations').findOne({ email: ghost.email });
      expect(inv!['firstName']).toBe('Jana');
      expect(inv!['lastName']).toBe('Nováková');
    });
  });

  describe('active users → Membership', () => {
    it('creates a default Membership for an active user', async () => {
      const user = makeActiveUser();
      await db.collection('users').insertOne(user);

      await migrate_2026_05_23_memberships(db, logger);

      const membership = await db.collection('memberships').findOne({
        userId: user._id.toString(),
        organisationId: orgId,
      });
      expect(membership).not.toBeNull();
      expect(membership!['isDefault']).toBe(true);
      expect(membership!['status']).toBe('ACTIVE');
      expect(membership!['roles']).toEqual(['EMPLOYEE']);
    });

    it('strips per-tenant fields from User after migration', async () => {
      const user = makeActiveUser();
      await db.collection('users').insertOne(user);

      await migrate_2026_05_23_memberships(db, logger);

      const userAfter = await db.collection('users').findOne({ _id: user._id });
      expect(userAfter).not.toBeNull();
      // Per-tenant fields should be gone
      expect(userAfter!['organisationId']).toBeUndefined();
      expect(userAfter!['roles']).toBeUndefined();
      expect(userAfter!['organizationalUnit']).toBeUndefined();
      expect(userAfter!['teams']).toBeUndefined();
      expect(userAfter!['mustChangePassword']).toBeUndefined();
      expect(userAfter!['invitationSentAt']).toBeUndefined();
      // Global fields should remain
      expect(userAfter!['email']).toBe(user.email);
      expect(userAfter!['isActive']).toBe(true);
      expect(userAfter!['mfaEnabled']).toBe(false);
    });

    it('migrates preferences.emailNotifications to Membership.notifications.email', async () => {
      const user = makeActiveUser({
        preferences: {
          language: 'en',
          timezone: 'UTC',
          emailNotifications: false,
          pushNotifications: true,
        },
      });
      await db.collection('users').insertOne(user);

      await migrate_2026_05_23_memberships(db, logger);

      const membership = await db.collection('memberships').findOne({
        userId: user._id.toString(),
      });
      expect(membership!['notifications']).toEqual({ email: false, push: true });
    });

    it('keeps global preferences (language, timezone) on User', async () => {
      const user = makeActiveUser({
        preferences: {
          language: 'en',
          timezone: 'UTC',
          emailNotifications: true,
          pushNotifications: false,
        },
      });
      await db.collection('users').insertOne(user);

      await migrate_2026_05_23_memberships(db, logger);

      const userAfter = await db.collection('users').findOne({ _id: user._id });
      expect(userAfter!['preferences']['language']).toBe('en');
      expect(userAfter!['preferences']['timezone']).toBe('UTC');
      // notification prefs stripped from user.preferences
      expect(userAfter!['preferences']['emailNotifications']).toBeUndefined();
      expect(userAfter!['preferences']['pushNotifications']).toBeUndefined();
    });

    it('sets Membership.mustChangePassword from User.mustChangePassword', async () => {
      const user = makeActiveUser({ mustChangePassword: true });
      await db.collection('users').insertOne(user);

      await migrate_2026_05_23_memberships(db, logger);

      const membership = await db.collection('memberships').findOne({
        userId: user._id.toString(),
      });
      expect(membership!['mustChangePassword']).toBe(true);
    });

    it('does NOT touch MFA fields on User (they stay global)', async () => {
      const user = makeActiveUser({
        mfaEnabled: true,
        mfaSecret: 'encrypted-secret-here',
        mfaRecoveryCodes: ['code1', 'code2'],
      });
      await db.collection('users').insertOne(user);

      await migrate_2026_05_23_memberships(db, logger);

      const userAfter = await db.collection('users').findOne({ _id: user._id });
      expect(userAfter!['mfaEnabled']).toBe(true);
      expect(userAfter!['mfaSecret']).toBe('encrypted-secret-here');
      expect(userAfter!['mfaRecoveryCodes']).toEqual(['code1', 'code2']);
    });
  });

  describe('idempotency', () => {
    it('running migration twice produces the same result (no duplicates, no errors)', async () => {
      const user = makeActiveUser();
      const ghost = makeGhostUser();
      await db.collection('users').insertMany([user, ghost]);

      // First run
      await migrate_2026_05_23_memberships(db, logger);

      const membershipCountAfterFirst = await db.collection('memberships').countDocuments({});
      const invitationCountAfterFirst = await db.collection('invitations').countDocuments({});

      // Second run — should be a no-op
      await migrate_2026_05_23_memberships(db, logger);

      const membershipCountAfterSecond = await db.collection('memberships').countDocuments({});
      const invitationCountAfterSecond = await db.collection('invitations').countDocuments({});

      expect(membershipCountAfterSecond).toBe(membershipCountAfterFirst);
      expect(invitationCountAfterSecond).toBe(invitationCountAfterFirst);
    });

    it('user without organisationId (already migrated) is skipped without error', async () => {
      const alreadyMigratedUser = makeActiveUser();
      // Remove organisationId to simulate already-migrated state
      delete (alreadyMigratedUser as Record<string, unknown>)['organisationId'];
      await db.collection('users').insertOne(alreadyMigratedUser);

      // Should not throw
      await expect(migrate_2026_05_23_memberships(db, logger)).resolves.toBeUndefined();

      // No membership created for already-migrated user
      const membershipCount = await db.collection('memberships').countDocuments({});
      expect(membershipCount).toBe(0);
    });
  });

  describe('multiple users in one tenant', () => {
    it('creates separate Memberships for each user in the same org', async () => {
      const user1 = makeActiveUser({ roles: ['ADMIN'] });
      const user2 = makeActiveUser({ roles: ['EMPLOYEE'] });
      const user3 = makeActiveUser({ roles: ['ASSET_MANAGER'] });
      await db.collection('users').insertMany([user1, user2, user3]);

      await migrate_2026_05_23_memberships(db, logger);

      const memberships = await db.collection('memberships').find({}).toArray();
      expect(memberships).toHaveLength(3);
      expect(memberships.every((m) => m['isDefault'] === true)).toBe(true);

      const roles = memberships.map((m) => m['roles'][0]).sort();
      expect(roles).toEqual(['ADMIN', 'ASSET_MANAGER', 'EMPLOYEE']);
    });
  });

  describe('index creation', () => {
    it('creates the global email unique index on users collection', async () => {
      const user = makeActiveUser();
      await db.collection('users').insertOne(user);

      await migrate_2026_05_23_memberships(db, logger);

      const indexes = await db.collection('users').indexes();
      const emailIndex = indexes.find((idx) => idx.name === 'users_email_global_unique');
      expect(emailIndex).toBeDefined();
      expect(emailIndex!.unique).toBe(true);
    });

    it('creates the memberships unique index on userId+organisationId', async () => {
      await migrate_2026_05_23_memberships(db, logger);

      const indexes = await db.collection('memberships').indexes();
      const uidOrgIndex = indexes.find(
        (idx) => idx.name === 'memberships_userId_organisationId_unique',
      );
      expect(uidOrgIndex).toBeDefined();
      expect(uidOrgIndex!.unique).toBe(true);
    });
  });
});

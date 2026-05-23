// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Migration 2026-05-23-memberships — ADR-0015 cross-tenant memberships.
 *
 * Čo robí (idempotentné):
 *
 * 1. **Ghost users → invitations collection**
 *    User dokumenty s `passwordHash: null, emailVerified: false, authProviders: []`
 *    sú pending pozvánky (ghost-user pattern). Presunú sa do kolekcie `invitations`
 *    a pôvodné User dokumenty sa fyzicky zmažú.
 *
 * 2. **Active users → Membership row**
 *    Pre každého aktívneho Usera sa vytvorí Membership dokument
 *    (`userId, organisationId, roles, ...`) s `isDefault: true`.
 *    Ak Membership pre daný `userId + organisationId` pair už existuje, preskočí sa.
 *
 * 3. **Strip per-tenant fields z User**
 *    Po vytvorení Membership sa z User dokumentu odstrania:
 *    `organisationId, roles, organizationalUnit, teams,
 *     invitationSentAt, mustChangePassword,
 *     preferences.emailNotifications, preferences.pushNotifications`
 *
 * 4. **Index management**
 *    Odstráni starý `organisationId_email_unique` index z `users`.
 *    Vytvorí globálny `email_1` unique index na `users`.
 *    Vytvorí všetky indexy pre `memberships` a `invitations`.
 *
 * Idempotencia:
 *   - Ghost users: kontroluje sa existencia v `invitations` podľa tokenu pred insertom.
 *   - Memberships: unique index `{userId, organisationId}` zabraňuje duplicitám
 *     (insert s `{ ignoreUndefined: true }` + catch E11000).
 *   - Index creation: všetky `createIndex` volania sú idempotentné (Mongo ignoruje
 *     ak index s rovnakým názvom a definíciou už existuje).
 *
 * Produkčný postup:
 *   1. Atlas snapshot prod DB (DR baseline) PRED deploy-om.
 *   2. Deploy novej verzie API — runner sa spustí automaticky.
 *   3. Smoke test: login, list assets, list memberships.
 *   4. Rollback: Atlas restore zo snapshot (< 1 min).
 */

import { ObjectId, type Db } from 'mongodb';

import type { FastifyBaseLogger } from 'fastify';

// ---------------------------------------------------------------------------
// Raw document shapes (čítame priamo z MongoDB, nie cez Zod)
// ---------------------------------------------------------------------------

interface RawUser {
  _id: ObjectId;
  email: string;
  organisationId?: string;
  roles?: string[];
  organizationalUnit?: unknown | null;
  teams?: unknown[];
  isActive?: boolean;
  mustChangePassword?: boolean;
  invitationSentAt?: string | null;
  passwordHash?: string | null;
  emailVerified?: boolean;
  emailVerificationToken?: string | null;
  emailVerificationExpiresAt?: string | null;
  authProviders?: unknown[];
  firstName?: string | null;
  lastName?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
  lastLoginAt?: string | null;
  preferences?: {
    language?: string;
    timezone?: string;
    emailNotifications?: boolean;
    pushNotifications?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Migration entry point
// ---------------------------------------------------------------------------

export async function migrate_2026_05_23_memberships(
  db: Db,
  logger: FastifyBaseLogger,
): Promise<void> {
  const usersCol = db.collection<RawUser>('users');
  const membershipsCol = db.collection('memberships');
  const invitationsCol = db.collection('invitations');

  // -------------------------------------------------------------------------
  // Step 1: Ensure memberships + invitations indexes FIRST (idempotent)
  // -------------------------------------------------------------------------

  logger.info('Step 1/4: Creating indexes for memberships + invitations collections');

  await Promise.all([
    membershipsCol.createIndex(
      { userId: 1, organisationId: 1 },
      { unique: true, name: 'memberships_userId_organisationId_unique' },
    ),
    membershipsCol.createIndex(
      { userId: 1, isDefault: 1 },
      {
        unique: true,
        partialFilterExpression: { isDefault: true, deletedAt: null },
        name: 'memberships_userId_isDefault_partial_unique',
      },
    ),
    membershipsCol.createIndex(
      { organisationId: 1, status: 1, deletedAt: 1 },
      { name: 'memberships_organisationId_status_deletedAt' },
    ),
    membershipsCol.createIndex(
      { userId: 1, deletedAt: 1 },
      { name: 'memberships_userId_deletedAt' },
    ),
    invitationsCol.createIndex(
      { token: 1 },
      { unique: true, sparse: true, name: 'invitations_token_unique_sparse' },
    ),
    invitationsCol.createIndex(
      { organisationId: 1, status: 1, deletedAt: 1 },
      { name: 'invitations_organisationId_status_deletedAt' },
    ),
    invitationsCol.createIndex(
      { email: 1, organisationId: 1, status: 1 },
      { name: 'invitations_email_organisationId_status' },
    ),
    invitationsCol.createIndex({ expiresAt: 1 }, { name: 'invitations_expiresAt' }),
  ]);

  // -------------------------------------------------------------------------
  // Step 2: Ghost users → invitations collection
  // -------------------------------------------------------------------------

  logger.info('Step 2/4: Migrating ghost users (pending invites) to invitations collection');

  const ghostUsers = await usersCol
    .find({
      passwordHash: null,
      emailVerified: false,
      $or: [{ authProviders: { $size: 0 } }, { authProviders: { $exists: false } }],
      deletedAt: null,
    })
    .toArray();

  logger.info({ count: ghostUsers.length }, 'Ghost users found');

  let ghostMigrated = 0;
  let ghostSkipped = 0;

  for (const ghost of ghostUsers) {
    // Skip if already migrated to invitations (idempotency check via token)
    if (ghost.emailVerificationToken) {
      const existingInvitation = await invitationsCol.findOne({
        token: ghost.emailVerificationToken,
      });
      if (existingInvitation) {
        ghostSkipped++;
        continue;
      }
    }

    // Build invitation document from ghost user
    const invitation = {
      _id: new ObjectId(),
      email: ghost.email,
      organisationId: ghost.organisationId ?? '',
      roles: ghost.roles ?? ['EMPLOYEE'],
      firstName: ghost.firstName ?? null,
      lastName: ghost.lastName ?? null,
      invitedUserId: null, // ghost users were always new-user invites
      token: ghost.emailVerificationToken ?? generateFallbackToken(),
      expiresAt:
        ghost.emailVerificationExpiresAt ??
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      invitedBy: ghost.createdBy,
      status: 'PENDING' as const,
      acceptedAt: null,
      membershipId: null,
      createdAt: ghost.createdAt,
      updatedAt: ghost.updatedAt,
      createdBy: ghost.createdBy,
      updatedBy: ghost.updatedBy,
      deletedAt: null,
      deletedBy: null,
    };

    try {
      await invitationsCol.insertOne(invitation);
      // Remove ghost user from users collection
      await usersCol.deleteOne({ _id: ghost._id });
      ghostMigrated++;
    } catch (err) {
      // E11000 = token already exists in invitations → already migrated
      if (isDuplicateKeyError(err)) {
        ghostSkipped++;
      } else {
        throw err;
      }
    }
  }

  logger.info({ migrated: ghostMigrated, skipped: ghostSkipped }, 'Ghost users migration done');

  // -------------------------------------------------------------------------
  // Step 3: Active users → Membership rows
  // -------------------------------------------------------------------------

  logger.info('Step 3/4: Creating Membership rows for active users');

  // Fetch all non-deleted users that still have organisationId (not yet migrated)
  const activeUsers = await usersCol
    .find({
      deletedAt: null,
      organisationId: { $exists: true, $ne: null as unknown as string },
    } as never)
    .toArray();

  logger.info({ count: activeUsers.length }, 'Active users to process');

  let membershipCreated = 0;
  let membershipSkipped = 0;
  let fieldsStripped = 0;

  for (const user of activeUsers) {
    if (!user.organisationId) {
      // Already migrated (organisationId stripped in a previous run)
      membershipSkipped++;
      continue;
    }

    // Build membership document
    const now = new Date().toISOString();
    const membership = {
      _id: new ObjectId(),
      userId: user._id.toString(), // stored as string to match ObjectIdSchema
      organisationId: user.organisationId,
      roles: user.roles ?? ['EMPLOYEE'],
      organizationalUnit: user.organizationalUnit ?? null,
      teams: user.teams ?? [],
      status: 'ACTIVE' as const,
      isDefault: true,
      invitedBy: user.createdBy,
      invitedAt: user.createdAt,
      acceptedAt: user.createdAt, // self-serve or JIT = immediate accept
      mustChangePassword: user.mustChangePassword ?? false,
      lastAccessedAt: user.lastLoginAt ?? null,
      notifications: {
        email: user.preferences?.emailNotifications ?? true,
        push: user.preferences?.pushNotifications ?? false,
      },
      createdAt: user.createdAt,
      updatedAt: now,
      createdBy: user.createdBy,
      updatedBy: 'SYSTEM',
      deletedAt: null,
      deletedBy: null,
    };

    try {
      await membershipsCol.insertOne(membership);
      membershipCreated++;
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        // Membership already exists for this user+org pair — idempotent skip
        membershipSkipped++;
      } else {
        throw err;
      }
    }

    // Strip per-tenant fields from User document
    await usersCol.updateOne(
      { _id: user._id },
      {
        $unset: {
          organisationId: '',
          roles: '',
          organizationalUnit: '',
          teams: '',
          invitationSentAt: '',
          mustChangePassword: '',
          'preferences.emailNotifications': '',
          'preferences.pushNotifications': '',
        },
        $set: { updatedAt: now, updatedBy: 'SYSTEM' },
      },
    );
    fieldsStripped++;
  }

  logger.info(
    { created: membershipCreated, skipped: membershipSkipped, fieldsStripped },
    'Membership migration done',
  );

  // -------------------------------------------------------------------------
  // Step 4: Update indexes on users collection
  // -------------------------------------------------------------------------

  logger.info('Step 4/4: Updating indexes on users collection');

  // Drop the old per-tenant email unique index (email+organisationId).
  // Ignore errors if the index doesn't exist yet (first run after code change).
  for (const oldIndex of ['organisationId_email_unique', 'email_1_organisationId_1']) {
    try {
      await usersCol.dropIndex(oldIndex);
      logger.info({ index: oldIndex }, 'Dropped old user index');
    } catch {
      // Index not found — already dropped or never existed
    }
  }

  // Create new globally-unique email index.
  await usersCol.createIndex({ email: 1 }, { unique: true, name: 'users_email_global_unique' });

  logger.info('Step 4/4: Index updates done');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 11000
  );
}

/**
 * Fallback token for ghost users where emailVerificationToken is null.
 * Should be rare (only if the invite flow had a bug). The token is still
 * 64 hex chars for schema compliance but won't be usable since it wasn't
 * sent to anyone.
 */
function generateFallbackToken(): string {
  const chars = '0123456789abcdef';
  let token = '';
  for (let i = 0; i < 64; i++) {
    token += chars[Math.floor(Math.random() * 16)];
  }
  return token;
}

/**
 * Integration tests for public invitation endpoints — Slice #6c K18.
 *
 * GET  /v1/auth/invitations/:token   — public preview
 * POST /v1/auth/accept-invitation    — accept with password
 */

import { randomBytes } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { provisionUser, resolveTestTenantId, UserRole } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validInviteBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const stamp = randomBytes(4).toString('hex');
  return {
    email: `accept-${stamp}@example.com`,
    role: UserRole.EMPLOYEE,
    firstName: 'Ján',
    lastName: 'Novák',
    ...overrides,
  };
}

/** Create a pending invitation via the API and return the invite token from DB. */
async function createInvite(
  app: FastifyInstance,
  adminToken: string,
  overrides: Record<string, unknown> = {},
): Promise<{ inviteId: string; token: string; email: string }> {
  const body = validInviteBody(overrides);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/invitations',
    headers: { cookie: `inv_access=${adminToken}` },
    payload: body,
  });
  if (res.statusCode !== 201) {
    throw new Error(`createInvite failed: ${res.statusCode} ${res.body}`);
  }
  const inviteId = res.json<{ _id: string }>()._id;
  // K10: invitations are now stored in the `invitations` collection (not `users`).
  const { ObjectId } = await import('mongodb');
  const doc = await app.mongo.db
    .collection<{ token: string }>('invitations')
    .findOne({ _id: new ObjectId(inviteId) });
  return { inviteId, token: doc!.token, email: body['email'] as string };
}

// ---------------------------------------------------------------------------
// GET /v1/auth/invitations/:token
// ---------------------------------------------------------------------------

describe('GET /v1/auth/invitations/:token', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
    const admin = await provisionUser(app, {
      oid: 'preview-admin',
      role: UserRole.ADMIN,
      firstName: 'Maroš',
      lastName: 'Správca',
    });
    adminToken = admin.token;
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  it('returns 200 with preview data for valid token', async () => {
    const { token } = await createInvite(app, adminToken, {
      email: 'preview@example.com',
      role: UserRole.EMPLOYEE,
    });
    const res = await app.inject({ method: 'GET', url: `/v1/auth/invitations/${token}` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      email: string;
      role: string;
      organisation: { displayName: string };
      inviter: { displayName: string };
      expiresAt: string;
    }>();
    expect(body.email).toBe('preview@example.com');
    expect(body.role).toBe(UserRole.EMPLOYEE);
    expect(body.organisation.displayName).toBeTruthy();
    expect(body.inviter.displayName).toBeTruthy();
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('returns 410 for non-existent token', async () => {
    const fakeToken = randomBytes(32).toString('hex');
    const res = await app.inject({ method: 'GET', url: `/v1/auth/invitations/${fakeToken}` });
    expect(res.statusCode).toBe(410);
  });

  it('returns 410 for malformed token (wrong length)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/invitations/tooshort' });
    expect(res.statusCode).toBe(410);
  });

  it('returns 410 for expired token', async () => {
    const { inviteId, token } = await createInvite(app, adminToken);
    const { ObjectId } = await import('mongodb');
    // Push expiry into the past in invitations collection (K10)
    await app.mongo.db
      .collection('invitations')
      .updateOne(
        { _id: new ObjectId(inviteId) },
        { $set: { expiresAt: new Date(Date.now() - 1000).toISOString() } },
      );
    const res = await app.inject({ method: 'GET', url: `/v1/auth/invitations/${token}` });
    expect(res.statusCode).toBe(410);
  });

  it('returns 410 for already accepted token (emailVerified=true)', async () => {
    const { inviteId, token } = await createInvite(app, adminToken);
    const { ObjectId } = await import('mongodb');
    // Mark invitation as ACCEPTED in invitations collection (K10)
    await app.mongo.db
      .collection('invitations')
      .updateOne({ _id: new ObjectId(inviteId) }, { $set: { status: 'ACCEPTED' } });
    const res = await app.inject({ method: 'GET', url: `/v1/auth/invitations/${token}` });
    expect(res.statusCode).toBe(410);
  });

  it('does not expose email addresses other than the invited one', async () => {
    const { token } = await createInvite(app, adminToken);
    const res = await app.inject({ method: 'GET', url: `/v1/auth/invitations/${token}` });
    expect(res.statusCode).toBe(200);
    // The raw body should not contain the admin's email
    const rawBody = res.body;
    expect(rawBody).not.toContain('preview-admin');
  });
});

// ---------------------------------------------------------------------------
// POST /v1/auth/accept-invitation
// ---------------------------------------------------------------------------

describe('POST /v1/auth/accept-invitation', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
    const admin = await provisionUser(app, { oid: 'accept-admin', role: UserRole.ADMIN });
    adminToken = admin.token;
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  describe('happy path', () => {
    it('accepts invite with password → 204 + auth cookies set', async () => {
      const { token } = await createInvite(app, adminToken, { email: 'newuser@example.com' });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/accept-invitation',
        payload: { token, password: 'securePassw0rd!!', firstName: 'Ján', lastName: 'Letko' },
      });
      expect(res.statusCode).toBe(204);
      const cookies = res.cookies;
      expect(cookies.some((c) => c.name === 'inv_access')).toBe(true);
      expect(cookies.some((c) => c.name === 'inv_refresh')).toBe(true);
    });

    it('activates the user account in DB (emailVerified=true, passwordHash set)', async () => {
      const { token, email } = await createInvite(app, adminToken);
      await app.inject({
        method: 'POST',
        url: '/v1/auth/accept-invitation',
        payload: { token, password: 'securePassw0rd!!', firstName: 'Ján', lastName: 'Letko' },
      });
      // K10: new user is created with a new _id — find by email
      const doc = await app.mongo.db.collection('users').findOne({ email });
      expect(doc!['emailVerified']).toBe(true);
      expect(doc!['passwordHash']).toBeTruthy();
      expect(doc!['emailVerificationToken']).toBeNull();
      expect(doc!['firstName']).toBe('Ján');
      expect(doc!['lastName']).toBe('Letko');
      expect(doc!['displayName']).toBe('Ján Letko');
    });

    it('clears the invite token from DB', async () => {
      const { token, email } = await createInvite(app, adminToken);
      await app.inject({
        method: 'POST',
        url: '/v1/auth/accept-invitation',
        payload: { token, password: 'securePassw0rd!!', firstName: 'Ján', lastName: 'Letko' },
      });
      // K10: find user by email; invitation token is on the invitation doc, not the user
      const invDoc = await app.mongo.db.collection('invitations').findOne({ email });
      expect(invDoc!['status']).toBe('ACCEPTED');
      expect(invDoc!['acceptedAt']).not.toBeNull();
    });

    it('stores a refresh token in DB', async () => {
      const { token, email } = await createInvite(app, adminToken);
      await app.inject({
        method: 'POST',
        url: '/v1/auth/accept-invitation',
        payload: { token, password: 'securePassw0rd!!', firstName: 'Ján', lastName: 'Letko' },
      });
      // K10: find new user by email to get their actual _id
      const user = await app.mongo.db.collection('users').findOne({ email });
      expect(user).not.toBeNull();
      const rt = await app.mongo.db
        .collection('refresh_tokens')
        .findOne({ userId: String(user!['_id']) });
      expect(rt).not.toBeNull();
    });

    it('emits USER_INVITATION_ACCEPTED audit event', async () => {
      const { token, email } = await createInvite(app, adminToken);
      await app.inject({
        method: 'POST',
        url: '/v1/auth/accept-invitation',
        payload: { token, password: 'securePassw0rd!!', firstName: 'Ján', lastName: 'Letko' },
      });
      // K10: audit action is USER_INVITATION_ACCEPTED, actor email matches invite email
      const audit = await app.mongo.db
        .collection('audit_logs')
        .findOne({ action: 'USER_INVITATION_ACCEPTED', 'actor.email': email });
      expect(audit).not.toBeNull();
      expect(audit!['metadata']).toMatchObject({ via: 'password' });
    });
  });

  describe('error cases', () => {
    it('returns 400 for non-existent token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/accept-invitation',
        payload: {
          token: randomBytes(32).toString('hex'),
          password: 'securePassw0rd!!',
          firstName: 'Ján',
          lastName: 'Letko',
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for expired token', async () => {
      const { inviteId, token } = await createInvite(app, adminToken);
      const { ObjectId } = await import('mongodb');
      // Expire the invite in invitations collection (K10)
      await app.mongo.db
        .collection('invitations')
        .updateOne(
          { _id: new ObjectId(inviteId) },
          { $set: { expiresAt: new Date(Date.now() - 1000).toISOString() } },
        );
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/accept-invitation',
        payload: { token, password: 'securePassw0rd!!', firstName: 'Ján', lastName: 'Letko' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/expired/i);
    });

    it('returns 400 for already used token', async () => {
      const { token } = await createInvite(app, adminToken);
      await app.inject({
        method: 'POST',
        url: '/v1/auth/accept-invitation',
        payload: { token, password: 'securePassw0rd!!', firstName: 'Ján', lastName: 'Letko' },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/accept-invitation',
        payload: { token, password: 'securePassw0rd!!', firstName: 'Ján', lastName: 'Letko' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for password shorter than 12 chars', async () => {
      const { token } = await createInvite(app, adminToken);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/accept-invitation',
        payload: { token, password: 'short', firstName: 'Ján', lastName: 'Letko' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when token has wrong format (not 64 hex chars)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/accept-invitation',
        payload: {
          token: 'tooshort',
          password: 'securePassw0rd!!',
          firstName: 'Ján',
          lastName: 'Letko',
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when firstName is missing', async () => {
      const { token } = await createInvite(app, adminToken);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/accept-invitation',
        payload: { token, password: 'securePassw0rd!!', lastName: 'Letko' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('accepted user can login', () => {
    it('accepted user can call GET /v1/auth/me with the issued cookie', async () => {
      const { token } = await createInvite(app, adminToken, { email: 'loginafter@example.com' });
      const acceptRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/accept-invitation',
        payload: { token, password: 'securePassw0rd!!', firstName: 'Ján', lastName: 'Letko' },
      });
      const accessCookie = acceptRes.cookies.find((c) => c.name === 'inv_access')!;
      const meRes = await app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        headers: { cookie: `inv_access=${accessCookie.value}` },
      });
      expect(meRes.statusCode).toBe(200);
      expect(meRes.json<{ user: { email: string } }>().user.email).toBe('loginafter@example.com');
    });
  });
});

// ---------------------------------------------------------------------------
// POST /v1/auth/accept-invitation — existing-user path (K12)
// ---------------------------------------------------------------------------

describe('POST /v1/auth/accept-invitation — existing-user path', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
    const admin = await provisionUser(app, { oid: 'existing-user-admin', role: UserRole.ADMIN });
    adminToken = admin.token;
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  it('cross-tenant: existing user accepts invite → 204 + new membership created', async () => {
    // Provision a real user in a different org (simulated by using a second provisioned user)
    const { user: existingUserDoc, token: existingUserToken } = await provisionUser(app, {
      oid: 'cross-tenant-user',
      role: UserRole.EMPLOYEE,
    });
    const existingUserId = String(existingUserDoc._id);
    const existingUserEmail = existingUserDoc.email;

    // Create invite targeting the existing user's email
    const { token } = await createInvite(app, adminToken, { email: existingUserEmail });

    // Accept with the existing user's session cookie
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/accept-invitation',
      headers: { cookie: `inv_access=${existingUserToken}` },
      payload: { token },
    });

    expect(res.statusCode).toBe(204);
    expect(res.cookies.some((c) => c.name === 'inv_access')).toBe(true);

    // Verify membership was created in the admin's org
    const membership = await app.mongo.db.collection('memberships').findOne({
      userId: existingUserId,
      deletedAt: null,
      status: 'ACTIVE',
    });
    expect(membership).not.toBeNull();
  });

  it('rejoin: reactivates soft-deleted membership instead of inserting new one', async () => {
    // Provision existing user
    const { user: existingUserDoc, token: existingUserToken } = await provisionUser(app, {
      oid: 'rejoin-user',
      role: UserRole.EMPLOYEE,
    });
    const existingUserId = String(existingUserDoc._id);
    const orgId = await resolveTestTenantId(app);

    // Directly insert a soft-deleted membership (simulates having left the org)
    const now = new Date().toISOString();
    const insertResult = await app.mongo.db.collection('memberships').insertOne({
      userId: existingUserId,
      organisationId: orgId,
      role: UserRole.EMPLOYEE,
      status: 'ACTIVE',
      isDefault: true,
      organizationalUnit: null,
      teams: [],
      invitedBy: 'test-setup',
      invitedAt: now,
      acceptedAt: now,
      mustChangePassword: false,
      lastAccessedAt: now,
      notifications: { email: true, push: false },
      createdAt: now,
      updatedAt: now,
      createdBy: 'test-setup',
      updatedBy: 'test-setup',
      deletedAt: now, // already soft-deleted
      deletedBy: existingUserId,
    });
    const originalId = insertResult.insertedId;

    // Create rejoin invite
    const { token } = await createInvite(app, adminToken, { email: existingUserDoc.email });

    // Accept
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/accept-invitation',
      headers: { cookie: `inv_access=${existingUserToken}` },
      payload: { token },
    });

    expect(res.statusCode).toBe(204);

    // Must be exactly one membership document (reactivated, not a new insert)
    const memberships = await app.mongo.db
      .collection('memberships')
      .find({ userId: existingUserId })
      .toArray();
    expect(memberships).toHaveLength(1);
    expect(String(memberships[0]!['_id'])).toBe(String(originalId));
    expect(memberships[0]!['deletedAt']).toBeNull();
    expect(memberships[0]!['status']).toBe('ACTIVE');

    // Audit action must be USER_REJOINED_ORGANISATION
    const audit = await app.mongo.db
      .collection('audit_logs')
      .findOne({ action: 'USER_REJOINED_ORGANISATION' });
    expect(audit).not.toBeNull();
  });

  it('double-accept: second accept returns 409, not 500', async () => {
    const { user: existingUserDoc, token: existingUserToken } = await provisionUser(app, {
      oid: 'double-accept-user',
      role: UserRole.EMPLOYEE,
    });
    const existingUserId = String(existingUserDoc._id);
    const orgId = await resolveTestTenantId(app);
    const { randomBytes: rb } = await import('node:crypto');

    // Helper: insert invite directly into DB with invitedUserId already set.
    // Bypasses POST /v1/invitations duplicate check which fires on active membership.
    const insertInviteWithUser = async (): Promise<string> => {
      const tok = rb(32).toString('hex');
      const now = new Date().toISOString();
      await app.mongo.db.collection('invitations').insertOne({
        email: existingUserDoc.email,
        organisationId: orgId,
        role: UserRole.EMPLOYEE,
        firstName: null,
        lastName: null,
        invitedUserId: existingUserId,
        token: tok,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        invitedBy: 'test-setup',
        status: 'PENDING',
        acceptedAt: null,
        membershipId: null,
        createdAt: now,
        updatedAt: now,
        createdBy: 'test-setup',
        updatedBy: 'test-setup',
        deletedAt: null,
        deletedBy: null,
      });
      return tok;
    };

    // First accept — cross-tenant, no membership yet → 204
    const token1 = await insertInviteWithUser();
    const res1 = await app.inject({
      method: 'POST',
      url: '/v1/auth/accept-invitation',
      headers: { cookie: `inv_access=${existingUserToken}` },
      payload: { token: token1 },
    });
    expect(res1.statusCode).toBe(204);

    // Second accept — membership already active → must be 409, never 500
    const token2 = await insertInviteWithUser();
    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/auth/accept-invitation',
      headers: { cookie: `inv_access=${existingUserToken}` },
      payload: { token: token2 },
    });
    expect(res2.statusCode).toBe(409);
  });
});

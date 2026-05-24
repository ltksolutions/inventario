// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Passkeys integration tests — ADR-0016 Slice #8 K14.
 *
 * Covers: registration flow, authentication flow, management endpoints,
 * error paths, counter regression warning.
 *
 * Uses synthetic WebAuthn attestations (see helpers/webauthn-fixtures.ts)
 * to simulate a real device without browser or hardware.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { provisionUser, resolveTestTenantId, UserRole } from '../helpers/test-fixtures.js';
import {
  createSyntheticAuthenticator,
  makeSyntheticAssertion,
  makeSyntheticAttestation,
} from '../helpers/webauthn-fixtures.js';

import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// WebAuthn test config — must match server config
// ---------------------------------------------------------------------------

const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe('Passkeys — registration + authentication + management', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env['WEBAUTHN_RP_ID'] = RP_ID;
    process.env['WEBAUTHN_RP_NAME'] = 'Inventario Test';
    process.env['WEBAUTHN_EXPECTED_ORIGINS'] = ORIGIN;

    app = await buildTestApp();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // Helpers
  // =========================================================================

  async function registerPasskeyForUser(token: string): Promise<{
    credentialId: string;
    authenticator: ReturnType<typeof createSyntheticAuthenticator>;
    passkeyId: string;
  }> {
    const authenticator = createSyntheticAuthenticator();

    // Get options
    const optionsRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/passkeys/register/options',
      payload: {},
      cookies: { inv_access: token },
    });
    expect(optionsRes.statusCode).toBe(200);
    const { options, challengeToken } = JSON.parse(optionsRes.body) as {
      options: { challenge: string; rp: { id: string } };
      challengeToken: string;
    };

    // Build synthetic attestation
    const attestation = makeSyntheticAttestation({
      authenticator,
      challenge: options.challenge,
      rpId: RP_ID,
      origin: ORIGIN,
    });

    // Verify
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/passkeys/register/verify',
      payload: {
        credential: attestation,
        challengeToken,
        deviceName: 'Test Device',
      },
      cookies: { inv_access: token },
    });
    expect(verifyRes.statusCode).toBe(201);

    const body = JSON.parse(verifyRes.body) as { passkey: { _id: string } };
    return {
      credentialId: authenticator.credentialId,
      authenticator,
      passkeyId: body.passkey._id,
    };
  }

  async function loginWithPasskey(
    authenticator: ReturnType<typeof createSyntheticAuthenticator>,
    email?: string,
  ): Promise<{ statusCode: number; cookies: string[] }> {
    // Get options
    const optionsRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/passkeys/login/options',
      payload: email ? { email } : {},
    });
    expect(optionsRes.statusCode).toBe(200);
    const { options, challengeToken } = JSON.parse(optionsRes.body) as {
      options: { challenge: string };
      challengeToken: string;
    };

    // Increment counter
    authenticator.counter += 1;

    // Build synthetic assertion
    const assertion = makeSyntheticAssertion({
      authenticator,
      challenge: options.challenge,
      rpId: RP_ID,
      origin: ORIGIN,
      newCounter: authenticator.counter,
    });

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/passkeys/login/verify',
      payload: { credential: assertion, challengeToken },
    });

    return {
      statusCode: verifyRes.statusCode,
      cookies: verifyRes.headers['set-cookie'] as string[],
    };
  }

  // =========================================================================
  // Registration happy path
  // =========================================================================

  describe('Registration', () => {
    it('K14-R1: registers a passkey and returns 201 with passkey metadata', async () => {
      const { user, token } = await provisionUser(app, { role: UserRole.EMPLOYEE });
      const { passkeyId } = await registerPasskeyForUser(token);

      expect(passkeyId).toBeTruthy();

      // User passkeyEnabled flag should be set
      const users = await app.mongo.db.collection('users').find({ email: user.email }).toArray();
      expect(users[0]?.['passkeyEnabled']).toBe(true);
    });

    it('K14-R2: excludes existing credentials in options to prevent duplicates', async () => {
      const { token } = await provisionUser(app, { role: UserRole.EMPLOYEE });
      await registerPasskeyForUser(token);

      // Get options again — should contain excludeCredentials
      const optionsRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/passkeys/register/options',
        payload: {},
        cookies: { inv_access: token },
      });
      expect(optionsRes.statusCode).toBe(200);
      const { options } = JSON.parse(optionsRes.body) as {
        options: { excludeCredentials: unknown[] };
      };
      expect(options.excludeCredentials).toHaveLength(1);
    });

    it('K14-R3: returns 400 for invalid challenge token', async () => {
      const { token } = await provisionUser(app, { role: UserRole.EMPLOYEE });
      const authenticator = createSyntheticAuthenticator();

      const optionsRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/passkeys/register/options',
        payload: {},
        cookies: { inv_access: token },
      });
      const { options } = JSON.parse(optionsRes.body) as { options: { challenge: string } };

      const attestation = makeSyntheticAttestation({
        authenticator,
        challenge: options.challenge,
        rpId: RP_ID,
        origin: ORIGIN,
      });

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/passkeys/register/verify',
        payload: {
          credential: attestation,
          challengeToken: 'invalid.challenge.token.that.is.long.enough',
          deviceName: 'Test',
        },
        cookies: { inv_access: token },
      });
      expect(verifyRes.statusCode).toBe(401);
    });

    it('K14-R4: returns 400 when RP ID mismatches', async () => {
      const { token } = await provisionUser(app, { role: UserRole.EMPLOYEE });
      const authenticator = createSyntheticAuthenticator();

      const optionsRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/passkeys/register/options',
        payload: {},
        cookies: { inv_access: token },
      });
      const { options, challengeToken } = JSON.parse(optionsRes.body) as {
        options: { challenge: string };
        challengeToken: string;
      };

      // Use wrong RP ID in attestation
      const attestation = makeSyntheticAttestation({
        authenticator,
        challenge: options.challenge,
        rpId: 'evil.example.com',
        origin: ORIGIN,
      });

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/passkeys/register/verify',
        payload: { credential: attestation, challengeToken },
        cookies: { inv_access: token },
      });
      expect(verifyRes.statusCode).toBe(400);
    });

    it('K14-R5: returns 400 when origin mismatches', async () => {
      const { token } = await provisionUser(app, { role: UserRole.EMPLOYEE });
      const authenticator = createSyntheticAuthenticator();

      const optionsRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/passkeys/register/options',
        payload: {},
        cookies: { inv_access: token },
      });
      const { options, challengeToken } = JSON.parse(optionsRes.body) as {
        options: { challenge: string };
        challengeToken: string;
      };

      const attestation = makeSyntheticAttestation({
        authenticator,
        challenge: options.challenge,
        rpId: RP_ID,
        origin: 'https://evil.example.com',
      });

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/passkeys/register/verify',
        payload: { credential: attestation, challengeToken },
        cookies: { inv_access: token },
      });
      expect(verifyRes.statusCode).toBe(400);
    });

    it('K14-R6: returns 401 for unauthenticated register request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/passkeys/register/options',
        payload: {},
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // Authentication happy path
  // =========================================================================

  describe('Authentication', () => {
    it('K14-A1: logs in with passkey (allow-credentials flow) and sets cookies', async () => {
      const { user, token } = await provisionUser(app, { role: UserRole.EMPLOYEE });

      // Seed membership for default tenant resolution
      const orgId = await resolveTestTenantId(app);
      await app.mongo.db.collection('memberships').insertOne({
        userId: String(user._id),
        organisationId: orgId,
        roles: [UserRole.EMPLOYEE],
        status: 'ACTIVE',
        isDefault: true,
        invitedBy: 'SYSTEM',
        invitedAt: new Date().toISOString(),
        acceptedAt: new Date().toISOString(),
        mustChangePassword: false,
        lastAccessedAt: null,
        notifications: { email: true, push: false },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'test',
        updatedBy: 'test',
        deletedAt: null,
        deletedBy: null,
        organizationalUnit: null,
        teams: [],
      });

      const { authenticator } = await registerPasskeyForUser(token);
      const { statusCode, cookies } = await loginWithPasskey(authenticator, user.email);

      expect(statusCode).toBe(204);
      expect(cookies).toBeDefined();
      const hasCookie = cookies.some((c: string) => c.includes('inv_access'));
      expect(hasCookie).toBe(true);
    });

    it('K14-A2: logs in without email (discovery/resident-key flow)', async () => {
      const { user, token } = await provisionUser(app, { role: UserRole.EMPLOYEE });
      const orgId = await resolveTestTenantId(app);
      await app.mongo.db.collection('memberships').insertOne({
        userId: String(user._id),
        organisationId: orgId,
        roles: [UserRole.EMPLOYEE],
        status: 'ACTIVE',
        isDefault: true,
        invitedBy: 'SYSTEM',
        invitedAt: new Date().toISOString(),
        acceptedAt: new Date().toISOString(),
        mustChangePassword: false,
        lastAccessedAt: null,
        notifications: { email: true, push: false },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'test',
        updatedBy: 'test',
        deletedAt: null,
        deletedBy: null,
        organizationalUnit: null,
        teams: [],
      });

      const { authenticator } = await registerPasskeyForUser(token);
      const { statusCode } = await loginWithPasskey(authenticator);
      expect(statusCode).toBe(204);
    });

    it('K14-A3: returns 401 for unknown credential ID', async () => {
      // No registered passkeys — any assertion should fail
      const authenticator = createSyntheticAuthenticator();

      const optionsRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/passkeys/login/options',
        payload: {},
      });
      const { options, challengeToken } = JSON.parse(optionsRes.body) as {
        options: { challenge: string };
        challengeToken: string;
      };
      authenticator.counter += 1;
      const assertion = makeSyntheticAssertion({
        authenticator,
        challenge: options.challenge,
        rpId: RP_ID,
        origin: ORIGIN,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/passkeys/login/verify',
        payload: { credential: assertion, challengeToken },
      });
      expect(res.statusCode).toBe(401);
    });

    it('K14-A4: returns 401 for invalid assertion (wrong signature)', async () => {
      const { user, token } = await provisionUser(app, { role: UserRole.EMPLOYEE });
      const orgId = await resolveTestTenantId(app);
      await app.mongo.db.collection('memberships').insertOne({
        userId: String(user._id),
        organisationId: orgId,
        roles: [UserRole.EMPLOYEE],
        status: 'ACTIVE',
        isDefault: true,
        invitedBy: 'SYSTEM',
        invitedAt: new Date().toISOString(),
        acceptedAt: new Date().toISOString(),
        mustChangePassword: false,
        lastAccessedAt: null,
        notifications: { email: true, push: false },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'test',
        updatedBy: 'test',
        deletedAt: null,
        deletedBy: null,
        organizationalUnit: null,
        teams: [],
      });

      const { authenticator } = await registerPasskeyForUser(token);

      const optionsRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/passkeys/login/options',
        payload: { email: user.email },
      });
      const { options, challengeToken } = JSON.parse(optionsRes.body) as {
        options: { challenge: string };
        challengeToken: string;
      };

      // Use different authenticator (wrong key) but same credentialId
      const wrongAuthenticator = createSyntheticAuthenticator();
      wrongAuthenticator.credentialId = authenticator.credentialId; // same ID, wrong key
      wrongAuthenticator.counter = 1;

      const badAssertion = makeSyntheticAssertion({
        authenticator: wrongAuthenticator,
        challenge: options.challenge,
        rpId: RP_ID,
        origin: ORIGIN,
        newCounter: 1,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/passkeys/login/verify',
        payload: { credential: badAssertion, challengeToken },
      });
      expect(res.statusCode).toBe(401);
    });

    it('K14-A5: returns 401 for expired challenge token', async () => {
      const authenticator = createSyntheticAuthenticator();
      authenticator.counter = 1;

      const assertion = makeSyntheticAssertion({
        authenticator,
        challenge: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo', // random base64url
        rpId: RP_ID,
        origin: ORIGIN,
        newCounter: 1,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/passkeys/login/verify',
        payload: {
          credential: assertion,
          challengeToken: 'clearly.invalid.jwt.token.long.enough',
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('K14-A6: returns 401 when user is inactive', async () => {
      const { user, token } = await provisionUser(app, { role: UserRole.EMPLOYEE });
      const orgId = await resolveTestTenantId(app);
      await app.mongo.db.collection('memberships').insertOne({
        userId: String(user._id),
        organisationId: orgId,
        roles: [UserRole.EMPLOYEE],
        status: 'ACTIVE',
        isDefault: true,
        invitedBy: 'SYSTEM',
        invitedAt: new Date().toISOString(),
        acceptedAt: new Date().toISOString(),
        mustChangePassword: false,
        lastAccessedAt: null,
        notifications: { email: true, push: false },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'test',
        updatedBy: 'test',
        deletedAt: null,
        deletedBy: null,
        organizationalUnit: null,
        teams: [],
      });

      const { authenticator } = await registerPasskeyForUser(token);

      // Deactivate user
      await app.mongo.db
        .collection('users')
        .updateOne({ email: user.email } as never, { $set: { isActive: false } });

      const { statusCode } = await loginWithPasskey(authenticator, user.email);
      expect(statusCode).toBe(401);
    });
  });

  // =========================================================================
  // Management endpoints
  // =========================================================================

  describe('Management', () => {
    it('K14-M1: lists user passkeys', async () => {
      const { token } = await provisionUser(app, { role: UserRole.EMPLOYEE });
      await registerPasskeyForUser(token);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/passkeys',
        cookies: { inv_access: token },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('K14-M2: renames a passkey', async () => {
      const { token } = await provisionUser(app, { role: UserRole.EMPLOYEE });
      const { passkeyId } = await registerPasskeyForUser(token);

      const renameRes = await app.inject({
        method: 'PATCH',
        url: `/v1/auth/passkeys/${passkeyId}`,
        payload: { deviceName: 'My iPhone' },
        cookies: { inv_access: token },
      });
      expect(renameRes.statusCode).toBe(204);

      // Verify new name in list
      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/auth/passkeys',
        cookies: { inv_access: token },
      });
      const body = JSON.parse(listRes.body) as { data: Array<{ deviceName: string }> };
      expect(body.data[0]?.deviceName).toBe('My iPhone');
    });

    it('K14-M3: deletes passkey and clears passkeyEnabled when last is removed', async () => {
      const { user, token } = await provisionUser(app, { role: UserRole.EMPLOYEE });
      const { passkeyId } = await registerPasskeyForUser(token);

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/v1/auth/passkeys/${passkeyId}`,
        cookies: { inv_access: token },
      });
      expect(deleteRes.statusCode).toBe(204);

      // passkeyEnabled should be false
      const users = await app.mongo.db.collection('users').find({ email: user.email }).toArray();
      expect(users[0]?.['passkeyEnabled']).toBeFalsy();

      // List should be empty
      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/auth/passkeys',
        cookies: { inv_access: token },
      });
      const body = JSON.parse(listRes.body) as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });
  });

  // =========================================================================
  // Counter regression (advisory)
  // =========================================================================

  describe('Counter regression', () => {
    it('K14-C1: login succeeds even when counter does not increment (synced passkey)', async () => {
      const { user, token } = await provisionUser(app, { role: UserRole.EMPLOYEE });
      const orgId = await resolveTestTenantId(app);
      await app.mongo.db.collection('memberships').insertOne({
        userId: String(user._id),
        organisationId: orgId,
        roles: [UserRole.EMPLOYEE],
        status: 'ACTIVE',
        isDefault: true,
        invitedBy: 'SYSTEM',
        invitedAt: new Date().toISOString(),
        acceptedAt: new Date().toISOString(),
        mustChangePassword: false,
        lastAccessedAt: null,
        notifications: { email: true, push: false },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'test',
        updatedBy: 'test',
        deletedAt: null,
        deletedBy: null,
        organizationalUnit: null,
        teams: [],
      });

      const { authenticator } = await registerPasskeyForUser(token);

      // Login with counter = 0 (simulates synced passkey that never increments)
      const optionsRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/passkeys/login/options',
        payload: { email: user.email },
      });
      const { options, challengeToken } = JSON.parse(optionsRes.body) as {
        options: { challenge: string };
        challengeToken: string;
      };

      const assertion = makeSyntheticAssertion({
        authenticator,
        challenge: options.challenge,
        rpId: RP_ID,
        origin: ORIGIN,
        newCounter: 0, // counter regression — advisory only
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/passkeys/login/verify',
        payload: { credential: assertion, challengeToken },
      });

      // Should still succeed (advisory, not blocking)
      expect(res.statusCode).toBe(204);
    });
  });
});

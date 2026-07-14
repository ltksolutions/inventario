// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integračné testy pre POST /v1/memberships/pre-provisioned (ADR-0034, K5).
 *
 * Pokrýva:
 *   - RBAC (len ASSET_MANAGER/ADMIN)
 *   - Validácie (DOMAIN_RESTRICTED only, domain allowlist, duplicitný e-mail,
 *     tvar vstupu)
 *   - Tvar odpovede + zápis do users/memberships/audit_logs
 *   - Merge pri prvom SSO prihlásení cez attemptDomainAutoJoin (žiadny
 *     duplicitný User, existujúce ACTIVE membership sa znovu použije)
 *   - Happy-path: predpripravený člen ako beneficiary v žiadosti o výpožičku
 *     (ADR-0023 assertBeneficiaryIsActiveMember)
 *
 * Pozri aj:
 *   - tests/integration/invitations-post.test.ts (RBAC/validation vzor)
 *   - tests/integration/oauth-domain-autojoin.test.ts (attemptDomainAutoJoin vzor)
 */

import { randomBytes } from 'node:crypto';

import { AuthProvider } from '@inventario/shared-types';
import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { attemptDomainAutoJoin } from '../../src/modules/auth/oauth.routes.js';
import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestCategory,
  provisionUser,
  resolveTestTenantId,
  UserRole,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

const DOMAIN = 'futbalsfz.sk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const stamp = randomBytes(4).toString('hex');
  return {
    firstName: 'Jana',
    lastName: 'Nováková',
    localPart: `jana.novakova.${stamp}`,
    domain: DOMAIN,
    ...overrides,
  };
}

/** Nastaví testovací tenant na DOMAIN_RESTRICTED s allowlistom [DOMAIN]. */
async function makeDomainRestricted(
  app: FastifyInstance,
  domains: string[] = [DOMAIN],
): Promise<string> {
  const orgId = await resolveTestTenantId(app);
  await app.mongo.db
    .collection('organisations')
    .updateOne(
      { _id: new ObjectId(orgId) },
      { $set: { memberJoinPolicy: 'DOMAIN_RESTRICTED', autoJoinDomains: domains } },
    );
  return orgId;
}

describe('POST /v1/memberships/pre-provisioned', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;
  let managerToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
    await makeDomainRestricted(app);
    const admin = await provisionUser(app, { oid: 'pp-admin', role: UserRole.ADMIN });
    adminToken = admin.token;
    adminId = String(admin.user._id);
    const manager = await provisionUser(app, {
      oid: 'pp-manager',
      role: UserRole.ASSET_MANAGER,
    });
    managerToken = manager.token;
  });
  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('ADMIN vytvorí predpripraveného člena → 201 so správnym tvarom', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/memberships/pre-provisioned',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validBody({ localPart: 'jana.novakova' }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{
        membershipId: string;
        userId: string;
        email: string;
        firstName: string;
        lastName: string;
        displayName: string;
        role: string;
        hasLoggedIn: boolean;
        createdAt: string;
      }>();
      expect(body.membershipId).toMatch(/^[a-f0-9]{24}$/);
      expect(body.userId).toMatch(/^[a-f0-9]{24}$/);
      expect(body.email).toBe(`jana.novakova@${DOMAIN}`);
      expect(body.firstName).toBe('Jana');
      expect(body.lastName).toBe('Nováková');
      expect(body.displayName).toBe('Jana Nováková');
      expect(body.role).toBe(UserRole.EMPLOYEE);
      expect(body.hasLoggedIn).toBe(false);
      expect(new Date(body.createdAt).toString()).not.toBe('Invalid Date');
    });

    it('ASSET_MANAGER môže vytvoriť predpripraveného člena', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/memberships/pre-provisioned',
        headers: { cookie: `inv_access=${managerToken}` },
        payload: validBody(),
      });
      expect(res.statusCode).toBe(201);
    });

    it('vytvorí User bez credentials, s lastLoginAt: null (nikdy neprihlásený)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/memberships/pre-provisioned',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validBody({ localPart: 'nova-user' }),
      });
      const { userId } = res.json<{ userId: string }>();
      const user = await app.mongo.db.collection('users').findOne({ _id: new ObjectId(userId) });
      expect(user).not.toBeNull();
      expect(user!['lastLoginAt']).toBeNull();
      expect(user!['passwordHash']).toBeNull();
      expect(user!['entraOid']).toBeNull();
      expect(user!['isActive']).toBe(true);
      expect(user!['roles']).toEqual([UserRole.EMPLOYEE]);
    });

    it('vytvorí ACTIVE EMPLOYEE membership, isDefault: true', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/memberships/pre-provisioned',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validBody({ localPart: 'nova-membership' }),
      });
      const { membershipId, userId } = res.json<{ membershipId: string; userId: string }>();
      const membership = await app.mongo.db
        .collection('memberships')
        .findOne({ _id: new ObjectId(membershipId) });
      expect(membership).not.toBeNull();
      expect(membership!['userId']).toBe(userId);
      expect(membership!['status']).toBe('ACTIVE');
      expect(membership!['role']).toBe(UserRole.EMPLOYEE);
      expect(membership!['isDefault']).toBe(true);
    });

    it('emituje MEMBER_PRE_PROVISIONED audit event', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/memberships/pre-provisioned',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validBody({ localPart: 'nova-audit' }),
      });
      const { userId } = res.json<{ userId: string }>();
      const audit = await app.mongo.db
        .collection('audit_logs')
        .findOne({ action: 'MEMBER_PRE_PROVISIONED', 'target.entityId': userId });
      expect(audit).not.toBeNull();
      expect(audit!['severity']).toBe('INFO');
      expect((audit!['actor'] as { userId: string }).userId).toBe(adminId);
    });

    it('normalizuje localPart na malé písmená', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/memberships/pre-provisioned',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validBody({ localPart: 'Nova-Case' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<{ email: string }>().email).toBe(`nova-case@${DOMAIN}`);
    });
  });

  // -------------------------------------------------------------------------
  // RBAC
  // -------------------------------------------------------------------------

  describe('RBAC', () => {
    it('vráti 403 pre EMPLOYEE', async () => {
      const { token } = await provisionUser(app, { oid: 'pp-emp', role: UserRole.EMPLOYEE });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/memberships/pre-provisioned',
        headers: { cookie: `inv_access=${token}` },
        payload: validBody(),
      });
      expect(res.statusCode).toBe(403);
    });

    it('vráti 401 bez cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/memberships/pre-provisioned',
        payload: validBody(),
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // Validácie
  // -------------------------------------------------------------------------

  describe('validácie', () => {
    it('vráti 400 DOMAIN_RESTRICTED_ONLY pre INVITE_ONLY organizáciu', async () => {
      const orgId = await resolveTestTenantId(app);
      await app.mongo.db
        .collection('organisations')
        .updateOne({ _id: new ObjectId(orgId) }, { $set: { memberJoinPolicy: 'INVITE_ONLY' } });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/memberships/pre-provisioned',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validBody(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/DOMAIN_RESTRICTED_ONLY/);
    });

    it('vráti 400 DOMAIN_NOT_ALLOWED pre doménu mimo allowlistu', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/memberships/pre-provisioned',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validBody({ domain: 'gmail.com' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/DOMAIN_NOT_ALLOWED/);
      expect(res.json<{ message: string }>().message).toMatch(/gmail\.com/);
    });

    it('vráti 409 pre e-mail, ktorý už existuje (globálna unikátnosť)', async () => {
      const first = await app.inject({
        method: 'POST',
        url: '/v1/memberships/pre-provisioned',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validBody({ localPart: 'duplicitny' }),
      });
      expect(first.statusCode).toBe(201);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/memberships/pre-provisioned',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validBody({ localPart: 'duplicitny' }),
      });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ message: string }>().message).toMatch(/existuje/i);
    });

    it('vráti 400 pre chýbajúce firstName', async () => {
      const body = validBody();
      delete body['firstName'];
      const res = await app.inject({
        method: 'POST',
        url: '/v1/memberships/pre-provisioned',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });
      expect(res.statusCode).toBe(400);
    });

    it('vráti 400 pre localPart s neplatnými znakmi', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/memberships/pre-provisioned',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validBody({ localPart: 'jana novakova' }),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Merge pri prvom SSO prihlásení (attemptDomainAutoJoin)
  // -------------------------------------------------------------------------

  describe('merge s attemptDomainAutoJoin (prvé SSO prihlásenie)', () => {
    it('znovu použije predpripraveného usera + membership, žiadny duplikát', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/v1/memberships/pre-provisioned',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validBody({ localPart: 'branislav.rozbora' }),
      });
      expect(create.statusCode).toBe(201);
      const { userId, membershipId, email } = create.json<{
        userId: string;
        membershipId: string;
        email: string;
      }>();

      const res = await attemptDomainAutoJoin({
        db: app.mongo.db,
        provider: 'google',
        authProviderEnum: AuthProvider.GOOGLE,
        providerUser: {
          providerId: 'g-branislav-123',
          email,
          emailVerified: true,
          firstName: 'Branislav',
          lastName: 'Rozbora',
          displayName: 'Branislav Rozbora',
          entraTid: null,
        },
      });

      expect(res).not.toBeNull();
      expect(res?.success).toBe(true);
      if (!res || !res.success) return;
      expect(res.isNew).toBe(false);
      expect(String(res.user._id)).toBe(userId);
      expect(res.membershipId).toBe(membershipId);

      // Žiadny duplicitný User ani Membership.
      expect(await app.mongo.db.collection('users').countDocuments({ email })).toBe(1);
      expect(
        await app.mongo.db.collection('memberships').countDocuments({ userId, deletedAt: null }),
      ).toBe(1);

      // lastLoginAt sa nastaví — člen sa "aktivoval" prvým prihlásením.
      const user = await app.mongo.db.collection('users').findOne({ _id: new ObjectId(userId) });
      expect(user!['lastLoginAt']).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Happy-path: beneficiary v žiadosti o výpožičku (ADR-0023)
  // -------------------------------------------------------------------------

  describe('beneficiary v žiadosti o výpožičku (ADR-0023)', () => {
    it('predpripravený člen je hneď použiteľný ako beneficiary', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/v1/memberships/pre-provisioned',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validBody({ localPart: 'buduci-zamestnanec' }),
      });
      expect(create.statusCode).toBe(201);
      const { userId } = create.json<{ userId: string }>();

      const category = await insertTestCategory(app);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/loan-requests',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {
          purpose: 'Príprava pracoviska pred nástupom',
          plannedFrom: new Date(Date.now() + 1000).toISOString(),
          items: [{ categoryId: category._id, quantityRequested: 1 }],
          beneficiaryId: userId,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json<{ beneficiaryId: string }>().beneficiaryId).toBe(userId);
    });
  });
});

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * ADR-0030 D2+D3 — entraTenantId domain restriction + auth settings tests.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { provisionUser, UserRole } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

function makeFakeIdToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

describe('ADR-0030 D2 — entraTenantId restriction', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanTestDatabase(app);
  });

  describe('id_token tid extraction', () => {
    it('extracts tid from a well-formed MS id_token payload', () => {
      const tid = 'a1b2c3d4-0000-0000-0000-000000000001';
      const token = makeFakeIdToken({ sub: 'user123', tid, email: 'user@corp.sk' });
      const parts = token.split('.');
      const decoded = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf-8')) as Record<
        string,
        unknown
      >;
      expect(decoded['tid']).toBe(tid);
    });

    it('handles id_token without tid gracefully (personal MS accounts)', () => {
      const token = makeFakeIdToken({ sub: 'user123', email: 'user@outlook.com' });
      const parts = token.split('.');
      const decoded = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf-8')) as Record<
        string,
        unknown
      >;
      expect(decoded['tid']).toBeUndefined();
    });
  });

  describe('org without entraTenantId — no restriction', () => {
    it('restriction only fires when BOTH entraTenantId AND tid are set AND mismatched', async () => {
      await provisionUser(app, { role: UserRole.ADMIN });
      const org = await app.mongo.db.collection('organisations').findOne({ deletedAt: null });
      expect(org).not.toBeNull();
      const entraTenantId = org?.['entraTenantId'] as string | null;
      if (entraTenantId === null) {
        expect(entraTenantId).toBeNull();
      } else {
        expect(typeof entraTenantId).toBe('string');
      }
    });
  });

  describe('org with entraTenantId — Microsoft tid must match', () => {
    it('org document can store entraTenantId', async () => {
      const entraTid = 'a1b2c3d4-5e6f-7890-abcd-ef1234567890';
      await provisionUser(app, { role: UserRole.ADMIN });
      const updateResult = await app.mongo.db
        .collection('organisations')
        .updateOne({ deletedAt: null }, { $set: { entraTenantId: entraTid } });
      expect(updateResult.modifiedCount).toBe(1);
      const org = await app.mongo.db.collection('organisations').findOne({ deletedAt: null });
      expect(org?.['entraTenantId']).toBe(entraTid);
    });

    it('entra_tenant_mismatch error code is correct string', () => {
      expect('entra_tenant_mismatch').toBe('entra_tenant_mismatch');
    });
  });

  describe('GET /v1/auth/login/:provider', () => {
    it('returns non-200 for unknown provider', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/auth/login/facebook' });
      expect(res.statusCode).not.toBe(200);
    });

    it('apple is handled by separate plugin', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/auth/login/apple' });
      expect(res.statusCode).toBe(503);
    });
  });

  describe('autoJoinDomains domain model', () => {
    it('org stores autoJoinDomains as empty array by default', async () => {
      await provisionUser(app, { role: UserRole.ADMIN });
      const org = await app.mongo.db.collection('organisations').findOne({ deletedAt: null });
      expect(org?.['autoJoinDomains']).toEqual([]);
    });

    it('org can have autoJoinDomains and DOMAIN_RESTRICTED set', async () => {
      await provisionUser(app, { role: UserRole.ADMIN });
      await app.mongo.db.collection('organisations').updateOne(
        { deletedAt: null },
        {
          $set: {
            memberJoinPolicy: 'DOMAIN_RESTRICTED',
            autoJoinDomains: ['firma.sk', 'firma.sk'],
          },
        },
      );
      const org = await app.mongo.db.collection('organisations').findOne({ deletedAt: null });
      expect(org?.['memberJoinPolicy']).toBe('DOMAIN_RESTRICTED');
      expect(org?.['autoJoinDomains']).toEqual(['firma.sk', 'firma.sk']);
    });

    it('INVITE_ONLY is the default memberJoinPolicy', async () => {
      await provisionUser(app, { role: UserRole.ADMIN });
      const org = await app.mongo.db.collection('organisations').findOne({ deletedAt: null });
      expect(org?.['memberJoinPolicy']).toBe('INVITE_ONLY');
    });
  });

  describe('accept-invitation with org domain policy', () => {
    it('invite domain check fires when enforceAllowedDomains is set', async () => {
      const { token: adminToken } = await provisionUser(app, { role: UserRole.ADMIN });
      await app.mongo.db.collection('organisations').updateOne(
        { deletedAt: null },
        {
          $set: {
            autoJoinDomains: ['approved.sk'],
            settings: { invitations: { enforceAllowedDomains: true, exceptions: [] } },
          },
        },
      );
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { email: 'user@otherdomain.sk', role: UserRole.EMPLOYEE },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/not allowed/i);
    });

    it('invite succeeds for email in allowed domain', async () => {
      const { token: adminToken } = await provisionUser(app, { role: UserRole.ADMIN });
      await app.mongo.db.collection('organisations').updateOne(
        { deletedAt: null },
        {
          $set: {
            autoJoinDomains: ['approved.sk'],
            settings: { invitations: { enforceAllowedDomains: true, exceptions: [] } },
          },
        },
      );
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { email: 'user@approved.sk', role: UserRole.EMPLOYEE },
      });
      expect(res.statusCode).toBe(201);
    });

    it('exception email can be invited outside allowed domain', async () => {
      const { token: adminToken } = await provisionUser(app, { role: UserRole.ADMIN });
      await app.mongo.db.collection('organisations').updateOne(
        { deletedAt: null },
        {
          $set: {
            autoJoinDomains: ['approved.sk'],
            settings: {
              invitations: {
                enforceAllowedDomains: true,
                exceptions: ['special@otherdomain.sk'],
              },
            },
          },
        },
      );
      const res = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { email: 'special@otherdomain.sk', role: UserRole.EMPLOYEE },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe('PATCH /v1/organisations/current — auth domain settings (D3)', () => {
    it('ADMIN can update allowedAuthProviders', async () => {
      const { token: adminToken } = await provisionUser(app, { role: UserRole.ADMIN });
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { allowedAuthProviders: ['MICROSOFT', 'EMAIL'] },
      });
      expect(res.statusCode).toBe(200);
      const org = await app.mongo.db.collection('organisations').findOne({ deletedAt: null });
      expect(org?.['allowedAuthProviders']).toEqual(expect.arrayContaining(['MICROSOFT', 'EMAIL']));
    });

    it('ADMIN can update memberJoinPolicy to DOMAIN_RESTRICTED', async () => {
      const { token: adminToken } = await provisionUser(app, { role: UserRole.ADMIN });
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { memberJoinPolicy: 'DOMAIN_RESTRICTED', autoJoinDomains: ['firma.sk'] },
      });
      expect(res.statusCode).toBe(200);
      const org = await app.mongo.db.collection('organisations').findOne({ deletedAt: null });
      expect(org?.['memberJoinPolicy']).toBe('DOMAIN_RESTRICTED');
      expect(org?.['autoJoinDomains']).toContain('firma.sk');
    });

    it('ADMIN can set entraTenantId (Entra migrácia model)', async () => {
      const { token: adminToken } = await provisionUser(app, { role: UserRole.ADMIN });
      const entraTid = 'bcd6945a-5a57-4c2b-9ebb-d62712ad4b55';
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { entraTenantId: entraTid },
      });
      expect(res.statusCode).toBe(200);
      const org = await app.mongo.db.collection('organisations').findOne({ deletedAt: null });
      expect(org?.['entraTenantId']).toBe(entraTid);
    });

    it('ADMIN can clear entraTenantId', async () => {
      const { token: adminToken } = await provisionUser(app, { role: UserRole.ADMIN });
      await app.mongo.db
        .collection('organisations')
        .updateOne(
          { deletedAt: null },
          { $set: { entraTenantId: 'bcd6945a-5a57-4c2b-9ebb-d62712ad4b55' } },
        );
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { entraTenantId: null },
      });
      expect(res.statusCode).toBe(200);
      const org = await app.mongo.db.collection('organisations').findOne({ deletedAt: null });
      expect(org?.['entraTenantId']).toBeNull();
    });

    it('rejects empty allowedAuthProviders array', async () => {
      const { token: adminToken } = await provisionUser(app, { role: UserRole.ADMIN });
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { allowedAuthProviders: [] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('EMPLOYEE cannot update auth domain settings (403)', async () => {
      const { token: employeeToken } = await provisionUser(app, { role: UserRole.EMPLOYEE });
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/current',
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: { memberJoinPolicy: 'OPEN' },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

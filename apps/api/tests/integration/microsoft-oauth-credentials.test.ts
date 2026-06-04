// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { provisionUser, UserRole } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('ADR-0031 E5 — PATCH microsoftOAuth + read path strip', () => {
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

  it('GET /current does not return clientSecretEncrypted', async () => {
    const { token } = await provisionUser(app, { role: UserRole.ADMIN });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/organisations/current',
      headers: { cookie: `inv_access=${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();

    // oauthCredentials may be null or an object — never contains clientSecretEncrypted
    const oauthCreds = body['oauthCredentials'] as Record<string, unknown> | null;
    if (oauthCreds) {
      const ms = oauthCreds['microsoft'] as Record<string, unknown> | null;
      if (ms) {
        expect(ms).not.toHaveProperty('clientSecretEncrypted');
        expect(ms).toHaveProperty('hasSecret');
      }
    }
  });

  it('ADMIN can set microsoftOAuth credentials', async () => {
    const { token } = await provisionUser(app, { role: UserRole.ADMIN });

    // OAUTH_SECRET_ENCRYPTION_KEY musí byť nastavený v test env
    // (buildTestApp nastaví ephemeral MFA key; pre OAuth test ho simulujeme)
    process.env['OAUTH_SECRET_ENCRYPTION_KEY'] = 'a'.repeat(64);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/organisations/current',
      headers: { cookie: `inv_access=${token}` },
      payload: {
        microsoftOAuth: {
          clientId: 'test-azure-client-id',
          clientSecret: 'test-azure-client-secret',
          tenantMode: 'organizations',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();

    const oauthCreds = body['oauthCredentials'] as Record<string, unknown> | null;
    expect(oauthCreds).not.toBeNull();
    const ms = oauthCreds?.['microsoft'] as Record<string, unknown> | null;
    expect(ms).not.toBeNull();
    expect(ms?.['clientId']).toBe('test-azure-client-id');
    expect(ms?.['hasSecret']).toBe(true);
    // Secret NIKDY nevracia
    expect(ms).not.toHaveProperty('clientSecretEncrypted');

    // Overiť že sa zašifroval v DB (nie plaintext)
    const org = await app.mongo.db.collection('organisations').findOne({ deletedAt: null });
    const dbMs = (org?.['oauthCredentials'] as Record<string, unknown> | null)?.[
      'microsoft'
    ] as Record<string, unknown> | null;
    expect(dbMs?.['clientId']).toBe('test-azure-client-id');
    expect(typeof dbMs?.['clientSecretEncrypted']).toBe('string');
    expect(dbMs?.['clientSecretEncrypted']).not.toBe('test-azure-client-secret'); // zašifrovaný
    expect((dbMs?.['clientSecretEncrypted'] as string).split(':').length).toBe(3); // iv:tag:ct

    delete process.env['OAUTH_SECRET_ENCRYPTION_KEY'];
  });

  it('ADMIN can clear microsoftOAuth (null = back to platform fallback)', async () => {
    const { token } = await provisionUser(app, { role: UserRole.ADMIN });

    process.env['OAUTH_SECRET_ENCRYPTION_KEY'] = 'a'.repeat(64);

    // Najprv nastav
    await app.inject({
      method: 'PATCH',
      url: '/v1/organisations/current',
      headers: { cookie: `inv_access=${token}` },
      payload: {
        microsoftOAuth: {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          tenantMode: 'organizations',
        },
      },
    });

    // Potom vymaz
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/organisations/current',
      headers: { cookie: `inv_access=${token}` },
      payload: { microsoftOAuth: null },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    const oauthCreds = body['oauthCredentials'] as Record<string, unknown> | null;
    const ms = oauthCreds?.['microsoft'] as Record<string, unknown> | null;
    expect(ms).toBeNull();

    delete process.env['OAUTH_SECRET_ENCRYPTION_KEY'];
  });

  it('returns 200 when microsoftOAuth not in body (unchanged)', async () => {
    const { token } = await provisionUser(app, { role: UserRole.ADMIN });

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/organisations/current',
      headers: { cookie: `inv_access=${token}` },
      payload: { displayName: 'Updated Name' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('EMPLOYEE cannot PATCH microsoftOAuth (403)', async () => {
    const { token } = await provisionUser(app, { role: UserRole.EMPLOYEE });

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/organisations/current',
      headers: { cookie: `inv_access=${token}` },
      payload: {
        microsoftOAuth: {
          clientId: 'test-client-id',
          clientSecret: 'test-secret',
        },
      },
    });

    expect(res.statusCode).toBe(403);
  });
});

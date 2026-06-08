// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integračné testy pre auto-join podľa firemnej domény (DOMAIN_RESTRICTED).
 *
 * Testujeme `attemptDomainAutoJoin` priamo proti testovacej DB — pokrýva
 * REÁLNY zápis používateľa + členstva, ktorý čistá unit funkcia
 * (selectAutoJoinOrg) nevie overiť. Obchádzame HTTP/Arctic vrstvu zámerne:
 * mockovať celý OAuth callback (PKCE, state cookie, výmena code→token,
 * Graph /me) by bolo krehké lešenie; rozhodovacia logika je v čistej
 * funkcii a tu overujeme dôsledky na DB.
 *
 * Pozri aj:
 *   - tests/unit/auto-join.test.ts (čistá logika výberu org)
 */

import { AuthProvider } from '@inventario/shared-types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { attemptDomainAutoJoin } from '../../src/modules/auth/oauth.routes.js';
import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { insertTestUser } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

const ENTRA_TENANT = 'bcd6945a-5a57-4c2b-9ebb-d62712ad4b55';
const DOMAIN = 'futbalsfz.sk';

describe('attemptDomainAutoJoin (firemná doména → auto-join)', () => {
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

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  async function seedOrg(overrides: Record<string, unknown> = {}): Promise<string> {
    const now = new Date().toISOString();
    const doc = {
      displayName: 'Auto-join Org',
      slug: `aj-${Math.random().toString(36).slice(2, 10)}`,
      entraTenantId: null,
      customDomain: null,
      status: 'ACTIVE',
      plan: 'FREE',
      primaryContactEmail: null,
      brandKit: null,
      settings: {},
      allowedAuthProviders: ['MICROSOFT', 'GOOGLE', 'APPLE', 'EMAIL'],
      memberJoinPolicy: 'DOMAIN_RESTRICTED',
      autoJoinDomains: [DOMAIN],
      appBaseUrl: null,
      publicAssetLookup: false,
      foundContactInfo: null,
      inventoryNumberFormat: null,
      protocolSettings: null,
      labelPrinting: null,
      oauthCredentials: null,
      createdAt: now,
      updatedAt: now,
      createdBy: 'test',
      updatedBy: 'test',
      deletedAt: null,
      deletedBy: null,
      ...overrides,
    };
    const r = await app.mongo.db.collection('organisations').insertOne(doc);
    return String(r.insertedId);
  }

  interface TestProviderUser {
    providerId: string;
    email: string;
    emailVerified: boolean;
    firstName: string;
    lastName: string;
    displayName: string;
    entraTid: string | null;
  }

  function providerUser(overrides: Partial<TestProviderUser> = {}): TestProviderUser {
    return {
      providerId: `ms-${Math.random().toString(36).slice(2, 12)}`,
      email: `branislav.rozbora@${DOMAIN}`,
      emailVerified: true,
      firstName: 'Branislav',
      lastName: 'Rozbora',
      displayName: 'Branislav Rozbora',
      entraTid: ENTRA_TENANT,
      ...overrides,
    };
  }

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('založí používateľa + ACTIVE EMPLOYEE členstvo pri zhode domény (Microsoft, tid sedí)', async () => {
    const orgId = await seedOrg({ entraTenantId: ENTRA_TENANT });
    const pu = providerUser();

    const res = await attemptDomainAutoJoin({
      db: app.mongo.db,
      provider: 'microsoft',
      authProviderEnum: AuthProvider.MICROSOFT,
      providerUser: pu,
    });

    expect(res).not.toBeNull();
    expect(res?.success).toBe(true);
    if (!res || !res.success) return;
    expect(String(res.org._id)).toBe(orgId);
    expect(res.role).toBe('EMPLOYEE');
    expect(res.isNew).toBe(true);
    expect(res.wasInvite).toBe(false);

    // Používateľ existuje a má naviazaný Microsoft provider.
    const user = await app.mongo.db.collection('users').findOne({ email: pu.email });
    expect(user).not.toBeNull();
    const providers = (user?.['authProviders'] ?? []) as Array<{ provider: string }>;
    expect(providers.some((p) => p.provider === AuthProvider.MICROSOFT)).toBe(true);

    // Členstvo ACTIVE EMPLOYEE v správnej org, default (prvé členstvo).
    const membership = await app.mongo.db.collection('memberships').findOne({
      userId: String(user?.['_id']),
      organisationId: orgId,
    });
    expect(membership).not.toBeNull();
    expect(membership?.['status']).toBe('ACTIVE');
    expect(membership?.['role']).toBe('EMPLOYEE');
    expect(membership?.['isDefault']).toBe(true);
  });

  it('Google: tenant check sa neuplatní, auto-join prejde', async () => {
    const orgId = await seedOrg({ entraTenantId: ENTRA_TENANT });
    const res = await attemptDomainAutoJoin({
      db: app.mongo.db,
      provider: 'google',
      authProviderEnum: AuthProvider.GOOGLE,
      providerUser: providerUser({ entraTid: null, providerId: 'g-123' }),
    });
    expect(res?.success).toBe(true);
    if (!res || !res.success) return;
    expect(String(res.org._id)).toBe(orgId);
  });

  it('existujúcemu používateľovi (podľa e-mailu) dolinkuje provider a vytvorí členstvo, bez duplicitného usera', async () => {
    const orgId = await seedOrg({ entraTenantId: ENTRA_TENANT });
    const email = `branislav.rozbora@${DOMAIN}`;
    // Existujúci LOCAL účet s týmto e-mailom, ZÁMERNE bez členstva v cieľovej org.
    await insertTestUser(app, { email, accountType: 'LOCAL', createMembership: false });

    const res = await attemptDomainAutoJoin({
      db: app.mongo.db,
      provider: 'microsoft',
      authProviderEnum: AuthProvider.MICROSOFT,
      providerUser: providerUser({ email }),
    });

    expect(res?.success).toBe(true);
    if (!res || !res.success) return;
    expect(res.isNew).toBe(false);

    const userCount = await app.mongo.db.collection('users').countDocuments({ email });
    expect(userCount).toBe(1);
    const membershipCount = await app.mongo.db
      .collection('memberships')
      .countDocuments({ organisationId: orgId });
    expect(membershipCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Negatívne prípady → null, žiadny zápis
  // -------------------------------------------------------------------------

  it('vráti null pre INVITE_ONLY org (žiadny auto-join, žiadny zápis)', async () => {
    await seedOrg({ memberJoinPolicy: 'INVITE_ONLY', entraTenantId: ENTRA_TENANT });
    const res = await attemptDomainAutoJoin({
      db: app.mongo.db,
      provider: 'microsoft',
      authProviderEnum: AuthProvider.MICROSOFT,
      providerUser: providerUser(),
    });
    expect(res).toBeNull();
    expect(await app.mongo.db.collection('users').countDocuments({})).toBe(0);
    expect(await app.mongo.db.collection('memberships').countDocuments({})).toBe(0);
  });

  it('vráti null keď Microsoft tid nesedí s org.entraTenantId', async () => {
    await seedOrg({ entraTenantId: ENTRA_TENANT });
    const res = await attemptDomainAutoJoin({
      db: app.mongo.db,
      provider: 'microsoft',
      authProviderEnum: AuthProvider.MICROSOFT,
      providerUser: providerUser({ entraTid: 'iny-tenant' }),
    });
    expect(res).toBeNull();
    expect(await app.mongo.db.collection('users').countDocuments({})).toBe(0);
  });

  it('vráti null keď doménu nárokuje viac orgov (nejednoznačné → pozvánka)', async () => {
    await seedOrg({ entraTenantId: null });
    await seedOrg({ entraTenantId: null });
    const res = await attemptDomainAutoJoin({
      db: app.mongo.db,
      provider: 'microsoft',
      authProviderEnum: AuthProvider.MICROSOFT,
      providerUser: providerUser({ entraTid: null }),
    });
    expect(res).toBeNull();
    expect(await app.mongo.db.collection('memberships').countDocuments({})).toBe(0);
  });

  it('vráti null keď doména nesedí žiadnej org', async () => {
    await seedOrg({ entraTenantId: null });
    const res = await attemptDomainAutoJoin({
      db: app.mongo.db,
      provider: 'microsoft',
      authProviderEnum: AuthProvider.MICROSOFT,
      providerUser: providerUser({ email: 'niekto@gmail.com', entraTid: null }),
    });
    expect(res).toBeNull();
  });

  it('vráti null pri neovereom e-maile (emailVerified=false)', async () => {
    await seedOrg({ entraTenantId: null });
    const res = await attemptDomainAutoJoin({
      db: app.mongo.db,
      provider: 'microsoft',
      authProviderEnum: AuthProvider.MICROSOFT,
      providerUser: providerUser({ emailVerified: false, entraTid: null }),
    });
    expect(res).toBeNull();
    expect(await app.mongo.db.collection('users').countDocuments({})).toBe(0);
  });
});

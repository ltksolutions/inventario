// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Unit tests pre `createDynamicCorsOrigin` (ADR-0035 F4).
 *
 * Volá resolver priamo (nie cez skutočný CORS preflight/`app.inject`) —
 * testuje presne tú bezpečnostne citlivú logiku, ktorú si vyžiadala
 * nezávislá revízia (should-fix položky #1 a #2): striktná zhoda hostname
 * proti `customDomain`, https-only, žiadny neštandardný port, fail-closed
 * pre soft-deleted a chýbajúcu organizáciu.
 */

import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDynamicCorsOrigin } from '../../src/modules/organisations/dynamic-cors.js';
import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { resolveTestTenantId } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('createDynamicCorsOrigin (ADR-0035 F4)', () => {
  let app: FastifyInstance;
  let tenantId: string;
  const customDomain = 'majetok.example-test.sk';

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
    tenantId = await resolveTestTenantId(app);
    await app.mongo.db
      .collection('organisations')
      .updateOne({ _id: new ObjectId(tenantId) }, { $set: { customDomain } });
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  it('povolí https origin s presnou zhodou na customDomain', async () => {
    const dynamicCorsOrigin = createDynamicCorsOrigin(app);
    await expect(dynamicCorsOrigin(`https://${customDomain}`)).resolves.toBe(true);
  });

  it('zamietne http (nešifrovaný) origin aj pre registrovanú doménu', async () => {
    const dynamicCorsOrigin = createDynamicCorsOrigin(app);
    await expect(dynamicCorsOrigin(`http://${customDomain}`)).resolves.toBe(false);
  });

  it('zamietne origin s neštandardným portom', async () => {
    const dynamicCorsOrigin = createDynamicCorsOrigin(app);
    await expect(dynamicCorsOrigin(`https://${customDomain}:8443`)).resolves.toBe(false);
  });

  it('zamietne neregistrovanú doménu (no oracle — rovnaká false ako pri chybe)', async () => {
    const dynamicCorsOrigin = createDynamicCorsOrigin(app);
    await expect(dynamicCorsOrigin('https://neexistuje.example.sk')).resolves.toBe(false);
  });

  it('zamietne doménu patriacu soft-deleted organizácii', async () => {
    await app.mongo.db
      .collection('organisations')
      .updateOne(
        { _id: new ObjectId(tenantId) },
        { $set: { deletedAt: new Date().toISOString(), deletedBy: 'test' } },
      );

    const dynamicCorsOrigin = createDynamicCorsOrigin(app);
    await expect(dynamicCorsOrigin(`https://${customDomain}`)).resolves.toBe(false);
  });

  it('povolí chýbajúci Origin header (same-origin/server-to-server, nie je to autentifikačná kontrola)', async () => {
    const dynamicCorsOrigin = createDynamicCorsOrigin(app);
    await expect(dynamicCorsOrigin(undefined)).resolves.toBe(true);
  });

  it('zamietne nevalidný Origin header', async () => {
    const dynamicCorsOrigin = createDynamicCorsOrigin(app);
    await expect(dynamicCorsOrigin('not-a-valid-url')).resolves.toBe(false);
  });

  it('nerozšíri zhodu na iný hostname s customDomain ako podreťazcom (žiadne wildcard/prefix matchovanie)', async () => {
    const dynamicCorsOrigin = createDynamicCorsOrigin(app);
    await expect(dynamicCorsOrigin(`https://evil-${customDomain}`)).resolves.toBe(false);
    await expect(dynamicCorsOrigin(`https://${customDomain}.evil.sk`)).resolves.toBe(false);
  });

  it('cachuje výsledok — druhé volanie pre rovnaký hostname nevyžaduje nový DB dotaz', async () => {
    const dynamicCorsOrigin = createDynamicCorsOrigin(app);
    const first = await dynamicCorsOrigin(`https://${customDomain}`);
    // Zmažeme organizáciu priamo v DB — ak by druhé volanie nešlo z cache,
    // dostali by sme false. Toto len overuje, že cache existuje a niečo
    // vracia do vypršania TTL; presné načasovanie TTL netestujeme (60s je
    // príliš dlhé na jednotkový test bez fake timers).
    await app.mongo.db.collection('organisations').deleteOne({ _id: new ObjectId(tenantId) });
    const second = await dynamicCorsOrigin(`https://${customDomain}`);
    expect(first).toBe(true);
    expect(second).toBe(true);
  });
});

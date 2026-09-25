// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for GET /v1/assets?q= — serverové vyhľadávanie.
 *
 * Predtým sa hľadalo len klientsky nad aktuálnou stránkou (20 položiek)
 * a len v `inventoryNumber` + `name`. Položky na ďalších stránkach a
 * hľadanie podľa sériového čísla sa nenašli.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import { insertTestAsset, provisionUser, UserRole } from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

interface ListBody {
  data: Array<{ _id: string; name: string }>;
  pagination: { total: number; limit: number; skip: number; hasMore: boolean };
}

describe('GET /v1/assets?q=', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
    const provisioned = await provisionUser(app, {
      oid: 'viewer-for-search',
      role: UserRole.ADMIN,
    });
    token = provisioned.token;
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  async function search(q: string, extra = ''): Promise<ListBody> {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/assets?q=${encodeURIComponent(q)}${extra}`,
      headers: { cookie: `inv_access=${token}` },
    });
    expect(res.statusCode).toBe(200);
    return res.json<ListBody>();
  }

  it('finds an asset by serial number (case-insensitive)', async () => {
    const hit = await insertTestAsset(app, { name: 'Notebook', serialNumber: 'SN-ABC-12345' });
    await insertTestAsset(app, { name: 'Projektor', serialNumber: 'XYZ-999' });

    const body = await search('abc-123');
    expect(body.data.map((a) => a._id)).toEqual([hit._id]);
    expect(body.pagination.total).toBe(1);
  });

  it.each([
    ['name', { name: 'Futbalová lopta Adidas' }, 'lopta'],
    ['inventoryNumber', { inventoryNumber: 'SFZ-2026-0042' }, '2026-0042'],
    ['manufacturer', { manufacturer: 'Lenovo' }, 'lenovo'],
    ['model', { model: 'ThinkPad X1 Carbon' }, 'x1 carbon'],
    ['description', { description: 'Rezerva pre reprezentačný výjazd' }, 'výjazd'],
  ] as const)('finds an asset by %s', async (_field, fields, q) => {
    const hit = await insertTestAsset(app, fields);
    await insertTestAsset(app, { name: 'Iná vec' });

    const body = await search(q);
    expect(body.data.map((a) => a._id)).toEqual([hit._id]);
  });

  it('searches across all pages, not only the current one', async () => {
    for (let i = 0; i < 25; i++) {
      await insertTestAsset(app, { name: `Kužeľ ${i}` });
    }
    // Najstaršia položka — pri sort createdAt:-1 by bola až na 2. stránke.
    const hit = await insertTestAsset(app, { name: 'Dres', serialNumber: 'HIDDEN-01' });
    await app.mongo.db
      .collection('assets')
      .updateOne(
        { serialNumber: 'HIDDEN-01' },
        { $set: { createdAt: '2000-01-01T00:00:00.000Z' } },
      );

    const body = await search('hidden', '&limit=20&skip=0');
    expect(body.data.map((a) => a._id)).toEqual([hit._id]);
    expect(body.pagination.total).toBe(1);
  });

  it('treats regex metacharacters literally', async () => {
    const hit = await insertTestAsset(app, { name: 'Kábel (2m)', serialNumber: 'A.B*C' });
    await insertTestAsset(app, { name: 'Kábel 2m', serialNumber: 'AxBBBC' });

    expect((await search('A.B*C')).data.map((a) => a._id)).toEqual([hit._id]);
    expect((await search('(2m)')).data.map((a) => a._id)).toEqual([hit._id]);
  });

  it('does not leak assets of another tenant', async () => {
    await insertTestAsset(app, {
      name: 'Cudzí notebook',
      serialNumber: 'FOREIGN-1',
      organisationId: '0000000000000000000000ff',
    });

    const body = await search('foreign');
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(0);
  });

  it('returns the full list when q is omitted', async () => {
    await insertTestAsset(app, { name: 'A' });
    await insertTestAsset(app, { name: 'B' });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/assets',
      headers: { cookie: `inv_access=${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<ListBody>().pagination.total).toBe(2);
  });

  it('rejects q longer than 200 characters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/assets?q=${'a'.repeat(201)}`,
      headers: { cookie: `inv_access=${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/assets?q=abc' });
    expect(res.statusCode).toBe(401);
  });
});

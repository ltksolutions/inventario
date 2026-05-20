/**
 * Integration tests for audit log creation on asset CRUD — Slice #6c K17 (cookie auth).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestAsset,
  provisionUser,
  seedAssetFkRefs,
  UserRole,
  validCreateAssetBody,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

interface AuditLogDoc {
  at: string;
  action: string;
  actor: { userId: string; displayName: string; accountType: string };
  target: { entityType: string; entityId: string; snapshot?: Record<string, unknown> };
  description: string;
  changes: Array<{ field: string; before: unknown; after: unknown }> | null;
  severity: string;
}

describe('Audit log on /v1/assets operations', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;
  let adminDisplayName: string;
  let fkCategoryId: string;
  let fkLocationId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);
    const { user, token } = await provisionUser(app, {
      oid: 'admin-for-audit',
      role: UserRole.ADMIN,
    });
    adminToken = token;
    adminId = String(user._id);
    adminDisplayName = user.displayName;
    const fk = await seedAssetFkRefs(app);
    fkCategoryId = fk.categoryId;
    fkLocationId = fk.locationId;
  });

  const bodyWithFk = (overrides: Record<string, unknown> = {}) =>
    validCreateAssetBody({ categoryId: fkCategoryId, locationId: fkLocationId, ...overrides });

  async function readAuditLogsFor(entityId: string): Promise<AuditLogDoc[]> {
    return app.mongo.db
      .collection<AuditLogDoc>('audit_logs')
      .find({ 'target.entityId': entityId })
      .sort({ at: 1 })
      .toArray();
  }

  describe('POST creates ASSET_CREATED audit entry', () => {
    it('records one ASSET_CREATED entry with correct actor and target', async () => {
      const before = Date.now();
      const create = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: bodyWithFk({ name: 'Audited asset', inventoryNumberPrefix: 'AUD' }),
      });
      expect(create.statusCode).toBe(201);
      const assetId = create.json<{ _id: string }>()._id;
      const inventoryNumber = create.json<{ inventoryNumber: string }>().inventoryNumber;

      const logs = await readAuditLogsFor(assetId);
      expect(logs).toHaveLength(1);
      const entry = logs[0]!;
      expect(entry.action).toBe('ASSET_CREATED');
      expect(entry.severity).toBe('INFO');
      expect(entry.actor.userId).toBe(adminId);
      expect(entry.actor.displayName).toBe(adminDisplayName);
      expect(entry.target.entityType).toBe('Asset');
      expect(entry.target.entityId).toBe(assetId);
      expect(entry.target.snapshot).toMatchObject({
        inventoryNumber,
        name: 'Audited asset',
        status: 'AVAILABLE',
      });
      expect(entry.description).toContain(inventoryNumber);
      expect(entry.changes).toBeNull();
      expect(new Date(entry.at).getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe('PATCH creates ASSET_UPDATED audit entry with diff', () => {
    it('records single-field change in changes array', async () => {
      const asset = await insertTestAsset(app, { name: 'Original name' });
      await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'New name' },
      });
      const logs = await readAuditLogsFor(asset._id);
      expect(logs).toHaveLength(1);
      expect(logs[0]!.action).toBe('ASSET_UPDATED');
      expect(logs[0]!.changes).toHaveLength(1);
      expect(logs[0]!.changes![0]).toEqual({
        field: 'name',
        before: 'Original name',
        after: 'New name',
      });
    });

    it('records multiple changes when several fields update', async () => {
      const asset = await insertTestAsset(app, { name: 'A', condition: 'NEW' });
      await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'B', condition: 'GOOD', internalNotes: 'Refurbished' },
      });
      const logs = await readAuditLogsFor(asset._id);
      expect(logs).toHaveLength(1);
      expect(logs[0]!.changes).toHaveLength(3);
      const changeMap = new Map(logs[0]!.changes!.map((c) => [c.field, c]));
      expect(changeMap.get('name')).toEqual({ field: 'name', before: 'A', after: 'B' });
    });

    it('does NOT create an audit entry when PATCH is a no-op (same values)', async () => {
      const asset = await insertTestAsset(app, { name: 'Same' });
      await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Same' },
      });
      expect(await readAuditLogsFor(asset._id)).toHaveLength(0);
    });

    it('does NOT create an audit entry for empty patch body', async () => {
      const asset = await insertTestAsset(app);
      await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: {},
      });
      expect(await readAuditLogsFor(asset._id)).toHaveLength(0);
    });
  });

  describe('DELETE creates ASSET_DELETED audit entry', () => {
    it('records ASSET_DELETED entry with severity WARNING', async () => {
      const asset = await insertTestAsset(app, { name: 'About to be deleted' });
      const del = await app.inject({
        method: 'DELETE',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(del.statusCode).toBe(204);
      const logs = await readAuditLogsFor(asset._id);
      expect(logs).toHaveLength(1);
      expect(logs[0]!.action).toBe('ASSET_DELETED');
      expect(logs[0]!.severity).toBe('WARNING');
      expect(logs[0]!.actor.userId).toBe(adminId);
    });
  });

  describe('failed operations write no audit log', () => {
    it('PATCH on non-existent asset creates no audit entry', async () => {
      const beforeCount = await app.mongo.db.collection('audit_logs').countDocuments();
      expect(beforeCount).toBe(0);
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/assets/0123456789abcdef01234567',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Whatever' },
      });
      expect(res.statusCode).toBe(404);
      expect(await app.mongo.db.collection('audit_logs').countDocuments()).toBe(0);
    });

    it('DELETE on on-loan asset creates no audit entry', async () => {
      const { ObjectId } = await import('mongodb');
      const asset = await insertTestAsset(app, { currentLoanId: new ObjectId() });
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/assets/${asset._id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
      expect(await readAuditLogsFor(asset._id)).toHaveLength(0);
    });

    it('DELETE on non-existent asset creates no audit entry', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/assets/0123456789abcdef01234567',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
      expect(await app.mongo.db.collection('audit_logs').countDocuments()).toBe(0);
    });
  });

  describe('multiple operations on same asset', () => {
    it('records create + update + delete as three separate entries in order', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/v1/assets',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: bodyWithFk({ name: 'Lifecycle test', inventoryNumberPrefix: 'LIFE' }),
      });
      expect(create.statusCode).toBe(201);
      const assetId = create.json<{ _id: string }>()._id;

      await app.inject({
        method: 'PATCH',
        url: `/v1/assets/${assetId}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { name: 'Lifecycle test - updated' },
      });
      await app.inject({
        method: 'DELETE',
        url: `/v1/assets/${assetId}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });

      const logs = await readAuditLogsFor(assetId);
      expect(logs).toHaveLength(3);
      expect(logs.map((l) => l.action)).toEqual([
        'ASSET_CREATED',
        'ASSET_UPDATED',
        'ASSET_DELETED',
      ]);
    });
  });
});

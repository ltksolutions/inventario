// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for POST /v1/categories.
 *
 * Covers:
 *   - 201 Created with valid body
 *   - Slug uniqueness check (409-ish via 400 BadRequestError)
 *   - Parent existence check (parentId non-null must reference existing)
 *   - Required field validation (400 for missing/malformed)
 *   - Audit fields populated correctly (createdBy/updatedBy = user._id)
 *
 * What's tested elsewhere:
 *   - RBAC → categories.rbac will be added later; for now we rely on the
 *     same RBAC enforcement pattern as assets (covered in assets RBAC tests)
 *   - Audit log entry creation → categories audit test (future)
 *   - Auth gate → auth.test.ts
 *
 * Setup:
 *   Each test starts with a clean DB and an ADMIN user. ADMIN has the
 *   broadest privileges, so authentication/RBAC is out of the picture
 *   and we focus on POST behaviour.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  insertTestCategory,
  provisionUser,
  UserRole,
  validCreateCategoryBody,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('POST /v1/categories', () => {
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
    const { token } = await provisionUser(app, {
      oid: 'admin-for-categories-post',
      role: UserRole.ADMIN,
    });
    adminToken = token;
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('creates a root category and returns 201', async () => {
      const body = validCreateCategoryBody({
        name: 'Notebooky',
        slug: 'notebooky',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });

      expect(res.statusCode).toBe(201);
      const result = res.json<{
        _id: string;
        name: string;
        slug: string;
        parentId: string | null;
        isActive: boolean;
      }>();

      expect(result._id).toMatch(/^[a-f0-9]{24}$/);
      expect(result.name).toBe('Notebooky');
      expect(result.slug).toBe('notebooky');
      expect(result.parentId).toBeNull();
      expect(result.isActive).toBe(true);
    });

    it('creates a child category referencing an existing parent', async () => {
      const parent = await insertTestCategory(app, { name: 'Šport', slug: 'sport' });

      const body = validCreateCategoryBody({
        name: 'Dresy',
        slug: 'dresy',
        parentId: parent._id,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });

      expect(res.statusCode).toBe(201);
      const result = res.json<{ parentId: string }>();
      expect(result.parentId).toBe(parent._id);
    });

    it('persists the category so GET returns it', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateCategoryBody({ name: 'Persisted', slug: 'persisted-cat' }),
      });
      expect(create.statusCode).toBe(201);
      const id = create.json<{ _id: string }>()._id;

      const get = await app.inject({
        method: 'GET',
        url: `/v1/categories/${id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });

      expect(get.statusCode).toBe(200);
      const body = get.json<{ name: string; slug: string }>();
      expect(body.name).toBe('Persisted');
      expect(body.slug).toBe('persisted-cat');
    });
  });

  // -------------------------------------------------------------------------
  // Slug uniqueness
  // -------------------------------------------------------------------------

  describe('slug uniqueness', () => {
    it('rejects a duplicate slug with 400', async () => {
      await insertTestCategory(app, { slug: 'duplicate-slug' });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateCategoryBody({ slug: 'duplicate-slug', name: 'Second one' }),
      });

      expect(res.statusCode).toBe(400);
      const body = res.json<{ message: string }>();
      expect(body.message).toMatch(/slug.*already exists/i);
    });
  });

  // -------------------------------------------------------------------------
  // Parent existence
  // -------------------------------------------------------------------------

  describe('parent existence', () => {
    it('rejects parentId pointing to a non-existent category with 400', async () => {
      const fakeParentId = '0123456789abcdef01234567';

      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateCategoryBody({ parentId: fakeParentId }),
      });

      expect(res.statusCode).toBe(400);
      const body = res.json<{ message: string }>();
      expect(body.message).toMatch(/parent.*does not exist/i);
    });

    it('rejects parentId pointing to a soft-deleted category with 400', async () => {
      const parent = await insertTestCategory(app, { slug: 'about-to-delete' });

      const { ObjectId } = await import('mongodb');
      await app.mongo.db
        .collection('categories')
        .updateOne(
          { _id: new ObjectId(parent._id) },
          { $set: { deletedAt: new Date().toISOString(), deletedBy: 'test' } },
        );

      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateCategoryBody({ parentId: parent._id }),
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Validation failures
  // -------------------------------------------------------------------------

  describe('validation failures', () => {
    it('rejects empty name with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateCategoryBody({ name: '' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects slug with uppercase letters (must be lowercase-with-dashes)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateCategoryBody({ slug: 'UPPERCASE-Slug' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects slug with spaces', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateCategoryBody({ slug: 'has spaces' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects malformed color (not hex)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateCategoryBody({ color: 'not-a-color' }),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Slug auto-generation (K3)
  // -------------------------------------------------------------------------

  describe('slug auto-generation', () => {
    it('derives slug from name when slug is omitted from the body', async () => {
      const body = validCreateCategoryBody({ name: 'Pracovné notebooky' });
      delete body['slug'];

      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json<{ slug: string }>().slug).toBe('pracovne-notebooky');
    });

    it('strips Slovak diacritics when deriving slug', async () => {
      const body = validCreateCategoryBody({ name: 'Tréningové pomôcky' });
      delete body['slug'];

      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json<{ slug: string }>().slug).toBe('treningove-pomocky');
    });

    it('appends -2 suffix when the derived slug already exists', async () => {
      await insertTestCategory(app, { name: 'Notebooky', slug: 'notebooky' });

      const body = validCreateCategoryBody({ name: 'Notebooky' });
      delete body['slug'];

      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json<{ slug: string }>().slug).toBe('notebooky-2');
    });

    it('appends -3 when base and -2 are both taken', async () => {
      await insertTestCategory(app, { name: 'Dresy', slug: 'dresy' });
      await insertTestCategory(app, { name: 'Dresy 2', slug: 'dresy-2' });

      const body = validCreateCategoryBody({ name: 'Dresy' });
      delete body['slug'];

      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json<{ slug: string }>().slug).toBe('dresy-3');
    });

    it('returns 400 if name slugifies to an empty string (e.g. only specials)', async () => {
      const body = validCreateCategoryBody({ name: '!@#$%' });
      delete body['slug'];

      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });

      expect(res.statusCode).toBe(400);
      const responseBody = res.json<{ message: string }>();
      expect(responseBody.message).toMatch(/cannot derive a slug/i);
    });

    it('client-supplied slug bypasses auto-derivation', async () => {
      const body = validCreateCategoryBody({
        name: 'Renamed thing',
        slug: 'totally-different-slug',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json<{ slug: string }>().slug).toBe('totally-different-slug');
    });
  });

  // -------------------------------------------------------------------------
  // Hierarchy depth
  // -------------------------------------------------------------------------

  describe('hierarchy depth (presne 2 úrovne: root + hodnoty)', () => {
    it('allows creating a value directly under a root (depth 1)', async () => {
      const root = await insertTestCategory(app, { slug: 'cr-root' });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateCategoryBody({
          name: 'Notebooky',
          slug: 'cr-value',
          parentId: root._id,
        }),
      });

      expect(res.statusCode).toBe(201);
      expect(res.json<{ parentId: string }>().parentId).toBe(root._id);
    });

    it('rejects creating a grandchild (a value under another value)', async () => {
      const root = await insertTestCategory(app, { slug: 'crover-root' });
      const value = await insertTestCategory(app, { slug: 'crover-value', parentId: root._id });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateCategoryBody({
          name: 'Too deep',
          slug: 'crover-toodeep',
          parentId: value._id,
        }),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(/úrovne|hodnot/i);
    });
  });

  // -------------------------------------------------------------------------
  // Audit fields
  // -------------------------------------------------------------------------

  describe('audit fields', () => {
    it('sets createdBy and updatedBy to the calling user _id', async () => {
      const adminUser = await app.mongo.db
        .collection('users')
        .findOne({ entraOid: 'admin-for-categories-post' });
      expect(adminUser).not.toBeNull();
      const adminId = String(adminUser!._id);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateCategoryBody(),
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<{ createdBy: string; updatedBy: string }>();
      expect(body.createdBy).toBe(adminId);
      expect(body.updatedBy).toBe(adminId);
    });

    it('sets createdAt and updatedAt to equal ISO timestamps on insert', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateCategoryBody(),
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<{ createdAt: string; updatedAt: string }>();
      expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(body.updatedAt).toBe(body.createdAt);
    });
  });
});

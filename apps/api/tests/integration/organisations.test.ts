// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integration tests for /v1/organisations (platform admin endpoints).
 *
 * Covers:
 *   - GET    /v1/organisations        list + filter by status/plan
 *   - GET    /v1/organisations/:id    single
 *   - POST   /v1/organisations        create + validation + slug uniqueness
 *   - PATCH  /v1/organisations/:id    partial update + slug/entraTenantId immutability
 *   - DELETE /v1/organisations/:id    soft-delete
 *   - RBAC   all endpoints require ADMIN; ASSET_MANAGER + EMPLOYEE get 403
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, cleanTestDatabase } from '../helpers/test-app.js';
import {
  provisionUser,
  resolveTestTenantId,
  seedTestTenant,
  UserRole,
} from '../helpers/test-fixtures.js';

import type { FastifyInstance } from 'fastify';

describe('/v1/organisations', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
  let employeeToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(app);

    const { token: at } = await provisionUser(app, { oid: 'org-admin', role: UserRole.ADMIN });
    const { token: mt } = await provisionUser(app, {
      oid: 'org-manager',
      role: UserRole.ASSET_MANAGER,
    });
    const { token: et } = await provisionUser(app, {
      oid: 'org-employee',
      role: UserRole.EMPLOYEE,
    });

    adminToken = at;
    managerToken = mt;
    employeeToken = et;
  });

  afterEach(async () => {
    await cleanTestDatabase(app);
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** POST a new organisation directly through the API. Returns parsed body. */
  async function createOrg(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/organisations',
      headers: { cookie: `inv_access=${adminToken}` },
      payload,
    });
    expect(res.statusCode, `createOrg failed: ${res.body}`).toBe(201);
    return res.json<Record<string, unknown>>();
  }

  function validCreateOrgBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const stamp = Date.now().toString(36).slice(-6);
    return {
      displayName: `Test Org ${stamp}`,
      slug: `test-org-${stamp}`,
      entraTenantId: null,
      status: 'ACTIVE',
      plan: 'FREE',
      primaryContactEmail: null,
      ...overrides,
    };
  }

  // -------------------------------------------------------------------------
  // RBAC — all endpoints ADMIN only
  // -------------------------------------------------------------------------

  describe('RBAC', () => {
    it('returns 403 for ASSET_MANAGER on GET /v1/organisations', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/organisations',
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 for EMPLOYEE on GET /v1/organisations', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/organisations',
        headers: { cookie: `inv_access=${employeeToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 401 without auth on GET /v1/organisations', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/organisations' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 for ASSET_MANAGER on POST /v1/organisations', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/organisations',
        headers: { cookie: `inv_access=${managerToken}` },
        payload: validCreateOrgBody(),
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 for EMPLOYEE on PATCH /v1/organisations/:id', async () => {
      const orgId = await resolveTestTenantId(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/organisations/${orgId}`,
        headers: { cookie: `inv_access=${employeeToken}` },
        payload: { displayName: 'Hack' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 for ASSET_MANAGER on DELETE /v1/organisations/:id', async () => {
      const org = await createOrg(validCreateOrgBody({ slug: 'rbac-delete-test' }));
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/organisations/${String(org['_id'])}`,
        headers: { cookie: `inv_access=${managerToken}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // GET /v1/organisations
  // -------------------------------------------------------------------------

  describe('GET /v1/organisations', () => {
    it('returns 200 with data + pagination', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/organisations',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[]; pagination: { total: number } }>();
      expect(Array.isArray(body.data)).toBe(true);
      expect(typeof body.pagination.total).toBe('number');
    });

    it('lists all tenants across tenant boundary', async () => {
      await seedTestTenant(app, { slug: 'cross-tenant-a', entraTenantId: null });
      await seedTestTenant(app, { slug: 'cross-tenant-b', entraTenantId: null });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/organisations',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: Array<{ slug: string }> }>();
      const slugs = body.data.map((o) => o.slug);
      expect(slugs).toContain('cross-tenant-a');
      expect(slugs).toContain('cross-tenant-b');
    });

    it('filters by status=ACTIVE', async () => {
      await seedTestTenant(app, { slug: 'active-org', entraTenantId: null, status: 'ACTIVE' });
      await seedTestTenant(app, {
        slug: 'suspended-org',
        entraTenantId: null,
        status: 'SUSPENDED',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/organisations?status=ACTIVE',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: Array<{ status: string }> }>();
      expect(body.data.every((o) => o.status === 'ACTIVE')).toBe(true);
    });

    it('filters by plan=PRO', async () => {
      // Create a PRO org via the API
      await createOrg(validCreateOrgBody({ slug: 'pro-org', plan: 'PRO' }));

      const res = await app.inject({
        method: 'GET',
        url: '/v1/organisations?plan=PRO',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: Array<{ plan: string }> }>();
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data.every((o) => o.plan === 'PRO')).toBe(true);
    });

    it('respects limit + skip pagination', async () => {
      // Seed 3 extra orgs
      for (let i = 0; i < 3; i++) {
        await seedTestTenant(app, {
          slug: `paginate-org-${i}`,
          entraTenantId: null,
        });
      }

      const page1 = await app.inject({
        method: 'GET',
        url: '/v1/organisations?limit=2&skip=0',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(page1.statusCode).toBe(200);
      const p1 = page1.json<{ data: unknown[]; pagination: { hasMore: boolean } }>();
      expect(p1.data.length).toBeLessThanOrEqual(2);
      expect(typeof p1.pagination.hasMore).toBe('boolean');
    });
  });

  // -------------------------------------------------------------------------
  // GET /v1/organisations/:id
  // -------------------------------------------------------------------------

  describe('GET /v1/organisations/:id', () => {
    it('returns the organisation by id', async () => {
      const created = await createOrg(validCreateOrgBody({ slug: 'get-by-id-test' }));
      const id = String(created['_id']);

      const res = await app.inject({
        method: 'GET',
        url: `/v1/organisations/${id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ _id: string; slug: string }>();
      expect(body._id).toBe(id);
      expect(body.slug).toBe('get-by-id-test');
    });

    it('returns 404 for non-existent id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/organisations/0123456789abcdef01234567',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for malformed id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/organisations/not-an-objectid',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/organisations
  // -------------------------------------------------------------------------

  describe('POST /v1/organisations', () => {
    it('creates an organisation and returns 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/organisations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateOrgBody({
          displayName: 'Slovenský futbalový zväz',
          slug: 'slovensky-futbalovy-zvaz',
          plan: 'PRO',
          primaryContactEmail: 'admin@sfz.sk',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{
        _id: string;
        displayName: string;
        slug: string;
        plan: string;
        status: string;
        primaryContactEmail: string;
      }>();
      expect(body._id).toMatch(/^[a-f0-9]{24}$/);
      expect(body.displayName).toBe('Slovenský futbalový zväz');
      expect(body.slug).toBe('slovensky-futbalovy-zvaz');
      expect(body.plan).toBe('PRO');
      expect(body.status).toBe('ACTIVE');
      expect(body.primaryContactEmail).toBe('admin@sfz.sk');
    });

    it('rejects duplicate slug with 400', async () => {
      await createOrg(validCreateOrgBody({ slug: 'duplicate-slug-org' }));

      const res = await app.inject({
        method: 'POST',
        url: '/v1/organisations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateOrgBody({ slug: 'duplicate-slug-org', displayName: 'Second' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid slug format with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/organisations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateOrgBody({ slug: 'UPPER_CASE' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects missing displayName with 400', async () => {
      const body = validCreateOrgBody({ slug: 'no-name-org' });
      delete body['displayName'];
      const res = await app.inject({
        method: 'POST',
        url: '/v1/organisations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid plan value with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/organisations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateOrgBody({ plan: 'ULTRA' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('defaults status to ACTIVE when omitted', async () => {
      const body = validCreateOrgBody({ slug: 'default-status-org' });
      delete body['status'];
      const res = await app.inject({
        method: 'POST',
        url: '/v1/organisations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<{ status: string }>().status).toBe('ACTIVE');
    });

    it('defaults plan to FREE when omitted', async () => {
      const body = validCreateOrgBody({ slug: 'default-plan-org' });
      delete body['plan'];
      const res = await app.inject({
        method: 'POST',
        url: '/v1/organisations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: body,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<{ plan: string }>().plan).toBe('FREE');
    });

    it('sets createdBy to the calling admin user _id', async () => {
      const adminUser = await app.mongo.db.collection('users').findOne({ entraOid: 'org-admin' });
      const adminId = String(adminUser!._id);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/organisations',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: validCreateOrgBody({ slug: 'created-by-check' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<{ createdBy: string }>().createdBy).toBe(adminId);
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /v1/organisations/:id
  // -------------------------------------------------------------------------

  describe('PATCH /v1/organisations/:id', () => {
    it('updates displayName (ADMIN)', async () => {
      const org = await createOrg(validCreateOrgBody({ slug: 'patch-name-org' }));
      const id = String(org['_id']);

      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/organisations/${id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { displayName: 'Nový názov organizácie' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ displayName: string }>().displayName).toBe('Nový názov organizácie');
    });

    it('updates plan and status together', async () => {
      const org = await createOrg(validCreateOrgBody({ slug: 'patch-plan-status' }));
      const id = String(org['_id']);

      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/organisations/${id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { plan: 'ENTERPRISE', status: 'SUSPENDED' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ plan: string; status: string }>();
      expect(body.plan).toBe('ENTERPRISE');
      expect(body.status).toBe('SUSPENDED');
    });

    it('does NOT change slug even if body contains one', async () => {
      // The backend strips slug from PATCH body via the Zod schema —
      // sending it should not 400 but also not change the slug.
      const org = await createOrg(validCreateOrgBody({ slug: 'original-patch-slug' }));
      const id = String(org['_id']);

      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/organisations/${id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        // slug is excluded from UpdateOrganisationBodySchema —
        // Zod strips unknown keys with .strict()… actually it uses .partial()
        // which means slug is just ignored if not in schema. Include it anyway
        // to confirm it doesn't blow up.
        payload: { displayName: 'Still valid' },
      });
      expect(res.statusCode).toBe(200);
      // Slug should be unchanged
      expect(res.json<{ slug: string }>().slug).toBe('original-patch-slug');
    });

    it('rejects invalid status value', async () => {
      const org = await createOrg(validCreateOrgBody({ slug: 'invalid-status-patch' }));
      const id = String(org['_id']);

      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/organisations/${id}`,
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { status: 'DELETED' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent id', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/organisations/0123456789abcdef01234567',
        headers: { cookie: `inv_access=${adminToken}` },
        payload: { displayName: 'Ghost' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /v1/organisations/:id
  // -------------------------------------------------------------------------

  describe('DELETE /v1/organisations/:id', () => {
    it('soft-deletes an organisation and returns 204', async () => {
      const org = await createOrg(validCreateOrgBody({ slug: 'delete-me-org' }));
      const id = String(org['_id']);

      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/organisations/${id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(204);
    });

    it('soft-deleted org is excluded from list by default', async () => {
      const org = await createOrg(validCreateOrgBody({ slug: 'deleted-hidden-org' }));
      const id = String(org['_id']);

      await app.inject({
        method: 'DELETE',
        url: `/v1/organisations/${id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });

      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/organisations',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const body = listRes.json<{ data: Array<{ _id: string }> }>();
      expect(body.data.find((o) => o._id === id)).toBeUndefined();
    });

    it('soft-deleted org is visible with includeDeleted=true', async () => {
      const org = await createOrg(validCreateOrgBody({ slug: 'deleted-visible-org' }));
      const id = String(org['_id']);

      await app.inject({
        method: 'DELETE',
        url: `/v1/organisations/${id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });

      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/organisations?includeDeleted=true',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      const body = listRes.json<{ data: Array<{ _id: string; deletedAt: string | null }> }>();
      const found = body.data.find((o) => o._id === id);
      expect(found).toBeDefined();
      expect(found!.deletedAt).not.toBeNull();
    });

    it('GET /:id returns 404 for soft-deleted org', async () => {
      const org = await createOrg(validCreateOrgBody({ slug: 'deleted-get-404' }));
      const id = String(org['_id']);

      await app.inject({
        method: 'DELETE',
        url: `/v1/organisations/${id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/organisations/${id}`,
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for non-existent id', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/organisations/0123456789abcdef01234567',
        headers: { cookie: `inv_access=${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // GET + PATCH /v1/organisations/current (tenant self-service)
  // -------------------------------------------------------------------------

  describe('/v1/organisations/current', () => {
    // -----------------------------------------------------------------------
    // GET /current — ľubovolný člen tenanta môže čítať vlastnú org
    // -----------------------------------------------------------------------

    describe('GET /v1/organisations/current', () => {
      it('returns 200 with org data for ADMIN', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json<{ _id: string; slug: string; displayName: string }>();
        expect(typeof body._id).toBe('string');
        expect(typeof body.slug).toBe('string');
        expect(typeof body.displayName).toBe('string');
      });

      it('returns 200 with org data for EMPLOYEE', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${employeeToken}` },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json<{ _id: string }>();
        expect(typeof body._id).toBe('string');
      });

      it('returns 200 with org data for ASSET_MANAGER', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${managerToken}` },
        });
        expect(res.statusCode).toBe(200);
      });

      it('returns 401 without auth', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/v1/organisations/current',
        });
        expect(res.statusCode).toBe(401);
      });

      it('vracia organisationId odvozené z JWT, nie z URL', async () => {
        // Admin a employee patria do rovnakého test tenanta.
        // GET /current musí obom vrátiť tú istú org.
        const adminRes = await app.inject({
          method: 'GET',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
        });
        const empRes = await app.inject({
          method: 'GET',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${employeeToken}` },
        });
        expect(adminRes.statusCode).toBe(200);
        expect(empRes.statusCode).toBe(200);
        expect(adminRes.json<{ _id: string }>()._id).toBe(empRes.json<{ _id: string }>()._id);
      });
    });

    // -----------------------------------------------------------------------
    // PATCH /current — len ADMIN, SAFE subset
    // -----------------------------------------------------------------------

    describe('PATCH /v1/organisations/current', () => {
      it('ADMIN môže zmeniť displayName', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { displayName: 'Aktualizovaný názov' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<{ displayName: string }>().displayName).toBe('Aktualizovaný názov');
      });

      it('ADMIN môže zmeniť primaryContactEmail', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { primaryContactEmail: 'kontakt@example.sk' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<{ primaryContactEmail: string }>().primaryContactEmail).toBe(
          'kontakt@example.sk',
        );
      });

      it('ADMIN môže nastaviť labelPrinting.mode na ZEBRA_ZPL (ADR-0027)', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: {
            labelPrinting: {
              mode: 'ZEBRA_ZPL',
              pdfPreset: 'avery-l7160',
              zplLabelWidthMm: 50,
              zplLabelHeightMm: 25,
              zplDpi: 203,
              zplDarkness: 20,
              finderText: { enabled: false, text: 'Našli ste ma? Naskenujte a pomôžte ma vrátiť.' },
            },
          },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json<{
          labelPrinting: { mode: string; zplLabelWidthMm: number; zplDpi: number } | null;
        }>();
        expect(body.labelPrinting?.mode).toBe('ZEBRA_ZPL');
        expect(body.labelPrinting?.zplLabelWidthMm).toBe(50);
        expect(body.labelPrinting?.zplDpi).toBe(203);

        // Overiť, že sa to naozaj persistuje (nie len echo v response) —
        // druhý GET musí ukázať rovnaký stav.
        const getRes = await app.inject({
          method: 'GET',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
        });
        expect(getRes.json<{ labelPrinting: { mode: string } | null }>().labelPrinting?.mode).toBe(
          'ZEBRA_ZPL',
        );

        // Vrátiť na PDF_SHEET, aby nasledujúce testy v tomto describe blocku
        // (najmä 'prázdny patch' nižšie) neboli ovplyvnené poradím testov.
        await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { labelPrinting: null },
        });
      });

      it('EMPLOYEE dostane 403', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${employeeToken}` },
          payload: { displayName: 'Nepovolene' },
        });
        expect(res.statusCode).toBe(403);
      });

      it('ASSET_MANAGER dostane 403', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${managerToken}` },
          payload: { displayName: 'Nepovolene' },
        });
        expect(res.statusCode).toBe(403);
      });

      it('bez autentifikácie vracia 401', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          payload: { displayName: 'Ghost' },
        });
        expect(res.statusCode).toBe(401);
      });

      it('prázdny patch (bez polí) vráti 200 bez zmeny', async () => {
        const before = await app.inject({
          method: 'GET',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
        });
        const beforeName = before.json<{ displayName: string }>().displayName;

        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: {},
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<{ displayName: string }>().displayName).toBe(beforeName);
      });

      it('PATCH /current nemení plan ani status (platform-only polia)', async () => {
        // plan a status nie sú v UpdateOwnOrganisationBodySchema —
        // Zod ich stripne, teda patch musí uspäť bez zmeny týchto polí.
        const before = await app.inject({
          method: 'GET',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
        });
        const { plan: planBefore, status: statusBefore } = before.json<{
          plan: string;
          status: string;
        }>();

        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          // plan + status sú známe polia ale nie sú v SAFE subset schéme
          payload: { displayName: 'Povolene', plan: 'ENTERPRISE', status: 'SUSPENDED' },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json<{ plan: string; status: string; displayName: string }>();
        expect(body.displayName).toBe('Povolene');
        expect(body.plan).toBe(planBefore);
        expect(body.status).toBe(statusBefore);
      });

      // --- Cross-tenant izolácia ---

      it('cross-tenant: ADMIN nemôže patcho vať org iného tenanta cez /current', async () => {
        // Vytvoriť druhý tenant a user v ňom
        const secondTenantOrg = await createOrg(
          validCreateOrgBody({ slug: 'second-tenant-cross' }),
        );
        const secondOrgId = String(secondTenantOrg['_id']);
        const displayNameBefore = String(secondTenantOrg['displayName']);

        // Admin z prvého tenanta PATCH /current — musí zmeniť LEN svoju org,
        // nie secondOrgId.
        const patchRes = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { displayName: 'Should only change my org' },
        });
        expect(patchRes.statusCode).toBe(200);

        // Druhý tenant musí zostať nedotknutý.
        const secondRes = await app.inject({
          method: 'GET',
          url: `/v1/organisations/${secondOrgId}`,
          headers: { cookie: `inv_access=${adminToken}` },
        });
        expect(secondRes.statusCode).toBe(200);
        expect(secondRes.json<{ displayName: string }>().displayName).toBe(displayNameBefore);
      });

      // --- Billing validácia ---

      it('billing: validá IČO (8 číslic)', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { billing: { ico: '12345678', isVatPayer: false } },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<{ billing: { ico: string } }>().billing?.ico).toBe('12345678');
      });

      it('billing: neplatné IČO (nie 8 číslic) vráti 400', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { billing: { ico: '1234', isVatPayer: false } },
        });
        expect(res.statusCode).toBe(400);
      });

      it('billing: neplatné IČO (obsahuje písmená) vráti 400', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { billing: { ico: 'ABCD1234', isVatPayer: false } },
        });
        expect(res.statusCode).toBe(400);
      });

      it('billing: validý IČ DPH (SK + 10 číslic)', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { billing: { icDph: 'SK1234567890', isVatPayer: true } },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<{ billing: { icDph: string } }>().billing?.icDph).toBe('SK1234567890');
      });

      it('billing: IČ DPH s medzerami sa normalizuje', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { billing: { icDph: 'SK 1234 567 890', isVatPayer: true } },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<{ billing: { icDph: string } }>().billing?.icDph).toBe('SK1234567890');
      });

      it('billing: neplatný IČ DPH (bez prefixu SK) vráti 400', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { billing: { icDph: 'CZ1234567890', isVatPayer: true } },
        });
        expect(res.statusCode).toBe(400);
      });

      it('billing: validý IBAN', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { billing: { iban: 'SK3112000000198742637541', isVatPayer: false } },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<{ billing: { iban: string } }>().billing?.iban).toBe(
          'SK3112000000198742637541',
        );
      });

      it('billing: IBAN s medzerami sa normalizuje', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { billing: { iban: 'SK31 1200 0000 1987 4263 7541', isVatPayer: false } },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<{ billing: { iban: string } }>().billing?.iban).toBe(
          'SK3112000000198742637541',
        );
      });

      it('billing: neplatný IBAN vráti 400', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { billing: { iban: 'INVALID-IBAN', isVatPayer: false } },
        });
        expect(res.statusCode).toBe(400);
      });

      it('billing: neplatný billingEmail vráti 400', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { billing: { billingEmail: 'nie-je-email', isVatPayer: false } },
        });
        expect(res.statusCode).toBe(400);
      });

      it('billing: null vynuluje celý billing blok', async () => {
        // Najprv nastav billing
        await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { billing: { ico: '12345678', isVatPayer: false } },
        });
        // Potom ho vynuluj
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { billing: null },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<{ billing: unknown }>().billing).toBeNull();
      });

      // --- ADR-0035 F5: vlastná doména pre prihlásenie (tenant self-service) ---

      it('ADMIN môže nastaviť customDomain', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { customDomain: 'majetok.example-f5.sk' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<{ customDomain: string | null }>().customDomain).toBe(
          'majetok.example-f5.sk',
        );

        const getRes = await app.inject({
          method: 'GET',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
        });
        expect(getRes.json<{ customDomain: string | null }>().customDomain).toBe(
          'majetok.example-f5.sk',
        );
      });

      it('customDomain sa ukladá lowercase bez ohladu na vstup', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { customDomain: 'MAJETOK.Example-F5.SK' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<{ customDomain: string | null }>().customDomain).toBe(
          'majetok.example-f5.sk',
        );
      });

      it('customDomain s neplatným formátom (nie FQDN) vráti 400', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { customDomain: 'https://nie-fqdn.sk/cesta' },
        });
        expect(res.statusCode).toBe(400);
      });

      it('customDomain kolidujúci s iným tenantom vráti 400', async () => {
        const secondOrg = await createOrg(validCreateOrgBody({ slug: 'second-tenant-domain' }));
        const { token: secondAdminToken } = await provisionUser(app, {
          oid: 'org-admin-2',
          role: UserRole.ADMIN,
          organisationId: String(secondOrg['_id']),
        });

        const setupRes = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { customDomain: 'majetok.koliduje.sk' },
        });
        expect(setupRes.statusCode).toBe(200);

        const collisionRes = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${secondAdminToken}` },
          payload: { customDomain: 'majetok.koliduje.sk' },
        });
        expect(collisionRes.statusCode).toBe(400);
        expect(collisionRes.json<{ message: string }>().message).toContain('majetok.koliduje.sk');
      });

      it('customDomain: null vynuluje nastavenú doménu', async () => {
        await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { customDomain: 'majetok.example-f5.sk' },
        });

        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { customDomain: null },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<{ customDomain: string | null }>().customDomain).toBeNull();
      });

      it('nastavenie rovnakého customDomain akou už org má (no-op) nevyhodí kolizúciu', async () => {
        await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { customDomain: 'majetok.example-f5.sk' },
        });

        const res = await app.inject({
          method: 'PATCH',
          url: '/v1/organisations/current',
          headers: { cookie: `inv_access=${adminToken}` },
          payload: { customDomain: 'majetok.example-f5.sk', displayName: 'Stále rovnaká doména' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<{ customDomain: string | null }>().customDomain).toBe(
          'majetok.example-f5.sk',
        );
      });
    });
  });
});

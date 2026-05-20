/**
 * Test fixtures — helpers for creating users + assets in tests.
 *
 * Two concerns this file solves:
 *
 *   1. Role-scoped test users:
 *      Production user roles are `EMPLOYEE` by default after JIT. Most
 *      CRUD tests need elevated roles (ASSET_MANAGER, ADMIN). The
 *      `provisionUserAs()` helper does JIT then directly bumps the role.
 *
 *   2. Test asset creation:
 *      PATCH/DELETE tests need an existing asset to operate on. Instead
 *      of going through the full POST endpoint (which has its own test
 *      coverage), `insertTestAsset()` writes directly to the collection.
 *      This isolates each test from the asset-creation pipeline.
 *
 * Why direct DB writes for fixtures:
 *   Integration tests for endpoint X should fail when endpoint X is
 *   broken, not when a fixture happens to use endpoint Y. By bypassing
 *   the API for setup, failures point exactly at the SUT.
 *
 * Phase C Blok 5 (multi-tenant):
 *   Every tenant-scoped document carries `organisationId`. The auth
 *   middleware JIT-provisions an Organisation for the synthetic test
 *   tenant id on the first `/v1/me` call, then all subsequent requests
 *   from the same test reuse it. Direct-insert fixtures (`insertTestX`)
 *   need to stamp `organisationId` on the row themselves — they take an
 *   optional `organisationId` parameter that defaults to the JIT tenant
 *   resolved via `resolveTestTenantId(app)`. Tests that want to assert
 *   cross-tenant isolation can pass a different `organisationId` to seed
 *   data for tenant B alongside tenant A.
 */

import { UserRole, AccountType, type User } from '@inventario/shared-types';

import type { SignTestTokenInput } from './test-jwt.js';
import type { FastifyInstance } from 'fastify';
import type { ObjectId, WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Module-level counters for unique fixture data
// ---------------------------------------------------------------------------

/**
 * Process-monotonic counter for generating unique `inventoryNumber`
 * values across `insertTestAsset` calls.
 *
 * Previous implementation derived the suffix from `Date.now().slice(-6)`,
 * which collides on the unique `{organisationId, inventoryNumber}` index
 * whenever two fixture inserts land in the same millisecond — trivially
 * easy in tight loops (e.g. tests that seed multiple assets for one
 * loan request). A simple counter is collision-free for the lifetime
 * of the vitest process (singleFork = one process for all test files).
 */
let testAssetCounter = 0;

// ---------------------------------------------------------------------------
// Tenant resolution
// ---------------------------------------------------------------------------

/**
 * The synthetic Entra tenant id all test tokens carry. The auth
 * middleware will JIT-provision an Organisation for it on the first
 * `/v1/me` call from any test that exercises the auth flow. Tests that
 * need a tenant context BEFORE calling `/v1/me` use
 * `resolveTestTenantId(app)` which provisions on demand.
 *
 * Defined as a string with no dashes (after lowercase normalization)
 * since that is the slug format the OrganisationsService produces from
 * the raw `tid` claim.
 */
const TEST_ENTRA_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Resolve the test tenant's organisation `_id` (as a 24-hex string).
 *
 * Looks up the Organisation by the deterministic slug derived from
 * `TEST_ENTRA_TENANT_ID`. If the row does not exist yet (no test has
 * called `/v1/me` in this DB run), creates it inline so direct-insert
 * fixtures can stamp `organisationId` even before the first authenticated
 * request.
 *
 * Tests that seed two tenants (cross-tenant isolation) call
 * `seedTestTenant(app, { slug: 'tenant-b' })` for the second one and
 * pass that id to the fixtures.
 */
export async function resolveTestTenantId(app: FastifyInstance): Promise<string> {
  const slug = TEST_ENTRA_TENANT_ID.toLowerCase().replace(/-/g, '');
  const organisations = app.mongo.db.collection('organisations');

  const existing = await organisations.findOne({ slug });
  if (existing) {
    return String(existing['_id']);
  }

  // Mirror the JIT-provision path so fixture-inserted tenants look
  // exactly like auth-middleware-provisioned ones. The schema fields
  // here match OrganisationsService.buildOrganisationFromClaims().
  const now = new Date().toISOString();
  const doc = {
    displayName: `Test tenant ${slug}`,
    slug,
    entraTenantId: TEST_ENTRA_TENANT_ID,
    customDomain: null,
    status: 'ACTIVE' as const,
    plan: 'FREE' as const,
    primaryContactEmail: null,
    brandKit: null,
    settings: {},
    createdAt: now,
    updatedAt: now,
    createdBy: 'SYSTEM' as const,
    updatedBy: 'SYSTEM' as const,
    deletedAt: null,
    deletedBy: null,
  };

  const result = await organisations.insertOne(doc);
  return String(result.insertedId);
}

/**
 * Seed an additional test tenant with a custom slug. Used by cross-
 * tenant isolation tests that need to assert tenant A cannot see tenant
 * B's data. Returns the tenant's `_id` as a 24-hex string.
 *
 * The seeded tenant has `entraTenantId` set to a fresh UUID so it does
 * not collide with `TEST_ENTRA_TENANT_ID` on the sparse unique index.
 */
export async function seedTestTenant(
  app: FastifyInstance,
  options: {
    slug: string;
    displayName?: string;
    entraTenantId?: string | null;
    status?: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  },
): Promise<{ _id: string; slug: string }> {
  const now = new Date().toISOString();
  const doc = {
    displayName: options.displayName ?? `Tenant ${options.slug}`,
    slug: options.slug,
    entraTenantId:
      options.entraTenantId !== undefined
        ? options.entraTenantId
        : // Random UUID v4-ish to avoid collision with TEST_ENTRA_TENANT_ID.
          `00000000-0000-4000-8000-${randomHex(12)}`,
    customDomain: null,
    status: options.status ?? ('ACTIVE' as const),
    plan: 'FREE' as const,
    primaryContactEmail: null,
    brandKit: null,
    settings: {},
    createdAt: now,
    updatedAt: now,
    createdBy: 'SYSTEM' as const,
    updatedBy: 'SYSTEM' as const,
    deletedAt: null,
    deletedBy: null,
  };

  const result = await app.mongo.db.collection('organisations').insertOne(doc);
  return { _id: String(result.insertedId), slug: options.slug };
}

// ---------------------------------------------------------------------------
// User fixtures
// ---------------------------------------------------------------------------

/**
 * Provision a user via the normal JIT flow, then promote them to the
 * specified role. Returns the resulting user document (with the bumped
 * role applied).
 *
 * Why go through JIT first instead of direct insert?
 *   The auth flow sets fields we shouldn't have to hand-construct in
 *   every test (preferences, audit fields, accountType, entraOid uniqueness
 *   in the schema). Letting the service build them keeps the fixture
 *   minimal AND keeps tests honest about real provisioning behaviour.
 *
 * Concurrency note:
 *   Tests run sequentially under singleFork, so the JIT call here cannot
 *   race against another provisioning attempt for the same oid.
 */
export async function provisionUserAs(
  app: FastifyInstance,
  signToken: (input: SignTestTokenInput) => Promise<string>,
  options: {
    oid: string;
    role: UserRole;
    email?: string;
    firstName?: string;
    lastName?: string;
  },
): Promise<WithId<User>> {
  const token = await signToken({
    oid: options.oid,
    ...(options.email !== undefined && { email: options.email }),
    ...(options.firstName !== undefined && { given_name: options.firstName }),
    ...(options.lastName !== undefined && { family_name: options.lastName }),
  });

  // JIT-provision via GET /v1/me
  const meRes = await app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: { authorization: `Bearer ${token}` },
  });
  if (meRes.statusCode !== 200) {
    throw new Error(`provisionUserAs: JIT failed with ${meRes.statusCode}: ${meRes.body}`);
  }

  // Bump role directly in DB (simulating admin action; there's no
  // role-management endpoint yet — that's slice #3 territory).
  const usersColl = app.mongo.db.collection<User>('users');
  const updateResult = await usersColl.findOneAndUpdate(
    { entraOid: options.oid },
    { $set: { roles: [options.role] } },
    { returnDocument: 'after' },
  );

  if (!updateResult) {
    throw new Error(`provisionUserAs: could not find user after JIT for oid=${options.oid}`);
  }

  return updateResult;
}

/**
 * Variant of `provisionUserAs` that returns the token alongside the user.
 * Useful when a test wants to JIT a user AND then make requests as them.
 */
export async function provisionUserAsAndSignToken(
  app: FastifyInstance,
  signToken: (input: SignTestTokenInput) => Promise<string>,
  options: {
    oid: string;
    role: UserRole;
    email?: string;
  },
): Promise<{ user: WithId<User>; token: string }> {
  const user = await provisionUserAs(app, signToken, options);
  const tokenInput: SignTestTokenInput = { oid: options.oid };
  if (options.email !== undefined) tokenInput.email = options.email;
  const token = await signToken(tokenInput);
  return { user, token };
}

// ---------------------------------------------------------------------------
// Asset fixtures
// ---------------------------------------------------------------------------

export interface InsertTestAssetOptions {
  /**
   * Tenant scope for this asset. Defaults to the JIT-resolved test
   * tenant (`resolveTestTenantId(app)`). Cross-tenant tests pass a
   * different `_id` to seed data for a second tenant.
   */
  organisationId?: string;
  /**
   * Inventory number. Defaults to a unique value based on the current
   * test timestamp, avoiding collisions across tests.
   */
  inventoryNumber?: string;
  /** Asset display name. Defaults to "Test Asset". */
  name?: string;
  /** Asset status. Defaults to AVAILABLE. */
  status?: 'AVAILABLE' | 'BORROWED' | 'IN_REPAIR' | 'RETIRED' | 'LOST';
  /** Asset condition. Defaults to NEW. */
  condition?: 'NEW' | 'GOOD' | 'FAIR' | 'POOR' | 'BROKEN';
  /** Asset type. Defaults to IT. */
  type?: string;
  /** Category ID (24-hex string). Defaults to a fixed test sentinel. */
  categoryId?: string;
  /** Location ID (24-hex string). Defaults to a fixed test sentinel. */
  locationId?: string;
  /** ID of the user who "created" this asset. Defaults to "test-creator". */
  createdBy?: string;
  /** Override `currentLoanId` (defaults to null = not on loan). */
  currentLoanId?: ObjectId | null;
}

/**
 * Insert an asset directly into the `assets` collection, bypassing the
 * service layer. Returns the inserted document with its assigned `_id`.
 *
 * Use this in test setup for endpoints that operate on an existing
 * asset (GET /:id, PATCH, DELETE). For POST tests, do NOT use this —
 * exercise the POST endpoint directly so its full behaviour is covered.
 */
export async function insertTestAsset(
  app: FastifyInstance,
  options: InsertTestAssetOptions = {},
): Promise<{ _id: string; inventoryNumber: string; name: string }> {
  const now = new Date().toISOString();
  const organisationId = options.organisationId ?? (await resolveTestTenantId(app));
  // Process-monotonic counter so back-to-back inserts in the same
  // millisecond do not collide on the unique
  // `{organisationId, inventoryNumber}` index.
  const defaultInventoryNumber =
    options.inventoryNumber ??
    `TEST-${new Date().getFullYear()}-${String(++testAssetCounter).padStart(6, '0')}`;

  const doc = {
    organisationId,
    inventoryNumber: defaultInventoryNumber,
    serialNumber: null,
    name: options.name ?? 'Test Asset',
    description: null,
    type: options.type ?? 'IT',
    categoryId: options.categoryId ?? '000000000000000000000001',
    condition: options.condition ?? 'NEW',
    locationId: options.locationId ?? '000000000000000000000002',
    manufacturer: null,
    model: null,
    acquiredAt: now,
    acquisitionCost: null,
    warrantyUntil: null,
    specs: {},
    tags: [],
    imageIds: [],
    internalNotes: null,
    isLoanable: true,
    requiresApproval: true,
    status: options.status ?? 'AVAILABLE',
    currentLoanId: options.currentLoanId ?? null,
    createdAt: now,
    updatedAt: now,
    createdBy: options.createdBy ?? 'test-creator',
    updatedBy: options.createdBy ?? 'test-creator',
    deletedAt: null,
    deletedBy: null,
  };

  const insertResult = await app.mongo.db.collection('assets').insertOne(doc);

  return {
    _id: String(insertResult.insertedId),
    inventoryNumber: doc.inventoryNumber,
    name: doc.name,
  };
}

// ---------------------------------------------------------------------------
// Convenience: a minimal valid POST /v1/assets body
// ---------------------------------------------------------------------------

/**
 * Returns a minimal valid request body for `POST /v1/assets`. Tests that
 * need only the happy path use this directly; tests verifying validation
 * errors override one field to introduce the error.
 *
 * Note: this object matches what the API EXPECTS (with `inventoryNumberPrefix`,
 * not `inventoryNumber`). The service generates the full inventory number
 * server-side.
 */
export function validCreateAssetBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    inventoryNumberPrefix: 'TEST',
    name: 'Integration test asset',
    type: 'IT',
    categoryId: '000000000000000000000001',
    condition: 'NEW',
    locationId: '000000000000000000000002',
    acquiredAt: new Date().toISOString(),
    isLoanable: true,
    requiresApproval: true,
    ...overrides,
  };
}

// Re-export UserRole so tests can use it without importing shared-types.
export { UserRole, AccountType };

// ---------------------------------------------------------------------------
// Asset FK reference seeding
// ---------------------------------------------------------------------------

/**
 * Seed one category and one location so a test can POST/PATCH an asset
 * that references real FK targets. Returns their _ids ready to drop into
 * `validCreateAssetBody({ categoryId, locationId })`.
 *
 * Why: after slice #3 K7, the assets service validates that categoryId
 * and locationId point at non-deleted documents. The old sentinel IDs
 * (`000000000000000000000001`, etc) now fail with 400. Tests that need
 * to create an asset have to seed real references first.
 *
 * Use this in `beforeEach` of any asset-creating test:
 *   const fk = await seedAssetFkRefs(app);
 *   ... validCreateAssetBody({ categoryId: fk.categoryId, locationId: fk.locationId })
 */
export async function seedAssetFkRefs(
  app: FastifyInstance,
): Promise<{ categoryId: string; locationId: string }> {
  const stamp = Date.now().toString().slice(-6);
  const category = await insertTestCategory(app, {
    slug: `fk-category-${stamp}`,
    name: `FK Category ${stamp}`,
  });
  const location = await insertTestLocation(app, {
    slug: `fk-location-${stamp}`,
    name: `FK Location ${stamp}`,
  });
  return { categoryId: category._id, locationId: location._id };
}

// ---------------------------------------------------------------------------
// Category fixtures
// ---------------------------------------------------------------------------

export interface InsertTestCategoryOptions {
  /**
   * Tenant scope for this category. Defaults to the JIT-resolved test
   * tenant. Pass a different `_id` to seed cross-tenant data.
   */
  organisationId?: string;
  /** Display name. Defaults to a unique name based on millisecond timestamp. */
  name?: string;
  /** Slug. Defaults to a millisecond-timestamped variant to avoid collisions. */
  slug?: string;
  /** Parent category ID. Defaults to null (root). */
  parentId?: string | null;
  /** Asset type bucket. Defaults to IT. */
  assetType?:
    | 'IT'
    | 'SPORTS_GEAR'
    | 'TRAINING_EQUIPMENT'
    | 'OFFICE_EQUIPMENT'
    | 'MEDIA'
    | 'COMMUNICATION'
    | 'OTHER';
  /** Active flag. Defaults to true. */
  isActive?: boolean;
  /** Sort order. Defaults to 0. */
  sortOrder?: number;
  /** Optional description. */
  description?: string | null;
  /** Optional icon name. */
  icon?: string | null;
  /** Optional hex color. */
  color?: string | null;
  /** Approver user IDs. Defaults to empty array. */
  approverIds?: string[];
  /** Whether loans need approval by default. Defaults to true. */
  requiresApprovalByDefault?: boolean;
  /** Max loan days. Defaults to null (no limit). */
  maxLoanDays?: number | null;
  /** ID of the user who "created" this category. Defaults to "test-creator". */
  createdBy?: string;
}

/**
 * Insert a category directly into the `categories` collection, bypassing
 * the service. Returns the inserted document's _id, name, and slug.
 *
 * Use this in PATCH/DELETE tests to set up an existing category. For
 * POST tests, exercise the endpoint directly.
 */
export async function insertTestCategory(
  app: FastifyInstance,
  options: InsertTestCategoryOptions = {},
): Promise<{ _id: string; name: string; slug: string }> {
  const now = new Date().toISOString();
  const stamp = Date.now().toString().slice(-6);
  const organisationId = options.organisationId ?? (await resolveTestTenantId(app));

  const doc = {
    organisationId,
    name: options.name ?? `Test Category ${stamp}`,
    slug: options.slug ?? `test-category-${stamp}`,
    parentId: options.parentId ?? null,
    assetType: options.assetType ?? 'IT',
    description: options.description ?? null,
    icon: options.icon ?? null,
    color: options.color ?? null,
    approverIds: options.approverIds ?? [],
    requiresApprovalByDefault: options.requiresApprovalByDefault ?? true,
    maxLoanDays: options.maxLoanDays ?? null,
    isActive: options.isActive ?? true,
    sortOrder: options.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
    createdBy: options.createdBy ?? 'test-creator',
    updatedBy: options.createdBy ?? 'test-creator',
    deletedAt: null,
    deletedBy: null,
  };

  const insertResult = await app.mongo.db.collection('categories').insertOne(doc);

  return {
    _id: String(insertResult.insertedId),
    name: doc.name,
    slug: doc.slug,
  };
}

/**
 * Returns a minimal valid request body for `POST /v1/categories`.
 *
 * Note: caller must supply a unique slug per test if testing slug-related
 * behaviour. The default uses a millisecond stamp to avoid same-second
 * collisions between consecutive tests in one file.
 */
export function validCreateCategoryBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const stamp = Date.now().toString().slice(-6);
  return {
    name: `Test Category ${stamp}`,
    slug: `test-category-${stamp}`,
    parentId: null,
    assetType: 'IT',
    description: null,
    icon: null,
    color: null,
    approverIds: [],
    requiresApprovalByDefault: true,
    maxLoanDays: null,
    isActive: true,
    sortOrder: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Location fixtures
// ---------------------------------------------------------------------------

export type LocationType =
  | 'WAREHOUSE'
  | 'OFFICE'
  | 'STADIUM'
  | 'TRAINING_CENTER'
  | 'EXTERNAL'
  | 'IN_TRANSIT';

export interface InsertTestLocationOptions {
  /**
   * Tenant scope for this location. Defaults to the JIT-resolved test
   * tenant. Pass a different `_id` to seed cross-tenant data.
   */
  organisationId?: string;
  /** Display name. Defaults to a unique name based on millisecond timestamp. */
  name?: string;
  /** Slug. Defaults to a millisecond-timestamped variant to avoid collisions. */
  slug?: string;
  /** Parent location ID. Defaults to null (root). */
  parentId?: string | null;
  /** Location type. Defaults to WAREHOUSE. */
  type?: LocationType;
  /** Active flag. Defaults to true. */
  isActive?: boolean;
  /** Optional description. */
  description?: string | null;
  /** Optional address. */
  address?: {
    street?: string;
    city?: string;
    postalCode?: string;
    country?: string;
  } | null;
  /** Optional GPS coordinates. */
  coordinates?: { lat: number; lng: number } | null;
  /** Optional manager user ID. */
  managerId?: string | null;
  /** ID of the user who "created" this location. Defaults to "test-creator". */
  createdBy?: string;
}

/**
 * Insert a location directly into the `locations` collection, bypassing
 * the service. Returns the inserted document's _id, name, and slug.
 *
 * Use this in PATCH/DELETE tests to set up an existing location. For
 * POST tests, exercise the endpoint directly.
 */
export async function insertTestLocation(
  app: FastifyInstance,
  options: InsertTestLocationOptions = {},
): Promise<{ _id: string; name: string; slug: string }> {
  const now = new Date().toISOString();
  const stamp = Date.now().toString().slice(-6);
  const organisationId = options.organisationId ?? (await resolveTestTenantId(app));

  const doc = {
    organisationId,
    name: options.name ?? `Test Location ${stamp}`,
    slug: options.slug ?? `test-location-${stamp}`,
    type: options.type ?? 'WAREHOUSE',
    address: options.address ?? null,
    coordinates: options.coordinates ?? null,
    parentId: options.parentId ?? null,
    description: options.description ?? null,
    managerId: options.managerId ?? null,
    isActive: options.isActive ?? true,
    createdAt: now,
    updatedAt: now,
    createdBy: options.createdBy ?? 'test-creator',
    updatedBy: options.createdBy ?? 'test-creator',
    deletedAt: null,
    deletedBy: null,
  };

  const insertResult = await app.mongo.db.collection('locations').insertOne(doc);

  return {
    _id: String(insertResult.insertedId),
    name: doc.name,
    slug: doc.slug,
  };
}

/**
 * Returns a minimal valid request body for `POST /v1/locations`.
 *
 * Note: caller must supply a unique slug per test if testing slug-related
 * behaviour. The default uses a millisecond stamp to avoid same-second
 * collisions between consecutive tests in one file.
 */
export function validCreateLocationBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const stamp = Date.now().toString().slice(-6);
  return {
    name: `Test Location ${stamp}`,
    slug: `test-location-${stamp}`,
    type: 'WAREHOUSE',
    address: null,
    coordinates: null,
    parentId: null,
    description: null,
    managerId: null,
    isActive: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Loan Request fixtures
// ---------------------------------------------------------------------------

export interface InsertTestLoanRequestOptions {
  organisationId?: string;
  requesterId?: string;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  /** Array of assetIds to include. Defaults to one test asset created inline. */
  assetIds?: string[];
  plannedFrom?: string;
  plannedTo?: string;
  purpose?: string;
  resultingLoanId?: string | null;
  rejectionReason?: string | null;
}

/**
 * Insert a loan request directly into the `loan_requests` collection.
 * Useful for tests that need an existing request to operate on.
 */
export async function insertTestLoanRequest(
  app: FastifyInstance,
  options: InsertTestLoanRequestOptions = {},
): Promise<{ _id: string; status: string; items: Array<{ assetId: string }> }> {
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const organisationId = options.organisationId ?? (await resolveTestTenantId(app));
  const requesterId = options.requesterId ?? 'test-requester-000000000000';

  // Default to one sentinel asset if no ids given.
  const assetIds = options.assetIds ?? ['000000000000000000000099'];

  const items = assetIds.map((assetId) => ({
    assetId,
    snapshot: { inventoryNumber: `TEST-${assetId.slice(-4)}`, name: 'Test Asset' },
    status: 'PENDING' as const,
    substitutedWithAssetId: null,
    approverNote: null,
  }));

  const doc = {
    organisationId,
    requesterId,
    purpose: options.purpose ?? 'Test purpose',
    plannedFrom: options.plannedFrom ?? now,
    plannedTo: options.plannedTo ?? future,
    items,
    status: options.status ?? 'PENDING',
    approvers: [],
    resultingLoanId: options.resultingLoanId ?? null,
    rejectionReason: options.rejectionReason ?? null,
    teamId: null,
    idempotencyKey: null,
    createdAt: now,
    updatedAt: now,
    createdBy: requesterId,
    updatedBy: requesterId,
    deletedAt: null,
    deletedBy: null,
  };

  const result = await app.mongo.db.collection('loan_requests').insertOne(doc);
  return {
    _id: String(result.insertedId),
    status: doc.status,
    items: items.map((i) => ({ assetId: i.assetId })),
  };
}

// ---------------------------------------------------------------------------
// Loan fixtures
// ---------------------------------------------------------------------------

export interface InsertTestLoanOptions {
  organisationId?: string;
  requestId?: string;
  borrowerId?: string;
  assetIds?: string[];
  status?: 'ACTIVE' | 'RETURNED' | 'DAMAGED' | 'LOST';
  /** dueAt ISO string. Defaults to 7 days from now (not overdue). */
  dueAt?: string;
}

/**
 * Insert a loan directly into the `loans` collection.
 */
export async function insertTestLoan(
  app: FastifyInstance,
  options: InsertTestLoanOptions = {},
): Promise<{ _id: string; status: string }> {
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const organisationId = options.organisationId ?? (await resolveTestTenantId(app));
  const borrowerId = options.borrowerId ?? 'test-borrower-0000000000000';
  const assetIds = options.assetIds ?? ['000000000000000000000099'];

  const items = assetIds.map((assetId) => ({
    assetId,
    snapshot: { inventoryNumber: `TEST-${assetId.slice(-4)}`, name: 'Test Asset' },
    condition: {
      atPickup: { condition: 'GOOD' as const, note: null, photoIds: [] },
      atReturn: null,
    },
  }));

  const doc = {
    organisationId,
    requestId: options.requestId ?? '000000000000000000000000',
    borrowerId,
    purpose: 'Test purpose',
    pickedUpAt: now,
    handedOverBy: 'test-manager-00000000000',
    dueAt: options.dueAt ?? future,
    returnedAt: null,
    returnedTo: null,
    items,
    status: options.status ?? 'ACTIVE',
    extensionCount: 0,
    handoverProtocolId: null,
    returnProtocolId: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
    createdBy: borrowerId,
    updatedBy: borrowerId,
    deletedAt: null,
    deletedBy: null,
  };

  const result = await app.mongo.db.collection('loans').insertOne(doc);
  return { _id: String(result.insertedId), status: doc.status };
}

export interface InsertTestUserOptions {
  /**
   * Tenant scope for this user. Defaults to the JIT-resolved test
   * tenant. Pass a different `_id` to seed cross-tenant data.
   */
  organisationId?: string;
  /** Primary email. Defaults to a unique value based on millisecond timestamp. */
  email?: string;
  /** First name. Defaults to "Test". */
  firstName?: string;
  /** Last name. Defaults to "User". */
  lastName?: string;
  /** Display name. Defaults to firstName + lastName. */
  displayName?: string;
  /** Account type. Defaults to ENTRA_ID. */
  accountType?: 'ENTRA_ID' | 'LOCAL';
  /** Entra Object ID. Defaults to a unique UUID-shaped string for ENTRA_ID. */
  entraOid?: string | null;
  /** Roles array. Defaults to [EMPLOYEE]. */
  roles?: UserRole[];
  /** Active flag. Defaults to true. */
  isActive?: boolean;
  /** ID of the user who "created" this record. Defaults to "test-creator". */
  createdBy?: string;
}

/**
 * Insert a user directly into the `users` collection, bypassing the JIT
 * service path. Returns the inserted document's _id, email, and roles.
 *
 * Why a direct-insert path (in addition to `provisionUserAs`):
 *   `provisionUserAs` walks the full JIT flow, which is overkill (and
 *   slower) when a test just needs a target user to PATCH or look up
 *   by id. For admin-endpoint tests where the actor is the admin and
 *   the target is a stranger, this helper is the right tool.
 *
 * The fixture sets sensible defaults for all required schema fields so
 * the inserted document is shaped like a real user (no missing
 * `preferences`, `teams`, etc.).
 */
export async function insertTestUser(
  app: FastifyInstance,
  options: InsertTestUserOptions = {},
): Promise<{ _id: string; email: string; roles: UserRole[] }> {
  const now = new Date().toISOString();
  // Random hex stamp so concurrent inserts in the same tick get distinct
  // emails / entraOids without colliding on either unique index.
  const stamp = randomHex(12);
  const organisationId = options.organisationId ?? (await resolveTestTenantId(app));

  const firstName = options.firstName ?? 'Test';
  const lastName = options.lastName ?? 'User';
  const accountType = options.accountType ?? 'ENTRA_ID';
  // For ENTRA_ID accounts the entraOid must be a non-null unique value
  // matching the UUID v4 pattern from shared-types (`z.string().uuid()`).
  // We construct one with the v4 sentinel byte and random hex in the
  // node segment.
  const defaultEntraOid = accountType === 'ENTRA_ID' ? `00000000-0000-4000-8000-${stamp}` : null;

  const doc = {
    organisationId,
    email: options.email ?? `test-${stamp}@example.com`,
    firstName,
    lastName,
    displayName: options.displayName ?? `${firstName} ${lastName}`,
    accountType,
    entraOid: options.entraOid !== undefined ? options.entraOid : defaultEntraOid,
    passwordHash: null,
    roles: options.roles ?? [UserRole.EMPLOYEE],
    organizationalUnit: null,
    teams: [],
    isActive: options.isActive ?? true,
    lastLoginAt: now,
    invitationSentAt: null,
    mustChangePassword: false,
    preferences: {
      language: 'sk',
      timezone: 'Europe/Bratislava',
      emailNotifications: true,
      pushNotifications: false,
    },
    createdAt: now,
    updatedAt: now,
    createdBy: options.createdBy ?? 'test-creator',
    updatedBy: options.createdBy ?? 'test-creator',
    deletedAt: null,
    deletedBy: null,
  };

  const insertResult = await app.mongo.db.collection('users').insertOne(doc);

  return {
    _id: String(insertResult.insertedId),
    email: doc.email,
    roles: doc.roles,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Generate `length` random lowercase hex characters. Used to fabricate
 * unique entraOid suffixes and email local parts for test users.
 */
function randomHex(length: number): string {
  const chars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

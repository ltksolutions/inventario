// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { apiClient } from './api-client';
import { useAuth } from './auth-context';

/**
 * TanStack Query hooks wrapping the generated openapi-fetch client.
 *
 * Every hook follows the same pattern:
 *   1. Query key is namespaced under a string literal so we can
 *      invalidate slices independently (e.g. `assets`, `categories`).
 *   2. The query function calls apiClient and unwraps `{ data, error }`,
 *      throwing on error so TanStack can route it through its error
 *      state. The thrown value is the parsed error body when the
 *      backend returned one, or the underlying Error otherwise.
 *   3. `enabled` defaults to whether the user is authenticated —
 *      pre-login components stay silent instead of hammering the API
 *      with 401s.
 *
 * Why one tiny hook per endpoint instead of a fully generic helper:
 *   typed query keys (e.g. ['assets', { limit, skip, filters }]) are
 *   much easier to reason about than a generic wrapper, and the
 *   compile-time autocomplete on filters is worth the small repetition.
 */

// ---------------------------------------------------------------------------
// Response type aliases
// ---------------------------------------------------------------------------

/**
 * The Me response shape. Defined here because /v1/me's response
 * schema is a small subset of the full User document — re-using a
 * full User type would over-expose fields and confuse downstream
 * code about what's actually available client-side.
 */
export interface MeResponse {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  accountType: string;
  roles: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  preferences: Record<string, unknown>;
  createdAt: string;
}

/**
 * Generic list-response wrapper used by all paginated endpoints
 * (assets, categories, locations, users).
 */
export interface ListResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    skip: number;
    hasMore: boolean;
  };
}

// ---------------------------------------------------------------------------
// /v1/me — current authenticated user
// ---------------------------------------------------------------------------

/**
 * Fetch the current user. Pair with useIsAuthenticated() upstream;
 * this hook itself gates on the same signal so it doesn't fire
 * pre-login.
 */
export function useMe(): UseQueryResult<MeResponse, Error> {
  const { isAuthenticated } = useAuth();

  return useQuery<MeResponse, Error>({
    queryKey: ['me'],
    enabled: isAuthenticated,
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/v1/me');
      if (error) {
        // The openapi-fetch error type is `never` for endpoints that
        // don't declare error responses in the spec. Cast through
        // unknown so we can still surface the runtime payload (the
        // backend's error-handler.ts returns { message, code, ... }).
        const errObj = error as unknown as { message?: unknown };
        throw new Error(
          typeof errObj.message === 'string' ? errObj.message : 'Failed to load current user',
        );
      }
      if (!data) {
        throw new Error('Empty response from /v1/me');
      }
      // Cast through unknown — the openapi-typescript schema uses a
      // permissive record shape, but we know the route returns the
      // MeResponse fields (the response schema is enforced server-side).
      return data as unknown as MeResponse;
    },
  });
}

// ---------------------------------------------------------------------------
// Generic list fetchers — keep the signatures uniform across resources
// ---------------------------------------------------------------------------

interface ListQueryOptions {
  limit?: number;
  skip?: number;
}

/**
 * Build a list-fetcher hook for a resource. Reduces boilerplate while
 * keeping each call site type-checkable.
 *
 * Used internally — exported hooks below wrap this with concrete
 * resource names so the query keys stay readable.
 */
function makeListHook<TItem>(
  resourceKey: string,
  path: '/v1/assets' | '/v1/categories' | '/v1/locations',
) {
  return function useResourceList(
    options: ListQueryOptions = {},
  ): UseQueryResult<ListResponse<TItem>, Error> {
    const { limit = 50, skip = 0 } = options;
    const { isAuthenticated } = useAuth();

    return useQuery<ListResponse<TItem>, Error>({
      queryKey: [resourceKey, { limit, skip }],
      enabled: isAuthenticated,
      queryFn: async () => {
        const { data, error } = await apiClient.GET(path, {
          params: { query: { limit, skip } },
        });
        if (error) {
          // See useMe — the spec doesn't declare error responses, so
          // openapi-fetch types `error` as `never`. Cast and inspect.
          const errObj = error as unknown as { message?: unknown };
          throw new Error(
            typeof errObj.message === 'string' ? errObj.message : `Failed to load ${resourceKey}`,
          );
        }
        if (!data) {
          throw new Error(`Empty response from ${path}`);
        }
        return data as unknown as ListResponse<TItem>;
      },
    });
  };
}

// ---------------------------------------------------------------------------
// Resource list hooks
// ---------------------------------------------------------------------------

/**
 * Minimal asset shape used by the dashboard and list pages. The full
 * Asset schema has many more fields; we only project what the UI
 * actually renders. Code that needs more fields casts the result.
 */
export interface AssetSummary {
  _id: string;
  inventoryNumber: string;
  name: string;
  status: string;
  categoryId: string;
  locationId: string;
  /** ADR-0020: SERIALIZED (default) alebo BULK. */
  trackingMode: 'SERIALIZED' | 'BULK';
  /** ADR-0020: zostatok pre BULK položky, null pre SERIALIZED. */
  quantityOnHand: number | null;
  [key: string]: unknown;
}

export interface CategorySummary {
  _id: string;
  name: string;
  slug: string;
  assetType: string;
  isActive: boolean;
  [key: string]: unknown;
}

export interface LocationSummary {
  _id: string;
  name: string;
  slug: string;
  type: string;
  isActive: boolean;
  [key: string]: unknown;
}

export const useAssets = makeListHook<AssetSummary>('assets', '/v1/assets');
export const useCategories = makeListHook<CategorySummary>('categories', '/v1/categories');
export const useLocations = makeListHook<LocationSummary>('locations', '/v1/locations');

// ---------------------------------------------------------------------------
// Asset Types + Asset Conditions — dynamic per-tenant collections
// ---------------------------------------------------------------------------

export interface AssetTypeEntrySummary {
  _id: string;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
  [key: string]: unknown;
}

export interface AssetConditionEntrySummary {
  _id: string;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
  [key: string]: unknown;
}

export function useAssetTypes(
  options: ListQueryOptions = {},
): UseQueryResult<ListResponse<AssetTypeEntrySummary>, Error> {
  const { limit = 200, skip = 0 } = options;
  const { isAuthenticated } = useAuth();

  return useQuery<ListResponse<AssetTypeEntrySummary>, Error>({
    queryKey: ['asset-types', { limit, skip }],
    enabled: isAuthenticated,
    queryFn: async () => {
      const fetchAssetTypes = apiClient.GET as (
        path: string,
        opts: unknown,
      ) => Promise<{ data: unknown; error: unknown }>;
      const { data, error } = await fetchAssetTypes('/v1/asset-types', {
        params: { query: { limit, skip } },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to load asset types');
      }
      if (!data) throw new Error('Empty response from /v1/asset-types');
      return data as unknown as ListResponse<AssetTypeEntrySummary>;
    },
  });
}

export function useAssetConditions(
  options: ListQueryOptions = {},
): UseQueryResult<ListResponse<AssetConditionEntrySummary>, Error> {
  const { limit = 200, skip = 0 } = options;
  const { isAuthenticated } = useAuth();

  return useQuery<ListResponse<AssetConditionEntrySummary>, Error>({
    queryKey: ['asset-conditions', { limit, skip }],
    enabled: isAuthenticated,
    queryFn: async () => {
      const fetchAssetConditions = apiClient.GET as (
        path: string,
        opts: unknown,
      ) => Promise<{ data: unknown; error: unknown }>;
      const { data, error } = await fetchAssetConditions('/v1/asset-conditions', {
        params: { query: { limit, skip } },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(
          typeof e.message === 'string' ? e.message : 'Failed to load asset conditions',
        );
      }
      if (!data) throw new Error('Empty response from /v1/asset-conditions');
      return data as unknown as ListResponse<AssetConditionEntrySummary>;
    },
  });
}

// ---------------------------------------------------------------------------
// Categories — create + delete
// ---------------------------------------------------------------------------

/**
 * Input shape for creating a category. Mirrors the backend's
 * `ApiCreateCategoryBodySchema` in apps/api/src/modules/categories/
 * categories.routes.ts — `slug` is optional (server derives from
 * name), every other field has a sensible default the route applies.
 *
 * Most fields are intentionally optional even though the backend's
 * Zod schema accepts them: the K1 UI sends a minimal payload (name +
 * assetType + maybe description/parentId), and the backend default
 * does the rest. Once the categories edit form lands we'll expose
 * the remaining knobs (color, icon, approvers, maxLoanDays) — until
 * then this hook keeps the call site small.
 */
export interface CreateCategoryInput {
  name: string;
  assetType: string;
  description?: string | null | undefined;
  parentId?: string | null | undefined;
  slug?: string | undefined;
}

/**
 * Full category shape as returned by the API. Wider than
 * `CategorySummary` (which is just the projection the list views
 * need); pages that show all fields (e.g. edit form) use this.
 */
export interface CategoryDetail {
  _id: string;
  organisationId: string;
  name: string;
  slug: string;
  parentId: string | null;
  assetType: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  approverIds: string[];
  requiresApprovalByDefault: boolean;
  maxLoanDays: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
}

/**
 * POST /v1/categories. On success invalidates the categories list
 * cache so list pages re-fetch and the new row appears.
 *
 * Backend RBAC: ASSET_MANAGER + ADMIN can call this. We don't enforce
 * RBAC client-side here — `useCanManageTaxonomy()` is the helper UI
 * uses to gate the "+ Pridať" button. The mutation will still hit
 * 403 for an unauthorized caller; we just don't surface the button.
 */
export function useCreateCategory(): UseMutationResult<CategoryDetail, Error, CreateCategoryInput> {
  const queryClient = useQueryClient();

  return useMutation<CategoryDetail, Error, CreateCategoryInput>({
    mutationFn: async (input) => {
      // Strip undefined values — Zod's defaults only apply when the
      // field is absent from the JSON body, not when it's `undefined`.
      // Send `null` for parentId/description if the user left them
      // empty (those are nullable in the schema).
      const body: Record<string, unknown> = {
        name: input.name,
        assetType: input.assetType,
        parentId: input.parentId ?? null,
        description:
          input.description == null || input.description === '' ? null : input.description,
      };
      if (input.slug !== undefined && input.slug !== '') {
        body['slug'] = input.slug;
      }

      const { data, error } = await apiClient.POST('/v1/categories', {
        body: body as never,
      });
      if (error) {
        const errObj = error as unknown as { message?: unknown };
        throw new Error(
          typeof errObj.message === 'string' ? errObj.message : 'Failed to create category',
        );
      }
      if (!data) {
        throw new Error('Empty response after category create');
      }
      return data as unknown as CategoryDetail;
    },
    onSuccess: () => {
      // Refresh every cached page of the categories list. Cheaper
      // than reconciling and prevents stale per-page caches from
      // hiding the new row when the user paginates.
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

/**
 * DELETE /v1/categories/:id. Server-side this is a soft-delete with
 * two FK protection checks:
 *   - Refuse if the category has any non-deleted child categories
 *     (would orphan a subtree).
 *   - Refuse if any non-deleted asset references this category.
 *
 * Both cases surface as a 400 with a message naming the offending
 * count + category name (e.g. "12 assets reference it. Reassign or
 * delete those assets first."). The caller renders that message
 * verbatim — the backend already phrased it for end users.
 *
 * RBAC: ADMIN only. Client-side, the delete button is hidden behind
 * `useCanDeleteTaxonomy()`.
 */
export function useDeleteCategory(): UseMutationResult<void, Error, { id: string }> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await apiClient.DELETE('/v1/categories/{id}', {
        params: { path: { id } },
      });
      if (error) {
        const errObj = error as unknown as { message?: unknown };
        throw new Error(
          typeof errObj.message === 'string' ? errObj.message : 'Failed to delete category',
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Locations — create + delete
// ---------------------------------------------------------------------------

/**
 * Input shape for creating a location. Mirrors the backend's
 * `ApiCreateLocationBodySchema` in apps/api/src/modules/locations/
 * locations.routes.ts — `slug` is optional (server derives from
 * name), every other field has a sensible default the route applies.
 *
 * The MVP create modal only collects name + type + description +
 * parentId; richer fields (address, coordinates, managerId) get
 * filled in via the (yet-to-be-built) edit form. The hook exposes
 * the full shape so future call sites don't need a second hook.
 */
export interface CreateLocationInput {
  name: string;
  type: string;
  description?: string | null | undefined;
  parentId?: string | null | undefined;
  slug?: string | undefined;
  address?:
    | {
        street?: string | undefined;
        city?: string | undefined;
        postalCode?: string | undefined;
        country?: string | undefined;
      }
    | null
    | undefined;
  coordinates?: { lat: number; lng: number } | null | undefined;
  managerId?: string | null | undefined;
  isActive?: boolean | undefined;
}

/**
 * Full location shape as returned by the API. Wider than
 * `LocationSummary` (which is just the projection the list views
 * need); pages that show every field (e.g. edit form) use this.
 */
export interface LocationDetail {
  _id: string;
  organisationId: string;
  name: string;
  slug: string;
  type: string;
  parentId: string | null;
  description: string | null;
  address: {
    street?: string | null;
    city?: string | null;
    postalCode?: string | null;
    country: string;
  } | null;
  coordinates: { lat: number; lng: number } | null;
  managerId: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
}

/**
 * POST /v1/locations. On success invalidates the locations list
 * cache so list pages re-fetch and the new row appears.
 *
 * Backend RBAC: ASSET_MANAGER + ADMIN can call this. Client-side the
 * "+ Pridať" button is gated behind `useCanManageTaxonomy()` — same
 * helper as categories, same role set.
 */
export function useCreateLocation(): UseMutationResult<LocationDetail, Error, CreateLocationInput> {
  const queryClient = useQueryClient();

  return useMutation<LocationDetail, Error, CreateLocationInput>({
    mutationFn: async (input) => {
      // Same strip-undefined pattern as useCreateCategory — Zod
      // defaults only fire when a field is absent from the body, not
      // when it's `undefined`. Send `null` for nullable fields if the
      // user left them empty.
      const body: Record<string, unknown> = {
        name: input.name,
        type: input.type,
        parentId: input.parentId ?? null,
        description:
          input.description == null || input.description === '' ? null : input.description,
        address: input.address ?? null,
        coordinates: input.coordinates ?? null,
        managerId: input.managerId ?? null,
      };
      if (input.slug !== undefined && input.slug !== '') {
        body['slug'] = input.slug;
      }
      if (input.isActive !== undefined) {
        body['isActive'] = input.isActive;
      }

      const { data, error } = await apiClient.POST('/v1/locations', {
        body: body as never,
      });
      if (error) {
        const errObj = error as unknown as { message?: unknown };
        throw new Error(
          typeof errObj.message === 'string' ? errObj.message : 'Failed to create location',
        );
      }
      if (!data) {
        throw new Error('Empty response after location create');
      }
      return data as unknown as LocationDetail;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
    },
  });
}

/**
 * DELETE /v1/locations/:id. Server-side this is a soft-delete with
 * two FK protection checks (mirrors categories):
 *   - Refuse if the location has any non-deleted child locations
 *     (would orphan a subtree).
 *   - Refuse if any non-deleted asset references this location.
 *
 * Both cases surface as a 400 with a user-friendly message naming
 * the offending count + location name. The caller renders the
 * message verbatim through ConfirmDeleteDialog.
 *
 * RBAC: ADMIN only. Client-side the delete button hides behind
 * `useCanDeleteTaxonomy()`.
 */
export function useDeleteLocation(): UseMutationResult<void, Error, { id: string }> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await apiClient.DELETE('/v1/locations/{id}', {
        params: { path: { id } },
      });
      if (error) {
        const errObj = error as unknown as { message?: unknown };
        throw new Error(
          typeof errObj.message === 'string' ? errObj.message : 'Failed to delete location',
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Single asset — detail + update
// ---------------------------------------------------------------------------

/**
 * Full asset shape returned by GET /v1/assets/:id.
 *
 * Wider than AssetSummary because the detail page needs every column
 * the backend persists. The schema lives in @inventario/shared-types
 * (AssetSchema), but we keep a local copy of the field surface here
 * for two reasons:
 *
 *   - openapi-typescript generates a deeply permissive record type
 *     for the path response (lots of `unknown`), so a narrow local
 *     interface gives much better autocomplete at every call site.
 *   - The shared Zod schema includes Date objects after parsing,
 *     but the HTTP boundary always ships ISO strings — we want the
 *     wire shape, not the parsed runtime shape.
 *
 * Stays in sync via the openapi.json freshness CI check + manual
 * review when the backend asset schema changes.
 */
export interface AssetDetail {
  _id: string;
  organisationId: string;
  inventoryNumber: string;
  serialNumber: string | null;
  name: string;
  description: string | null;
  type: string;
  categoryId: string;
  status: string;
  condition: string;
  locationId: string;
  currentLoanId: string | null;
  manufacturer: string | null;
  model: string | null;
  acquiredAt: string;
  acquisitionCost: number | null;
  warrantyUntil: string | null;
  specs: Record<string, unknown>;
  tags: string[];
  imageIds: string[];
  internalNotes: string | null;
  isLoanable: boolean;
  requiresApproval: boolean;
  /** ADR-0020: SERIALIZED (default) alebo BULK (hromadné množstevné položky). */
  trackingMode: 'SERIALIZED' | 'BULK';
  /** ADR-0020: cache zo StockMovement ledgera. Null pre SERIALIZED. */
  quantityOnHand: number | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
}

/**
 * Patchable subset of AssetDetail. Mirrors the server's
 * UpdateAssetSchema (shared-types) — everything optional, but never
 * `inventoryNumber` (immutable identity) and never `organisationId`
 * (tenant scope is immutable).
 */
export type AssetUpdatePatch = Partial<
  Omit<
    AssetDetail,
    | '_id'
    | 'organisationId'
    | 'inventoryNumber'
    | 'createdAt'
    | 'updatedAt'
    | 'createdBy'
    | 'updatedBy'
    | 'deletedAt'
    | 'deletedBy'
    | 'currentLoanId'
  >
>;

/**
 * Fetch a single asset by ID. Returns isError + 404-aware error so
 * the page can render a "not found" empty state distinct from
 * "server unreachable".
 *
 * Why a separate hook instead of useAssets({ filter: { _id } }):
 *   the backend exposes /v1/assets/:id with stricter tenant scoping
 *   and access logging than the list endpoint. We want to honour
 *   that boundary on the client too.
 */
export function useAsset(id: string | null): UseQueryResult<AssetDetail, Error> {
  const { isAuthenticated } = useAuth();

  return useQuery<AssetDetail, Error>({
    queryKey: ['asset', id],
    enabled: isAuthenticated && typeof id === 'string' && id.length > 0,
    queryFn: async () => {
      if (!id) {
        // useQuery only invokes queryFn when `enabled` is true, so this
        // path is unreachable at runtime — but the type narrowing helps
        // satisfy openapi-fetch's path-param requirement below.
        throw new Error('Asset ID is required.');
      }
      const result = await apiClient.GET('/v1/assets/{id}', {
        params: { path: { id } },
      });
      const { data, error } = result;
      // openapi-fetch types `response` as `never` when the spec doesn't
      // declare error responses for the endpoint. Cast to a vanilla
      // Response so we can read the status code for the 404-vs-other
      // branch the UI cares about.
      const response = (result as unknown as { response?: Response }).response;
      if (error) {
        const errObj = error as unknown as { message?: unknown };
        const msg = typeof errObj.message === 'string' ? errObj.message : 'Failed to load asset';
        // Attach status code so the page can render the right empty
        // state for 404 vs 403 vs 5xx without re-parsing the message.
        const wrapped = new Error(msg) as Error & { status?: number };
        if (response?.status != null) {
          wrapped.status = response.status;
        }
        throw wrapped;
      }
      if (!data) {
        throw new Error('Empty response from /v1/assets/:id');
      }
      return data as unknown as AssetDetail;
    },
  });
}

/**
 * PATCH an asset. On success invalidates both the single-asset cache
 * and any list views so the change shows up everywhere immediately.
 *
 * Variables shape is `{ id, patch }` rather than the patch alone so a
 * single mutation instance can be reused across different assets
 * (rare, but cheap to support and makes the call site read naturally:
 * `mutate({ id, patch: dirtyFields })`).
 */
export function useUpdateAsset(): UseMutationResult<
  AssetDetail,
  Error,
  { id: string; patch: AssetUpdatePatch }
> {
  const queryClient = useQueryClient();

  return useMutation<AssetDetail, Error, { id: string; patch: AssetUpdatePatch }>({
    mutationFn: async ({ id, patch }) => {
      const { data, error } = await apiClient.PATCH('/v1/assets/{id}', {
        params: { path: { id } },
        // openapi-fetch types the body off the spec; cast through unknown
        // because the spec's Update body has the same shape as our local
        // AssetUpdatePatch but with more permissive `unknown` fields.
        body: patch as unknown as never,
      });
      if (error) {
        const errObj = error as unknown as { message?: unknown };
        throw new Error(
          typeof errObj.message === 'string' ? errObj.message : 'Failed to update asset',
        );
      }
      if (!data) {
        throw new Error('Empty response after asset update');
      }
      return data as unknown as AssetDetail;
    },
    onSuccess: (updated) => {
      // Replace the cached detail with the freshly-returned document,
      // so the UI flips back to read mode without an extra round-trip.
      queryClient.setQueryData(['asset', updated._id], updated);
      // Invalidate every list — we can't know which page the asset
      // appears on, and refetching is cheaper than reconciling.
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Users — admin list, detail, update
// ---------------------------------------------------------------------------

/**
 * Minimal user shape used by the admin list page. The full User
 * schema has many more fields; the projection here is what the list
 * UI actually renders (display + filter columns + identity for the
 * edit modal).
 */
export interface UserSummary {
  _id: string;
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
  accountType: string;
  roles: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  [key: string]: unknown;
}

/**
 * Full user shape as returned by GET /v1/users/:id. Same field set
 * as MeResponse plus the admin-only fields (organisationId,
 * createdAt etc.) for the edit dialog.
 */
export interface UserDetail {
  _id: string;
  organisationId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  accountType: string;
  roles: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Patch body for PATCH /v1/users/:id. K10 exposes only `roles` and
 * `isActive`; the service supports more (name, preferences) but the
 * admin endpoint deliberately stays narrow.
 */
export interface UserUpdatePatch {
  roles?: string[] | undefined;
  isActive?: boolean | undefined;
}

interface UsersListQueryOptions {
  limit?: number;
  skip?: number;
  role?: string | undefined;
  isActive?: boolean | undefined;
  /** Free-text search across email + displayName + firstName + lastName. */
  q?: string | undefined;
}

/**
 * GET /v1/users — paginated user list with filters. ADMIN-only on
 * the backend; the client mirrors that with `useCanAdminUsers()`
 * gating the whole route.
 *
 * The query key includes every filter so different filter
 * combinations don't share a cache. `q` is debounced upstream —
 * the page-level component holds the search input state and only
 * passes the debounced value down.
 */
export function useUsers(
  options: UsersListQueryOptions = {},
): UseQueryResult<ListResponse<UserSummary>, Error> {
  const { limit = 50, skip = 0, role, isActive, q } = options;
  const { isAuthenticated } = useAuth();

  return useQuery<ListResponse<UserSummary>, Error>({
    queryKey: ['users', { limit, skip, role, isActive, q }],
    enabled: isAuthenticated,
    queryFn: async () => {
      // Build the query object incrementally so undefined values
      // never make it into the wire format. openapi-fetch passes the
      // object straight to URLSearchParams, which would serialise
      // `undefined` as the literal string "undefined".
      const query: Record<string, unknown> = { limit, skip };
      if (role !== undefined) {
        query['role'] = role;
      }
      if (isActive !== undefined) {
        // The backend accepts the literal strings 'true' / 'false'
        // (see the isActive enum in ListUsersQuerySchema). Send the
        // canonical lowercase form.
        query['isActive'] = isActive ? 'true' : 'false';
      }
      if (q !== undefined && q.length > 0) {
        query['q'] = q;
      }

      const { data, error } = await apiClient.GET('/v1/users', {
        params: { query: query as never },
      });
      if (error) {
        const errObj = error as unknown as { message?: unknown };
        throw new Error(
          typeof errObj.message === 'string' ? errObj.message : 'Failed to load users',
        );
      }
      if (!data) {
        throw new Error('Empty response from /v1/users');
      }
      return data as unknown as ListResponse<UserSummary>;
    },
  });
}

/**
 * GET /v1/users/:id — single user for the edit modal. Returns
 * isError + 404-aware error so the dialog can render a "not found"
 * state distinct from "server unreachable".
 *
 * Mirrors `useAsset` precisely — same status-code extraction
 * pattern through the openapi-fetch result.
 */
export function useUser(id: string | null): UseQueryResult<UserDetail, Error> {
  const { isAuthenticated } = useAuth();

  return useQuery<UserDetail, Error>({
    queryKey: ['user', id],
    enabled: isAuthenticated && typeof id === 'string' && id.length > 0,
    queryFn: async () => {
      if (!id) {
        throw new Error('User ID is required.');
      }
      const result = await apiClient.GET('/v1/users/{id}', {
        params: { path: { id } },
      });
      const { data, error } = result;
      const response = (result as unknown as { response?: Response }).response;
      if (error) {
        const errObj = error as unknown as { message?: unknown };
        const msg = typeof errObj.message === 'string' ? errObj.message : 'Failed to load user';
        const wrapped = new Error(msg) as Error & { status?: number };
        if (response?.status != null) {
          wrapped.status = response.status;
        }
        throw wrapped;
      }
      if (!data) {
        throw new Error('Empty response from /v1/users/:id');
      }
      return data as unknown as UserDetail;
    },
  });
}

/**
 * PATCH /v1/users/:id. On success invalidates the users list and
 * patches the single-user cache so the edit dialog can close
 * immediately and the list reflects the change without an extra
 * round-trip.
 *
 * The backend enforces guardrails (self-demote, self-deactivate,
 * last-active-admin) and rejects with a user-facing 400 message.
 * The caller surfaces that message verbatim through the dialog's
 * error state.
 */
export function useUpdateUser(): UseMutationResult<
  UserDetail,
  Error,
  { id: string; patch: UserUpdatePatch }
> {
  const queryClient = useQueryClient();

  return useMutation<UserDetail, Error, { id: string; patch: UserUpdatePatch }>({
    mutationFn: async ({ id, patch }) => {
      const { data, error } = await apiClient.PATCH('/v1/users/{id}', {
        params: { path: { id } },
        body: patch as unknown as never,
      });
      if (error) {
        const errObj = error as unknown as { message?: unknown };
        throw new Error(
          typeof errObj.message === 'string' ? errObj.message : 'Failed to update user',
        );
      }
      if (!data) {
        throw new Error('Empty response after user update');
      }
      return data as unknown as UserDetail;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['user', updated._id], updated);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      // If the admin updated themselves (e.g. toggled their own
      // preferences — currently impossible via this UI, but possible
      // via future flows), invalidate /v1/me too so the header reflects
      // it. Cheap; just one extra refetch.
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

/**
 * Returns whether the current user can administer users (list +
 * edit). Backend reserves the whole admin users surface for ADMIN.
 *
 * Pessimistic during /v1/me load — same reasoning as the other
 * role-gating helpers.
 */
export function useCanAdminUsers(): boolean {
  const me = useMe();
  const roles = me.data?.roles ?? [];
  return roles.includes('ADMIN');
}

/**
 * Roles defined by the backend. Kept in sync with packages/shared-types
 * (UserRole enum). Listed here as a const tuple so `Role` is a narrow
 * union type useful in role-gating hooks.
 */
export const USER_ROLES = ['EMPLOYEE', 'ASSET_MANAGER', 'ADMIN'] as const;
export type Role = (typeof USER_ROLES)[number];

/**
 * Returns whether the current user can mutate assets. Matches the
 * backend's RBAC for POST/PATCH /v1/assets: ASSET_MANAGER and ADMIN
 * pass, EMPLOYEE does not. Stays in sync via the route guards in
 * apps/api/src/routes/assets.ts.
 *
 * Returns `false` while the /v1/me query is loading — pessimistic by
 * design, so the UI never flashes an edit button to a user who
 * shouldn't see it.
 */
export function useCanEditAssets(): boolean {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  return roles.includes('ASSET_MANAGER') || roles.includes('ADMIN');
}

export function useCanManageTaxonomy(): boolean {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  return roles.includes('ASSET_MANAGER') || roles.includes('ADMIN');
}

export function useCanDeleteTaxonomy(): boolean {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  return roles.includes('ADMIN');
}

// ---------------------------------------------------------------------------
// Loans — types, hooks, mutations
// ---------------------------------------------------------------------------

export interface LoanRequestItem {
  assetId: string;
  snapshot: { inventoryNumber: string; name: string };
  status: string;
}

export interface LoanRequestSummary {
  _id: string;
  organisationId: string;
  requesterId: string;
  purpose: string;
  plannedFrom: string;
  plannedTo: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  items: LoanRequestItem[];
  resultingLoanId: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface LoanItemSummary {
  assetId: string;
  snapshot: { inventoryNumber: string; name: string };
}

export interface LoanSummary {
  _id: string;
  organisationId: string;
  requestId: string;
  borrowerId: string;
  purpose: string;
  pickedUpAt: string;
  dueAt: string;
  returnedAt: string | null;
  status: 'ACTIVE' | 'RETURNED' | 'DAMAGED' | 'LOST';
  isOverdue: boolean;
  items: LoanItemSummary[];
  createdAt: string;
  [key: string]: unknown;
}

export interface CreateLoanRequestInput {
  purpose: string;
  plannedFrom: string;
  plannedTo: string;
  items: Array<{ assetId: string }>;
}

interface LoanRequestsListOptions {
  status?: string;
  limit?: number;
  skip?: number;
}

/** GET /v1/loan-requests — EMPLOYEE sees own, manager sees all */
export function useLoanRequests(
  options: LoanRequestsListOptions = {},
): UseQueryResult<ListResponse<LoanRequestSummary>, Error> {
  const { limit = 20, skip = 0, status } = options;
  const { isAuthenticated } = useAuth();

  return useQuery<ListResponse<LoanRequestSummary>, Error>({
    queryKey: ['loan-requests', { limit, skip, status }],
    enabled: isAuthenticated,
    queryFn: async () => {
      const query: Record<string, unknown> = { limit, skip };
      if (status !== undefined) query['status'] = status;
      const { data, error } = await apiClient.GET('/v1/loan-requests', {
        params: { query: query as never },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to load loan requests');
      }
      return data as unknown as ListResponse<LoanRequestSummary>;
    },
  });
}

interface LoansListOptions {
  status?: string;
  limit?: number;
  skip?: number;
  borrowerId?: string;
}

/** GET /v1/loans/my — current user's loans */
export function useMyLoans(
  options: LoansListOptions = {},
): UseQueryResult<ListResponse<LoanSummary>, Error> {
  const { limit = 20, skip = 0, status } = options;
  const { isAuthenticated } = useAuth();

  return useQuery<ListResponse<LoanSummary>, Error>({
    queryKey: ['my-loans', { limit, skip, status }],
    enabled: isAuthenticated,
    queryFn: async () => {
      const query: Record<string, unknown> = { limit, skip };
      if (status !== undefined) query['status'] = status;
      const { data, error } = await apiClient.GET('/v1/loans/my', {
        params: { query: query as never },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to load my loans');
      }
      return data as unknown as ListResponse<LoanSummary>;
    },
  });
}

/** GET /v1/loans — all loans (manager) or own (employee) */
export function useLoans(
  options: LoansListOptions = {},
): UseQueryResult<ListResponse<LoanSummary>, Error> {
  const { limit = 20, skip = 0, status, borrowerId } = options;
  const { isAuthenticated } = useAuth();

  return useQuery<ListResponse<LoanSummary>, Error>({
    queryKey: ['loans', { limit, skip, status, borrowerId }],
    enabled: isAuthenticated,
    queryFn: async () => {
      const query: Record<string, unknown> = { limit, skip };
      if (status !== undefined) query['status'] = status;
      if (borrowerId !== undefined) query['borrowerId'] = borrowerId;
      const { data, error } = await apiClient.GET('/v1/loans', {
        params: { query: query as never },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to load loans');
      }
      return data as unknown as ListResponse<LoanSummary>;
    },
  });
}

/** Fetch loans that contain a specific asset (client-side filter over recent loans). */
export function useLoansForAsset(assetId: string | null): UseQueryResult<LoanSummary[], Error> {
  const { isAuthenticated } = useAuth();
  return useQuery<LoanSummary[], Error>({
    queryKey: ['loans-for-asset', assetId],
    enabled: isAuthenticated && !!assetId,
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/v1/loans', {
        params: { query: { limit: 100, skip: 0 } as never },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to load loans');
      }
      const all = (data as unknown as ListResponse<LoanSummary>).data ?? [];
      return all.filter((loan) => loan.items.some((item) => item.assetId === assetId));
    },
  });
}

/** POST /v1/loan-requests */
export function useCreateLoanRequest(): UseMutationResult<
  LoanRequestSummary,
  Error,
  CreateLoanRequestInput
> {
  const queryClient = useQueryClient();
  return useMutation<LoanRequestSummary, Error, CreateLoanRequestInput>({
    mutationFn: async (input) => {
      const { data, error } = await apiClient.POST('/v1/loan-requests', {
        body: input as never,
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(
          typeof e.message === 'string' ? e.message : 'Failed to create loan request',
        );
      }
      return data as unknown as LoanRequestSummary;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['loan-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

/** POST /v1/loan-requests/:id/approve */
export function useApproveLoanRequest(): UseMutationResult<LoanSummary, Error, { id: string }> {
  const queryClient = useQueryClient();
  return useMutation<LoanSummary, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { data, error } = await apiClient.POST('/v1/loan-requests/{id}/approve', {
        params: { path: { id } },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(
          typeof e.message === 'string' ? e.message : 'Failed to approve loan request',
        );
      }
      return data as unknown as LoanSummary;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['loan-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['loans'] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

/** POST /v1/loan-requests/:id/reject */
export function useRejectLoanRequest(): UseMutationResult<
  void,
  Error,
  { id: string; reason: string }
> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string; reason: string }>({
    mutationFn: async ({ id, reason }) => {
      const { error } = await apiClient.POST('/v1/loan-requests/{id}/reject', {
        params: { path: { id } },
        body: { reason } as never,
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(
          typeof e.message === 'string' ? e.message : 'Failed to reject loan request',
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['loan-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

/** DELETE /v1/loan-requests/:id (cancel) */
export function useCancelLoanRequest(): UseMutationResult<void, Error, { id: string }> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await apiClient.DELETE('/v1/loan-requests/{id}', {
        params: { path: { id } },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(
          typeof e.message === 'string' ? e.message : 'Failed to cancel loan request',
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['loan-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

/** Whether current user can manage loans (approve/reject/return) */
export function useCanManageLoans(): boolean {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  return roles.includes('ASSET_MANAGER') || roles.includes('ADMIN');
}

// ---------------------------------------------------------------------------
// Assets — create
// ---------------------------------------------------------------------------

export interface CreateAssetInput {
  name: string;
  type: string;
  categoryId: string;
  locationId: string;
  status?: string | undefined;
  condition?: string | undefined;
  description?: string | null | undefined;
  serialNumber?: string | null | undefined;
  manufacturer?: string | null | undefined;
  model?: string | null | undefined;
  acquiredAt?: string | undefined;
  acquisitionCost?: number | null | undefined;
  warrantyUntil?: string | null | undefined;
  tags?: string[] | undefined;
  isLoanable?: boolean | undefined;
  requiresApproval?: boolean | undefined;
}

export function useCreateAsset(): UseMutationResult<AssetDetail, Error, CreateAssetInput> {
  const queryClient = useQueryClient();
  return useMutation<AssetDetail, Error, CreateAssetInput>({
    mutationFn: async (input) => {
      const { data, error } = await apiClient.POST('/v1/assets', {
        body: input as unknown as never,
      });
      if (error) {
        const errObj = error as unknown as { message?: unknown };
        throw new Error(
          typeof errObj.message === 'string' ? errObj.message : 'Failed to create asset',
        );
      }
      if (!data) throw new Error('Empty response after asset create');
      return data as unknown as AssetDetail;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Stock — skladové pohyby BULK položiek (ADR-0020)
// ---------------------------------------------------------------------------

/**
 * Jeden pohyb zo StockMovement ledgera.
 * Zrkadlí StockMovementSchema z @inventario/shared-types (wire shape).
 */
export interface StockMovement {
  _id: string;
  organisationId: string;
  itemId: string;
  type: 'RECEIPT' | 'LOAN_OUT' | 'LOAN_RETURN' | 'ADJUSTMENT';
  /** Signed delta: kladné = príjem, záporné = výdaj. */
  quantity: number;
  balanceAfter: number;
  locationId: string;
  reason: string | null;
  note: string | null;
  loanId: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface StockMovementsListOptions {
  limit?: number;
  skip?: number;
  type?: StockMovement['type'];
}

export interface ReconcileResult {
  itemId: string;
  ledgerBalance: number;
  cacheWas: number | null;
  wasConsistent: boolean;
}

// Generic fetch cast — stock endpointy nie sú zatiaľ v openapi spec paths type.
const genericGet = apiClient.GET as (
  path: string,
  opts: unknown,
) => Promise<{ data: unknown; error: unknown }>;

/**
 * GET /v1/stock/:itemId/movements — paginovaný zoznam pohybov.
 * Len pre BULK položky (backend overuje trackingMode).
 * EMPLOYEE+ môže čítať.
 */
export function useStockMovements(
  itemId: string | null,
  options: StockMovementsListOptions = {},
): UseQueryResult<ListResponse<StockMovement>, Error> {
  const { limit = 50, skip = 0, type } = options;
  const { isAuthenticated } = useAuth();

  return useQuery<ListResponse<StockMovement>, Error>({
    queryKey: ['stock-movements', itemId, { limit, skip, type }],
    enabled: isAuthenticated && typeof itemId === 'string' && itemId.length > 0,
    queryFn: async () => {
      if (!itemId) throw new Error('itemId je povinné.');
      const query: Record<string, unknown> = { limit, skip };
      if (type !== undefined) query['type'] = type;
      const { data, error } = await genericGet(`/v1/stock/${itemId}/movements`, {
        params: { query },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(
          typeof e.message === 'string' ? e.message : 'Nepodarilo sa načítať pohyby skladu',
        );
      }
      if (!data) throw new Error('Prázdna odpoveď z /v1/stock/:itemId/movements');
      return data as ListResponse<StockMovement>;
    },
  });
}

/**
 * GET /v1/stock — prehľad skladu, všetky BULK položky tenanta.
 * ASSET_MANAGER + ADMIN.
 */
export function useStockOverview(): UseQueryResult<
  { data: BulkItemOverview[]; total: number },
  Error
> {
  const { isAuthenticated } = useAuth();

  return useQuery<{ data: BulkItemOverview[]; total: number }, Error>({
    queryKey: ['stock-overview'],
    enabled: isAuthenticated,
    queryFn: async () => {
      const { data, error } = await genericGet('/v1/stock', {});
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(
          typeof e.message === 'string' ? e.message : 'Nepodarilo sa načítať prehľad skladu',
        );
      }
      if (!data) throw new Error('Prázdna odpoveď z /v1/stock');
      return data as { data: BulkItemOverview[]; total: number };
    },
  });
}

export interface BulkItemOverview {
  _id: string;
  inventoryNumber: string;
  name: string;
  quantityOnHand: number | null;
  categoryId: string;
  locationId: string;
  /** Množstvo posledného príjmu. Null ak žiadny RECEIPT ešte nebol. */
  lastReceiptQuantity: number | null;
}

export interface ReceiveStockInput {
  quantity: number;
  locationId: string;
  reason?: string | null;
  note?: string | null;
}

export interface AdjustStockInput {
  /** Signed delta — kladné alebo záporné, nesmie byť 0. */
  quantity: number;
  locationId: string;
  /** Povinný dôvod — min 3 znaky. */
  reason: string;
  note?: string | null;
}

/**
 * POST /v1/stock/:itemId/receive — príjem na sklad (RECEIPT).
 * ASSET_MANAGER + ADMIN.
 * Invaliduje stock-movements aj asset (quantityOnHand cache).
 */
export function useReceiveStock(
  itemId: string,
): UseMutationResult<StockMovement, Error, ReceiveStockInput> {
  const queryClient = useQueryClient();
  const genericPost2 = apiClient.POST as (
    path: string,
    opts: unknown,
  ) => Promise<{ data: unknown; error: unknown }>;

  return useMutation<StockMovement, Error, ReceiveStockInput>({
    mutationFn: async (input) => {
      const { data, error } = await genericPost2(`/v1/stock/${itemId}/receive`, { body: input });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Príjem na sklad zlyhal');
      }
      if (!data) throw new Error('Prázdna odpoveď po príjme na sklad');
      return data as StockMovement;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stock-movements', itemId] });
      // Invaliduj asset detail — quantityOnHand cache sa zmenila
      void queryClient.invalidateQueries({ queryKey: ['asset', itemId] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

/**
 * POST /v1/stock/:itemId/adjust — ručná korekcia (ADJUSTMENT).
 * ASSET_MANAGER + ADMIN. Dôvod je povinný.
 */
export function useAdjustStock(
  itemId: string,
): UseMutationResult<StockMovement, Error, AdjustStockInput> {
  const queryClient = useQueryClient();
  const genericPost2 = apiClient.POST as (
    path: string,
    opts: unknown,
  ) => Promise<{ data: unknown; error: unknown }>;

  return useMutation<StockMovement, Error, AdjustStockInput>({
    mutationFn: async (input) => {
      const { data, error } = await genericPost2(`/v1/stock/${itemId}/adjust`, { body: input });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Korekcia skladu zlyhala');
      }
      if (!data) throw new Error('Prázdna odpoveď po korekcii skladu');
      return data as StockMovement;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stock-movements', itemId] });
      void queryClient.invalidateQueries({ queryKey: ['asset', itemId] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

/**
 * POST /v1/stock/:itemId/reconcile — diagnostická oprava cache. ADMIN only.
 * Overí sum(ledger) vs quantityOnHand cache a prípadne opraví.
 */
export function useReconcileStock(itemId: string): UseMutationResult<ReconcileResult, Error, void> {
  const queryClient = useQueryClient();
  const genericPost2 = apiClient.POST as (
    path: string,
    opts: unknown,
  ) => Promise<{ data: unknown; error: unknown }>;

  return useMutation<ReconcileResult, Error, void>({
    mutationFn: async () => {
      const { data, error } = await genericPost2(`/v1/stock/${itemId}/reconcile`, {});
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(
          typeof e.message === 'string' ? e.message : 'Reconciliation skladu zlyhala',
        );
      }
      if (!data) throw new Error('Prázdna odpoveď po reconciliation');
      return data as ReconcileResult;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['asset', itemId] });
      void queryClient.invalidateQueries({ queryKey: ['stock-movements', itemId] });
    },
  });
}

/**
 * Môže aktuálny user robiť skladové pohyby (receive/adjust)?
 * ASSET_MANAGER + ADMIN. Pessimisticky false počas načítavania.
 */
export function useCanManageStock(): boolean {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  return roles.includes('ASSET_MANAGER') || roles.includes('ADMIN');
}

// ---------------------------------------------------------------------------
// Taxonomy mutations — rename category, location, asset type, asset condition
// ---------------------------------------------------------------------------

type GenericRecord = Record<string, unknown>;

export function useRenameCategory(): UseMutationResult<
  GenericRecord,
  Error,
  { id: string; name: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }) => {
      const { data, error } = await apiClient.PATCH('/v1/categories/{id}', {
        params: { path: { id } },
        body: { name } as never,
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to rename category');
      }
      return data as unknown as GenericRecord;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useRenameLocation(): UseMutationResult<
  GenericRecord,
  Error,
  { id: string; name: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }) => {
      const { data, error } = await apiClient.PATCH('/v1/locations/{id}', {
        params: { path: { id } },
        body: { name } as never,
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to rename location');
      }
      return data as unknown as GenericRecord;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['locations'] }),
  });
}

// Asset types + conditions use generic fetch (not in openapi spec yet)
const genericPatch = apiClient.PATCH as (
  path: string,
  opts: unknown,
) => Promise<{ data: unknown; error: unknown }>;

const genericPost = apiClient.POST as (
  path: string,
  opts: unknown,
) => Promise<{ data: unknown; error: unknown }>;

export function useCreateAssetTypes(): UseMutationResult<
  GenericRecord,
  Error,
  { name: string; slug?: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const { data, error } = await genericPost('/v1/asset-types', { body: input });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to create asset type');
      }
      return data as GenericRecord;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['asset-types'] }),
  });
}

export function useRenameAssetType(): UseMutationResult<
  GenericRecord,
  Error,
  { id: string; name: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }) => {
      const { data, error } = await genericPatch(`/v1/asset-types/${id}`, { body: { name } });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to rename asset type');
      }
      return data as GenericRecord;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['asset-types'] }),
  });
}

export function useCreateAssetConditions(): UseMutationResult<
  GenericRecord,
  Error,
  { name: string; slug?: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const { data, error } = await genericPost('/v1/asset-conditions', { body: input });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(
          typeof e.message === 'string' ? e.message : 'Failed to create asset condition',
        );
      }
      return data as GenericRecord;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['asset-conditions'] }),
  });
}

export function useRenameAssetCondition(): UseMutationResult<
  GenericRecord,
  Error,
  { id: string; name: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }) => {
      const { data, error } = await genericPatch(`/v1/asset-conditions/${id}`, { body: { name } });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(
          typeof e.message === 'string' ? e.message : 'Failed to rename asset condition',
        );
      }
      return data as GenericRecord;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['asset-conditions'] }),
  });
}

const genericDelete = apiClient.DELETE as (
  path: string,
  opts?: unknown,
) => Promise<{ data: unknown; error: unknown }>;

export function useDeleteAssetType(): UseMutationResult<void, Error, { id: string }> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await genericDelete(`/v1/asset-types/${id}`);
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to delete asset type');
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['asset-types'] }),
  });
}

export function useDeleteAssetCondition(): UseMutationResult<void, Error, { id: string }> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await genericDelete(`/v1/asset-conditions/${id}`);
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(
          typeof e.message === 'string' ? e.message : 'Failed to delete asset condition',
        );
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['asset-conditions'] }),
  });
}

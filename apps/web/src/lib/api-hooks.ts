// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { API_BASE_URL, apiClient } from './api-client';
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
  /** @deprecated legacy User.roles (GET /v1/me). Not used for RBAC — use useAuth().user.role. */
  roles: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  preferences: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Role hierarchy (ADR-0029) — small local copy mirroring shared-types.
// ---------------------------------------------------------------------------

const ROLE_LEVEL: Record<string, number> = {
  ADMIN: 3,
  ASSET_MANAGER: 2,
  EMPLOYEE: 1,
  EXTERNAL: 1,
};

/** Does `actual` role satisfy at least the `required` level? (ADR-0029) */
function roleSatisfies(actual: string | undefined, required: string): boolean {
  return (ROLE_LEVEL[actual ?? 'EMPLOYEE'] ?? 1) >= (ROLE_LEVEL[required] ?? 1);
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
  /**
   * Override for the global 30s staleTime (see providers.tsx). Used for
   * rarely-changing reference data (categories, locations) so a short
   * idle gap doesn't force a refetch — see docs/sessions for the
   * preloader-latency investigation (2026-07-14). Mutations that touch
   * this data already call invalidateQueries, so freshness after an
   * edit is unaffected by this value.
   */
  staleTimeMs?: number,
) {
  return function useResourceList(
    options: ListQueryOptions = {},
  ): UseQueryResult<ListResponse<TItem>, Error> {
    const { limit = 50, skip = 0 } = options;
    const { isAuthenticated } = useAuth();

    return useQuery<ListResponse<TItem>, Error>({
      queryKey: [resourceKey, { limit, skip }],
      enabled: isAuthenticated,
      ...(staleTimeMs === undefined ? {} : { staleTime: staleTimeMs }),
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
  /**
   * ID nadradenej kategórie; null = root. Root kategórie plnia rolu
   * "typov majetku" (zlúčený číselník) — majetok sa zaraďuje len do
   * podkategórií.
   */
  parentId: string | null;
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

/**
 * Reference/taxonomy data changes rarely and every write path already
 * invalidates its own query key — see the preloader-latency
 * investigation (docs/sessions/2026-07-14). 5 min keeps it cached
 * across a normal idle gap so a page load doesn't refetch it
 * needlessly and risk landing on a cold serverless instance.
 */
export const REFERENCE_DATA_STALE_TIME_MS = 5 * 60_000;

export const useAssets = makeListHook<AssetSummary>('assets', '/v1/assets');
export const useCategories = makeListHook<CategorySummary>(
  'categories',
  '/v1/categories',
  REFERENCE_DATA_STALE_TIME_MS,
);
export const useLocations = makeListHook<LocationSummary>(
  'locations',
  '/v1/locations',
  REFERENCE_DATA_STALE_TIME_MS,
);

// ---------------------------------------------------------------------------
// Asset Conditions — dynamic per-tenant collection
// ---------------------------------------------------------------------------

export interface AssetConditionEntrySummary {
  _id: string;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
  [key: string]: unknown;
}

export function useAssetConditions(
  options: ListQueryOptions = {},
): UseQueryResult<ListResponse<AssetConditionEntrySummary>, Error> {
  const { limit = 200, skip = 0 } = options;
  const { isAuthenticated } = useAuth();

  return useQuery<ListResponse<AssetConditionEntrySummary>, Error>({
    queryKey: ['asset-conditions', { limit, skip }],
    enabled: isAuthenticated,
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
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
 * Zod schema accepts them: the UI sends a minimal payload (name +
 * maybe description/parentId), and the backend default does the rest.
 * Once the categories edit form lands we'll expose the remaining knobs
 * (color, icon, approvers, maxLoanDays) — until then this hook keeps
 * the call site small.
 *
 * `parentId` null/absent = nová ROOT kategória (plní rolu "typu
 * majetku" v zlúčenom číselníku).
 */
export interface CreateCategoryInput {
  name: string;
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
  /**
   * ADR-0020: SERIALIZED (default) alebo BULK (hromadné množstevné položky).
   * Môže chýbať v legacy dokumentoch vytvorených pred zavedením poľa.
   */
  trackingMode: 'SERIALIZED' | 'BULK' | undefined;
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
 * GET /v1/assets/tags — unikátne existujúce tagy naprieč majetkami tenanta
 * (2026-07-06). Zdroj návrhov pre autocomplete v `TagsCombobox` na oboch
 * formulároch majetku (Pridanie aj Editácia).
 *
 * Not yet reflected in generated api-types.ts — generic-cast pattern
 * (rovnaké ako usePersonsDirectory).
 */
export function useAssetTags(): UseQueryResult<string[], Error> {
  const { isAuthenticated } = useAuth();
  const genericGet = apiClient.GET as (
    path: string,
    opts: unknown,
  ) => Promise<{ data: unknown; error: unknown }>;

  return useQuery<string[], Error>({
    queryKey: ['asset-tags'],
    enabled: isAuthenticated,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await genericGet('/v1/assets/tags', {});
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to load asset tags');
      }
      const parsed = data as unknown as { data?: unknown };
      return Array.isArray(parsed?.data) ? (parsed.data as string[]) : [];
    },
  });
}

// ---------------------------------------------------------------------------
// Tagy — číselník (summary s počtami použitia, premenovanie, mazanie)
// ---------------------------------------------------------------------------

export interface TagSummaryEntry {
  tag: string;
  count: number;
}

/**
 * GET /v1/assets/tags/summary — tagy s počtom majetku, ktorý ich používa.
 * Dátový zdroj pre číselník "Tagy" na /ciselniky (2026-07-07).
 *
 * Not yet reflected in generated api-types.ts — generic-cast pattern
 * (rovnaké ako useAssetTags).
 */
export function useTagsSummary(): UseQueryResult<TagSummaryEntry[], Error> {
  const { isAuthenticated } = useAuth();
  const genericGet = apiClient.GET as (
    path: string,
    opts: unknown,
  ) => Promise<{ data: unknown; error: unknown }>;

  return useQuery<TagSummaryEntry[], Error>({
    queryKey: ['asset-tags-summary'],
    enabled: isAuthenticated,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await genericGet('/v1/assets/tags/summary', {});
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to load tags summary');
      }
      const parsed = data as unknown as { data?: unknown };
      return Array.isArray(parsed?.data) ? (parsed.data as TagSummaryEntry[]) : [];
    },
  });
}

/**
 * POST /v1/assets/tags/rename — hromadné premenovanie tagu naprieč
 * majetkom (duplicity po zlúčení sa serverom deduplikujú). Vracia počet
 * dotknutých položiek majetku.
 *
 * Na úspech invaliduje tags summary, distinct-tags autocomplete zdroj aj
 * zoznam majetku (zmenené `tags` polia sa musia prejaviť aj tam) a detail
 * jednotlivých majetkov (nevieme presne ktoré, invalidujeme celý predikát).
 *
 * RBAC: ASSET_MANAGER + ADMIN (server aj klient — `useCanManageTaxonomy()`).
 */
export function useRenameTag(): UseMutationResult<
  { affected: number },
  Error,
  { oldTag: string; newTag: string }
> {
  const queryClient = useQueryClient();
  const genericPost = apiClient.POST as (
    path: string,
    opts: unknown,
  ) => Promise<{ data: unknown; error: unknown }>;

  return useMutation<{ affected: number }, Error, { oldTag: string; newTag: string }>({
    mutationFn: async ({ oldTag, newTag }) => {
      const { data, error } = await genericPost('/v1/assets/tags/rename', {
        body: { oldTag, newTag },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to rename tag');
      }
      if (!data) throw new Error('Empty response after tag rename');
      return data as { affected: number };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['asset-tags-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['asset-tags'] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['asset'] });
    },
  });
}

/**
 * POST /v1/assets/tags/delete — hromadné odstránenie tagu zo všetkého
 * majetku. Vracia počet dotknutých položiek majetku.
 *
 * Rovnaká invalidation stratégia ako useRenameTag.
 *
 * RBAC: ASSET_MANAGER + ADMIN (server aj klient — `useCanManageTaxonomy()`).
 */
export function useDeleteTag(): UseMutationResult<{ affected: number }, Error, { tag: string }> {
  const queryClient = useQueryClient();
  const genericPost = apiClient.POST as (
    path: string,
    opts: unknown,
  ) => Promise<{ data: unknown; error: unknown }>;

  return useMutation<{ affected: number }, Error, { tag: string }>({
    mutationFn: async ({ tag }) => {
      const { data, error } = await genericPost('/v1/assets/tags/delete', {
        body: { tag },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to delete tag');
      }
      if (!data) throw new Error('Empty response after tag delete');
      return data as { affected: number };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['asset-tags-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['asset-tags'] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['asset'] });
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
  /**
   * Authoritative role(s) derived from Membership.role (ADR-0029) —
   * always 0 or 1 element. Kept as an array for backwards compat with
   * the list row shape.
   */
  roles: string[];
  /**
   * _id of the user's ACTIVE membership in the current tenant. Used by
   * the edit dialog to change the role via PATCH /v1/memberships/:id.
   * Null if the membership lookup failed (defensive).
   */
  membershipId: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Patch body for PATCH /v1/users/:id. The admin endpoint exposes
 * `isActive` and profile fields (ADR-0029: role changes go through
 * PATCH /v1/memberships/:id — see `useUpdateMembershipRole`).
 *
 * `email` (detail+editácia používateľa, 2026-07-14): only accepted by
 * the backend when the target's `accountType` is `LOCAL` — rejected
 * with 400 otherwise. Must be unique within the organisation.
 */
export interface UserUpdatePatch {
  isActive?: boolean | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  email?: string | undefined;
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
 * PATCH /v1/memberships/:id — change the authoritative role of a
 * member (ADR-0029: role lives on Membership, not User). Used by the
 * admin user-edit dialog. Backend guardrails: last-active-ADMIN can't
 * be demoted (assertNotLastAdmin); errors surface verbatim.
 *
 * On success invalidates the users list + the single-user cache (the
 * dialog reads roles through GET /v1/users/:id, which derives them
 * from the membership).
 */
export function useUpdateMembershipRole(): UseMutationResult<
  unknown,
  Error,
  { membershipId: string; userId: string; role: string }
> {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, { membershipId: string; userId: string; role: string }>({
    mutationFn: async ({ membershipId, role }) => {
      const { data, error } = await apiClient.PATCH('/v1/memberships/{id}', {
        params: { path: { id: membershipId } },
        body: { role } as unknown as never,
      });
      if (error) {
        const errObj = error as unknown as { message?: unknown };
        throw new Error(
          typeof errObj.message === 'string' ? errObj.message : 'Failed to update role',
        );
      }
      return data;
    },
    onSuccess: (_data, { userId }) => {
      void queryClient.invalidateQueries({ queryKey: ['user', userId] });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      // Role change can affect the actor's own session capabilities
      // when editing self is ever allowed — cheap refetch.
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

/**
 * DELETE /v1/memberships/:id — remove a member from the current tenant
 * (ADR-0029). Used by the admin user-edit dialog ("Odobrať z organizácie").
 * Backend guardrails: the last active ADMIN can't be removed; errors surface
 * verbatim. Invalidates the users list + single-user cache + members picker.
 */
export function useRemoveMembership(): UseMutationResult<
  unknown,
  Error,
  { membershipId: string; userId: string }
> {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, { membershipId: string; userId: string }>({
    mutationFn: async ({ membershipId }) => {
      const { data, error } = await apiClient.DELETE('/v1/memberships/{id}', {
        params: { path: { id: membershipId } },
      });
      if (error) {
        const errObj = error as unknown as { message?: unknown };
        throw new Error(
          typeof errObj.message === 'string' ? errObj.message : 'Failed to remove member',
        );
      }
      return data;
    },
    onSuccess: (_data, { userId }) => {
      void queryClient.invalidateQueries({ queryKey: ['user', userId] });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['members'] });
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
  const { user } = useAuth();
  return user?.role === 'ADMIN';
}

/**
 * Roles defined by the backend. Kept in sync with packages/shared-types
 * (UserRole enum). Listed here as a const tuple so `Role` is a narrow
 * union type useful in role-gating hooks.
 */
export const USER_ROLES = ['EMPLOYEE', 'ASSET_MANAGER', 'ADMIN', 'EXTERNAL'] as const;
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
  return roleSatisfies(user?.role, 'ASSET_MANAGER');
}

export function useCanManageTaxonomy(): boolean {
  const { user } = useAuth();
  return roleSatisfies(user?.role, 'ASSET_MANAGER');
}

/**
 * Minimal person shape returned by GET /v1/users/directory. Deliberately
 * much smaller than UserSummary — this endpoint is ASSET_MANAGER-accessible
 * (not just ADMIN), so the response only carries what's needed to identify
 * a person, not the full admin User profile.
 *
 * Originally built for the standalone "Osoby" module (2026-07-06), which
 * was merged into /users on 2026-07-14 and fully removed on 2026-07-15
 * (task #35). This type + `usePersonsDirectory()` below survived that
 * cleanup because of a second, unrelated caller found along the way: the
 * "Osoba" filter dropdown on the Audit log page (`AuditLogContent.tsx`).
 */
export interface PersonSummary {
  _id: string;
  displayName: string;
  email: string;
  role: string | null;
  isActive: boolean;
  [key: string]: unknown;
}

interface PersonsDirectoryOptions {
  limit?: number;
  skip?: number;
  /** Free-text search across email + displayName + firstName + lastName. */
  q?: string | undefined;
}

/**
 * GET /v1/users/directory — "Osoby" module list (ASSET_MANAGER + ADMIN).
 *
 * Not yet reflected in the generated api-types.ts (that file is a
 * gitignored local artifact regenerated from openapi.json via
 * `openapi-typescript`, a separate manual step from the pre-commit hook
 * that regenerates openapi.json itself) — uses the same generic-cast
 * escape hatch as `useLoanRequest()` for a path the typed client doesn't
 * know about yet.
 */
export function usePersonsDirectory(
  options: PersonsDirectoryOptions = {},
): UseQueryResult<ListResponse<PersonSummary>, Error> {
  const { limit = 50, skip = 0, q } = options;
  const { isAuthenticated } = useAuth();
  const genericGet = apiClient.GET as (
    path: string,
    opts: unknown,
  ) => Promise<{ data: unknown; error: unknown }>;

  return useQuery<ListResponse<PersonSummary>, Error>({
    queryKey: ['persons-directory', { limit, skip, q }],
    enabled: isAuthenticated,
    queryFn: async () => {
      const query: Record<string, unknown> = { limit, skip };
      if (q !== undefined && q.length > 0) {
        query['q'] = q;
      }
      const { data, error } = await genericGet('/v1/users/directory', {
        params: { query },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to load persons');
      }
      return data as unknown as ListResponse<PersonSummary>;
    },
  });
}

/**
 * Role gate for invitations + member pre-provisioning (ADR-0034).
 * ASSET_MANAGER+ — matches the backend RBAC on POST /v1/invitations and
 * POST /v1/memberships/pre-provisioned (`requireRole([ADMIN, ASSET_MANAGER])`).
 * Distinct export from useCanAdminUsers (ADMIN-only, gates /users) so the
 * two thresholds don't get confused at call sites.
 */
export function useCanManageMembers(): boolean {
  const { user } = useAuth();
  return roleSatisfies(user?.role, 'ASSET_MANAGER');
}

/**
 * Role gate for the "Osoby" module. Same threshold as useCanEditAssets
 * (ASSET_MANAGER+) — kept as a distinctly-named export for call-site
 * clarity, mirroring useCanAdminUsers / useCanManageTaxonomy.
 */
export function useCanManagePersons(): boolean {
  const { user } = useAuth();
  return roleSatisfies(user?.role, 'ASSET_MANAGER');
}

export function useCanDeleteTaxonomy(): boolean {
  const { user } = useAuth();
  return user?.role === 'ADMIN';
}

// ---------------------------------------------------------------------------
// Audit log — kompletný, prehľadávateľný tenant-wide log (2026-07-07)
// ---------------------------------------------------------------------------

/**
 * Role gate pre `/audit-log`. ASSET_MANAGER + ADMIN (rozhodnutie Janiky —
 * pôvodne plánované len pre ADMIN, rozšírené aj na Správcu majetku
 * aktívneho tenanta). Rovnaký threshold ako useCanManageTaxonomy /
 * useCanManagePersons, samostatný export kvôli čitateľnosti call-site.
 */
export function useCanViewAuditLog(): boolean {
  const { user } = useAuth();
  return roleSatisfies(user?.role, 'ASSET_MANAGER');
}

export interface AuditLogEntry {
  id: string;
  at: string;
  actor: {
    userId: string;
    displayName: string;
    accountType: string;
  };
  action: string;
  target: { entityType: string; entityId: string | null } | null;
  description: string;
  changes: Array<{ field: string; before: unknown; after: unknown }> | null;
  severity: string;
}

export interface AuditLogFilterOptions {
  limit?: number;
  skip?: number;
  action?: string | undefined;
  entityType?: string | undefined;
  actorUserId?: string | undefined;
  /** ISO 8601 dátum-čas (nie len dátum) — volajúci konvertuje na hranicu dňa. */
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

/**
 * GET /v1/audit-log — kompletný audit log aktívneho tenanta, filtrovateľný
 * podľa akcie, typu entity, osoby (aktér) a dátumového rozsahu.
 *
 * Not yet reflected in generated api-types.ts — generic-cast pattern
 * (rovnaké ako usePersonsDirectory).
 */
export function useAuditLog(
  options: AuditLogFilterOptions = {},
): UseQueryResult<ListResponse<AuditLogEntry>, Error> {
  const { limit = 50, skip = 0, action, entityType, actorUserId, dateFrom, dateTo } = options;
  const { isAuthenticated } = useAuth();
  const genericGet = apiClient.GET as (
    path: string,
    opts: unknown,
  ) => Promise<{ data: unknown; error: unknown }>;

  return useQuery<ListResponse<AuditLogEntry>, Error>({
    queryKey: ['audit-log', { limit, skip, action, entityType, actorUserId, dateFrom, dateTo }],
    enabled: isAuthenticated,
    queryFn: async () => {
      const query: Record<string, unknown> = { limit, skip };
      if (action) query['action'] = action;
      if (entityType) query['entityType'] = entityType;
      if (actorUserId) query['actorUserId'] = actorUserId;
      if (dateFrom) query['dateFrom'] = dateFrom;
      if (dateTo) query['dateTo'] = dateTo;

      const { data, error } = await genericGet('/v1/audit-log', { params: { query } });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to load audit log');
      }
      if (!data) throw new Error('Empty response from /v1/audit-log');
      return data as unknown as ListResponse<AuditLogEntry>;
    },
  });
}

// ---------------------------------------------------------------------------
// Loans — types, hooks, mutations
// ---------------------------------------------------------------------------

/** ADR-0026: katalógová položka žiadosti — kategória + množstvo. */
export interface LoanRequestItem {
  categoryId: string;
  categorySnapshot: { name: string; slug: string };
  quantityRequested: number;
  quantityFulfilled: number;
  note: string | null;
}

/** ADR-0026: 7-stavový FSM žiadosti. */
export type LoanRequestStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'PARTIALLY_FULFILLED'
  | 'FULFILLED'
  | 'CLOSED'
  | 'REJECTED'
  | 'CANCELLED';

export interface LoanRequestSummary {
  _id: string;
  organisationId: string;
  requesterId: string;
  beneficiaryId: string | null;
  purpose: string;
  plannedFrom: string;
  /** Null = výpožička bez termínu ("do odvolania", ADR-0025). */
  plannedTo: string | null;
  status: LoanRequestStatus;
  items: LoanRequestItem[];
  /** ADR-0026: 1 žiadosť → N Loanov postupne. */
  resultingLoanIds: string[];
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
  requestId: string | null;
  borrowerId: string;
  /** Meno vypožičiavateľa — enrichované z users collection pri načítaní loan. */
  borrowerDisplayName: string | null;
  purpose: string;
  pickedUpAt: string;
  /** Null = výpožička bez termínu ("do odvolania", ADR-0025). */
  dueAt: string | null;
  returnedAt: string | null;
  status: 'ACTIVE' | 'RETURNED' | 'DAMAGED' | 'LOST';
  isOverdue: boolean;
  items: LoanItemSummary[];
  createdAt: string;
  [key: string]: unknown;
}

/** ADR-0026: katalógová žiadosť — kategória + množstvo, žiadne assetId. */
export interface CreateLoanRequestInput {
  purpose: string;
  plannedFrom: string;
  /** Null / vynechané = výpožička bez termínu ("do odvolania", ADR-0025). */
  plannedTo?: string | null;
  items: Array<{ categoryId: string; quantityRequested: number; note?: string | null }>;
  /** Voliteľný beneficiár (ADR-0023). Ak chýba, server nastaví na requesterId. */
  beneficiaryId?: string;
}

/**
 * ADR-0026: vydanie z žiadosti — mapovanie položiek na konkrétny majetok.
 *
 * EXTRA_SERIALIZED / EXTRA_BULK (2026-07-16): položka mimo pôvodnej žiadosti
 * — žiadosť je len orientačný podnet, správca môže pripísať čokoľvek
 * navyše (napr. predlžovačka k notebooku). Žiadny requestItemIndex — server
 * dopíše novú položku do žiadosti.
 */
export type FulfilLoanRequestItem =
  | { requestItemIndex: number; type: 'SERIALIZED'; assetIds: string[] }
  | { requestItemIndex: number; type: 'BULK'; bulkItemId: string; quantity: number }
  | { type: 'EXTRA_SERIALIZED'; categoryId: string; assetIds: string[] }
  | { type: 'EXTRA_BULK'; categoryId: string; bulkItemId: string; quantity: number };

export interface FulfilLoanRequestInput {
  items: FulfilLoanRequestItem[];
  /** Záväzný termín vrátenia pre vzniknutý Loan (null = do odvolania). */
  dueAt?: string | null;
  /** Ak true, žiadosť sa uzavrie aj keď nebolo vydané celé množstvo. */
  closeRemainder?: boolean;
  notes?: string | null;
}

interface LoanRequestsListOptions {
  status?: string;
  limit?: number;
  skip?: number;
  /** ADR-0023 — filter by requester (manager-only on the backend). */
  requesterId?: string;
  /**
   * ADR-0023 — filter by beneficiary (manager-only on the backend).
   * Pass the same value as requesterId to get "requester OR beneficiary".
   */
  beneficiaryId?: string;
}

/**
 * GET /v1/loan-requests — EMPLOYEE sees own, manager sees all.
 *
 * `requesterId` / `beneficiaryId` are manager-only filters on the
 * backend (ADR-0023) — EMPLOYEE callers always get their own requests
 * regardless of what's passed here. Used by the "Osoby" person card
 * (pass the same personId as both to get "requester OR beneficiary").
 */
export function useLoanRequests(
  options: LoanRequestsListOptions = {},
): UseQueryResult<ListResponse<LoanRequestSummary>, Error> {
  const { limit = 20, skip = 0, status, requesterId, beneficiaryId } = options;
  const { isAuthenticated } = useAuth();

  return useQuery<ListResponse<LoanRequestSummary>, Error>({
    queryKey: ['loan-requests', { limit, skip, status, requesterId, beneficiaryId }],
    enabled: isAuthenticated,
    queryFn: async () => {
      const query: Record<string, unknown> = { limit, skip };
      if (status !== undefined) query['status'] = status;
      if (requesterId !== undefined) query['requesterId'] = requesterId;
      if (beneficiaryId !== undefined) query['beneficiaryId'] = beneficiaryId;
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

/** GET /v1/loan-requests/:id — EMPLOYEE sees own, manager sees all (service checks ownership). */
export function useLoanRequest(id: string | null): UseQueryResult<LoanRequestSummary, Error> {
  const { isAuthenticated } = useAuth();
  const genericGet = apiClient.GET as (
    path: string,
    opts: unknown,
  ) => Promise<{ data: unknown; error: unknown }>;

  return useQuery<LoanRequestSummary, Error>({
    queryKey: ['loan-request', id],
    enabled: isAuthenticated && !!id,
    queryFn: async () => {
      const { data, error } = await genericGet('/v1/loan-requests/{id}', {
        params: { path: { id: id as string } },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to load loan request');
      }
      return data as unknown as LoanRequestSummary;
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

/** POST /v1/loan-requests/:id/approve — ADR-0026: len zmena stavu PENDING→APPROVED, nevytvára Loan */
export function useApproveLoanRequest(): UseMutationResult<
  LoanRequestSummary,
  Error,
  { id: string }
> {
  const queryClient = useQueryClient();
  return useMutation<LoanRequestSummary, Error, { id: string }>({
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
      return data as unknown as LoanRequestSummary;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['loan-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['loans'] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

/** POST /v1/loan-requests/:id/fulfil — ADR-0026: vydanie, vznik Loan-u + prepočet stavu žiadosti */
export function useFulfilLoanRequest(): UseMutationResult<
  LoanSummary,
  Error,
  { id: string; input: FulfilLoanRequestInput }
> {
  const queryClient = useQueryClient();
  const genericPostFulfil = apiClient.POST as (
    path: string,
    opts: unknown,
  ) => Promise<{ data: unknown; error: unknown }>;
  return useMutation<LoanSummary, Error, { id: string; input: FulfilLoanRequestInput }>({
    mutationFn: async ({ id, input }) => {
      const { data, error } = await genericPostFulfil(`/v1/loan-requests/${id}/fulfil`, {
        body: input,
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Vydanie zžiadosti zlyhalo');
      }
      return data as unknown as LoanSummary;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['loan-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['loans'] });
      void queryClient.invalidateQueries({ queryKey: ['my-loans'] });
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
  return roleSatisfies(user?.role, 'ASSET_MANAGER');
}

// ---------------------------------------------------------------------------
// Members — picker-safe zoznam členov org (ADR-0025, beneficiary picker)
// ---------------------------------------------------------------------------

export interface MemberPickerItem {
  _id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  membershipId: string;
  role: string;
}

/**
 * GET /v1/members — EMPLOYEE+ endpoint, picker-safe polia.
 * Používa sa pre beneficiary SelectField v loan request formulári (ADR-0025).
 */
export function useMembers(): UseQueryResult<ListResponse<MemberPickerItem>, Error> {
  const { isAuthenticated } = useAuth();
  const genericGet2 = apiClient.GET as (
    path: string,
    opts: unknown,
  ) => Promise<{ data: unknown; error: unknown }>;

  return useQuery<ListResponse<MemberPickerItem>, Error>({
    queryKey: ['members'],
    enabled: isAuthenticated,
    queryFn: async () => {
      const { data, error } = await genericGet2('/v1/members', {
        params: { query: { limit: 200 } },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to load members');
      }
      if (!data) throw new Error('Empty response from /v1/members');
      return data as unknown as ListResponse<MemberPickerItem>;
    },
  });
}

// ---------------------------------------------------------------------------
// Assets — create
// ---------------------------------------------------------------------------

export interface CreateAssetInput {
  name: string;
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
  trackingMode?: 'SERIALIZED' | 'BULK' | undefined;
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
  return roleSatisfies(user?.role, 'ASSET_MANAGER');
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

export function useUpdateLocation(): UseMutationResult<
  GenericRecord,
  Error,
  { id: string; name?: string; type?: string; description?: string | null }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }) => {
      const { data, error } = await apiClient.PATCH('/v1/locations/{id}', {
        params: { path: { id } },
        body: patch as never,
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to update location');
      }
      return data as unknown as GenericRecord;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['locations'] }),
  });
}

// Asset conditions use generic fetch (not in openapi spec yet)
const genericPatch = apiClient.PATCH as (
  path: string,
  opts: unknown,
) => Promise<{ data: unknown; error: unknown }>;

const genericPost = apiClient.POST as (
  path: string,
  opts: unknown,
) => Promise<{ data: unknown; error: unknown }>;

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

// ---------------------------------------------------------------------------
// Preberacie protokoly (ADR-0022) — types, hooks, mutations
// ---------------------------------------------------------------------------

export type ProtocolType = 'HANDOVER' | 'RETURN' | 'AMENDMENT';
export type ProtocolStatus = 'DRAFT' | 'SIGNED' | 'AMENDED' | 'VOIDED';

export interface ProtocolParty {
  userId: string;
  snapshot: { displayName: string; email: string; organizationalUnit: string | null };
}

export interface ProtocolSignature {
  signedAt: string;
  method: string;
  ipAddress: string;
  signatureImageId: string | null;
}

export interface ProtocolItem {
  assetId: string;
  snapshot: {
    inventoryNumber: string;
    name: string;
    serialNumber: string | null;
    category: string;
  };
  condition: string;
  conditionNote: string | null;
}

export interface LoanProtocolSummary {
  _id: string;
  organisationId: string;
  type: ProtocolType;
  loanId: string;
  protocolNumber: string;
  issuedAt: string;
  paperSize: 'A4' | 'LETTER';
  parties: { handover: ProtocolParty; receive: ProtocolParty };
  items: ProtocolItem[];
  notes: string | null;
  signatures: { handover: ProtocolSignature | null; receive: ProtocolSignature | null };
  status: ProtocolStatus;
  pdfSha256: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

/** GET /v1/loans/{id} — detail výpožičky (borrower alebo manager). */
export function useLoan(id: string | null): UseQueryResult<LoanSummary, Error> {
  const { isAuthenticated } = useAuth();
  return useQuery<LoanSummary, Error>({
    queryKey: ['loan', id],
    enabled: isAuthenticated && !!id,
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/v1/loans/{id}', {
        params: { path: { id: id as string } },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to load loan');
      }
      return data as unknown as LoanSummary;
    },
  });
}

/** GET /v1/loans/{id}/protocols — protokoly viazané na výpožičku. */
export function useLoanProtocols(
  loanId: string | null,
): UseQueryResult<LoanProtocolSummary[], Error> {
  const { isAuthenticated } = useAuth();
  return useQuery<LoanProtocolSummary[], Error>({
    queryKey: ['loan-protocols', loanId],
    enabled: isAuthenticated && !!loanId,
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/v1/loans/{id}/protocols', {
        params: { path: { id: loanId as string } },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to load protocols');
      }
      return (data as unknown as { data: LoanProtocolSummary[] }).data ?? [];
    },
  });
}

interface ProtocolsListOptions {
  type?: ProtocolType;
  status?: ProtocolStatus;
  limit?: number;
  skip?: number;
}

/** GET /v1/protocols — zoznam protokolov (manager všetky, employee vlastné). */
export function useProtocols(
  options: ProtocolsListOptions = {},
): UseQueryResult<ListResponse<LoanProtocolSummary>, Error> {
  const { limit = 50, skip = 0, type, status } = options;
  const { isAuthenticated } = useAuth();

  return useQuery<ListResponse<LoanProtocolSummary>, Error>({
    queryKey: ['protocols', { limit, skip, type, status }],
    enabled: isAuthenticated,
    queryFn: async () => {
      const query: Record<string, unknown> = { limit, skip };
      if (type !== undefined) query['type'] = type;
      if (status !== undefined) query['status'] = status;
      const { data, error } = await apiClient.GET('/v1/protocols', {
        params: { query: query as never },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(typeof e.message === 'string' ? e.message : 'Failed to load protocols');
      }
      return data as unknown as ListResponse<LoanProtocolSummary>;
    },
  });
}

/** POST /v1/protocols/{protocolId}/sign — CLICK_TO_SIGN podpis prihlásenej strany. */
export function useSignProtocol(): UseMutationResult<
  LoanProtocolSummary,
  Error,
  { protocolId: string }
> {
  const queryClient = useQueryClient();
  return useMutation<LoanProtocolSummary, Error, { protocolId: string }>({
    mutationFn: async ({ protocolId }) => {
      const { data, error } = await apiClient.POST('/v1/protocols/{protocolId}/sign', {
        params: { path: { protocolId } },
        body: { method: 'CLICK_TO_SIGN' },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(
          typeof e.message === 'string' ? e.message : 'Protokol sa nepodarilo podpísať',
        );
      }
      return data as unknown as LoanProtocolSummary;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['protocols'] });
      void queryClient.invalidateQueries({ queryKey: ['loan-protocols'] });
    },
  });
}

/** POST /v1/loans/{id}/protocols — dodatočné vytvorenie protokolu (backfill, manager). */
export function useCreateLoanProtocol(): UseMutationResult<
  LoanProtocolSummary,
  Error,
  { loanId: string; type: 'HANDOVER' | 'RETURN' }
> {
  const queryClient = useQueryClient();
  return useMutation<LoanProtocolSummary, Error, { loanId: string; type: 'HANDOVER' | 'RETURN' }>({
    mutationFn: async ({ loanId, type }) => {
      const { data, error } = await apiClient.POST('/v1/loans/{id}/protocols', {
        params: { path: { id: loanId } },
        body: { type },
      });
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(
          typeof e.message === 'string' ? e.message : 'Protokol sa nepodarilo vytvoriť',
        );
      }
      return data as unknown as LoanProtocolSummary;
    },
    onSuccess: (_data, { loanId }) => {
      void queryClient.invalidateQueries({ queryKey: ['protocols'] });
      void queryClient.invalidateQueries({ queryKey: ['loan-protocols', loanId] });
      void queryClient.invalidateQueries({ queryKey: ['loan', loanId] });
    },
  });
}

/**
 * Stiahne PDF protokolu ako Blob (autentifikovaný fetch s cookie).
 *
 * Nejde cez openapi-fetch (binary response) — preto vlastný 401 retry:
 * pri expirácii access tokenu skúsi silent refresh a fetch zopakuje raz.
 */
export async function fetchProtocolPdf(protocolId: string): Promise<Blob> {
  const doFetch = (): Promise<Response> =>
    fetch(`${API_BASE_URL}/v1/protocols/${protocolId}/pdf`, { credentials: 'include' });

  let res = await doFetch();
  if (res.status === 401) {
    const refreshed = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (refreshed.ok) res = await doFetch();
  }
  if (!res.ok) throw new Error('PDF protokolu sa nepodarilo stiahnuť.');
  return res.blob();
}

// ---------------------------------------------------------------------------
// Dashboard — agregovaný súhrn (jeden request namiesto ~10)
// ---------------------------------------------------------------------------

/**
 * Tvar odpovede `GET /v1/dashboard/summary`.
 *
 * Zlúči counts + zoznamy žiadostí, výpožičiek a DRAFT protokolov, ktoré
 * dashboard predtým ťahal samostatnými requestmi. RBAC sa rieši na backende
 * (zoznamy cez loansService, protokoly cez participantUserId pravidlo).
 */
export interface DashboardSummary {
  counts: {
    assets: number;
    categories: number;
    locations: number;
    /** Aktívne výpožičky prihláseného používateľa. */
    activeLoans: number;
  };
  loanRequests: {
    pending: ListResponse<LoanRequestSummary>;
    approved: ListResponse<LoanRequestSummary>;
    partiallyFulfilled: ListResponse<LoanRequestSummary>;
  };
  protocols: {
    draft: ListResponse<LoanProtocolSummary>;
  };
  loans: {
    active: ListResponse<LoanSummary>;
  };
}

/**
 * GET /v1/dashboard/summary — jeden agregovaný request pre úvodnú obrazovku.
 *
 * Endpoint nie je v generovaných openapi typoch (api-types.ts), preto ide
 * cez generický `apiClient.GET` cast (rovnaký vzor ako `useMembers`).
 */
export function useDashboardSummary(): UseQueryResult<DashboardSummary, Error> {
  const { isAuthenticated } = useAuth();

  return useQuery<DashboardSummary, Error>({
    queryKey: ['dashboard-summary'],
    enabled: isAuthenticated,
    queryFn: async () => {
      const { data, error } = await genericGet('/v1/dashboard/summary', {});
      if (error) {
        const e = error as unknown as { message?: unknown };
        throw new Error(
          typeof e.message === 'string' ? e.message : 'Failed to load dashboard summary',
        );
      }
      if (!data) throw new Error('Empty response from /v1/dashboard/summary');
      return data as unknown as DashboardSummary;
    },
  });
}

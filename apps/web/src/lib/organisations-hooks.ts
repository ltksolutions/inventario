// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * TanStack Query hooks for /v1/organisations (platform admin).
 *
 * Separate from api-hooks.ts to keep that file focused on tenant-scoped
 * resources. Organisations sit above the tenant boundary.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';

import { useAuth } from './auth-context';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrganisationSummary {
  _id: string;
  displayName: string;
  slug: string;
  plan: string;
  status: string;
  primaryContactEmail: string | null;
  entraTenantId: string | null;
  customDomain: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ListOrganisationsResponse {
  data: OrganisationSummary[];
  pagination: {
    total: number;
    limit: number;
    skip: number;
    hasMore: boolean;
  };
}

export interface ListOrganisationsOptions {
  limit?: number;
  skip?: number;
  status?: string;
  plan?: string;
}

export interface CreateOrganisationInput {
  displayName: string;
  slug: string;
  plan?: string;
  primaryContactEmail?: string | null;
  entraTenantId?: string | null;
}

export interface UpdateOrganisationInput {
  displayName?: string;
  plan?: string;
  status?: string;
  primaryContactEmail?: string | null;
}

// ---------------------------------------------------------------------------
// GET /v1/organisations
// ---------------------------------------------------------------------------

export function useOrganisations(
  options: ListOrganisationsOptions = {},
): UseQueryResult<ListOrganisationsResponse, Error> {
  const { limit = 50, skip = 0, status, plan } = options;
  const { isAuthenticated } = useAuth();

  return useQuery<ListOrganisationsResponse, Error>({
    queryKey: ['organisations', { limit, skip, status, plan }],
    enabled: isAuthenticated,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit), skip: String(skip) });
      if (status) params.set('status', status);
      if (plan) params.set('plan', plan);

      const res = await fetch(`${API_BASE}/v1/organisations?${params.toString()}`, {
        credentials: 'include',
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Failed to load organisations');
      }

      return res.json() as Promise<ListOrganisationsResponse>;
    },
  });
}

// ---------------------------------------------------------------------------
// POST /v1/organisations
// ---------------------------------------------------------------------------

export function useCreateOrganisation(): UseMutationResult<
  OrganisationSummary,
  Error,
  CreateOrganisationInput
> {
  const queryClient = useQueryClient();

  return useMutation<OrganisationSummary, Error, CreateOrganisationInput>({
    mutationFn: async (input) => {
      const res = await fetch(`${API_BASE}/v1/organisations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          displayName: input.displayName,
          slug: input.slug,
          plan: input.plan ?? 'FREE',
          primaryContactEmail: input.primaryContactEmail ?? null,
          entraTenantId: input.entraTenantId ?? null,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Failed to create organisation');
      }

      return res.json() as Promise<OrganisationSummary>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organisations'] });
    },
  });
}

// ---------------------------------------------------------------------------
// PATCH /v1/organisations/:id
// ---------------------------------------------------------------------------

export function useUpdateOrganisation(): UseMutationResult<
  OrganisationSummary,
  Error,
  { id: string; patch: UpdateOrganisationInput }
> {
  const queryClient = useQueryClient();

  return useMutation<OrganisationSummary, Error, { id: string; patch: UpdateOrganisationInput }>({
    mutationFn: async ({ id, patch }) => {
      const res = await fetch(`${API_BASE}/v1/organisations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Failed to update organisation');
      }

      return res.json() as Promise<OrganisationSummary>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organisations'] });
    },
  });
}

// ---------------------------------------------------------------------------
// DELETE /v1/organisations/:id
// ---------------------------------------------------------------------------

export function useDeleteOrganisation(): UseMutationResult<void, Error, { id: string }> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(`${API_BASE}/v1/organisations/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Failed to delete organisation');
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organisations'] });
    },
  });
}

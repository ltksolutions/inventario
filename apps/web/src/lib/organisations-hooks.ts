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

export interface AddressInfo {
  street: string;
  city: string;
  postalCode: string;
  countryCode: string;
}

/**
 * Brand kit pre tenanta (ADR-0028 v2). Zrkadlo OrganisationBrandKitSchema zo Zod.
 * Null = použiť Inventario default (navy + blue).
 *
 * v2: `presetId` je UI skratka (backend podľa neho naplní hex polia),
 * `fontFamilySans` je enum ID ('system-ui'|'Inter'|'Open Sans'|'Roboto'|'Lato').
 */
export interface BrandKit {
  presetId: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  primary: string | null;
  primaryFg: string | null;
  accent: string | null;
  accentFg: string | null;
  logoDot: string | null;
  fontFamilySans: string | null;
}

export interface BillingInfo {
  legalName: string | null;
  ico: string | null;
  dic: string | null;
  isVatPayer: boolean;
  icDph: string | null;
  businessRegistration: string | null;
  iban: string | null;
  billingEmail: string | null;
  registeredAddress: AddressInfo | null;
  mailingAddress: AddressInfo | null;
}

export interface OrganisationSummary {
  _id: string;
  displayName: string;
  slug: string;
  plan: string;
  status: string;
  primaryContactEmail: string | null;
  entraTenantId: string | null;
  customDomain: string | null;
  billing: BillingInfo | null;
  /** Brand kit pre runtime CSS override (ADR-0028). Null = Inventario default. */
  brandKit: BrandKit | null;
  /** Kontakt na vrátenie najdeného majetku (ADR-0021). */
  foundContactInfo: {
    email: string | null;
    phone: string | null;
    message: string | null;
  } | null;
  /** Konfigurácia tlače QR štítkov (ADR-0027). Null = PDF_SHEET default. */
  labelPrinting: {
    mode: 'PDF_SHEET' | 'ZEBRA_ZPL';
    pdfPreset: 'avery-l7160' | 'avery-l7163';
    finderText: { enabled: boolean; text: string };
    zplLabelWidthMm: number;
    zplLabelHeightMm: number;
    zplDpi: 203 | 300;
    zplDarkness: number;
  } | null;
  /** Formát inventárneho čísla (ADR-0021). Null = nie je nastavený. */
  inventoryNumberFormat: {
    prefix: string;
    padding: number;
    includeYear: boolean;
    resetYearly: boolean;
  } | null;
  /** Nastavenia protokolov (ADR-0022). Null = systémové defaulty. */
  protocolSettings: {
    paperSize: 'A4' | 'LETTER';
    numberFormat: {
      prefix: string;
      padding: number;
      initialSeq: number;
    } | null;
  } | null;
  /** Základná URL aplikácie pre QR kódy a /scan/ odkazy (ADR-0021). Null = QR/štítky nedostupné. */
  appBaseUrl: string | null;
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
  billing?: BillingInfo | null;
}

// ---------------------------------------------------------------------------
// GET /v1/organisations/current (tenant self)
// ---------------------------------------------------------------------------

export function useCurrentOrganisation(): UseQueryResult<OrganisationSummary, Error> {
  const { isAuthenticated } = useAuth();

  return useQuery<OrganisationSummary, Error>({
    queryKey: ['organisation', 'current'],
    enabled: isAuthenticated,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/organisations/current`, {
        credentials: 'include',
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Failed to load current organisation');
      }

      return res.json() as Promise<OrganisationSummary>;
    },
  });
}

// ---------------------------------------------------------------------------
// PATCH /v1/organisations/current (tenant self, ADMIN)
// ---------------------------------------------------------------------------

export interface UpdateCurrentOrganisationInput {
  displayName?: string;
  primaryContactEmail?: string | null;
  billing?: BillingInfo | null;
  /** Kontakt na vrátenie najdeného majetku — zobrazí sa na verejnej scan stránke (ADR-0021). */
  foundContactInfo?: {
    email?: string | null;
    phone?: string | null;
    message?: string | null;
  } | null;
  /** Brand kit (ADR-0028 v2). Preset + logo + font — všetky plány. */
  brandKit?: BrandKit | null;
  /** Formát inventárneho čísla (ADR-0021). */
  inventoryNumberFormat?: {
    prefix: string;
    padding: number;
    includeYear: boolean;
    resetYearly: boolean;
  } | null;
  /** Nastavenia protokolov (ADR-0022). */
  protocolSettings?: {
    paperSize?: 'A4' | 'LETTER';
    numberFormat?: {
      prefix: string;
      padding: number;
      initialSeq: number;
    } | null;
  } | null;
  /** Základná URL aplikácie pre QR kódy a /scan/ odkazy (ADR-0021). */
  appBaseUrl?: string | null;
}

export function useUpdateCurrentOrganisation(): UseMutationResult<
  OrganisationSummary,
  Error,
  UpdateCurrentOrganisationInput
> {
  const queryClient = useQueryClient();
  const { refresh } = useAuth();

  return useMutation<OrganisationSummary, Error, UpdateCurrentOrganisationInput>({
    mutationFn: async (patch) => {
      const res = await fetch(`${API_BASE}/v1/organisations/current`, {
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
      void queryClient.invalidateQueries({ queryKey: ['organisation', 'current'] });
      void queryClient.invalidateQueries({ queryKey: ['organisations'] });
      // ADR-0028 v2: refresh auth kontextu → availableOrganisations[].brandKit
      // sa aktualizujú → BrandProvider okamžite prefarbí hlavičku/logo bez reloadu.
      void refresh();
    },
  });
}

// ---------------------------------------------------------------------------
// POST /v1/organisations/current/logo (tenant self, ADMIN) — ADR-0028 v2
// ---------------------------------------------------------------------------

/**
 * Nahranie loga do Vercel Blob. Posiela multipart/form-data s jedným
 * súborom (pole `file`). Backend zvaliduje (magic bytes + veľkosť),
 * nahrá do Blobu a zapíše URL do brandKit.logoUrl.
 */
export function useUploadLogo(): UseMutationResult<OrganisationSummary, Error, File> {
  const queryClient = useQueryClient();
  const { refresh } = useAuth();

  return useMutation<OrganisationSummary, Error, File>({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE}/v1/organisations/current/logo`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
        // POZN: Žiadny Content-Type header — browser ho nastaví sám
        // vrátane multipart boundary.
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Nahranie loga zlyhalo');
      }

      return res.json() as Promise<OrganisationSummary>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organisation', 'current'] });
      void queryClient.invalidateQueries({ queryKey: ['organisations'] });
      // ADR-0028 v2: refresh auth kontextu → nové logo sa zobrazí v hlavičke bez reloadu.
      void refresh();
    },
  });
}

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

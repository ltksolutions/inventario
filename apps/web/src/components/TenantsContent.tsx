// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * TenantsContent — Platform admin page for managing all tenants.
 *
 * RBAC: ADMIN only. Backend enforces this on all /v1/organisations
 * endpoints. In practice only LTK Solutions operators have ADMIN.
 *
 * Features:
 *   - Paginated list of all organisations (name, slug, plan, status,
 *     primaryContactEmail, createdAt)
 *   - Inline PATCH: plan (FREE / PRO / ENTERPRISE) + status
 *     (ACTIVE / SUSPENDED / ARCHIVED) via edit dialog
 *   - Create new tenant (POST /v1/organisations) — pre-onboarding
 *     before JIT SSO provisioning
 *   - Soft-delete (DELETE /v1/organisations/:id)
 *   - Filter by status + plan, search by name/slug
 */

import {
  Building2,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldOff,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { SelectField } from './SelectField';

import type { JSX } from 'react';

import { useCanAdminUsers, useMe } from '@/lib/api-hooks';
import {
  useCreateOrganisation,
  useDeleteOrganisation,
  useOrganisations,
  useUpdateOrganisation,
  type OrganisationSummary,
} from '@/lib/organisations-hooks';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAN_LABELS: Record<string, string> = {
  FREE: 'Free',
  PRO: 'Pro',
  ENTERPRISE: 'Enterprise',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Aktívny',
  SUSPENDED: 'Pozastavený',
  ARCHIVED: 'Archivovaný',
};

const PLAN_VALUES = ['FREE', 'PRO', 'ENTERPRISE'] as const;
const STATUS_VALUES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
const PAGE_SIZES = [20, 50, 100] as const;
type PageSize = (typeof PAGE_SIZES)[number];

const STATUS_OPTIONS = [
  { value: '', label: 'Všetky stavy' },
  ...STATUS_VALUES.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s })),
];

const PLAN_OPTIONS = [
  { value: '', label: 'Všetky plány' },
  ...PLAN_VALUES.map((p) => ({ value: p, label: PLAN_LABELS[p] ?? p })),
];

const PAGE_SIZE_OPTIONS = PAGE_SIZES.map((s) => ({ value: String(s), label: String(s) }));

const PLAN_OPTIONS_FULL = PLAN_VALUES.map((p) => ({ value: p, label: PLAN_LABELS[p] ?? p }));
const STATUS_OPTIONS_FULL = STATUS_VALUES.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }));

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function TenantsContent(): JSX.Element {
  const canAdmin = useCanAdminUsers();
  const meQuery = useMe();

  if (meQuery.isLoading) return <PageSkeleton />;
  if (!canAdmin) return <AccessDenied />;

  return <TenantsAdminPanel />;
}

// ---------------------------------------------------------------------------
// Admin panel
// ---------------------------------------------------------------------------

function TenantsAdminPanel(): JSX.Element {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [statusFilter, setStatusFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [editTarget, setEditTarget] = useState<OrganisationSummary | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, planFilter, debouncedSearch, pageSize]);

  const query = useOrganisations({
    limit: pageSize,
    skip: (page - 1) * pageSize,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(planFilter ? { plan: planFilter } : {}),
  });

  const orgs = query.data?.data ?? [];
  const total = query.data?.pagination.total ?? 0;
  const hasMore = query.data?.pagination.hasMore ?? false;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasActiveFilter = statusFilter !== '' || planFilter !== '' || debouncedSearch !== '';

  const filtered = debouncedSearch
    ? orgs.filter(
        (o) =>
          o.displayName.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
          o.slug.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
          (o.primaryContactEmail ?? '').toLowerCase().includes(debouncedSearch.toLowerCase()),
      )
    : orgs;

  return (
    <div>
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary sm:text-3xl">
            <Building2 aria-hidden="true" className="h-7 w-7 text-brand-accent" />
            Tenanti
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Správa všetkých organizácií na platforme. Viditeľné len pre platform operátorov.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Nový tenant
        </button>
      </header>

      {/* Filters */}
      <section
        aria-label="Filtre"
        className="mb-4 grid gap-3 rounded-xl border border-border-subtle bg-surface-card p-4 shadow-sm sm:grid-cols-[1fr_auto_auto_auto]"
      >
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          <span className="font-medium">Hľadať</span>
          <span className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Názov, slug alebo email"
              className="w-full rounded-lg border border-border-default bg-surface-card py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            />
          </span>
        </label>

        <div className="flex flex-col gap-1 text-sm text-text-secondary">
          <span className="font-medium">Stav</span>
          <SelectField
            label="Stav"
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_OPTIONS}
            className="w-40"
          />
        </div>

        <div className="flex flex-col gap-1 text-sm text-text-secondary">
          <span className="font-medium">Plán</span>
          <SelectField
            label="Plán"
            value={planFilter}
            onChange={setPlanFilter}
            options={PLAN_OPTIONS}
            className="w-36"
          />
        </div>

        <div className="flex flex-col gap-1 text-sm text-text-secondary">
          <span className="font-medium">Veľkosť strany</span>
          <SelectField
            label="Veľkosť strany"
            value={String(pageSize)}
            onChange={(v) => setPageSize(Number(v) as PageSize)}
            options={PAGE_SIZE_OPTIONS}
            className="w-24"
          />
        </div>
      </section>

      {/* Count */}
      <p className="mb-3 text-sm text-text-secondary" aria-live="polite">
        {query.isLoading ? (
          'Načítavam tenantov…'
        ) : query.isError ? (
          <span className="text-danger-fg">Tenantov sa nepodarilo načítať.</span>
        ) : hasActiveFilter ? (
          <>
            Nájdených <strong>{filtered.length}</strong> tenantov.
          </>
        ) : (
          <>
            Strana <strong>{page}</strong> z {totalPages} (celkom {total.toLocaleString('sk-SK')}{' '}
            tenantov).
          </>
        )}
      </p>

      {/* Table */}
      {query.isLoading ? (
        <TableSkeleton rows={Math.min(pageSize, 8)} />
      ) : query.isError ? (
        <ErrorPanel message="Tenantov sa nepodarilo načítať. Skontroluj pripojenie a skús to znova." />
      ) : filtered.length === 0 ? (
        <EmptyState hasActiveFilter={hasActiveFilter} />
      ) : (
        <TenantsTable orgs={filtered} onEdit={(org) => setEditTarget(org)} />
      )}

      {/* Pagination */}
      {!debouncedSearch && (
        <nav
          aria-label="Stránkovanie"
          className="mt-4 flex items-center justify-between gap-3 text-sm"
        >
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || query.isLoading}
            className="rounded-lg border border-border-default bg-surface-card px-3 py-2 font-medium text-text-primary transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus sm:px-4"
          >
            <span aria-hidden="true">←</span>
            <span className="sr-only sm:not-sr-only sm:ml-1">Predchádzajúca</span>
          </button>
          <span className="text-text-secondary">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore || query.isLoading}
            className="rounded-lg border border-border-default bg-surface-card px-3 py-2 font-medium text-text-primary transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus sm:px-4"
          >
            <span className="sr-only sm:not-sr-only sm:mr-1">Ďalšia</span>
            <span aria-hidden="true">→</span>
          </button>
        </nav>
      )}

      {editTarget && <TenantEditDialog org={editTarget} onClose={() => setEditTarget(null)} />}
      {createOpen && <TenantCreateDialog onClose={() => setCreateOpen(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function TenantsTable({
  orgs,
  onEdit,
}: {
  orgs: OrganisationSummary[];
  onEdit: (org: OrganisationSummary) => void;
}): JSX.Element {
  const deleteOrg = useDeleteOrganisation();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (org: OrganisationSummary): Promise<void> => {
    if (
      !confirm(
        `Naozaj chcete archivovať tenant „${org.displayName}"? Používatelia sa nebudú môcť prihlásiť.`,
      )
    )
      return;
    setDeletingId(org._id);
    try {
      await deleteOrg.mutateAsync({ id: org._id });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Chyba pri mazaní.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="border-b border-border-subtle bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
          <tr>
            <th scope="col" className="px-4 py-3">
              Názov
            </th>
            <th scope="col" className="px-4 py-3">
              Slug
            </th>
            <th scope="col" className="px-4 py-3">
              Plán
            </th>
            <th scope="col" className="px-4 py-3">
              Stav
            </th>
            <th scope="col" className="px-4 py-3">
              Kontakt
            </th>
            <th scope="col" className="px-4 py-3">
              Vytvorený
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              <span className="sr-only">Akcie</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {orgs.map((org) => {
            const isDeleted = !!org.deletedAt;
            const isDeleting = deletingId === org._id;
            return (
              <tr key={org._id} className={isDeleted ? 'opacity-50' : 'hover:bg-surface-subtle'}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs font-bold text-white"
                      style={{ background: orgColor(org._id) }}
                      aria-hidden="true"
                    >
                      {org.displayName.charAt(0).toUpperCase()}
                    </span>
                    <span className="font-medium text-text-primary">{org.displayName}</span>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-text-muted">{org.slug}</td>
                <td className="px-4 py-3">
                  <PlanBadge plan={org.plan} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={org.status} />
                </td>
                <td className="px-4 py-3 text-xs text-text-secondary">
                  {org.primaryContactEmail ?? '—'}
                </td>
                <td className="px-4 py-3 text-xs text-text-muted">
                  {new Date(org.createdAt).toLocaleDateString('sk-SK', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {!isDeleted && (
                      <button
                        type="button"
                        onClick={() => onEdit(org)}
                        aria-label={`Upraviť tenant ${org.displayName}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-card px-3 py-1.5 text-xs font-medium text-text-primary transition hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                      >
                        <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                        Upraviť
                      </button>
                    )}
                    {!isDeleted && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(org)}
                        disabled={isDeleting}
                        aria-label={`Archivovať tenant ${org.displayName}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-card px-3 py-1.5 text-xs font-medium text-danger-fg transition hover:bg-red-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                      >
                        {isDeleting ? (
                          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                        )}
                        Archivovať
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit dialog
// ---------------------------------------------------------------------------

function TenantEditDialog({
  org,
  onClose,
}: {
  org: OrganisationSummary;
  onClose: () => void;
}): JSX.Element {
  const updateOrg = useUpdateOrganisation();
  const [displayName, setDisplayName] = useState(org.displayName);
  const [plan, setPlan] = useState(org.plan);
  const [status, setStatus] = useState(org.status);
  const [primaryContactEmail, setPrimaryContactEmail] = useState(org.primaryContactEmail ?? '');
  const [error, setError] = useState('');
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  const handleSave = async (): Promise<void> => {
    setError('');
    try {
      await updateOrg.mutateAsync({
        id: org._id,
        patch: {
          displayName: displayName.trim() || org.displayName,
          plan,
          status,
          primaryContactEmail: primaryContactEmail.trim() || null,
        },
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodarilo sa uložiť zmeny.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tenant-edit-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <button
        type="button"
        aria-label="Zatvoriť dialog"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border-subtle bg-surface-card p-6 shadow-xl">
        <h2 id="tenant-edit-title" className="mb-4 text-base font-semibold text-text-primary">
          Upraviť tenant
        </h2>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        )}

        <div className="space-y-4">
          <div>
            <label htmlFor="te-name" className="block text-sm font-medium text-text-primary">
              Názov
            </label>
            <input
              id="te-name"
              ref={firstInputRef}
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
            />
          </div>

          <div>
            <label htmlFor="te-email" className="block text-sm font-medium text-text-primary">
              Kontaktný email
            </label>
            <input
              id="te-email"
              type="email"
              value={primaryContactEmail}
              onChange={(e) => setPrimaryContactEmail(e.target.value)}
              placeholder="kontakt@tenant.sk"
              className="mt-1 block w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="block text-sm font-medium text-text-primary">Plán</span>
              <SelectField
                label="Plán"
                value={plan}
                onChange={setPlan}
                options={PLAN_OPTIONS_FULL}
                className="mt-1 w-full"
              />
            </div>
            <div>
              <span className="block text-sm font-medium text-text-primary">Stav</span>
              <SelectField
                label="Stav"
                value={status}
                onChange={setStatus}
                options={STATUS_OPTIONS_FULL}
                className="mt-1 w-full"
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border-default bg-surface-card px-4 py-2 text-sm font-medium text-text-secondary transition hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            Zrušiť
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={updateOrg.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            {updateOrg.isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
            Uložiť
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create dialog
// ---------------------------------------------------------------------------

function TenantCreateDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const createOrg = useCreateOrganisation();
  const [displayName, setDisplayName] = useState('');
  const [slug, setSlug] = useState('');
  const [primaryContactEmail, setPrimaryContactEmail] = useState('');
  const [plan, setPlan] = useState('FREE');
  const [error, setError] = useState('');
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (displayName) {
      setSlug(
        displayName
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40),
      );
    }
  }, [displayName]);

  const handleCreate = async (): Promise<void> => {
    setError('');
    if (!displayName.trim()) {
      setError('Názov je povinný.');
      return;
    }
    if (!slug.trim()) {
      setError('Slug je povinný.');
      return;
    }
    try {
      await createOrg.mutateAsync({
        displayName: displayName.trim(),
        slug: slug.trim(),
        plan,
        primaryContactEmail: primaryContactEmail.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodarilo sa vytvoriť tenant.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tenant-create-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <button
        type="button"
        aria-label="Zatvoriť dialog"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border-subtle bg-surface-card p-6 shadow-xl">
        <h2 id="tenant-create-title" className="mb-4 text-base font-semibold text-text-primary">
          Nový tenant
        </h2>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        )}

        <div className="space-y-4">
          <div>
            <label htmlFor="tc-name" className="block text-sm font-medium text-text-primary">
              Názov organizácie <span className="text-danger-fg">*</span>
            </label>
            <input
              id="tc-name"
              ref={firstInputRef}
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Slovenský futbalový zväz"
              className="mt-1 block w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
            />
          </div>
          <div>
            <label htmlFor="tc-slug" className="block text-sm font-medium text-text-primary">
              Slug <span className="text-danger-fg">*</span>
            </label>
            <input
              id="tc-slug"
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="slovensky-futbalovy-zvaz"
              className="mt-1 block w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 font-mono text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
            />
            <p className="mt-1 text-xs text-text-muted">
              Lowercase ASCII, číslice a pomlčky, 2–40 znakov. Nemenný po vytvorení.
            </p>
          </div>
          <div>
            <label htmlFor="tc-email" className="block text-sm font-medium text-text-primary">
              Kontaktný email
            </label>
            <input
              id="tc-email"
              type="email"
              value={primaryContactEmail}
              onChange={(e) => setPrimaryContactEmail(e.target.value)}
              placeholder="kontakt@org.sk"
              className="mt-1 block w-full rounded-lg border border-border-default bg-surface-page px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
            />
          </div>
          <div>
            <span className="block text-sm font-medium text-text-primary">Plán</span>
            <SelectField
              label="Plán"
              value={plan}
              onChange={setPlan}
              options={PLAN_OPTIONS_FULL}
              className="mt-1 w-full"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border-default bg-surface-card px-4 py-2 text-sm font-medium text-text-secondary transition hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            Zrušiť
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={createOrg.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-brand-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            {createOrg.isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
            Vytvoriť
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function PlanBadge({ plan }: { plan: string }): JSX.Element {
  const colors: Record<string, string> = {
    FREE: 'bg-surface-subtle text-text-muted',
    PRO: 'bg-blue-50 text-blue-700',
    ENTERPRISE: 'bg-purple-50 text-purple-700',
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colors[plan] ?? 'bg-surface-subtle text-text-muted'}`}
    >
      {PLAN_LABELS[plan] ?? plan}
    </span>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  if (status === 'ACTIVE') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success-fg">
        <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
        {STATUS_LABELS['ACTIVE']}
      </span>
    );
  }
  if (status === 'SUSPENDED') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
        <XCircle aria-hidden="true" className="h-3.5 w-3.5" />
        {STATUS_LABELS['SUSPENDED']}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-text-muted">
      <XCircle aria-hidden="true" className="h-3.5 w-3.5" />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Skeletons / error / empty / access denied
// ---------------------------------------------------------------------------

function PageSkeleton(): JSX.Element {
  return (
    <div aria-busy="true" aria-label="Načítavam">
      <div className="mb-6 h-8 w-48 animate-pulse rounded bg-surface-subtle" />
      <div className="h-24 animate-pulse rounded-xl bg-surface-subtle" />
    </div>
  );
}

function TableSkeleton({ rows }: { rows: number }): JSX.Element {
  return (
    <div
      aria-busy="true"
      className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-sm"
    >
      <div className="border-b border-border-subtle bg-surface-subtle px-4 py-3">
        <div className="h-3 w-32 animate-pulse rounded bg-border-subtle" />
      </div>
      <ul className="divide-y divide-border-subtle">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="flex items-center gap-4 px-4 py-3">
            <div className="h-4 w-40 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 w-24 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 w-20 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 w-20 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 w-36 animate-pulse rounded bg-surface-subtle" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }): JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-danger-fg bg-danger-bg p-4 text-sm text-danger-fg"
    >
      <XCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function EmptyState({ hasActiveFilter }: { hasActiveFilter: boolean }): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-10 text-center">
      <p className="text-sm font-medium text-text-primary">
        {hasActiveFilter ? 'Žiadni tenanti nezodpovedajú filtru.' : 'Žiadni tenanti.'}
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        {hasActiveFilter
          ? 'Skúste vyčistiť filter.'
          : 'Tenanti sa vytvárajú pri prvom SSO prihlásení alebo manuálne.'}
      </p>
    </div>
  );
}

function AccessDenied(): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-10 text-center">
      <ShieldOff aria-hidden="true" className="mx-auto h-8 w-8 text-text-muted" />
      <p className="mt-3 text-sm font-medium text-text-primary">
        Na túto stránku máte prístup iba platform operátori.
      </p>
    </div>
  );
}

function orgColor(id: string): string {
  const palette = [
    '#1A2D47',
    '#388FC3',
    '#2E7D32',
    '#6A1B9A',
    '#BF360C',
    '#00695C',
    '#4527A0',
    '#AD1457',
  ];
  const seed = parseInt(id.slice(-4), 16);
  return palette[seed % palette.length] ?? '#1A2D47';
}

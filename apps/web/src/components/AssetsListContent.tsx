// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { ASSET_STATUS_VALUES } from '@inventario/shared-types';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { AssetsTable } from './AssetsTable';
import { SelectField } from './SelectField';

import type { CategorySummary, LocationSummary } from '@/lib/api-hooks';
import type { JSX } from 'react';

import { useAssets, useCanEditAssets, useCategories, useLocations } from '@/lib/api-hooks';

/**
 * Assets list page content.
 *
 * Data model:
 *   The backend's GET /v1/assets currently only supports `limit` + `skip`.
 *   Server-side filtering / sorting / search will land in a future slice;
 *   for the pilot launch we filter the *current page* on the client.
 *   That's a deliberate trade-off — pilot tenants have < 1000 assets, so
 *   one round-trip with a wider page size feels fine. We revisit when
 *   real data shows otherwise.
 *
 * Pagination strategy:
 *   - 1-indexed page number in the UI ("Strana 1 z 5") because that's
 *     what humans read; we convert to/from skip internally.
 *   - Page size choices (20/50/100) match the backend's `limit` cap of
 *     100. Default 20 keeps the initial paint cheap.
 *   - The "Ďalšia" button uses `pagination.hasMore` rather than
 *     comparing skip+limit vs total, because hasMore is the server's
 *     own decision and won't lie if total is stale by a few ms.
 *
 * Filter / search interaction with pagination:
 *   The two are intentionally orthogonal: filtering refines *what's on
 *   this page*, not which page we're looking at. If we filtered before
 *   paginating, we'd silently skip matches on later pages. Once the
 *   backend supports filter+search query params we'll flip this — but
 *   for now the UI explicitly says "filter applies to this page" via
 *   the result count line.
 */

const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'Dostupné',
  RESERVED: 'Rezervované',
  BORROWED: 'Zapožičané',
  IN_SERVICE: 'V servise',
  DISPOSED: 'Vyradené',
  LOST: 'Stratené',
};

type PageSize = 20 | 50 | 100;
const PAGE_SIZES: readonly PageSize[] = [20, 50, 100];

export function AssetsListContent(): JSX.Element {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  // Paginated assets request. The query key includes both pagination
  // params so TanStack caches each page independently — clicking back
  // to a previously seen page is instant.
  const assetsQuery = useAssets({ limit: pageSize, skip: (page - 1) * pageSize });

  // Reference data — fetch large pages once so we can resolve every
  // FK on the visible asset rows. 200 is comfortably above the pilot
  // tenants' expected taxonomy size and still a single round-trip.
  const categoriesQuery = useCategories({ limit: 200 });
  const locationsQuery = useLocations({ limit: 200 });

  // Build lookup maps once per query result. Memoising matters here:
  // the table would otherwise rebuild the lookup on every keystroke
  // in the search box.
  const categoriesById = useMemo(
    () => buildIdMap<CategorySummary>(categoriesQuery.data?.data ?? []),
    [categoriesQuery.data],
  );
  const locationsById = useMemo(
    () => buildIdMap<LocationSummary>(locationsQuery.data?.data ?? []),
    [locationsQuery.data],
  );

  // Apply client-side filters to the current page's rows. See the
  // comment on the component for why this is intentional.
  const filteredAssets = useMemo(() => {
    const rows = assetsQuery.data?.data ?? [];
    const normalisedSearch = searchTerm.trim().toLowerCase();
    return rows.filter((asset) => {
      if (statusFilter && asset.status !== statusFilter) {
        return false;
      }
      if (normalisedSearch) {
        const haystack = `${asset.inventoryNumber} ${asset.name}`.toLowerCase();
        if (!haystack.includes(normalisedSearch)) {
          return false;
        }
      }
      return true;
    });
  }, [assetsQuery.data, statusFilter, searchTerm]);

  const total = assetsQuery.data?.pagination.total ?? 0;
  const hasMore = assetsQuery.data?.pagination.hasMore ?? false;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasActiveFilter = statusFilter !== '' || searchTerm.trim() !== '';

  const canEdit = useCanEditAssets();

  return (
    <div>
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Majetok</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Evidencia jednotlivých položiek majetku organizácie.
          </p>
        </div>
        {canEdit && (
          <Link
            href="/assets/new"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Pridať majetok
          </Link>
        )}
      </header>

      <section
        aria-label="Filtre"
        className="mb-4 grid gap-3 rounded-xl border border-border-subtle bg-surface-card p-4 shadow-sm sm:grid-cols-[1fr_auto_auto]"
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
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Inventárne číslo alebo názov"
              className="w-full rounded-lg border border-border-default bg-surface-card py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            />
          </span>
        </label>

        <div className="flex flex-col gap-1 text-sm text-text-secondary">
          <span className="font-medium">Stav</span>
          <SelectField
            label="Stav"
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
            options={[
              { value: '', label: 'Všetky stavy' },
              ...ASSET_STATUS_VALUES.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s })),
            ]}
            className="w-44"
          />
        </div>

        <div className="flex flex-col gap-1 text-sm text-text-secondary">
          <span className="font-medium">Veľkosť strany</span>
          <SelectField
            label="Veľkosť strany"
            value={String(pageSize)}
            onChange={(v) => {
              setPageSize(Number(v) as PageSize);
              setPage(1);
            }}
            options={PAGE_SIZES.map((s) => ({ value: String(s), label: String(s) }))}
            className="w-24"
          />
        </div>
      </section>

      <p className="mb-3 text-sm text-text-secondary" aria-live="polite">
        {assetsQuery.isLoading ? (
          'Načítavam položky…'
        ) : assetsQuery.isError ? (
          <span className="text-danger-fg">Položky sa nepodarilo načítať.</span>
        ) : hasActiveFilter ? (
          <>
            Zobrazujem <strong>{filteredAssets.length}</strong> z{' '}
            {assetsQuery.data?.data.length ?? 0} položiek na strane (celkom v evidencii:{' '}
            {total.toLocaleString('sk-SK')}).
          </>
        ) : (
          <>
            Strana <strong>{page}</strong> z {totalPages} (celkom {total.toLocaleString('sk-SK')}{' '}
            položiek).
          </>
        )}
      </p>

      {assetsQuery.isLoading ? (
        <TableSkeleton rows={Math.min(pageSize, 8)} />
      ) : filteredAssets.length === 0 ? (
        <EmptyState hasActiveFilter={hasActiveFilter} />
      ) : (
        <AssetsTable
          assets={filteredAssets}
          categoriesById={categoriesById}
          locationsById={locationsById}
        />
      )}

      <nav
        aria-label="Stránkovanie"
        className="mt-4 flex items-center justify-between gap-3 text-sm"
      >
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1 || assetsQuery.isLoading}
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
          disabled={!hasMore || assetsQuery.isLoading}
          className="rounded-lg border border-border-default bg-surface-card px-3 py-2 font-medium text-text-primary transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus sm:px-4"
        >
          <span className="sr-only sm:not-sr-only sm:mr-1">Ďalšia</span>
          <span aria-hidden="true">→</span>
        </button>
      </nav>

      {(categoriesQuery.isError || locationsQuery.isError) && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-warning-fg bg-warning-bg p-3 text-sm text-warning-fg"
        >
          Číselník kategórií alebo lokalít sa nepodarilo načítať. Pri položkách sa zobrazia iba ID,
          kým spojenie obnovíme.
        </div>
      )}
    </div>
  );
}

/**
 * Build an O(1) lookup map from a list of identifiable records. Kept
 * generic so it works for both categories and locations (and any
 * future ID-keyed reference data).
 */
function buildIdMap<T extends { _id: string }>(items: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(item._id, item);
  }
  return map;
}

function TableSkeleton({ rows }: { rows: number }): JSX.Element {
  return (
    <div
      aria-busy="true"
      aria-label="Načítavam tabuľku majetku"
      className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-sm"
    >
      <div className="border-b border-border-subtle bg-surface-subtle px-4 py-3">
        <div className="h-3 w-32 animate-pulse rounded bg-border-subtle" />
      </div>
      <ul className="divide-y divide-border-subtle">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="flex items-center gap-4 px-4 py-3">
            <div className="h-4 w-28 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 flex-1 animate-pulse rounded bg-surface-subtle" />
            <div className="h-5 w-20 animate-pulse rounded-full bg-surface-subtle" />
            <div className="h-4 w-24 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 w-24 animate-pulse rounded bg-surface-subtle" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ hasActiveFilter }: { hasActiveFilter: boolean }): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-10 text-center">
      <p className="text-sm font-medium text-text-primary">
        {hasActiveFilter
          ? 'Žiadne položky nezodpovedajú filtru.'
          : 'Zatiaľ tu nie sú žiadne položky.'}
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        {hasActiveFilter
          ? 'Skúste vyčistiť hľadanie alebo zmeniť stav. Filter sa aplikuje na aktuálnu stranu.'
          : 'Akonáhle správca pridá prvý kus majetku, zobrazí sa tu.'}
      </p>
    </div>
  );
}

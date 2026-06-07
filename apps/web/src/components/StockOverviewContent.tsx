// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * StockOverviewContent — prehľad skladu pre ASSET_MANAGER + ADMIN.
 *
 * Zobrazuje všetky BULK položky tenanta s:
 *   - aktuálnym zostatkom (quantityOnHand)
 *   - farebnými indikátormi stavu zásob:
 *       🔴 červená — zostatok = 0
 *       🟡 žltá   — zostatok ≤ 10 % posledného príjmu (lastReceiptQuantity)
 *       🟢 zelená  — zostatok > 10 % posledného príjmu
 *       ⚪ sivá   — žiadny RECEIPT ešte nebol (nemáme referenčné množstvo)
 *   - kliknutím na riadok → detail položky (/assets/:id)
 *
 * Backend: GET /v1/stock (ASSET_MANAGER+)
 */

import { AlertTriangle, Warehouse } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { SelectField } from './SelectField';
import { TableSkeleton } from './Skeleton';

import type { BulkItemOverview } from '@/lib/api-hooks';
import type { JSX, ReactNode } from 'react';

import { useCanManageStock, useCategories, useLocations, useStockOverview } from '@/lib/api-hooks';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Stav zásob — farebný indikátor
// ---------------------------------------------------------------------------

type StockStatus = 'empty' | 'low' | 'ok' | 'unknown';

function getStockStatus(item: BulkItemOverview): StockStatus {
  const qty = item.quantityOnHand ?? 0;
  if (qty === 0) return 'empty';
  if (item.lastReceiptQuantity == null) return 'unknown';
  const threshold = item.lastReceiptQuantity * 0.1;
  return qty <= threshold ? 'low' : 'ok';
}

const STATUS_DOT: Record<StockStatus, string> = {
  empty: 'bg-red-500',
  low: 'bg-amber-400',
  ok: 'bg-emerald-500',
  unknown: 'bg-slate-300',
};

const STATUS_ROW_BG: Record<StockStatus, string> = {
  empty: 'bg-red-50/60',
  low: 'bg-amber-50/60',
  ok: '',
  unknown: '',
};

const STATUS_QTY_COLOR: Record<StockStatus, string> = {
  empty: 'text-red-700',
  low: 'text-amber-700',
  ok: 'text-emerald-700',
  unknown: 'text-text-secondary',
};

const STATUS_LABELS: Record<StockStatus, string> = {
  empty: 'Prázdne',
  low: 'Málo',
  ok: 'V poriadku',
  unknown: 'Bez referenčného príjmu',
};

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Všetky stavy' },
  { value: 'empty', label: '🔴 Prázdne' },
  { value: 'low', label: '🟡 Málo' },
  { value: 'ok', label: '🟢 V poriadku' },
  { value: 'unknown', label: '⚪ Bez príjmu' },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function StockOverviewContent(): JSX.Element {
  const canManage = useCanManageStock();
  const overviewQuery = useStockOverview();
  const categoriesQuery = useCategories({ limit: 200 });
  const locationsQuery = useLocations({ limit: 200 });

  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  const categoriesById = useMemo(
    () => new Map((categoriesQuery.data?.data ?? []).map((c) => [c._id, c])),
    [categoriesQuery.data],
  );
  const locationsById = useMemo(
    () => new Map((locationsQuery.data?.data ?? []).map((l) => [l._id, l])),
    [locationsQuery.data],
  );

  const items = overviewQuery.data?.data ?? [];

  const filtered = useMemo(() => {
    const norm = searchTerm.trim().toLowerCase();
    return items.filter((item) => {
      const status = getStockStatus(item);
      if (statusFilter && status !== statusFilter) return false;
      if (norm) {
        const hay = `${item.inventoryNumber} ${item.name}`.toLowerCase();
        if (!hay.includes(norm)) return false;
      }
      return true;
    });
  }, [items, statusFilter, searchTerm]);

  // Súhrnné štatistiky
  const stats = useMemo(() => {
    const all = items;
    return {
      total: all.length,
      empty: all.filter((i) => getStockStatus(i) === 'empty').length,
      low: all.filter((i) => getStockStatus(i) === 'low').length,
      ok: all.filter((i) => getStockStatus(i) === 'ok').length,
    };
  }, [items]);

  if (!canManage) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface-card p-8 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-text-muted" />
        <p className="mt-3 text-sm font-medium text-text-primary">Nedostatočné oprávnenie</p>
        <p className="mt-1 text-sm text-text-secondary">
          Prehľad skladu je dostupný pre Správcu majetku a Administrátora.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Sklad</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Prehľad zásob množstevných položiek organizácie.
          </p>
        </div>
      </header>

      {/* Súhrnné karty */}
      {!overviewQuery.isLoading && items.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Celkom položiek" value={stats.total} color="neutral" />
          <StatCard label="V poriadku" value={stats.ok} color="green" />
          <StatCard label="Málo zásob" value={stats.low} color="amber" />
          <StatCard label="Prázdne" value={stats.empty} color="red" />
        </div>
      )}

      {/* Filtre */}
      <section
        aria-label="Filtre"
        className="mb-4 grid gap-3 rounded-xl border border-border-subtle bg-surface-card p-4 shadow-sm sm:grid-cols-[1fr_auto]"
      >
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          <span className="font-medium">Hľadať</span>
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Inventárne číslo alebo názov"
            className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          />
        </label>
        <div className="flex flex-col gap-1 text-sm text-text-secondary">
          <span className="font-medium">Stav zásob</span>
          <SelectField
            label="Stav zásob"
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_FILTER_OPTIONS}
            className="w-52"
          />
        </div>
      </section>

      {/* Počet */}
      <p className="mb-3 text-sm text-text-secondary" aria-live="polite">
        {overviewQuery.isLoading
          ? 'Načítavam...'
          : overviewQuery.isError
            ? ''
            : `${filtered.length} z ${items.length} položiek`}
      </p>

      {/* Tabuľka / stavy */}
      {overviewQuery.isLoading ? (
        <TableSkeleton rows={6} columns={6} />
      ) : overviewQuery.isError ? (
        <ErrorBanner message={overviewQuery.error.message} />
      ) : filtered.length === 0 ? (
        <EmptyState hasFilter={statusFilter !== '' || searchTerm.trim() !== ''} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border-subtle">
              <caption className="sr-only">Prehľad zásob skladových položiek</caption>
              <thead className="bg-surface-subtle">
                <tr>
                  <Th>Stav</Th>
                  <Th>Inventárne číslo</Th>
                  <Th>Názov</Th>
                  <Th className="text-right">Zostatok</Th>
                  <Th className="text-right">Ref. príjem</Th>
                  <Th>Kategória</Th>
                  <Th>Lokalita</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filtered.map((item) => {
                  const status = getStockStatus(item);
                  const category = categoriesById.get(item.categoryId);
                  const location = locationsById.get(item.locationId);
                  return (
                    <tr
                      key={item._id}
                      className={cn(
                        'transition hover:bg-surface-subtle focus-within:bg-surface-subtle',
                        STATUS_ROW_BG[status],
                      )}
                    >
                      {/* Indikátor */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn('h-2.5 w-2.5 shrink-0 rounded-full', STATUS_DOT[status])}
                            aria-hidden="true"
                          />
                          <span className="hidden text-xs text-text-muted sm:inline">
                            {STATUS_LABELS[status]}
                          </span>
                        </div>
                      </td>
                      {/* Inventárne číslo */}
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-sm">
                        <Link
                          href={`/assets/${item._id}`}
                          className="text-brand-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                        >
                          {item.inventoryNumber}
                        </Link>
                      </td>
                      {/* Názov */}
                      <td className="px-4 py-3 text-sm font-medium text-text-primary">
                        {item.name}
                      </td>
                      {/* Zostatok */}
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <span
                          className={cn(
                            'font-mono text-sm font-bold tabular-nums',
                            STATUS_QTY_COLOR[status],
                          )}
                        >
                          {item.quantityOnHand ?? 0}
                          <span className="ml-1 text-xs font-normal text-text-muted">ks</span>
                        </span>
                      </td>
                      {/* Referenčný príjem */}
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm text-text-muted tabular-nums">
                        {item.lastReceiptQuantity != null ? (
                          <>
                            {item.lastReceiptQuantity}
                            <span className="ml-1 text-xs">ks</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      {/* Kategória */}
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-text-secondary">
                        {category?.name ?? (
                          <span className="font-mono text-xs text-text-muted">
                            {item.categoryId}
                          </span>
                        )}
                      </td>
                      {/* Lokalita */}
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-text-secondary">
                        {location?.name ?? (
                          <span className="font-mono text-xs text-text-muted">
                            {item.locationId}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Súhrnná karta
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'neutral' | 'green' | 'amber' | 'red';
}): JSX.Element {
  const colors = {
    neutral: 'border-border-subtle bg-surface-card',
    green: 'border-emerald-200 bg-emerald-50',
    amber: 'border-amber-200 bg-amber-50',
    red: 'border-red-200 bg-red-50',
  };
  const textColors = {
    neutral: 'text-text-primary',
    green: 'text-emerald-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
  };
  return (
    <div className={cn('min-w-0 rounded-xl border p-4 shadow-sm', colors[color])}>
      <p className="min-h-[2rem] text-xs font-medium leading-tight text-text-muted">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums', textColors[color])}>{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Th({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <th
      scope="col"
      className={cn(
        'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted',
        className,
      )}
    >
      {children}
    </th>
  );
}

function ErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function EmptyState({ hasFilter }: { hasFilter: boolean }): JSX.Element {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-card py-12 text-center">
      <Warehouse aria-hidden="true" className="mx-auto h-10 w-10 text-text-muted" />
      <p className="mt-3 text-sm font-medium text-text-primary">
        {hasFilter ? 'Žiadne položky pre zvolený filter' : 'Žiadne množstevné položky v evidencii'}
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        {hasFilter
          ? 'Skúste zmeniť filter.'
          : 'Množstevné položky pridáte v sekcii Majetok (typ: Množstevná).'}
      </p>
    </div>
  );
}

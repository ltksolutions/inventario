// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * ProtocolsContent — /protocols, zoznam preberacích protokolov (ADR-0022).
 *
 * ASSET_MANAGER/ADMIN vidí všetky protokoly organizácie (menu položka je
 * managerOnly), backend pre EMPLOYEE vynúti filter na vlastné protokoly.
 *
 * Filtrovanie: typ, stav, textové vyhľadávanie (odovzdávajúci/preberajúci).
 * Radenie: kliknutím na hlavičku stĺpca (client-side).
 * Akcie na riadku: Tlač + preklik na detail výpožičky.
 */

import {
  AlertCircle,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  FileSignature,
  FileText,
  Search,
} from 'lucide-react';
import Link from 'next/link';
import { useState, useMemo } from 'react';

import type { LoanProtocolSummary, ProtocolStatus, ProtocolType } from '@/lib/api-hooks';
import type { JSX } from 'react';

import {
  PROTOCOL_STATUS_CONFIG,
  PROTOCOL_TYPE_LABELS,
  ProtocolPdfButton,
} from '@/components/ProtocolCard';
import { useProtocols } from '@/lib/api-hooks';
import { cn } from '@/lib/cn';

type SortColumn = 'protocolNumber' | 'handover' | 'receive' | 'issuedAt' | 'status';
type SortDirection = 'asc' | 'desc';

const TYPE_FILTERS: Array<{ value: ProtocolType | ''; label: string }> = [
  { value: '', label: 'Všetky typy' },
  { value: 'HANDOVER', label: 'Preberacie' },
  { value: 'RETURN', label: 'O vrátení' },
  { value: 'AMENDMENT', label: 'Dodatky' },
];

const STATUS_FILTERS: Array<{ value: ProtocolStatus | ''; label: string }> = [
  { value: '', label: 'Všetky stavy' },
  { value: 'DRAFT', label: 'Návrhy' },
  { value: 'SIGNED', label: 'Podpísané' },
  { value: 'AMENDED', label: 'Nahradené' },
  { value: 'VOIDED', label: 'Zrušené' },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('sk-SK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function ProtocolsContent(): JSX.Element {
  const [typeFilter, setTypeFilter] = useState<ProtocolType | ''>('');
  const [statusFilter, setStatusFilter] = useState<ProtocolStatus | ''>('');
  const [partySearch, setPartySearch] = useState('');
  const [sortCol, setSortCol] = useState<SortColumn>('issuedAt');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  const protocolsQuery = useProtocols({
    limit: 100,
    ...(typeFilter ? { type: typeFilter } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
  });
  const rawProtocols = protocolsQuery.data?.data ?? [];
  const total = protocolsQuery.data?.pagination.total ?? 0;

  const STATUS_ORDER: Record<string, number> = { DRAFT: 0, SIGNED: 1, AMENDED: 2, VOIDED: 3 };

  const protocols = useMemo(() => {
    const needle = partySearch.trim().toLowerCase();
    const filtered = needle
      ? rawProtocols.filter((p) => {
          const handover = (
            p.parties.handover.snapshot.displayName ||
            p.parties.handover.snapshot.email ||
            ''
          ).toLowerCase();
          const receive = (
            p.parties.receive.snapshot.displayName ||
            p.parties.receive.snapshot.email ||
            ''
          ).toLowerCase();
          return handover.includes(needle) || receive.includes(needle);
        })
      : rawProtocols;

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case 'protocolNumber':
          cmp = a.protocolNumber.localeCompare(b.protocolNumber, 'sk');
          break;
        case 'handover':
          cmp = (
            a.parties.handover.snapshot.displayName ||
            a.parties.handover.snapshot.email ||
            ''
          ).localeCompare(
            b.parties.handover.snapshot.displayName || b.parties.handover.snapshot.email || '',
            'sk',
          );
          break;
        case 'receive':
          cmp = (
            a.parties.receive.snapshot.displayName ||
            a.parties.receive.snapshot.email ||
            ''
          ).localeCompare(
            b.parties.receive.snapshot.displayName || b.parties.receive.snapshot.email || '',
            'sk',
          );
          break;
        case 'issuedAt':
          cmp = a.issuedAt.localeCompare(b.issuedAt);
          break;
        case 'status':
          cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rawProtocols, partySearch, sortCol, sortDir]);

  function handleSort(col: SortColumn) {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  const isFiltered = Boolean(typeFilter || statusFilter || partySearch.trim());

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Preberacie protokoly</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Protokoly o odovzdaní a vrátení majetku. Nepodpísané protokoly čakajú na elektronické
          potvrdenie oboch strán.
        </p>
      </header>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter typu">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              type="button"
              onClick={() => setTypeFilter(f.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition',
                typeFilter === f.value
                  ? 'border-brand-primary bg-brand-primary text-white'
                  : 'border-border-default bg-surface-card text-text-secondary hover:bg-surface-subtle',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span aria-hidden="true" className="mx-1 hidden h-4 w-px bg-border-default sm:block" />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter stavu">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition',
                statusFilter === f.value
                  ? 'border-brand-primary bg-brand-primary text-white'
                  : 'border-border-default bg-surface-card text-text-secondary hover:bg-surface-subtle',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Party search */}
      <div className="mb-4">
        <label htmlFor="party-search" className="sr-only">
          Hľadaj odovzdávajúceho alebo preberajúceho
        </label>
        <div className="relative max-w-sm">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted"
          />
          <input
            id="party-search"
            type="search"
            value={partySearch}
            onChange={(e) => setPartySearch(e.target.value)}
            placeholder="Hľadaj odovzdávajúceho / preberajúceho…"
            className="w-full rounded-lg border border-border-default bg-surface-card py-1.5 pl-8 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
          />
        </div>
      </div>

      {protocolsQuery.isLoading ? (
        <ListSkeleton />
      ) : protocolsQuery.isError ? (
        <ErrorPanel message="Protokoly sa nepodarilo načítať. Skontroluj pripojenie a skús to znova." />
      ) : protocols.length === 0 ? (
        <EmptyState filtered={isFiltered} />
      ) : (
        <ProtocolsTable
          protocols={protocols}
          total={total}
          sortCol={sortCol}
          sortDir={sortDir}
          onSort={handleSort}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function SortIcon({
  col,
  sortCol,
  sortDir,
}: {
  col: SortColumn;
  sortCol: SortColumn;
  sortDir: SortDirection;
}): JSX.Element {
  if (sortCol !== col)
    return <ChevronsUpDown aria-hidden="true" className="ml-1 inline h-3 w-3 text-text-muted" />;
  return sortDir === 'asc' ? (
    <ChevronUp aria-hidden="true" className="ml-1 inline h-3 w-3" />
  ) : (
    <ChevronDown aria-hidden="true" className="ml-1 inline h-3 w-3" />
  );
}

function ProtocolsTable({
  protocols,
  total,
  sortCol,
  sortDir,
  onSort,
}: {
  protocols: readonly LoanProtocolSummary[];
  total: number;
  sortCol: SortColumn;
  sortDir: SortDirection;
  onSort: (col: SortColumn) => void;
}): JSX.Element {
  const thSort = (col: SortColumn, label: string, extraClass = '') => (
    <th
      scope="col"
      aria-sort={sortCol === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('px-4 py-3', extraClass)}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className="inline-flex items-center gap-0 font-semibold hover:text-text-primary transition-colors"
      >
        {label}
        <SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
      </button>
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-border-subtle bg-surface-subtle text-left text-xs uppercase tracking-wide text-text-muted">
          <tr>
            {thSort('protocolNumber', 'Číslo')}
            <th scope="col" className="px-4 py-3 font-semibold">
              Typ
            </th>
            {thSort('handover', 'Odovzdávajúci')}
            {thSort('receive', 'Preberajúci')}
            {thSort('issuedAt', 'Vystavený')}
            {thSort('status', 'Stav')}
            <th scope="col" className="px-4 py-3 text-right font-semibold">
              Akcie
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {protocols.map((p) => {
            const statusConfig = PROTOCOL_STATUS_CONFIG[p.status] ?? {
              label: p.status,
              className: 'bg-surface-subtle text-text-muted ring-border-subtle',
            };
            return (
              <tr key={p._id} className="hover:bg-surface-subtle">
                <td className="px-4 py-3 font-mono text-xs font-medium text-text-primary">
                  {p.protocolNumber}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {PROTOCOL_TYPE_LABELS[p.type] ?? p.type}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {p.parties.handover.snapshot.displayName ||
                    p.parties.handover.snapshot.email ||
                    '—'}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {p.parties.receive.snapshot.displayName ||
                    p.parties.receive.snapshot.email ||
                    '—'}
                </td>
                <td className="px-4 py-3 text-text-secondary">{formatDate(p.issuedAt)}</td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset',
                      statusConfig.className,
                    )}
                  >
                    {statusConfig.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <ProtocolPdfButton protocolId={p._id} />
                    <Link
                      href={`/loans/${p.loanId}`}
                      aria-label="Detail výpožičky"
                      className="inline-flex items-center gap-1 rounded-lg border border-brand-primary bg-brand-primary/10 px-2.5 py-1.5 text-xs font-medium text-brand-primary transition hover:bg-brand-primary/20"
                    >
                      <FileText aria-hidden="true" className="h-3.5 w-3.5" />
                      Výpožička
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {protocols.length > 0 && (
        <div className="border-t border-border-subtle px-4 py-2 text-xs text-text-muted">
          {protocols.length < total
            ? `Zobrazujem ${protocols.length} z ${total} protokolov`
            : `${total} protokolov`}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function ListSkeleton(): JSX.Element {
  return (
    <div
      aria-busy="true"
      aria-label="Načítavam protokoly"
      className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-sm"
    >
      <div className="border-b border-border-subtle bg-surface-subtle px-4 py-3">
        <div className="h-3 w-32 animate-pulse rounded bg-border-subtle" />
      </div>
      <ul className="divide-y divide-border-subtle">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="flex items-center gap-4 px-4 py-3">
            <div className="h-4 w-28 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 w-32 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 w-32 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 w-24 animate-pulse rounded bg-surface-subtle" />
            <div className="h-5 w-24 animate-pulse rounded-full bg-surface-subtle" />
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
      <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-10 text-center">
      <FileSignature aria-hidden="true" className="mx-auto h-8 w-8 text-text-muted" />
      <p className="mt-3 text-sm font-medium text-text-primary">
        {filtered ? 'Filtru nezodpovedá žiadny protokol.' : 'Zatiaľ žiadne protokoly.'}
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        {filtered
          ? 'Skúste zmeniť alebo zrušiť filtre.'
          : 'Protokoly vznikajú automaticky pri vydaní a vrátení výpožičky.'}
      </p>
    </div>
  );
}

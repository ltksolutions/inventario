// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * ProtocolsContent — /protocols, zoznam preberacích protokolov (ADR-0022).
 *
 * ASSET_MANAGER/ADMIN vidí všetky protokoly organizácie (menu položka je
 * managerOnly), backend pre EMPLOYEE vynúti filter na vlastné protokoly.
 *
 * Filtrovanie: typ (HANDOVER/RETURN/AMENDMENT) a stav (DRAFT/SIGNED/...).
 * Akcie na riadku: PDF / Tlač + preklik na detail výpožičky.
 */

import { AlertCircle, ChevronRight, FileSignature } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import type { LoanProtocolSummary, ProtocolStatus, ProtocolType } from '@/lib/api-hooks';
import type { JSX } from 'react';

import {
  PROTOCOL_STATUS_CONFIG,
  PROTOCOL_TYPE_LABELS,
  ProtocolPdfButton,
} from '@/components/ProtocolCard';
import { useProtocols } from '@/lib/api-hooks';
import { cn } from '@/lib/cn';

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

  const protocolsQuery = useProtocols({
    limit: 100,
    ...(typeFilter ? { type: typeFilter } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
  });
  const protocols = protocolsQuery.data?.data ?? [];
  const total = protocolsQuery.data?.pagination.total ?? 0;

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

      {protocolsQuery.isLoading ? (
        <ListSkeleton />
      ) : protocolsQuery.isError ? (
        <ErrorPanel message="Protokoly sa nepodarilo načítať. Skontroluj pripojenie a skús to znova." />
      ) : protocols.length === 0 ? (
        <EmptyState filtered={Boolean(typeFilter || statusFilter)} />
      ) : (
        <ProtocolsTable protocols={protocols} total={total} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function ProtocolsTable({
  protocols,
  total,
}: {
  protocols: readonly LoanProtocolSummary[];
  total: number;
}): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-border-subtle bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
          <tr>
            <th scope="col" className="px-4 py-3">
              Číslo
            </th>
            <th scope="col" className="px-4 py-3">
              Typ
            </th>
            <th scope="col" className="px-4 py-3">
              Odovzdávajúci
            </th>
            <th scope="col" className="px-4 py-3">
              Preberajúci
            </th>
            <th scope="col" className="px-4 py-3">
              Vystavený
            </th>
            <th scope="col" className="px-4 py-3">
              Stav
            </th>
            <th scope="col" className="px-4 py-3 text-right">
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
                      className="inline-flex items-center gap-0.5 rounded text-xs font-medium text-brand-primary underline-offset-2 transition hover:underline"
                    >
                      Výpožička
                      <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
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

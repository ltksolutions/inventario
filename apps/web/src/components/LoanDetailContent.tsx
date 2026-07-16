// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * LoanDetailContent — detail jednej výpožičky (/loans/[id]).
 *
 * Sekcie:
 *   1. Hlavička — stav, vypožičiavateľ, účel, dátumy.
 *   2. Položky — tabuľka s majetkom a stavom pri prevzatí/vrátení.
 *   3. Protokoly — preberacie protokoly a protokoly o vrátení (ADR-0022)
 *      s elektronickým podpisom (CLICK_TO_SIGN) a PDF tlačou.
 *
 * Backfill: ASSET_MANAGER/ADMIN môže pre staršie výpožičky bez protokolu
 * vytvoriť protokol dodatočne (POST /v1/loans/:id/protocols).
 */

import { AlertCircle, ArrowLeft, Clock, FilePlus2, Loader2, PackageCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import type { LoanProtocolSummary, LoanSummary } from '@/lib/api-hooks';
import type { JSX, ReactNode } from 'react';

import { ProtocolCard } from '@/components/ProtocolCard';
import { ReturnLoanModal } from '@/components/ReturnLoanModal';
import {
  useCanManageLoans,
  useCreateLoanProtocol,
  useLoan,
  useLoanProtocols,
  useMe,
} from '@/lib/api-hooks';
import { cn } from '@/lib/cn';
import { useConditionLabel } from '@/lib/conditions';

// ---------------------------------------------------------------------------
// Labels & helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Aktívna', className: 'bg-green-50 text-green-700 ring-green-600/20' },
  RETURNED: { label: 'Vrátená', className: 'bg-surface-subtle text-text-muted ring-border-subtle' },
  DAMAGED: { label: 'Poškodená', className: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  LOST: { label: 'Stratená', className: 'bg-red-50 text-red-700 ring-red-600/20' },
};

/** Polia detailu, ktoré LoanSummary typ nevymenúva explicitne. */
interface LoanItemCondition {
  condition: string;
  note: string | null;
  requiresService?: boolean;
}

interface LoanDetailItem {
  assetId: string;
  snapshot: { inventoryNumber: string; name: string };
  condition?: {
    atPickup: LoanItemCondition | null;
    atReturn: LoanItemCondition | null;
  };
}

function formatDate(iso: string | null | undefined): string {
  if (iso == null) return 'do odvolania';
  return new Date(iso).toLocaleDateString('sk-SK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LoanDetailContent({ loanId }: { loanId: string }): JSX.Element {
  const me = useMe();
  const canManage = useCanManageLoans();
  const loanQuery = useLoan(loanId);
  const protocolsQuery = useLoanProtocols(loanId);
  const [returnModalOpen, setReturnModalOpen] = useState(false);

  if (loanQuery.isLoading) {
    return <DetailSkeleton />;
  }

  if (loanQuery.isError || !loanQuery.data) {
    return (
      <div className="mx-auto max-w-4xl">
        <BackLink canManage={canManage} />
        <ErrorPanel message="Výpožičku sa nepodarilo načítať — buď neexistuje, alebo na ňu nemáte oprávnenie." />
      </div>
    );
  }

  const loan = loanQuery.data;
  const isOverdue = loan.isOverdue && loan.status === 'ACTIVE';
  const statusKey = isOverdue ? 'OVERDUE' : loan.status;
  const statusConfig =
    statusKey === 'OVERDUE'
      ? { label: 'Po termíne', className: 'bg-red-50 text-red-700 ring-red-600/20' }
      : (STATUS_CONFIG[loan.status] ?? {
          label: loan.status,
          className: 'bg-surface-subtle text-text-muted ring-border-subtle',
        });

  const items = loan.items as unknown as LoanDetailItem[];
  const protocols = protocolsQuery.data ?? [];
  const canReturn = canManage && loan.status === 'ACTIVE';

  return (
    <div className="mx-auto max-w-4xl">
      <BackLink canManage={canManage} />

      {/* Hlavička */}
      <header className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Výpožička</h1>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
                statusConfig.className,
              )}
            >
              {statusConfig.label}
            </span>
            {isOverdue && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
                <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                Termín vrátenia uplynul {formatDate(loan.dueAt)}
              </span>
            )}
          </div>
          {canReturn && (
            <button
              type="button"
              onClick={() => setReturnModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
            >
              <PackageCheck aria-hidden="true" className="h-4 w-4" />
              Vrátiť
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-text-secondary">{loan.purpose}</p>
      </header>

      {returnModalOpen && <ReturnLoanModal loan={loan} onClose={() => setReturnModalOpen(false)} />}

      {/* Info grid */}
      <section className="mb-6 grid grid-cols-1 gap-3 rounded-xl border border-border-subtle bg-surface-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <InfoField label="Vypožičiavateľ" value={loan.borrowerDisplayName ?? '—'} />
        <InfoField label="Prevzaté" value={formatDate(loan.pickedUpAt)} />
        <InfoField
          label="Termín vrátenia"
          value={formatDate(loan.dueAt)}
          valueClassName={isOverdue ? 'text-red-600' : undefined}
        />
        <InfoField label="Vrátené" value={loan.returnedAt ? formatDate(loan.returnedAt) : '—'} />
      </section>

      {/* Položky */}
      <section aria-labelledby="items-heading" className="mb-8">
        <h2 id="items-heading" className="mb-3 text-lg font-semibold text-text-primary">
          Položky ({items.length})
        </h2>
        <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-border-subtle bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Majetok
                </th>
                <th scope="col" className="px-4 py-3">
                  Stav pri prevzatí
                </th>
                <th scope="col" className="px-4 py-3">
                  Stav pri vrátení
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {items.map((item) => (
                <tr key={item.assetId} className="hover:bg-surface-subtle">
                  <td className="px-4 py-3">
                    <Link
                      href={`/assets/${item.assetId}`}
                      className="font-medium text-text-primary underline-offset-2 hover:underline"
                    >
                      {item.snapshot.inventoryNumber}
                    </Link>
                    <span className="ml-1.5 text-text-secondary">{item.snapshot.name}</span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    <ConditionCell condition={item.condition?.atPickup ?? null} />
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    <ConditionCell condition={item.condition?.atReturn ?? null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Protokoly */}
      <section aria-labelledby="protocols-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="protocols-heading" className="text-lg font-semibold text-text-primary">
            Protokoly
          </h2>
          {canManage && !protocolsQuery.isLoading && (
            <BackfillButtons loan={loan} protocols={protocols} />
          )}
        </div>

        {protocolsQuery.isLoading ? (
          <div
            aria-busy="true"
            aria-label="Načítavam protokoly"
            className="h-24 animate-pulse rounded-xl border border-border-subtle bg-surface-card"
          />
        ) : protocolsQuery.isError ? (
          <ErrorPanel message="Protokoly sa nepodarilo načítať." />
        ) : protocols.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-8 text-center">
            <p className="text-sm font-medium text-text-primary">
              K výpožičke zatiaľ neexistuje žiadny protokol.
            </p>
            {canManage ? (
              <p className="mt-1 text-sm text-text-secondary">
                Výpožička vznikla pred zavedením protokolov — preberací protokol môžete vytvoriť
                dodatočne.
              </p>
            ) : (
              <p className="mt-1 text-sm text-text-secondary">
                Požiadajte správcu majetku o vytvorenie protokolu.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {protocols.map((p) => (
              <ProtocolCard key={p._id} protocol={p} currentUserId={me.data?._id ?? ''} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Backfill — dodatočné vytvorenie protokolu (manager)
// ---------------------------------------------------------------------------

function BackfillButtons({
  loan,
  protocols,
}: {
  loan: LoanSummary;
  protocols: readonly LoanProtocolSummary[];
}): JSX.Element | null {
  const create = useCreateLoanProtocol();
  const [error, setError] = useState<string | null>(null);

  const hasHandover =
    Boolean(loan['handoverProtocolId']) || protocols.some((p) => p.type === 'HANDOVER');
  const hasReturn = Boolean(loan['returnProtocolId']) || protocols.some((p) => p.type === 'RETURN');
  const isReturned = loan.returnedAt != null;

  const showHandover = !hasHandover;
  const showReturn = !hasReturn && isReturned;

  if (!showHandover && !showReturn) return null;

  function handleCreate(type: 'HANDOVER' | 'RETURN'): void {
    setError(null);
    create.mutate({ loanId: loan._id, type }, { onError: (e) => setError(e.message) });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {showHandover && (
          <button
            type="button"
            onClick={() => handleCreate('HANDOVER')}
            disabled={create.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-primary bg-brand-primary/10 px-3 py-1.5 text-xs font-medium text-brand-primary transition hover:bg-brand-primary/20 disabled:opacity-50"
          >
            {create.isPending ? (
              <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FilePlus2 aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            Vytvoriť preberací protokol
          </button>
        )}
        {showReturn && (
          <button
            type="button"
            onClick={() => handleCreate('RETURN')}
            disabled={create.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-card px-3 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-surface-subtle disabled:opacity-50"
          >
            <FilePlus2 aria-hidden="true" className="h-3.5 w-3.5" />
            Vytvoriť protokol o vrátení
          </button>
        )}
      </div>
      {error && <p className="text-xs text-danger-fg">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function BackLink({ canManage }: { canManage: boolean }): JSX.Element {
  return (
    <nav className="mb-4 flex items-center gap-2 text-sm" aria-label="Drobky">
      <Link
        href={canManage ? '/loans' : '/my-loans'}
        className="inline-flex items-center gap-1 rounded text-text-secondary transition hover:text-text-primary"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Späť na výpožičky
      </Link>
    </nav>
  );
}

function InfoField({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string | undefined;
}): JSX.Element {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className={cn('mt-0.5 text-sm font-medium text-text-primary', valueClassName)}>
        {value}
      </dd>
    </div>
  );
}

function ConditionCell({ condition }: { condition: LoanItemCondition | null }): JSX.Element {
  const conditionLabel = useConditionLabel();
  if (!condition) return <span className="text-text-muted">—</span>;
  return (
    <span>
      {conditionLabel(condition.condition)}
      {condition.note ? (
        <span className="ml-1 text-xs text-text-muted">({condition.note})</span>
      ) : null}
      {condition.requiresService ? (
        <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
          Vyžaduje servis
        </span>
      ) : null}
    </span>
  );
}

function DetailSkeleton(): JSX.Element {
  return (
    <div aria-busy="true" aria-label="Načítavam výpožičku" className="mx-auto max-w-4xl">
      <div className="mb-4 h-4 w-32 animate-pulse rounded bg-surface-subtle" />
      <div className="mb-6 h-8 w-64 animate-pulse rounded bg-surface-subtle" />
      <div className="mb-6 h-24 animate-pulse rounded-xl border border-border-subtle bg-surface-card" />
      <div className="mb-8 h-40 animate-pulse rounded-xl border border-border-subtle bg-surface-card" />
      <div className="h-32 animate-pulse rounded-xl border border-border-subtle bg-surface-card" />
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

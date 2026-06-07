// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { AlertCircle, ChevronRight, Clock, Package, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import type { LoanRequestSummary, LoanSummary } from '@/lib/api-hooks';
import type { JSX } from 'react';

import { useCancelLoanRequest, useLoanRequests, useMyLoans } from '@/lib/api-hooks';
import { cn } from '@/lib/cn';

/**
 * /my-loans — current user's active and historical loans.
 *
 * Shows all loans for the authenticated user, newest first. Each row
 * shows the borrowed items, purpose, dates, and status with an
 * isOverdue badge (computed server-side on every GET).
 *
 * MVP scope:
 *   - Read-only list (return/lost flows are manager-initiated via /loans)
 *   - isOverdue badge for ACTIVE loans past dueAt
 *   - Status colour coding (ACTIVE, OVERDUE, RETURNED, DAMAGED, LOST)
 *
 * Out of scope (deferred):
 *   - Return self-service via QR code (Slice #5b)
 *   - Loan extension request (Slice #5b)
 *   - Loan detail page with protocol PDF download
 */

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Aktívna', className: 'bg-green-50 text-green-700 ring-green-600/20' },
  RETURNED: { label: 'Vrátená', className: 'bg-surface-subtle text-text-muted ring-border-subtle' },
  DAMAGED: { label: 'Poškodená', className: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  LOST: { label: 'Stratená', className: 'bg-red-50 text-red-700 ring-red-600/20' },
};

function formatDate(iso: string | null): string {
  if (iso == null) return 'do odvolania';
  return new Date(iso).toLocaleDateString('sk-SK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function MyLoansContent(): JSX.Element {
  const loansQuery = useMyLoans({ limit: 50 });
  const loans = loansQuery.data?.data ?? [];

  const pendingQuery = useLoanRequests({ status: 'PENDING', limit: 20 });
  const pendingRequests = pendingQuery.data?.data ?? [];

  return (
    <div>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Moje výpožičky</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Vaše aktívne aj historické výpožičky majetku.
          </p>
        </div>
        <Link
          href="/loans/request"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
        >
          <Package aria-hidden="true" className="h-4 w-4" />
          Požiadať o výpožičku
        </Link>
      </header>

      {/* Pending requests section — shown when user has PENDING loan-requests */}
      {(pendingRequests.length > 0 || pendingQuery.isLoading) && (
        <section aria-labelledby="pending-heading" className="mb-8">
          <h2 id="pending-heading" className="mb-3 text-lg font-semibold text-text-primary">
            Čakajúce žiadosti
          </h2>
          {pendingQuery.isLoading ? (
            <div
              aria-busy="true"
              aria-label="Načítavam žiadosti"
              className="h-16 animate-pulse rounded-xl border border-border-subtle bg-surface-card"
            />
          ) : (
            <PendingRequestsList requests={pendingRequests} />
          )}
        </section>
      )}

      {/* Loans section */}
      <section aria-labelledby="loans-heading">
        <h2 id="loans-heading" className="mb-3 text-lg font-semibold text-text-primary">
          Výpožičky
        </h2>
        {loansQuery.isLoading ? (
          <ListSkeleton />
        ) : loansQuery.isError ? (
          <ErrorPanel message="Výpožičky sa nepodarilo načítať. Skontroluj pripojenie a skús to znova." />
        ) : loans.length === 0 ? (
          <EmptyState />
        ) : (
          <LoansTable loans={loans} total={loansQuery.data?.pagination.total ?? loans.length} />
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending requests list
// ---------------------------------------------------------------------------

function PendingRequestsList({
  requests,
}: {
  requests: readonly LoanRequestSummary[];
}): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
      <table className="w-full min-w-[540px] text-sm">
        <thead className="border-b border-border-subtle bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
          <tr>
            <th scope="col" className="px-4 py-3">
              Položky
            </th>
            <th scope="col" className="px-4 py-3">
              Účel
            </th>
            <th scope="col" className="px-4 py-3">
              Termín
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Akcie
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {requests.map((req) => (
            <PendingRequestRow key={req._id} request={req} />
          ))}
        </tbody>
      </table>
      <div className="border-t border-border-subtle px-4 py-2 text-xs text-text-muted">
        {requests.length} čakajúch
      </div>
    </div>
  );
}

function PendingRequestRow({ request }: { request: LoanRequestSummary }): JSX.Element {
  const cancel = useCancelLoanRequest();
  const [rowError, setRowError] = useState<string | null>(null);

  function handleCancel(): void {
    setRowError(null);
    cancel.mutate({ id: request._id }, { onError: (e) => setRowError(e.message) });
  }

  return (
    <>
      <tr className="hover:bg-surface-subtle">
        <td className="px-4 py-3">
          <div className="flex flex-col gap-0.5">
            {request.items.map((item, idx) => (
              <span
                key={`${item.categoryId}-${idx}`}
                className="text-sm font-medium text-text-primary"
              >
                {item.quantityRequested}× {item.categorySnapshot.name}
                {item.note ? (
                  <span className="ml-1.5 font-normal text-text-muted">({item.note})</span>
                ) : null}
              </span>
            ))}
          </div>
        </td>
        <td className="px-4 py-3 text-text-secondary">{request.purpose}</td>
        <td className="px-4 py-3 text-xs text-text-secondary">
          {request.plannedTo == null
            ? `od ${formatDate(request.plannedFrom)} · do odvolania`
            : `${formatDate(request.plannedFrom)} – ${formatDate(request.plannedTo)}`}
        </td>
        <td className="px-4 py-3 text-right">
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancel.isPending}
            aria-label={`Zrušiť žiadosť`}
            className="inline-flex items-center gap-1 rounded-lg border border-border-default bg-surface-card px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-subtle hover:text-danger-fg disabled:opacity-50"
          >
            <XCircle aria-hidden="true" className="h-3.5 w-3.5" />
            Zrušiť
          </button>
        </td>
      </tr>
      {rowError && (
        <tr className="bg-danger-bg">
          <td colSpan={4} className="px-4 py-2 text-xs text-danger-fg">
            {rowError}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function LoansTable({
  loans,
  total,
}: {
  loans: readonly LoanSummary[];
  total: number;
}): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-border-subtle bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
          <tr>
            <th scope="col" className="px-4 py-3">
              Majetok
            </th>
            <th scope="col" className="px-4 py-3">
              Účel
            </th>
            <th scope="col" className="px-4 py-3">
              Prevzaté
            </th>
            <th scope="col" className="px-4 py-3">
              Termín vrátenia
            </th>
            <th scope="col" className="px-4 py-3">
              Stav
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              <span className="sr-only">Detail</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {loans.map((loan) => {
            const isOverdue = loan.isOverdue && loan.status === 'ACTIVE';
            const statusKey = isOverdue ? 'OVERDUE' : loan.status;
            const statusConfig = STATUS_CONFIG[statusKey] ??
              STATUS_CONFIG[loan.status] ?? {
                label: loan.status,
                className: 'bg-surface-subtle text-text-muted',
              };

            return (
              <tr key={loan._id} className="hover:bg-surface-subtle">
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-0.5">
                    {loan.items.map((item) => (
                      <span key={item.assetId} className="font-medium text-text-primary">
                        {item.snapshot.inventoryNumber}
                        <span className="ml-1.5 font-normal text-text-secondary">
                          {item.snapshot.name}
                        </span>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-text-secondary">{loan.purpose}</td>
                <td className="px-4 py-3 text-text-secondary">{formatDate(loan.pickedUpAt)}</td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'font-medium',
                      isOverdue ? 'text-red-600' : 'text-text-secondary',
                    )}
                  >
                    {formatDate(loan.dueAt)}
                  </span>
                  {isOverdue && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-red-600">
                      <Clock aria-hidden="true" className="h-3 w-3" />
                      Po termíne
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset',
                      isOverdue ? 'bg-red-50 text-red-700 ring-red-600/20' : statusConfig.className,
                    )}
                  >
                    {isOverdue ? 'Po termíne' : statusConfig.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/loans/${loan._id}`}
                    aria-label="Detail výpožičky"
                    className="inline-flex items-center gap-0.5 rounded text-xs font-medium text-brand-primary underline-offset-2 transition hover:underline"
                  >
                    Detail
                    <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {loans.length > 0 && loans.length < total && (
        <div className="border-t border-border-subtle px-4 py-2 text-xs text-text-muted">
          Zobrazujem {loans.length} z {total} výpožičiek
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
      aria-label="Načítavam výpožičky"
      className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-sm"
    >
      <div className="border-b border-border-subtle bg-surface-subtle px-4 py-3">
        <div className="h-3 w-32 animate-pulse rounded bg-border-subtle" />
      </div>
      <ul className="divide-y divide-border-subtle">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="flex items-center gap-4 px-4 py-3">
            <div className="h-4 w-32 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 w-40 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 w-24 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 w-24 animate-pulse rounded bg-surface-subtle" />
            <div className="h-5 w-20 animate-pulse rounded-full bg-surface-subtle" />
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

function EmptyState(): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-10 text-center">
      <p className="text-sm font-medium text-text-primary">Zatiaľ nemáte žiadne výpožičky.</p>
      <p className="mt-1 text-sm text-text-secondary">Keď si niečo vypožičíte, zobrazí sa to tu.</p>
      <Link
        href="/loans/request"
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
      >
        <Package aria-hidden="true" className="h-4 w-4" />
        Požiadať o prvú výpožičku
      </Link>
    </div>
  );
}

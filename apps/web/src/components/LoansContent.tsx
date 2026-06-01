// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { AlertCircle, CheckCircle, PackageCheck, Plus, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import type { LoanRequestSummary } from '@/lib/api-hooks';
import type { JSX } from 'react';

import { FulfilLoanRequestModal } from '@/components/FulfilLoanRequestModal';
import {
  useApproveLoanRequest,
  useCancelLoanRequest,
  useCanManageLoans,
  useLoanRequests,
  useMe,
  useRejectLoanRequest,
} from '@/lib/api-hooks';
import { cn } from '@/lib/cn';

/**
 * /loans — loan requests list.
 *
 * EMPLOYEE: sees own requests with status + cancel ability.
 * ASSET_MANAGER/ADMIN: sees all tenant requests + approve/reject actions.
 */

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PENDING: {
    label: 'Čaká na schválenie',
    className: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  },
  APPROVED: { label: 'Schválená', className: 'bg-blue-50 text-blue-700 ring-blue-600/20' },
  PARTIALLY_FULFILLED: {
    label: 'Čiastočne vydaná',
    className: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  },
  FULFILLED: { label: 'Vybavená', className: 'bg-green-50 text-green-700 ring-green-600/20' },
  CLOSED: {
    label: 'Uzavretá',
    className: 'bg-surface-subtle text-text-muted ring-border-subtle',
  },
  REJECTED: { label: 'Zamietnutá', className: 'bg-red-50 text-red-700 ring-red-600/20' },
  CANCELLED: {
    label: 'Zrušená',
    className: 'bg-surface-subtle text-text-muted ring-border-subtle',
  },
};

function formatDate(iso: string | null): string {
  if (iso == null) return 'do odvolania';
  return new Date(iso).toLocaleDateString('sk-SK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function LoansContent(): JSX.Element {
  const me = useMe();
  const canManage = useCanManageLoans();
  const [statusFilter, setStatusFilter] = useState<string>('');

  const requestsQuery = useLoanRequests({
    limit: 50,
    ...(statusFilter ? { status: statusFilter } : {}),
  });
  const requests = requestsQuery.data?.data ?? [];

  return (
    <div>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Výpožičky</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {canManage
              ? 'Žiadosti o výpožičky od zamestnancov tenantu.'
              : 'Vaše žiadosti o výpožičky.'}
          </p>
        </div>
        <Link
          href="/loans/request"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Nová žiadosť
        </Link>
      </header>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            '',
            'PENDING',
            'APPROVED',
            'PARTIALLY_FULFILLED',
            'FULFILLED',
            'CLOSED',
            'REJECTED',
            'CANCELLED',
          ] as const
        ).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition',
              statusFilter === s
                ? 'border-brand-primary bg-brand-primary text-white'
                : 'border-border-default bg-surface-card text-text-secondary hover:bg-surface-subtle',
            )}
          >
            {s === '' ? 'Všetky' : (STATUS_CONFIG[s]?.label ?? s)}
          </button>
        ))}
      </div>

      {requestsQuery.isLoading ? (
        <ListSkeleton />
      ) : requestsQuery.isError ? (
        <ErrorPanel message="Žiadosti sa nepodarilo načítať." />
      ) : requests.length === 0 ? (
        <EmptyState />
      ) : (
        <RequestsTable
          requests={requests}
          currentUserId={me.data?._id ?? ''}
          canManage={canManage}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table with inline actions
// ---------------------------------------------------------------------------

function RequestsTable({
  requests,
  currentUserId,
  canManage,
}: {
  requests: readonly LoanRequestSummary[];
  currentUserId: string;
  canManage: boolean;
}): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
      <table className="w-full min-w-[700px] text-sm">
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
            <th scope="col" className="px-4 py-3">
              Stav
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Akcie
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {requests.map((req) => (
            <RequestRow
              key={req._id}
              request={req}
              currentUserId={currentUserId}
              canManage={canManage}
            />
          ))}
        </tbody>
      </table>
      {requests.length > 0 && (
        <div className="border-t border-border-subtle px-4 py-2 text-xs text-text-muted">
          {requests.length} záznamov
        </div>
      )}
    </div>
  );
}

function RequestRow({
  request,
  currentUserId,
  canManage,
}: {
  request: LoanRequestSummary;
  currentUserId: string;
  canManage: boolean;
}): JSX.Element {
  const approve = useApproveLoanRequest();
  const reject = useRejectLoanRequest();
  const cancel = useCancelLoanRequest();

  const [rejectReason, setRejectReason] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [fulfilOpen, setFulfilOpen] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const statusConfig = STATUS_CONFIG[request.status] ?? {
    label: request.status,
    className: 'bg-surface-subtle text-text-muted ring-border-subtle',
  };
  const isOwner = request.requesterId === currentUserId;
  const isPending = request.status === 'PENDING';
  // ADR-0026: vydávať možno z APPROVED alebo PARTIALLY_FULFILLED
  const canFulfil =
    canManage && (request.status === 'APPROVED' || request.status === 'PARTIALLY_FULFILLED');

  function handleApprove(): void {
    setRowError(null);
    approve.mutate({ id: request._id }, { onError: (e) => setRowError(e.message) });
  }

  function handleReject(): void {
    if (rejectReason.trim().length < 5) {
      setRowError('Dôvod zamietnutia musí mať aspoň 5 znakov.');
      return;
    }
    setRowError(null);
    reject.mutate(
      { id: request._id, reason: rejectReason.trim() },
      {
        onSuccess: () => setRejectOpen(false),
        onError: (e) => setRowError(e.message),
      },
    );
  }

  function handleCancel(): void {
    setRowError(null);
    cancel.mutate({ id: request._id }, { onError: (e) => setRowError(e.message) });
  }

  return (
    <>
      <tr className="hover:bg-surface-subtle">
        <td className="px-4 py-3">
          <div className="flex flex-col gap-0.5">
            {request.items.map((item, idx) => {
              const fulfilled = item.quantityFulfilled ?? 0;
              return (
                <span
                  key={`${item.categoryId}-${idx}`}
                  className="text-sm font-medium text-text-primary"
                >
                  {item.quantityRequested}× {item.categorySnapshot.name}
                  {fulfilled > 0 ? (
                    <span className="ml-1.5 font-normal text-text-muted">
                      (vydané {fulfilled}/{item.quantityRequested})
                    </span>
                  ) : null}
                  {item.note ? (
                    <span className="ml-1.5 font-normal text-text-muted">· {item.note}</span>
                  ) : null}
                </span>
              );
            })}
          </div>
        </td>
        <td className="px-4 py-3 text-text-secondary">{request.purpose}</td>
        <td className="px-4 py-3 text-xs text-text-secondary">
          {request.plannedTo == null
            ? `od ${formatDate(request.plannedFrom)} · do odvolania`
            : `${formatDate(request.plannedFrom)} – ${formatDate(request.plannedTo)}`}
        </td>
        <td className="px-4 py-3">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset',
              statusConfig.className,
            )}
          >
            {statusConfig.label}
          </span>
          {request.rejectionReason && (
            <p className="mt-0.5 text-xs text-text-muted">{request.rejectionReason}</p>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            {isPending && canManage && (
              <>
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={approve.isPending}
                  aria-label="Schváliť žiadosť"
                  className="inline-flex items-center gap-1 rounded-lg border border-green-500 bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
                >
                  <CheckCircle aria-hidden="true" className="h-3.5 w-3.5" />
                  Schváliť
                </button>
                <button
                  type="button"
                  onClick={() => setRejectOpen(!rejectOpen)}
                  aria-label="Zamietnuť žiadosť"
                  className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                >
                  <XCircle aria-hidden="true" className="h-3.5 w-3.5" />
                  Zamietnuť
                </button>
              </>
            )}
            {canFulfil && (
              <button
                type="button"
                onClick={() => setFulfilOpen(true)}
                aria-label="Vydať majetok"
                className="inline-flex items-center gap-1 rounded-lg border border-brand-primary bg-brand-primary/10 px-2.5 py-1.5 text-xs font-medium text-brand-primary hover:bg-brand-primary/20"
              >
                <PackageCheck aria-hidden="true" className="h-3.5 w-3.5" />
                Vydať
              </button>
            )}
            {isPending && isOwner && !canManage && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancel.isPending}
                className="inline-flex items-center gap-1 rounded-lg border border-border-default bg-surface-card px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-subtle disabled:opacity-50"
              >
                Zrušiť
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Fulfil modal — ADR-0026 vydanie */}
      {fulfilOpen && (
        <FulfilLoanRequestModal request={request} onClose={() => setFulfilOpen(false)} />
      )}

      {/* Reject reason inline form */}
      {rejectOpen && (
        <tr className="bg-red-50">
          <td colSpan={5} className="px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label
                  htmlFor={`reject-reason-${request._id}`}
                  className="mb-1 block text-xs font-medium text-red-700"
                >
                  Dôvod zamietnutia (povinné)
                </label>
                <input
                  id={`reject-reason-${request._id}`}
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Napr. Majetok nie je dostupný v danom termíne…"
                  className="w-full rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={reject.isPending}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {reject.isPending ? 'Zamietam…' : 'Potvrdiť zamietnutie'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRejectOpen(false);
                    setRowError(null);
                  }}
                  className="rounded-lg border border-border-default bg-white px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-subtle"
                >
                  Zrušiť
                </button>
              </div>
            </div>
            {rowError && <p className="mt-1.5 text-xs text-red-600">{rowError}</p>}
          </td>
        </tr>
      )}

      {/* Row-level error (approve/cancel) */}
      {rowError && !rejectOpen && (
        <tr className="bg-danger-bg">
          <td colSpan={5} className="px-4 py-2 text-xs text-danger-fg">
            {rowError}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function ListSkeleton(): JSX.Element {
  return (
    <div
      aria-busy="true"
      aria-label="Načítavam žiadosti"
      className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-sm"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-border-subtle px-4 py-3 last:border-0"
        >
          <div className="h-4 w-32 animate-pulse rounded bg-surface-subtle" />
          <div className="h-4 w-40 animate-pulse rounded bg-surface-subtle" />
          <div className="h-4 w-28 animate-pulse rounded bg-surface-subtle" />
          <div className="h-5 w-24 animate-pulse rounded-full bg-surface-subtle" />
        </div>
      ))}
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
      <p className="text-sm font-medium text-text-primary">Žiadne žiadosti.</p>
      <p className="mt-1 text-sm text-text-secondary">Vytvorte novú žiadosť o výpožičku.</p>
      <Link
        href="/loans/request"
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
        Nová žiadosť
      </Link>
    </div>
  );
}

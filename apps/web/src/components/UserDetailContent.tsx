// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { ArrowLeft, Clock, Package, PackageCheck, ShieldOff, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { ReturnFromPersonModal } from './ReturnFromPersonModal';
import { CardSkeleton, TableSkeleton } from './Skeleton';

import type { LoanSummary } from '@/lib/api-hooks';
import type { JSX } from 'react';

import { useCanManagePersons, useLoans, useUser } from '@/lib/api-hooks';
import { cn } from '@/lib/cn';

/**
 * User detail page — /users/[id] (detail+editácia používateľa, 2026-07-14).
 *
 * Read-only for BOTH roles that can reach the merged "Používatelia" page
 * (ASSET_MANAGER + ADMIN, gated by `useCanManagePersons` — same gate as
 * the list). Reached by clicking a person's name in UsersContent's
 * table; the pencil icon next to it (ADMIN-only) opens UserEditDialog
 * instead, which handles editing.
 *
 * This page took over the loan-history responsibility that used to live
 * on the standalone /persons/[id] "osobná karta majetku" page (retired
 * by the 2026-07-06 Osoby/Používatelia merge) and, briefly, inside
 * UserEditDialog's "Výpožičky tejto osoby" section (removed by this
 * same change — see UserEditDialog.tsx header). Splitting "view" (this
 * page) from "edit" (the dialog) means the loan tables can have real
 * room — full date columns and a link straight through to each asset's
 * own detail page — instead of being squeezed into a modal.
 *
 * Header shows Meno, Priezvisko, Email — same three fields for both
 * roles (toManagerShape on the backend now includes firstName/lastName
 * alongside displayName+email, which ASSET_MANAGER already saw).
 *
 * Asset list: current loans (status ACTIVE) first, then history
 * (RETURNED/DAMAGED/LOST) below — one row per loan item, since a
 * single loan can cover several assets and each needs its own link.
 * `limit: 200` mirrors the cap used everywhere else this list is
 * fetched (list page, previous edit-dialog section) — the SFZ pilot's
 * loan volumes are nowhere near that per person; a proper paginated
 * view is a later improvement if that changes.
 */

const LOAN_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Aktívna', className: 'bg-green-50 text-green-700 ring-green-600/20' },
  // ADR-0036 — časť položiek vrátená, časť stále u používateľa (čiastočné vrátenie
  // "od osoby"). Počíta sa ako "aktuálny majetok", nie úplna história.
  PARTIALLY_RETURNED: {
    label: 'Čiastočne vrátená',
    className: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  },
  RETURNED: {
    label: 'Vrátená',
    className: 'bg-surface-subtle text-text-muted ring-border-subtle',
  },
  DAMAGED: { label: 'Poškodená', className: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  LOST: { label: 'Stratená', className: 'bg-red-50 text-red-700 ring-red-600/20' },
  OVERDUE: { label: 'Po termíne', className: 'bg-red-50 text-red-700 ring-red-600/20' },
};

function formatLoanDate(iso: string | null): string {
  if (iso == null) return '—';
  return new Date(iso).toLocaleDateString('sk-SK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function UserDetailContent({ userId }: { userId: string }): JSX.Element {
  const canManage = useCanManagePersons();
  const userQuery = useUser(userId);
  const loansQuery = useLoans({ borrowerId: userId, limit: 200 });
  const [returnModalOpen, setReturnModalOpen] = useState(false);

  const backLink = (
    <Link
      href="/users"
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-primary hover:underline"
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      Späť na používateľov
    </Link>
  );

  // Same rationale as UsersContent: don't even mount the queries above
  // if the caller can't reach this page at all — but the hooks are
  // already called (React rules of hooks), so we just gate the render.
  if (!canManage) {
    return <AccessDenied />;
  }

  if (userQuery.isLoading) {
    return (
      <div>
        {backLink}
        <CardSkeleton lines={3} />
      </div>
    );
  }

  if (userQuery.isError) {
    return (
      <div>
        {backLink}
        <ErrorPanel
          message={
            (userQuery.error as Error & { status?: number })?.status === 404
              ? 'Používateľ nebol nájdený. Pravdepodobne ho už zmazal niekto iný.'
              : 'Detail používateľa sa nepodarilo načítať. Skúste znova.'
          }
        />
      </div>
    );
  }

  const user = userQuery.data;
  if (!user) {
    // Defensive — isLoading/isError above already cover the expected
    // states; this only guards TypeScript's narrowing, not a real path.
    return <div>{backLink}</div>;
  }
  const allLoans = loansQuery.data?.data ?? [];
  // ADR-0036: PARTIALLY_RETURNED má stále ďalšie položky vonku, takže patrí medzi
  // "aktuálny majetok", nie do histórie.
  const currentLoans = allLoans.filter(
    (loan) => loan.status === 'ACTIVE' || loan.status === 'PARTIALLY_RETURNED',
  );
  const historyLoans = allLoans.filter(
    (loan) => loan.status !== 'ACTIVE' && loan.status !== 'PARTIALLY_RETURNED',
  );
  const hasBorrowedItems = currentLoans.some((loan) =>
    loan.items.some((item) => item.atReturn == null),
  );

  return (
    <div>
      {backLink}

      <header className="mb-6 rounded-xl border border-border-subtle bg-surface-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">{user.displayName}</h1>
          {hasBorrowedItems && (
            <button
              type="button"
              onClick={() => setReturnModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
            >
              <PackageCheck aria-hidden="true" className="h-4 w-4" />
              Vrátiť majetok
            </button>
          )}
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">Meno</dt>
            <dd className="text-text-primary">{user.firstName || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Priezvisko
            </dt>
            <dd className="text-text-primary">{user.lastName || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">Email</dt>
            <dd className="text-text-primary">{user.email}</dd>
          </div>
        </dl>
      </header>

      <section aria-labelledby="current-assets-heading" className="mb-6">
        <h2 id="current-assets-heading" className="mb-2 text-sm font-semibold text-text-primary">
          Aktuálny majetok ({currentLoans.length})
        </h2>
        {loansQuery.isLoading ? (
          <TableSkeleton rows={3} columns={4} />
        ) : loansQuery.isError ? (
          <ErrorPanel message="Výpožičky sa nepodarilo načítať." />
        ) : (
          <AssetLoanTable
            loans={currentLoans}
            emptyMessage="Nemá aktuálne v držaní žiadny majetok."
            variant="current"
          />
        )}
      </section>

      <section aria-labelledby="loan-history-heading">
        <h2 id="loan-history-heading" className="mb-2 text-sm font-semibold text-text-primary">
          História ({historyLoans.length})
        </h2>
        {loansQuery.isLoading ? null : loansQuery.isError ? null : (
          <AssetLoanTable
            loans={historyLoans}
            emptyMessage="Zatiaľ žiadna história výpožičiek."
            variant="history"
          />
        )}
      </section>

      {returnModalOpen && (
        <ReturnFromPersonModal
          borrowerId={userId}
          borrowerDisplayName={user.displayName}
          onClose={() => setReturnModalOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Asset loan table — one row per loan item (a loan can cover several assets)
// ---------------------------------------------------------------------------

interface LoanRow {
  loanId: string;
  assetId: string;
  inventoryNumber: string;
  name: string;
  status: LoanSummary['status'];
  /** Individuálny stav TEJTO položky (ADR-0036) — pri PARTIALLY_RETURNED loan-e
   * môžu niektoré položky byť už vrátené, iné stále vonku. */
  itemAlreadyReturned: boolean;
  isOverdue: boolean;
  pickedUpAt: string;
  dueAt: string | null;
  returnedAt: string | null;
}

function toLoanRows(loans: readonly LoanSummary[]): LoanRow[] {
  const rows: LoanRow[] = [];
  for (const loan of loans) {
    for (const item of loan.items) {
      rows.push({
        loanId: loan._id,
        assetId: item.assetId,
        inventoryNumber: item.snapshot.inventoryNumber,
        name: item.snapshot.name,
        status: loan.status,
        itemAlreadyReturned: item.atReturn != null,
        isOverdue: loan.isOverdue,
        pickedUpAt: loan.pickedUpAt,
        dueAt: loan.dueAt,
        returnedAt: loan.returnedAt,
      });
    }
  }
  return rows;
}

function AssetLoanTable({
  loans,
  emptyMessage,
  variant,
}: {
  loans: readonly LoanSummary[];
  emptyMessage: string;
  variant: 'current' | 'history';
}): JSX.Element {
  const rows = toLoanRows(loans);

  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border-default bg-surface-card p-6 text-sm text-text-secondary">
        <Package aria-hidden="true" className="h-4 w-4" />
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b border-border-subtle bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
          <tr>
            <th scope="col" className="px-4 py-3">
              Majetok
            </th>
            <th scope="col" className="px-4 py-3">
              Vypožičané
            </th>
            <th scope="col" className="px-4 py-3">
              {variant === 'current' ? 'Do' : 'Vrátené'}
            </th>
            <th scope="col" className="px-4 py-3">
              Stav
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {rows.map((row, idx) => {
            const isOverdue = row.isOverdue && row.status === 'ACTIVE';
            // ADR-0036: pri čiastočnom vrátení má zmysel zobraziť individuálny
            // stav TEJTO položky, nie len celkový stav loanu (PARTIALLY_RETURNED
            // by inak vyzeralo, že aj už vrátené kusy sú stále vonku).
            const statusKey =
              row.status === 'PARTIALLY_RETURNED' && row.itemAlreadyReturned
                ? 'RETURNED'
                : isOverdue
                  ? 'OVERDUE'
                  : row.status;
            const statusConfig = LOAN_STATUS_CONFIG[statusKey] ?? {
              label: row.status,
              className: 'bg-surface-subtle text-text-muted',
            };
            return (
              <tr key={`${row.loanId}-${row.assetId}-${idx}`} className="hover:bg-surface-subtle">
                <td className="px-4 py-3">
                  <Link
                    href={`/assets/${row.assetId}`}
                    className="font-medium text-text-primary underline-offset-2 hover:text-brand-primary hover:underline"
                  >
                    {row.inventoryNumber} · {row.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-text-secondary">{formatLoanDate(row.pickedUpAt)}</td>
                <td className="px-4 py-3 text-text-secondary">
                  {variant === 'current'
                    ? formatLoanDate(row.dueAt)
                    : formatLoanDate(row.returnedAt)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
                      statusConfig.className,
                    )}
                  >
                    {isOverdue ? <Clock aria-hidden="true" className="h-3 w-3" /> : null}
                    {statusConfig.label}
                  </span>
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
// Error + access-denied states
// ---------------------------------------------------------------------------

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

function AccessDenied(): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-10 text-center">
      <ShieldOff aria-hidden="true" className="mx-auto h-8 w-8 text-text-muted" />
      <p className="mt-3 text-sm font-medium text-text-primary">
        Na túto stránku máte prístup iba s rolou Správca majetku alebo Administrátor.
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        Ak túto rolu potrebujete, obráťte sa na existujúceho administrátora svojho tenanta.
      </p>
    </div>
  );
}

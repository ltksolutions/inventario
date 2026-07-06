// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { AlertCircle, ArrowLeft, Clock, Package, ShieldOff } from 'lucide-react';
import Link from 'next/link';

import { CardSkeleton, TableSkeleton } from './Skeleton';

import type { LoanRequestSummary, LoanSummary } from '@/lib/api-hooks';
import type { JSX } from 'react';

import { useCanManagePersons, useLoanRequests, useLoans, useMe, usePerson } from '@/lib/api-hooks';
import { cn } from '@/lib/cn';

/**
 * /persons/[id] — "osobná karta majetku" (2026-07-06).
 *
 * Detail jednej osoby pre správcu majetku / administrátora: kto to je
 * (meno, rola), čo má PRÁVE TERAZ v držaní, aké má čakajúce žiadosti,
 * a čo mala v minulosti (vrátené / poškodené / stratené).
 *
 * Poradie sekcií je zámerné (zadanie 2026-07-06): aktuálny majetok PRVÝ,
 * história AŽ POTOM — správcu najviac zaujíma "čo má táto osoba u seba
 * teraz", história je kontext. Čakajúce žiadosti sú medzi tým (ešte nie
 * je to majetok v držaní, ale je to "na ceste").
 *
 * Dátové zdroje:
 *   - usePerson(id)        → GET /v1/users/directory/:id (meno, rola, stav)
 *   - useLoans({borrowerId}) → GET /v1/loans?borrowerId= (existujúci hook,
 *     rozdelené na aktuálne/historické podľa status na klientovi — rovnaký
 *     vzor ako MyLoansContent)
 *   - useLoanRequests({requesterId, beneficiaryId, status: 'PENDING'}) →
 *     GET /v1/loan-requests s union requester-OR-beneficiary (ADR-0023),
 *     manager-only filter rozšírený práve pre tento use-case (2026-07-06)
 */

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrátor',
  ASSET_MANAGER: 'Správca majetku',
  EMPLOYEE: 'Zamestnanec',
  EXTERNAL: 'Externý',
};

function formatRole(role: string | null): string {
  if (role == null) return '—';
  return ROLE_LABELS[role] ?? role;
}

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

export function PersonDetailContent({ personId }: { personId: string }): JSX.Element {
  const canManage = useCanManagePersons();
  const meQuery = useMe();

  if (meQuery.isLoading) {
    return <CardSkeleton lines={3} />;
  }

  if (!canManage) {
    return <AccessDenied />;
  }

  return <PersonDetailPanel personId={personId} />;
}

function PersonDetailPanel({ personId }: { personId: string }): JSX.Element {
  const personQuery = usePerson(personId);
  const loansQuery = useLoans({ borrowerId: personId, limit: 200 });
  const pendingQuery = useLoanRequests({
    requesterId: personId,
    beneficiaryId: personId,
    status: 'PENDING',
    limit: 50,
  });

  const allLoans = loansQuery.data?.data ?? [];
  const currentLoans = allLoans.filter((loan) => loan.status === 'ACTIVE');
  const historyLoans = allLoans.filter((loan) => loan.status !== 'ACTIVE');
  const pendingRequests = pendingQuery.data?.data ?? [];

  if (personQuery.isLoading) {
    return <CardSkeleton lines={3} />;
  }

  if (personQuery.isError || !personQuery.data) {
    return (
      <div>
        <BackLink />
        <ErrorPanel message="Osobu sa nepodarilo načítať. Skontroluj, či existuje, alebo skús to znova." />
      </div>
    );
  }

  const person = personQuery.data;

  return (
    <div>
      <BackLink />

      <header className="mb-6 flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">{person.displayName}</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {formatRole(person.role)} · {person.email}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full bg-brand-primary/10 px-3 py-1.5 text-sm font-semibold text-brand-primary ring-1 ring-inset ring-brand-primary/20">
            Aktuálne: {currentLoans.length}
          </span>
          <span className="inline-flex items-center rounded-full bg-surface-subtle px-3 py-1.5 text-sm font-semibold text-text-secondary ring-1 ring-inset ring-border-subtle">
            História: {historyLoans.length}
          </span>
          {!person.isActive && (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
              Neaktívny účet
            </span>
          )}
        </div>
      </header>

      {/* Aktuálny majetok — VŽDY PRVÝ (zadanie 2026-07-06) */}
      <section aria-labelledby="current-heading" className="mb-8">
        <h2 id="current-heading" className="mb-3 text-lg font-semibold text-text-primary">
          Aktuálny majetok
        </h2>
        {loansQuery.isLoading ? (
          <TableSkeleton rows={3} columns={5} />
        ) : loansQuery.isError ? (
          <ErrorPanel message="Výpožičky sa nepodarilo načítať." />
        ) : currentLoans.length === 0 ? (
          <EmptyState message="Táto osoba nemá aktuálne v držaní žiadny majetok." />
        ) : (
          <LoansTable loans={currentLoans} />
        )}
      </section>

      {/* Čakajúce žiadosti */}
      {(pendingRequests.length > 0 || pendingQuery.isLoading) && (
        <section aria-labelledby="pending-heading" className="mb-8">
          <h2 id="pending-heading" className="mb-3 text-lg font-semibold text-text-primary">
            Čakajúce žiadosti
          </h2>
          {pendingQuery.isLoading ? (
            <TableSkeleton rows={2} columns={3} />
          ) : (
            <PendingRequestsList requests={pendingRequests} />
          )}
        </section>
      )}

      {/* História — odovzdaný / vyradený majetok */}
      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="mb-3 text-lg font-semibold text-text-primary">
          História (vrátený, poškodený, stratený majetok)
        </h2>
        {loansQuery.isLoading ? (
          <TableSkeleton rows={3} columns={5} />
        ) : loansQuery.isError ? (
          <ErrorPanel message="Výpožičky sa nepodarilo načítať." />
        ) : historyLoans.length === 0 ? (
          <EmptyState message="Táto osoba nemá zatiaľ žiadnu históriu výpožičiek." />
        ) : (
          <LoansTable loans={historyLoans} />
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loans table (current + history — rovnaký vzor ako MyLoansContent)
// ---------------------------------------------------------------------------

function LoansTable({ loans }: { loans: readonly LoanSummary[] }): JSX.Element {
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
              </tr>
            );
          })}
        </tbody>
      </table>
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
      <table className="w-full min-w-[480px] text-sm">
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
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {requests.map((req) => (
            <tr key={req._id} className="hover:bg-surface-subtle">
              <td className="px-4 py-3">
                <div className="flex flex-col gap-0.5">
                  {req.items.map((item, idx) => (
                    <span
                      key={`${item.categoryId}-${idx}`}
                      className="text-sm font-medium text-text-primary"
                    >
                      {item.quantityRequested}× {item.categorySnapshot.name}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3 text-text-secondary">{req.purpose}</td>
              <td className="px-4 py-3 text-xs text-text-secondary">
                {req.plannedTo == null
                  ? `od ${formatDate(req.plannedFrom)} · do odvolania`
                  : `${formatDate(req.plannedFrom)} – ${formatDate(req.plannedTo)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function BackLink(): JSX.Element {
  return (
    <Link
      href="/persons"
      className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-text-secondary hover:text-brand-primary"
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      Späť na zoznam osôb
    </Link>
  );
}

function AccessDenied(): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-10 text-center">
      <ShieldOff aria-hidden="true" className="mx-auto h-8 w-8 text-text-muted" />
      <p className="mt-3 text-sm font-medium text-text-primary">
        Na túto stránku máte prístup iba s rolou Správca majetku alebo Administrátor.
      </p>
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

function EmptyState({ message }: { message: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-8 text-center">
      <Package aria-hidden="true" className="mx-auto h-6 w-6 text-text-muted" />
      <p className="mt-2 text-sm text-text-secondary">{message}</p>
    </div>
  );
}

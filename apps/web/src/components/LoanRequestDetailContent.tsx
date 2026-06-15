// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * LoanRequestDetailContent — detail jednej žiadosti o výpožičku
 * (/loans/request/[id]). Read-only prehľad; akcie (schváliť/zamietnuť/vydať/
 * zrušiť) ostávajú v zozname /loans.
 *
 * Server vracia len ID žiadateľa/beneficiára — meno doplníme z členov org
 * (useMembers), rovnako ako v zozname žiadostí.
 */

import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';

import type { JSX, ReactNode } from 'react';

import { useLoanRequest, useMembers } from '@/lib/api-hooks';
import { cn } from '@/lib/cn';

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
  CLOSED: { label: 'Uzavretá', className: 'bg-surface-subtle text-text-muted ring-border-subtle' },
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

export function LoanRequestDetailContent({ requestId }: { requestId: string }): JSX.Element {
  const query = useLoanRequest(requestId);
  const membersQuery = useMembers();
  const memberName = (id: string | null): string => {
    if (!id) return '—';
    return (membersQuery.data?.data ?? []).find((m) => m._id === id)?.displayName ?? '—';
  };

  const backLink = (
    <Link
      href="/loans"
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-primary hover:underline"
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      Späť na žiadosti
    </Link>
  );

  if (query.isLoading) {
    return (
      <div>
        {backLink}
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          Načítavam žiadosť…
        </div>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div>
        {backLink}
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger-fg bg-danger-bg p-4 text-sm text-danger-fg"
        >
          <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>Žiadosť sa nepodarilo načítať alebo neexistuje.</span>
        </div>
      </div>
    );
  }

  const req = query.data;
  const statusConfig = STATUS_CONFIG[req.status] ?? {
    label: req.status,
    className: 'bg-surface-subtle text-text-muted ring-border-subtle',
  };
  const beneficiaryDiffers = req.beneficiaryId != null && req.beneficiaryId !== req.requesterId;
  const term =
    req.plannedTo == null
      ? `od ${formatDate(req.plannedFrom)} · do odvolania`
      : `${formatDate(req.plannedFrom)} – ${formatDate(req.plannedTo)}`;

  return (
    <div>
      {backLink}

      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Žiadosť o výpožičku</h1>
        <span
          className={cn(
            'inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset',
            statusConfig.className,
          )}
        >
          {statusConfig.label}
        </span>
      </header>

      {/* Metadáta */}
      <dl className="mb-6 grid grid-cols-1 gap-4 rounded-xl border border-border-subtle bg-surface-card p-5 shadow-sm sm:grid-cols-2">
        <Field label="Žiadateľ">{memberName(req.requesterId)}</Field>
        {beneficiaryDiffers && (
          <Field label="Pre koho (beneficiár)">{memberName(req.beneficiaryId)}</Field>
        )}
        <Field label="Účel">{req.purpose}</Field>
        <Field label="Termín">{term}</Field>
        <Field label="Vytvorené">{formatDate(req.createdAt)}</Field>
      </dl>

      {/* Položky */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
          Položky
        </h2>
        <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface-card shadow-sm">
          {req.items.map((item, idx) => {
            const fulfilled = item.quantityFulfilled ?? 0;
            return (
              <li key={`${item.categoryId}-${idx}`} className="flex flex-col gap-0.5 px-4 py-3">
                <span className="text-sm font-medium text-text-primary">
                  {item.quantityRequested}× {item.categorySnapshot.name}
                  {fulfilled > 0 && (
                    <span className="ml-1.5 font-normal text-text-muted">
                      (vydané {fulfilled}/{item.quantityRequested})
                    </span>
                  )}
                </span>
                {item.note && <span className="text-xs text-text-muted">{item.note}</span>}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Dôvod zamietnutia */}
      {req.rejectionReason && (
        <section className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4">
          <h2 className="mb-1 text-sm font-semibold text-red-700">Dôvod zamietnutia</h2>
          <p className="text-sm text-red-700">{req.rejectionReason}</p>
        </section>
      )}

      {/* Vzniknuté výpožičky */}
      {req.resultingLoanIds.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
            Vzniknuté výpožičky
          </h2>
          <div className="flex flex-wrap gap-2">
            {req.resultingLoanIds.map((loanId, idx) => (
              <Link
                key={loanId}
                href={`/loans/${loanId}`}
                className="inline-flex items-center rounded-lg border border-border-default bg-surface-card px-3 py-1.5 text-sm font-medium text-brand-primary hover:bg-surface-subtle"
              >
                Výpožička{req.resultingLoanIds.length > 1 ? ` ${idx + 1}` : ''} →
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="text-xs text-text-muted">
        Akcie (schváliť, zamietnuť, vydať, zrušiť) sú dostupné v{' '}
        <Link href="/loans" className="text-brand-primary hover:underline">
          zozname žiadostí
        </Link>
        .
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-text-primary">{children}</dd>
    </div>
  );
}

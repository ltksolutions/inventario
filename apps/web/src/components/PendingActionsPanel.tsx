// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * PendingActionsPanel — blok „Čaká na vás" na Dashboarde.
 *
 * Akčný prehľad vecí, ktoré má prihlásený používateľ riešiť, s priamymi
 * odkazmi na miesto, kde sa akcia vykoná:
 *
 *   ASSET_MANAGER / ADMIN:
 *     - žiadosti čakajúce na schválenie (PENDING)          → /loans
 *     - schválené žiadosti čakajúce na vydanie (APPROVED,
 *       PARTIALLY_FULFILLED)                               → /loans
 *     - protokoly čakajúce na MÔJ podpis                   → /loans/{loanId}
 *     - ostatné nepodpísané protokoly (čaká druhá strana)  → /protocols
 *     - aktívne výpožičky po termíne                       → /loans/{id}
 *
 *   EMPLOYEE:
 *     - protokoly čakajúce na môj podpis                   → /loans/{loanId}
 *     - moje výpožičky po termíne                          → /loans/{id}
 *     - moje čakajúce žiadosti (informačné)                → /my-loans
 *
 * Žiadne nové API — skladá existujúce endpointy (loan-requests, loans,
 * protocols); backend pre EMPLOYEE sám obmedzí dáta na vlastné.
 * Limit 5 položiek na skupinu + „+N ďalších" odkaz.
 */

import {
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  FileSignature,
  PackageCheck,
} from 'lucide-react';
import Link from 'next/link';

import type { LoanProtocolSummary, LoanRequestSummary, LoanSummary } from '@/lib/api-hooks';
import type { JSX, ReactNode } from 'react';

import { useCanManageLoans, useDashboardSummary, useMe } from '@/lib/api-hooks';

const MAX_ITEMS_PER_GROUP = 5;

const PROTOCOL_TYPE_LABEL: Record<string, string> = {
  HANDOVER: 'Preberací protokol',
  RETURN: 'Protokol o vrátení',
  AMENDMENT: 'Dodatok',
};

function formatDate(iso: string | null): string {
  if (iso == null) return 'do odvolania';
  return new Date(iso).toLocaleDateString('sk-SK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function requestItemsLabel(request: LoanRequestSummary): string {
  const parts = request.items.map((i) => `${i.quantityRequested}× ${i.categorySnapshot.name}`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PendingActionsPanel(): JSX.Element | null {
  const me = useMe();
  const canManage = useCanManageLoans();
  const myId = me.data?._id ?? '';

  // Jeden agregovaný request namiesto ~5 samostatných. Backend rieši RBAC:
  // žiadosti/výpožičky cez loansService (EMPLOYEE len vlastné), protokoly
  // cez participantUserId pravidlo.
  const summary = useDashboardSummary();

  const isLoading = me.isLoading || summary.isLoading;

  // ── Odvodené skupiny ──────────────────────────────────────────────────────

  const pending = summary.data?.loanRequests.pending.data ?? [];
  const toFulfil = [
    ...(summary.data?.loanRequests.approved.data ?? []),
    ...(summary.data?.loanRequests.partiallyFulfilled.data ?? []),
  ];

  const drafts = summary.data?.protocols.draft.data ?? [];
  /** Protokoly, kde je prihlásený používateľ nepodpísanou stranou. */
  const myUnsignedProtocols = drafts.filter(
    (p) =>
      (p.parties.handover.userId === myId && !p.signatures.handover) ||
      (p.parties.receive.userId === myId && !p.signatures.receive),
  );
  /** Zvyšné DRAFT protokoly — čaká sa na podpis niekoho iného (len manager). */
  const otherUnsignedCount = drafts.length - myUnsignedProtocols.length;

  const overdueLoans = (summary.data?.loans.active.data ?? []).filter((l) => l.isOverdue);

  const totalCount =
    pending.length +
    (canManage ? toFulfil.length : 0) +
    myUnsignedProtocols.length +
    overdueLoans.length;

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <section aria-labelledby="pending-actions-heading" className="mb-10">
        <h2 id="pending-actions-heading" className="sr-only">
          Čaká na vás
        </h2>
        <div
          aria-busy="true"
          aria-label="Načítavam čakajúce aktivity"
          className="h-24 animate-pulse rounded-xl border border-border-subtle bg-surface-card"
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="pending-actions-heading" className="mb-10">
      <div className="rounded-xl border border-border-subtle bg-surface-card shadow-md">
        <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-6 py-4">
          <h2 id="pending-actions-heading" className="text-lg font-semibold text-text-primary">
            Čaká na vás
          </h2>
          {totalCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
              {totalCount} {totalCount === 1 ? 'položka' : totalCount < 5 ? 'položky' : 'položiek'}
            </span>
          )}
        </div>

        {totalCount === 0 && otherUnsignedCount <= 0 ? (
          <div className="flex items-center gap-3 px-6 py-6">
            <CheckCircle2 aria-hidden="true" className="h-6 w-6 shrink-0 text-green-600" />
            <div>
              <p className="text-sm font-medium text-text-primary">Všetko vybavené.</p>
              <p className="text-sm text-text-secondary">
                Žiadne žiadosti, podpisy ani výpožičky po termíne nečakajú na vašu akciu.
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {/* Žiadosti na schválenie / moje čakajúce žiadosti */}
            {pending.length > 0 && (
              <ActionGroup
                icon={<ClipboardCheck aria-hidden="true" className="h-4 w-4" />}
                title={
                  canManage
                    ? `Žiadosti čakajúce na schválenie (${pending.length})`
                    : `Vaše žiadosti čakajúce na schválenie (${pending.length})`
                }
                moreHref={canManage ? '/loans' : '/my-loans'}
                moreCount={pending.length - MAX_ITEMS_PER_GROUP}
              >
                {pending.slice(0, MAX_ITEMS_PER_GROUP).map((req) => (
                  <ActionRow
                    key={req._id}
                    href={canManage ? '/loans' : '/my-loans'}
                    primary={requestItemsLabel(req)}
                    secondary={req.purpose}
                    cta={canManage ? 'Schváliť' : 'Zobraziť'}
                  />
                ))}
              </ActionGroup>
            )}

            {/* Schválené žiadosti na vydanie (len manager má akciu) */}
            {canManage && toFulfil.length > 0 && (
              <ActionGroup
                icon={<PackageCheck aria-hidden="true" className="h-4 w-4" />}
                title={`Schválené žiadosti čakajúce na vydanie (${toFulfil.length})`}
                moreHref="/loans"
                moreCount={toFulfil.length - MAX_ITEMS_PER_GROUP}
              >
                {toFulfil.slice(0, MAX_ITEMS_PER_GROUP).map((req) => (
                  <ActionRow
                    key={req._id}
                    href="/loans"
                    primary={requestItemsLabel(req)}
                    secondary={req.purpose}
                    cta="Vydať"
                  />
                ))}
              </ActionGroup>
            )}

            {/* Protokoly na môj podpis */}
            {myUnsignedProtocols.length > 0 && (
              <ActionGroup
                icon={<FileSignature aria-hidden="true" className="h-4 w-4" />}
                title={`Protokoly čakajúce na váš podpis (${myUnsignedProtocols.length})`}
                moreHref="/protocols"
                moreCount={myUnsignedProtocols.length - MAX_ITEMS_PER_GROUP}
              >
                {myUnsignedProtocols.slice(0, MAX_ITEMS_PER_GROUP).map((p) => (
                  <ActionRow
                    key={p._id}
                    href={`/loans/${p.loanId}`}
                    primary={`${PROTOCOL_TYPE_LABEL[p.type] ?? p.type} ${p.protocolNumber}`}
                    secondary={protocolCounterpartyLabel(p, myId)}
                    cta="Podpísať"
                  />
                ))}
              </ActionGroup>
            )}

            {/* Výpožičky po termíne */}
            {overdueLoans.length > 0 && (
              <ActionGroup
                icon={<Clock aria-hidden="true" className="h-4 w-4" />}
                title={
                  canManage
                    ? `Výpožičky po termíne (${overdueLoans.length})`
                    : `Vaše výpožičky po termíne (${overdueLoans.length})`
                }
                tone="danger"
                moreHref="/loans"
                moreCount={overdueLoans.length - MAX_ITEMS_PER_GROUP}
              >
                {overdueLoans.slice(0, MAX_ITEMS_PER_GROUP).map((loan) => (
                  <ActionRow
                    key={loan._id}
                    href={`/loans/${loan._id}`}
                    primary={loanItemsLabel(loan)}
                    secondary={`${loan.borrowerDisplayName ?? 'Neznámy'} · termín ${formatDate(loan.dueAt)}`}
                    cta="Riešiť"
                    tone="danger"
                  />
                ))}
              </ActionGroup>
            )}

            {/* Manager: nepodpísané protokoly čakajúce na druhú stranu (info) */}
            {canManage && otherUnsignedCount > 0 && (
              <div className="px-6 py-3">
                <Link
                  href="/protocols"
                  className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary underline-offset-2 transition hover:text-text-primary hover:underline"
                >
                  Ďalšie nepodpísané protokoly čakajúce na druhú stranu: {otherUnsignedCount}
                  <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loanItemsLabel(loan: LoanSummary): string {
  return loan.items.map((i) => `${i.snapshot.inventoryNumber} ${i.snapshot.name}`).join(', ');
}

/** „Druhá strana" protokolu z pohľadu prihláseného používateľa. */
function protocolCounterpartyLabel(p: LoanProtocolSummary, myId: string): string {
  const other = p.parties.handover.userId === myId ? p.parties.receive : p.parties.handover;
  const name = other.snapshot.displayName || other.snapshot.email;
  return name && other.userId !== myId ? `s ${name}` : `vystavený ${formatDate(p.issuedAt)}`;
}

// ---------------------------------------------------------------------------
// UI pieces
// ---------------------------------------------------------------------------

function ActionGroup({
  icon,
  title,
  tone,
  children,
  moreHref,
  moreCount,
}: {
  icon: ReactNode;
  title: string;
  tone?: 'danger' | undefined;
  children: ReactNode;
  moreHref: string;
  moreCount: number;
}): JSX.Element {
  return (
    <div className="px-6 py-4">
      <h3
        className={`mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${
          tone === 'danger' ? 'text-red-600' : 'text-text-muted'
        }`}
      >
        {icon}
        {title}
      </h3>
      <ul className="flex flex-col gap-1">{children}</ul>
      {moreCount > 0 && (
        <Link
          href={moreHref}
          className="mt-2 inline-flex items-center gap-0.5 text-xs font-medium text-brand-primary underline-offset-2 hover:underline"
        >
          +{moreCount} ďalších
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

function ActionRow({
  href,
  primary,
  secondary,
  cta,
  tone,
}: {
  href: string;
  primary: string;
  secondary: string;
  cta: string;
  tone?: 'danger' | undefined;
}): JSX.Element {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition hover:bg-surface-subtle"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-text-primary">{primary}</span>
          <span className="block truncate text-xs text-text-secondary">{secondary}</span>
        </span>
        <span
          className={`inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold ${
            tone === 'danger' ? 'text-red-600' : 'text-brand-primary'
          }`}
        >
          {cta}
          <ChevronRight
            aria-hidden="true"
            className="h-3.5 w-3.5 transition group-hover:translate-x-0.5"
          />
        </span>
      </Link>
    </li>
  );
}

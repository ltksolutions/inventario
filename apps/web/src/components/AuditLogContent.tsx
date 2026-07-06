// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { History, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { DateField } from './DateField';
import { SelectField } from './SelectField';
import { TableSkeleton } from './Skeleton';

import type { AuditLogEntry } from '@/lib/api-hooks';
import type { JSX } from 'react';

import { useAuditLog, useCanViewAuditLog, usePersonsDirectory } from '@/lib/api-hooks';
import {
  auditActionLabel,
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_TYPE_LABELS,
  auditEntityTypeLabel,
  auditSeverityLabel,
} from '@/lib/audit-labels';
import { cn } from '@/lib/cn';

/**
 * /audit-log — kompletný, prehľadávateľný audit log aktívneho tenanta
 * (2026-07-07).
 *
 * Na rozdiel od `AuditLogTab` na detaile majetku (história jedného
 * konkrétneho majetku) toto je tenant-wide pohľad naprieč všetkými
 * typmi entít — kto, kedy a čo v systéme urobil. Filtre: akcia, typ
 * entity, osoba (aktér), dátumový rozsah. Zatiaľ len prehľadávanie
 * (žiadny CSV export — Janika to pre v1 nevybrala).
 *
 * RBAC: `useCanViewAuditLog()` (ASSET_MANAGER + ADMIN) — rozhodnutie
 * Janiky, pôvodne plánované len pre ADMIN. Sidebar link je viditeľný
 * podľa AppShellu (`managerOnly`), ale stránka renderuje zreteľný
 * "no permission" stav pre priamu navigáciu (rovnaký vzor ako
 * PersonsContent/UsersContent).
 */

const ACTION_OPTIONS = [
  { value: '', label: 'Všetky akcie' },
  ...Object.entries(AUDIT_ACTION_LABELS)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'sk')),
];

const ENTITY_TYPE_OPTIONS = [
  { value: '', label: 'Všetky entity' },
  ...Object.entries(AUDIT_ENTITY_TYPE_LABELS)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'sk')),
];

type PageSize = 20 | 50 | 100;
const PAGE_SIZES: readonly PageSize[] = [20, 50, 100];

export function AuditLogContent(): JSX.Element {
  const canView = useCanViewAuditLog();

  if (!canView) {
    return <AccessDenied />;
  }

  return <AuditLogPanel />;
}

function AuditLogPanel(): JSX.Element {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [actorUserId, setActorUserId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    setPage(1);
  }, [pageSize, action, entityType, actorUserId, dateFrom, dateTo]);

  // Zoznam osôb pre filter "Osoba" — rovnaký directory endpoint ako
  // modul Osoby (ASSET_MANAGER+ prístupný, minimálny profil).
  const personsQuery = usePersonsDirectory({ limit: 200 });
  const actorOptions = [
    { value: '', label: 'Všetky osoby' },
    ...(personsQuery.data?.data ?? [])
      .map((p) => ({ value: p._id, label: p.displayName }))
      .sort((a, b) => a.label.localeCompare(b.label, 'sk')),
  ];

  const auditQuery = useAuditLog({
    limit: pageSize,
    skip: (page - 1) * pageSize,
    action: action || undefined,
    entityType: entityType || undefined,
    actorUserId: actorUserId || undefined,
    // DateField pracuje s dátumom bez času ('YYYY-MM-DD') — backend
    // vyžaduje plný ISO 8601 timestamp, takže na hranici filtra
    // doplníme začiatok/koniec dňa (dateTo je INCLUSIVE celého dňa).
    dateFrom: dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined,
    dateTo: dateTo ? `${dateTo}T23:59:59.999Z` : undefined,
  });

  const entries = auditQuery.data?.data ?? [];
  const total = auditQuery.data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasActiveFilter =
    action !== '' || entityType !== '' || actorUserId !== '' || dateFrom !== '' || dateTo !== '';

  return (
    <div>
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Audit log</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Kto, kedy a čo v systéme zmenil — kompletný záznam auditu aktívnej organizácie.
          </p>
        </div>
      </header>

      <section
        aria-label="Filtre"
        className="mb-4 grid gap-3 rounded-xl border border-border-subtle bg-surface-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
      >
        <SelectField label="Akcia" value={action} onChange={setAction} options={ACTION_OPTIONS} />
        <SelectField
          label="Typ entity"
          value={entityType}
          onChange={setEntityType}
          options={ENTITY_TYPE_OPTIONS}
        />
        <SelectField
          label="Osoba"
          value={actorUserId}
          onChange={setActorUserId}
          options={actorOptions}
        />
        <DateField
          label="Od"
          value={dateFrom}
          onChange={setDateFrom}
          {...(dateTo ? { max: dateTo } : {})}
        />
        <DateField
          label="Do"
          value={dateTo}
          onChange={setDateTo}
          {...(dateFrom ? { min: dateFrom } : {})}
        />
      </section>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-text-secondary" aria-live="polite">
          {auditQuery.isLoading ? (
            'Načítavam audit log…'
          ) : auditQuery.isError ? (
            <span className="text-danger-fg">Audit log sa nepodarilo načítať.</span>
          ) : hasActiveFilter ? (
            <>
              Nájdených <strong>{total.toLocaleString('sk-SK')}</strong> záznamov filtrom.
            </>
          ) : (
            <>
              Strana <strong>{page}</strong> z {totalPages} (celkom {total.toLocaleString('sk-SK')}{' '}
              záznamov).
            </>
          )}
        </p>
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <span className="font-medium">Veľkosť strany</span>
          <SelectField
            label="Veľkosť strany"
            value={String(pageSize)}
            onChange={(v) => setPageSize(Number(v) as PageSize)}
            options={PAGE_SIZES.map((s) => ({ value: String(s), label: String(s) }))}
            className="w-24"
          />
        </div>
      </div>

      {auditQuery.isLoading ? (
        <TableSkeleton rows={Math.min(pageSize, 8)} columns={5} />
      ) : auditQuery.isError ? (
        <ErrorPanel message="Audit log sa nepodarilo načítať. Skontroluj pripojenie a skús to znova." />
      ) : entries.length === 0 ? (
        <EmptyState hasFilter={hasActiveFilter} />
      ) : (
        <AuditLogTable entries={entries} />
      )}

      {!auditQuery.isLoading && !auditQuery.isError && total > pageSize && (
        <div className="mt-4 flex items-center justify-between text-sm text-text-secondary">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-border-default bg-surface-card px-3 py-1.5 font-medium disabled:opacity-50"
          >
            Predchádzajúca
          </button>
          <span>
            Strana {page} z {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-border-default bg-surface-card px-3 py-1.5 font-medium disabled:opacity-50"
          >
            Ďalšia
          </button>
        </div>
      )}
    </div>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('sk-SK', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SeverityBadge({ severity }: { severity: string }): JSX.Element {
  const styles: Record<string, string> = {
    INFO: 'bg-surface-subtle text-text-secondary ring-border-subtle',
    WARNING: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    ERROR: 'bg-danger-bg text-danger-fg ring-danger-fg/20',
    CRITICAL: 'bg-danger-bg text-danger-fg ring-danger-fg/20',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset',
        styles[severity] ?? styles['INFO'],
      )}
    >
      {auditSeverityLabel(severity)}
    </span>
  );
}

function AuditLogTable({ entries }: { entries: readonly AuditLogEntry[] }): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="border-b border-border-subtle bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
          <tr>
            <th scope="col" className="px-4 py-3">
              Dátum a čas
            </th>
            <th scope="col" className="px-4 py-3">
              Osoba
            </th>
            <th scope="col" className="px-4 py-3">
              Akcia
            </th>
            <th scope="col" className="px-4 py-3">
              Entita
            </th>
            <th scope="col" className="px-4 py-3">
              Popis
            </th>
            <th scope="col" className="px-4 py-3">
              Závažnosť
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {entries.map((entry) => (
            <tr key={entry.id} className="hover:bg-surface-subtle">
              <td className="whitespace-nowrap px-4 py-3 text-text-secondary">
                {formatDateTime(entry.at)}
              </td>
              <td className="px-4 py-3 font-medium text-text-primary">{entry.actor.displayName}</td>
              <td className="px-4 py-3 text-text-primary">{auditActionLabel(entry.action)}</td>
              <td className="px-4 py-3 text-text-secondary">
                {entry.target ? (
                  entry.target.entityType === 'Asset' && entry.target.entityId ? (
                    <Link
                      href={`/assets/${entry.target.entityId}`}
                      className="underline-offset-2 hover:text-brand-primary hover:underline"
                    >
                      {auditEntityTypeLabel(entry.target.entityType)}
                    </Link>
                  ) : (
                    auditEntityTypeLabel(entry.target.entityType)
                  )
                ) : (
                  <span className="text-text-muted">—</span>
                )}
              </td>
              <td className="max-w-[320px] px-4 py-3 text-text-secondary">{entry.description}</td>
              <td className="px-4 py-3">
                <SeverityBadge severity={entry.severity} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ hasFilter }: { hasFilter: boolean }): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-10 text-center">
      <History aria-hidden="true" className="mx-auto h-8 w-8 text-text-muted" />
      <p className="mt-3 text-sm font-medium text-text-primary">
        {hasFilter ? 'Žiadne záznamy nezodpovedajú filtru.' : 'Zatiaľ žiadne záznamy auditu.'}
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
        Ak túto rolu potrebujete, obráťte sa na administrátora svojho tenanta.
      </p>
    </div>
  );
}

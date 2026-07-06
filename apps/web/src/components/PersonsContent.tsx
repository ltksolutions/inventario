// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { Eye, Search, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { SelectField } from './SelectField';
import { CardSkeleton, TableSkeleton } from './Skeleton';

import type { PersonSummary } from '@/lib/api-hooks';
import type { JSX } from 'react';

import { useCanManagePersons, useMe, usePersonsDirectory } from '@/lib/api-hooks';

/**
 * /persons — "Osoby" module (2026-07-06).
 *
 * Zoznam osôb (zamestnancov aj externých) pre správcu majetku a
 * administrátora. Klik na riadok vedie na "osobnú kartu majetku"
 * (/persons/[id]) — detail s aktuálnym aj historickým majetkom danej
 * osoby.
 *
 * Zámerne oddelené od /users (admin-only, plný User profil vrátane
 * MFA/audit polí): tento modul je pre ASSET_MANAGER + ADMIN a zobrazuje
 * len minimálne polia (meno, rola, aktivita) potrebné na identifikáciu
 * osoby — backend endpoint GET /v1/users/directory rovnako obmedzuje
 * response shape (viď users.routes.ts).
 *
 * RBAC: gate podľa useCanManagePersons() (ASSET_MANAGER+). Rovnaký
 * vzor ako UsersContent — sidebar link je viditeľný podľa AppShellu,
 * ale samotná stránka renderuje zreteľný "no permission" stav pre
 * priamu navigáciu.
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

type PageSize = 20 | 50 | 100;
const PAGE_SIZES: readonly PageSize[] = [20, 50, 100];

export function PersonsContent(): JSX.Element {
  const canManage = useCanManagePersons();
  const meQuery = useMe();

  if (meQuery.isLoading) {
    return <CardSkeleton lines={2} />;
  }

  if (!canManage) {
    return <AccessDenied />;
  }

  return <PersonsPanel />;
}

function PersonsPanel(): JSX.Element {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, pageSize]);

  const personsQuery = usePersonsDirectory({
    limit: pageSize,
    skip: (page - 1) * pageSize,
    q: debouncedSearch || undefined,
  });

  const persons = personsQuery.data?.data ?? [];
  const total = personsQuery.data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasActiveFilter = debouncedSearch !== '';

  return (
    <div>
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Osoby</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Prehľad osôb a ich majetku — aktuálne aj historicky vypožičané položky.
          </p>
        </div>
      </header>

      <section
        aria-label="Filtre"
        className="mb-4 grid gap-3 rounded-xl border border-border-subtle bg-surface-card p-4 shadow-sm sm:grid-cols-[1fr_auto]"
      >
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          <span className="font-medium">Hľadať</span>
          <span className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="E-mail alebo meno"
              className="w-full rounded-lg border border-border-default bg-surface-card py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            />
          </span>
        </label>

        <div className="flex flex-col gap-1 text-sm text-text-secondary">
          <span className="font-medium">Veľkosť strany</span>
          <SelectField
            label="Veľkosť strany"
            value={String(pageSize)}
            onChange={(v) => setPageSize(Number(v) as PageSize)}
            options={PAGE_SIZES.map((s) => ({ value: String(s), label: String(s) }))}
            className="w-24"
          />
        </div>
      </section>

      <p className="mb-3 text-sm text-text-secondary" aria-live="polite">
        {personsQuery.isLoading ? (
          'Načítavam osoby…'
        ) : personsQuery.isError ? (
          <span className="text-danger-fg">Osoby sa nepodarilo načítať.</span>
        ) : hasActiveFilter ? (
          <>
            Nájdených <strong>{total.toLocaleString('sk-SK')}</strong> osôb filtrom.
          </>
        ) : (
          <>
            Strana <strong>{page}</strong> z {totalPages} (celkom {total.toLocaleString('sk-SK')}{' '}
            osôb).
          </>
        )}
      </p>

      {personsQuery.isLoading ? (
        <TableSkeleton rows={Math.min(pageSize, 8)} columns={4} />
      ) : personsQuery.isError ? (
        <ErrorPanel message="Osoby sa nepodarilo načítať. Skontroluj pripojenie a skús to znova." />
      ) : persons.length === 0 ? (
        <EmptyState hasFilter={hasActiveFilter} />
      ) : (
        <PersonsTable persons={persons} />
      )}

      {!personsQuery.isLoading && !personsQuery.isError && total > pageSize && (
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

function PersonsTable({ persons }: { persons: readonly PersonSummary[] }): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
      <table className="w-full min-w-[540px] text-sm">
        <thead className="border-b border-border-subtle bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
          <tr>
            <th scope="col" className="px-4 py-3">
              Meno
            </th>
            <th scope="col" className="px-4 py-3">
              Rola
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
          {persons.map((person) => (
            <tr key={person._id} className="hover:bg-surface-subtle">
              <td className="px-4 py-3">
                <Link
                  href={`/persons/${person._id}`}
                  className="font-medium text-text-primary underline-offset-2 hover:text-brand-primary hover:underline"
                >
                  {person.displayName}
                </Link>
                <div className="text-xs text-text-muted">{person.email}</div>
              </td>
              <td className="px-4 py-3 text-text-secondary">{formatRole(person.role)}</td>
              <td className="px-4 py-3">
                {person.isActive ? (
                  <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                    Aktívny
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-surface-subtle px-2 py-1 text-xs font-medium text-text-muted ring-1 ring-inset ring-border-subtle">
                    Neaktívny
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/persons/${person._id}`}
                  aria-label={`Osobná karta majetku — ${person.displayName}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-border-default bg-surface-card px-2.5 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-surface-subtle"
                >
                  <Eye aria-hidden="true" className="h-3.5 w-3.5" />
                  Detail
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

function EmptyState({ hasFilter }: { hasFilter: boolean }): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-10 text-center">
      <p className="text-sm font-medium text-text-primary">
        {hasFilter ? 'Žiadna osoba nezodpovedá filtru.' : 'Zatiaľ tu nie sú žiadne osoby.'}
      </p>
    </div>
  );
}

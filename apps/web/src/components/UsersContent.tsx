// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { USER_ROLE_VALUES } from '@inventario/shared-types';
import { CheckCircle2, Pencil, Search, ShieldOff, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { SelectField } from './SelectField';
import { CardSkeleton, TableSkeleton } from './Skeleton';
import { UserEditDialog } from './UserEditDialog';

import type { UserSummary } from '@/lib/api-hooks';
import type { JSX } from 'react';

import { useCanAdminUsers, useMe, useUsers } from '@/lib/api-hooks';

/**
 * Users admin list page.
 *
 * Differs structurally from CategoriesContent / LocationsContent
 * because user management is edit-driven, not create-driven:
 *   - No "+ Pridať" button — users vznikajú JIT pri prvom Entra
 *     login (slice #2), nie ručne v UI.
 *   - Edit modal is the primary action (per-row "Upraviť"),
 *     not delete. Soft-delete sa robí cez `isActive: false` v PATCH.
 *   - Server-side filters: backend supports role, isActive a q.
 *     This is the first list page that filters on the server (vs
 *     /assets which filters the visible page client-side), so the
 *     "X z Y" result line reads global counts, not page counts.
 *
 * RBAC: whole route is ADMIN-only. The component renders an access
 * denied state for non-ADMIN users that still navigate here directly
 * (the sidebar link is visible to everyone — gating the link too
 * would create confusing dead-ends; better to land on a clear "no
 * permission" page than to silently hide the menu item).
 *
 * Search debounce:
 *   The free-text search input fires a request 300ms after the user
 *   stops typing. Without debounce the backend would see one request
 *   per keystroke. 300ms is a comfortable trade-off between snappy
 *   feedback and avoiding noise during fast typing.
 */

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrátor',
  ASSET_MANAGER: 'Správca majetku',
  TEAM_MANAGER: 'Vedúci tímu',
  EMPLOYEE: 'Zamestnanec',
  EXTERNAL: 'Externý',
};

type ActiveFilter = 'all' | 'active' | 'inactive';

type PageSize = 20 | 50 | 100;
const PAGE_SIZES: readonly PageSize[] = [20, 50, 100];

export function UsersContent(): JSX.Element {
  const canAdmin = useCanAdminUsers();
  const meQuery = useMe();

  if (meQuery.isLoading) {
    return <CardSkeleton lines={2} />;
  }

  // Render the access-denied state before mounting any of the admin
  // hooks below. The /v1/users endpoint returns 403 to non-ADMINs,
  // and firing the query unconditionally would only generate noise
  // in the backend log + a useless network round-trip.
  if (!canAdmin) {
    return <AccessDenied />;
  }

  // me.data is guaranteed defined here — if canAdmin is true we got
  // a non-empty roles array, which means the /v1/me query resolved.
  // Pass the current user's ID down so the edit dialog can apply
  // pre-emptive self-guardrails.
  const currentUserId = meQuery.data?._id ?? null;
  return <UsersAdminPanel currentUserId={currentUserId} />;
}

// ---------------------------------------------------------------------------
// Admin panel
// ---------------------------------------------------------------------------

function UsersAdminPanel({ currentUserId }: { currentUserId: string | null }): JSX.Element {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [editTarget, setEditTarget] = useState<UserSummary | null>(null);

  // 300ms debounce on the search input. The effect rebinds whenever
  // searchInput changes; the cleanup cancels the previous timer so
  // only the last keystroke wins.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Reset to page 1 whenever a filter or the debounced search
  // changes — paging into "page 5 of role=ADMIN" and then switching
  // to role=EMPLOYEE shouldn't strand the user on page 5 of nothing.
  useEffect(() => {
    setPage(1);
  }, [roleFilter, activeFilter, debouncedSearch, pageSize]);

  const usersQuery = useUsers({
    limit: pageSize,
    skip: (page - 1) * pageSize,
    role: roleFilter || undefined,
    isActive: activeFilter === 'all' ? undefined : activeFilter === 'active',
    q: debouncedSearch || undefined,
  });

  const users = usersQuery.data?.data ?? [];
  const total = usersQuery.data?.pagination.total ?? 0;
  const hasMore = usersQuery.data?.pagination.hasMore ?? false;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasActiveFilter = roleFilter !== '' || activeFilter !== 'all' || debouncedSearch !== '';

  return (
    <div>
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Používatelia</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Správa rolí a aktívnosti pre používateľov tenanta. Účty sa vytvárajú automaticky pri
            prvom prihlásení cez Microsoft.
          </p>
        </div>
      </header>

      <section
        aria-label="Filtre"
        className="mb-4 grid gap-3 rounded-xl border border-border-subtle bg-surface-card p-4 shadow-sm sm:grid-cols-[1fr_auto_auto_auto]"
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
          <span className="font-medium">Rola</span>
          <SelectField
            label="Rola"
            value={roleFilter}
            onChange={setRoleFilter}
            options={[
              { value: '', label: 'Všetky roly' },
              ...USER_ROLE_VALUES.map((r) => ({ value: r, label: ROLE_LABELS[r] ?? r })),
            ]}
            className="w-44"
          />
        </div>

        <div className="flex flex-col gap-1 text-sm text-text-secondary">
          <span className="font-medium">Stav</span>
          <SelectField
            label="Stav"
            value={activeFilter}
            onChange={(v) => setActiveFilter(v as ActiveFilter)}
            options={[
              { value: 'all', label: 'Všetci' },
              { value: 'active', label: 'Iba aktívni' },
              { value: 'inactive', label: 'Iba deaktivovaní' },
            ]}
            className="w-44"
          />
        </div>

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
        {usersQuery.isLoading ? (
          'Načítavam používateľov…'
        ) : usersQuery.isError ? (
          <span className="text-danger-fg">Používateľov sa nepodarilo načítať.</span>
        ) : hasActiveFilter ? (
          <>
            Nájdených <strong>{total.toLocaleString('sk-SK')}</strong> používateľov filtrom.
          </>
        ) : (
          <>
            Strana <strong>{page}</strong> z {totalPages} (celkom {total.toLocaleString('sk-SK')}{' '}
            používateľov).
          </>
        )}
      </p>

      {usersQuery.isLoading ? (
        <TableSkeleton rows={Math.min(pageSize, 8)} columns={6} />
      ) : usersQuery.isError ? (
        <ErrorPanel message="Používateľov sa nepodarilo načítať. Skontroluj pripojenie a skús to znova." />
      ) : users.length === 0 ? (
        <EmptyState hasActiveFilter={hasActiveFilter} />
      ) : (
        <UsersTable
          users={users}
          currentUserId={currentUserId}
          onEdit={(user) => setEditTarget(user)}
        />
      )}

      <nav
        aria-label="Stránkovanie"
        className="mt-4 flex items-center justify-between gap-3 text-sm"
      >
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1 || usersQuery.isLoading}
          className="rounded-lg border border-border-default bg-surface-card px-3 py-2 font-medium text-text-primary transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus sm:px-4"
        >
          <span aria-hidden="true">←</span>
          <span className="sr-only sm:not-sr-only sm:ml-1">Predchádzajúca</span>
        </button>
        <span className="text-text-secondary">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => setPage((p) => p + 1)}
          disabled={!hasMore || usersQuery.isLoading}
          className="rounded-lg border border-border-default bg-surface-card px-3 py-2 font-medium text-text-primary transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus sm:px-4"
        >
          <span className="sr-only sm:not-sr-only sm:mr-1">Ďalšia</span>
          <span aria-hidden="true">→</span>
        </button>
      </nav>

      {editTarget ? (
        <UserEditDialog
          userId={editTarget._id}
          isSelf={editTarget._id === currentUserId}
          onClose={() => setEditTarget(null)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

interface UsersTableProps {
  users: readonly UserSummary[];
  currentUserId: string | null;
  onEdit: (user: UserSummary) => void;
}

function UsersTable({ users, currentUserId, onEdit }: UsersTableProps): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-border-subtle bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
          <tr>
            <th scope="col" className="px-4 py-3">
              Meno
            </th>
            <th scope="col" className="px-4 py-3">
              E-mail
            </th>
            <th scope="col" className="px-4 py-3">
              Roly
            </th>
            <th scope="col" className="px-4 py-3">
              Stav
            </th>
            <th scope="col" className="px-4 py-3">
              Posledné prihlásenie
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              <span className="sr-only">Akcie</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {users.map((user) => {
            const isSelf = currentUserId !== null && user._id === currentUserId;
            const isInactive = user.isActive === false;
            return (
              <tr key={user._id} className={isInactive ? 'opacity-60' : 'hover:bg-surface-subtle'}>
                <td className="px-4 py-3 font-medium text-text-primary">
                  {user.displayName}
                  {isSelf ? (
                    <span className="ml-2 rounded-full bg-info-bg px-2 py-0.5 text-xs font-normal text-info-fg">
                      Vy
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-text-secondary">{user.email}</td>
                <td className="px-4 py-3">
                  <ul className="flex flex-wrap gap-1">
                    {/* Defensive ?? [] — legacy users can have roles missing/null */}
                    {(user.roles ?? []).map((role) => (
                      <li
                        key={role}
                        className="rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-medium text-text-secondary"
                      >
                        {ROLE_LABELS[role] ?? role}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-4 py-3">
                  {isInactive ? (
                    <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                      <XCircle aria-hidden="true" className="h-3.5 w-3.5" />
                      Deaktivovaný
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-success-fg">
                      <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
                      Aktívny
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-text-muted">
                  {user.lastLoginAt ? (
                    new Date(user.lastLoginAt).toLocaleDateString('sk-SK', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })
                  ) : (
                    // ADR-0034: predpripravený člen (pridaný cez „Pridať budúceho
                    // používateľa“ na stránke Pozvánky) nikdy neprihlásený — lastLoginAt
                    // je null až do jeho prvého SSO prihlásenia.
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning-fg">
                      Očakáva nástup
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onEdit(user)}
                    aria-label={`Upraviť používateľa ${user.displayName}`}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-default bg-surface-card px-3 py-1.5 text-xs font-medium text-text-primary transition hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                  >
                    <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                    Upraviť
                  </button>
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
// Error + empty + access-denied states
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

function EmptyState({ hasActiveFilter }: { hasActiveFilter: boolean }): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-10 text-center">
      <p className="text-sm font-medium text-text-primary">
        {hasActiveFilter
          ? 'Žiadni používatelia nezodpovedajú filtru.'
          : 'V tomto tenante zatiaľ nie sú žiadni používatelia.'}
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        {hasActiveFilter
          ? 'Skúste vyčistiť hľadanie alebo zmeniť filter.'
          : 'Používatelia sa vytvoria automaticky pri prvom prihlásení cez Microsoft.'}
      </p>
    </div>
  );
}

function AccessDenied(): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-10 text-center">
      <ShieldOff aria-hidden="true" className="mx-auto h-8 w-8 text-text-muted" />
      <p className="mt-3 text-sm font-medium text-text-primary">
        Na túto stránku máte prístup iba s rolou Administrátor.
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        Ak túto rolu potrebujete, obráťte sa na existujúceho administrátora svojho tenanta.
      </p>
    </div>
  );
}

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { LocationCreateDialog } from './LocationCreateDialog';

import type { LocationSummary } from '@/lib/api-hooks';
import type { JSX } from 'react';

import {
  useCanDeleteTaxonomy,
  useCanManageTaxonomy,
  useDeleteLocation,
  useLocations,
} from '@/lib/api-hooks';

/**
 * Locations admin list page.
 *
 * Mirrors `CategoriesContent` precisely — same backend contract
 * (slug + hierarchy + soft-delete + FK protection), same RBAC matrix
 * (read for all, write for ASSET_MANAGER+ADMIN, delete for ADMIN
 * only), same reusable ConfirmDeleteDialog wiring.
 *
 * Differences from categories:
 *   - The discriminator is `type` (LocationType enum: WAREHOUSE,
 *     OFFICE, STADIUM, TRAINING_CENTER, EXTERNAL, IN_TRANSIT)
 *     rather than `assetType`.
 *   - The list shows `address.city` (when set) instead of just slug,
 *     because for locations the city is what humans recognise.
 *     Slug is still rendered so admins can sanity-check derived
 *     URLs / API references.
 *
 * Out of scope for this iteration (deferred):
 *   - Edit modal — UpdateLocationSchema is wired in shared-types,
 *     but the form UI for address + coordinates + managerId is a
 *     separate slice once we have a real tenant with > 5 locations
 *     to justify the complexity.
 *   - Tree-view rendering (parent → child indentation).
 *   - Manager selection — needs a users picker component.
 */

const LOCATION_TYPE_LABELS: Record<string, string> = {
  HEADQUARTERS: 'Sídlo',
  BRANCH: 'Pobočka',
  WAREHOUSE: 'Hlavný sklad',
  OFFICE: 'Kancelária',
  STADIUM: 'Štadión / areál',
  TRAINING_CENTER: 'Tréningové centrum',
  EXTERNAL: 'Externé miesto',
  IN_TRANSIT: 'V preprave',
};

export function LocationsContent(): JSX.Element {
  const locationsQuery = useLocations({ limit: 200 });
  const canManage = useCanManageTaxonomy();
  const canDelete = useCanDeleteTaxonomy();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LocationSummary | null>(null);

  const locations = locationsQuery.data?.data ?? [];

  // Build a lookup map so we can resolve parentId → parent name in
  // the list rows. The Map is rebuilt only when locations data
  // changes — not on every row render — but at this scale it's cheap
  // enough either way.
  const byId = new Map(locations.map((l) => [l._id, l]));

  return (
    <div>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Lokality</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Fyzické umiestnenia, kde sa majetok nachádza — sklady, kancelárie, štadióny.
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Pridať lokalitu
          </button>
        ) : null}
      </header>

      {locationsQuery.isLoading ? (
        <ListSkeleton />
      ) : locationsQuery.isError ? (
        <ErrorPanel message="Lokality sa nepodarilo načítať. Skontroluj pripojenie a skús to znova." />
      ) : locations.length === 0 ? (
        <EmptyState canCreate={canManage} onCreate={() => setCreateOpen(true)} />
      ) : (
        <LocationsTable
          locations={locations}
          byId={byId}
          canDelete={canDelete}
          onDelete={(location) => setDeleteTarget(location)}
        />
      )}

      {createOpen ? (
        <LocationCreateDialog
          existingLocations={locations}
          onClose={() => setCreateOpen(false)}
          onCreated={() => setCreateOpen(false)}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteLocationDialog location={deleteTarget} onClose={() => setDeleteTarget(null)} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

interface LocationsTableProps {
  locations: readonly LocationSummary[];
  byId: ReadonlyMap<string, LocationSummary>;
  canDelete: boolean;
  onDelete: (location: LocationSummary) => void;
}

function LocationsTable({
  locations,
  byId,
  canDelete,
  onDelete,
}: LocationsTableProps): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-border-subtle bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
          <tr>
            <th scope="col" className="px-4 py-3">
              Názov
            </th>
            <th scope="col" className="px-4 py-3">
              Typ
            </th>
            <th scope="col" className="px-4 py-3">
              Mesto
            </th>
            <th scope="col" className="px-4 py-3">
              Nadradená
            </th>
            <th scope="col" className="px-4 py-3">
              Slug
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              {canDelete ? <span className="sr-only">Akcie</span> : null}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {locations.map((location) => {
            const parent =
              typeof location['parentId'] === 'string'
                ? byId.get(location['parentId'] as string)
                : null;
            // `address` is part of the backend Location schema but
            // not narrowed on LocationSummary (we kept the summary
            // intentionally small). Reach into the index signature
            // and runtime-check the shape.
            const addressRaw = location['address'];
            const city =
              addressRaw !== null && typeof addressRaw === 'object' && 'city' in addressRaw
                ? ((addressRaw as { city?: unknown }).city ?? null)
                : null;
            const isInactive = location.isActive === false;
            return (
              <tr
                key={location._id}
                className={isInactive ? 'opacity-60' : 'hover:bg-surface-subtle'}
              >
                <td className="px-4 py-3 font-medium text-text-primary">
                  {location.name}
                  {isInactive ? (
                    <span className="ml-2 rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-normal text-text-muted">
                      Neaktívne
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {LOCATION_TYPE_LABELS[location.type] ?? location.type}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {typeof city === 'string' && city.length > 0 ? (
                    city
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {parent ? parent.name : <span className="text-text-muted">—</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-text-muted">{location.slug}</td>
                <td className="px-4 py-3 text-right">
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => onDelete(location)}
                      aria-label={`Vymazať lokalitu ${location.name}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-default bg-surface-card px-3 py-1.5 text-xs font-medium text-danger-fg transition hover:bg-danger-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                      Vymazať
                    </button>
                  ) : null}
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
// Delete dialog wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps `ConfirmDeleteDialog` with the actual `useDeleteLocation`
 * mutation. Kept as a small component instead of inlining the
 * mutation into `LocationsContent` because the mutation hook needs
 * to live inside the conditionally-rendered subtree to avoid the
 * "hook order" rule violation when `deleteTarget` flips from null to
 * a location mid-render.
 */
function DeleteLocationDialog({
  location,
  onClose,
}: {
  location: LocationSummary;
  onClose: () => void;
}): JSX.Element {
  const deleteLocation = useDeleteLocation();

  return (
    <ConfirmDeleteDialog
      title={`Vymazať lokalitu ${location.name}?`}
      description="Lokalita sa označí ako zmazaná. Záznam zostane v databáze kvôli auditu, ale prestane sa zobrazovať vo všetkých zoznamoch."
      confirmLabel="Vymazať"
      isPending={deleteLocation.isPending}
      error={deleteLocation.error?.message ?? null}
      onConfirm={() => {
        deleteLocation.mutate(
          { id: location._id },
          {
            onSuccess: onClose,
            // onError is handled via deleteLocation.error above — the
            // dialog stays open so the user can read the message.
          },
        );
      }}
      onCancel={onClose}
    />
  );
}

// ---------------------------------------------------------------------------
// Skeleton + error + empty states
// ---------------------------------------------------------------------------

function ListSkeleton(): JSX.Element {
  return (
    <div
      aria-busy="true"
      aria-label="Načítavam lokality"
      className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-sm"
    >
      <div className="border-b border-border-subtle bg-surface-subtle px-4 py-3">
        <div className="h-3 w-32 animate-pulse rounded bg-border-subtle" />
      </div>
      <ul className="divide-y divide-border-subtle">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex items-center gap-4 px-4 py-3">
            <div className="h-4 w-40 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 w-32 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 w-24 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 w-24 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 w-20 animate-pulse rounded bg-surface-subtle" />
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

function EmptyState({
  canCreate,
  onCreate,
}: {
  canCreate: boolean;
  onCreate: () => void;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-10 text-center">
      <p className="text-sm font-medium text-text-primary">Zatiaľ nemáte žiadne lokality.</p>
      <p className="mt-1 text-sm text-text-secondary">
        Lokality definujú miesta, kde sa fyzicky nachádza majetok.
        {canCreate ? ' Začnite vytvorením prvej.' : null}
      </p>
      {canCreate ? (
        <button
          type="button"
          onClick={onCreate}
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Pridať prvú lokalitu
        </button>
      ) : null}
    </div>
  );
}

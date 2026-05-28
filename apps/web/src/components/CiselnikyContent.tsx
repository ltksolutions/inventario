// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * Číselníky — zjednotená správa taxonómie (kategórie, lokality, typy,
 * stavy) na jednej stránke so 4 záložkami.
 *
 * Combobox v asset formulári rieši rýchle pridanie za behu. Táto
 * stránka slúži na správu: prehľad, premenovanie, mazanie (s FK
 * protection a count naviazaných assetov).
 *
 * RBAC:
 *   - Zobrazenie: všetci prihlásení
 *   - Pridať / premenovať: ASSET_MANAGER + ADMIN
 *   - Zmazať: ADMIN only (backend FK protection)
 */

import { AlertCircle, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

import type { JSX } from 'react';

import {
  useAssetConditions,
  useAssetTypes,
  useCanDeleteTaxonomy,
  useCanManageTaxonomy,
  useCategories,
  useCreateAssetConditions,
  useCreateAssetTypes,
  useCreateCategory,
  useCreateLocation,
  useDeleteAssetCondition,
  useDeleteAssetType,
  useDeleteCategory,
  useDeleteLocation,
  useLocations,
  useRenameAssetCondition,
  useRenameAssetType,
  useRenameCategory,
  useRenameLocation,
} from '@/lib/api-hooks';
import { cn } from '@/lib/cn';

type TabKey = 'categories' | 'locations' | 'types' | 'conditions';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'categories', label: 'Kategórie' },
  { key: 'locations', label: 'Lokality' },
  { key: 'types', label: 'Typy majetku' },
  { key: 'conditions', label: 'Stavy' },
];

export function CiselnikyContent(): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('categories');

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Číselníky</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Správa kategórií, lokalít, typov majetku a stavov. Hodnoty môžete pridávať aj priamo pri
          zadávaní majetku.
        </p>
      </header>

      <div className="mb-6 flex gap-1 border-b border-border-subtle">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'border-b-2 px-4 py-2.5 text-sm font-medium transition',
              activeTab === tab.key
                ? 'border-brand-primary text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'categories' && <CategoriesTab />}
      {activeTab === 'locations' && <LocationsTab />}
      {activeTab === 'types' && <TypesTab />}
      {activeTab === 'conditions' && <ConditionsTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic taxonomy table — shared by all 4 tabs
// ---------------------------------------------------------------------------

interface TaxonomyRow {
  id: string;
  name: string;
  slug: string;
  /** Extra column value (e.g. assetType label, location type) — optional */
  extra?: string | null;
}

interface TaxonomyTableProps {
  rows: TaxonomyRow[];
  isLoading: boolean;
  isError: boolean;
  /** Label for the optional extra column header. Null = no extra column. */
  extraHeader?: string | null;
  emptyLabel: string;
  addLabel: string;
  canManage: boolean;
  canDelete: boolean;
  onAdd: () => void;
  onRename: (id: string, newName: string) => Promise<void>;
  onDelete: (row: TaxonomyRow) => void;
}

function TaxonomyTable({
  rows,
  isLoading,
  isError,
  extraHeader,
  emptyLabel,
  addLabel,
  canManage,
  canDelete,
  onAdd,
  onRename,
  onDelete,
}: TaxonomyTableProps): JSX.Element {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);

  async function commitRename(id: string): Promise<void> {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    setRenameLoading(true);
    try {
      await onRename(id, trimmed);
      setRenamingId(null);
    } finally {
      setRenameLoading(false);
    }
  }

  if (isLoading) return <ListSkeleton />;
  if (isError)
    return (
      <ErrorPanel message="Údaje sa nepodarilo načítať. Skontroluj pripojenie a skús znova." />
    );

  return (
    <div>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            {addLabel}
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-10 text-center">
          <p className="text-sm font-medium text-text-primary">{emptyLabel}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-border-subtle bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Názov
                </th>
                {extraHeader ? (
                  <th scope="col" className="px-4 py-3">
                    {extraHeader}
                  </th>
                ) : null}
                <th scope="col" className="px-4 py-3">
                  Slug
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  <span className="sr-only">Akcie</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {rows.map((row) => {
                const isRenaming = renamingId === row.id;
                return (
                  <tr key={row.id} className="hover:bg-surface-subtle">
                    <td className="px-4 py-3 font-medium text-text-primary">
                      {isRenaming ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void commitRename(row.id);
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setRenamingId(null);
                              }
                            }}
                            ref={(el) => el?.focus()}
                            className="w-48 rounded border border-border-focus bg-surface-card px-2 py-1 text-sm focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={renameLoading}
                            onClick={() => void commitRename(row.id)}
                            aria-label="Uložiť"
                            className="rounded p-1 text-brand-primary hover:bg-surface-subtle disabled:opacity-50"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingId(null)}
                            aria-label="Zrušiť"
                            className="rounded p-1 text-text-muted hover:text-text-primary"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        row.name
                      )}
                    </td>
                    {extraHeader ? (
                      <td className="px-4 py-3 text-text-secondary">
                        {row.extra ?? <span className="text-text-muted">—</span>}
                      </td>
                    ) : null}
                    <td className="px-4 py-3 font-mono text-xs text-text-muted">{row.slug}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        {canManage && !isRenaming ? (
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingId(row.id);
                              setRenameValue(row.name);
                            }}
                            aria-label={`Premenovať ${row.name}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-card px-3 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                          >
                            <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                            Premenovať
                          </button>
                        ) : null}
                        {canDelete && !isRenaming ? (
                          <button
                            type="button"
                            onClick={() => onDelete(row)}
                            aria-label={`Vymazať ${row.name}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-card px-3 py-1.5 text-xs font-medium text-danger-fg transition hover:bg-danger-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                          >
                            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                            Vymazať
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline "add" prompt — simple name input row above the table
// ---------------------------------------------------------------------------

function AddInlineDialog({
  title,
  onSubmit,
  onClose,
}: {
  title: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nepodarilo sa vytvoriť.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border-subtle bg-surface-card p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zatvoriť"
            className="rounded p-1 text-text-muted hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text-secondary">Názov</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
            ref={(el) => el?.focus()}
            className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          />
        </label>
        {error ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger-fg bg-danger-bg p-3 text-sm text-danger-fg">
            <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border-default bg-surface-card px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-subtle"
          >
            Zrušiť
          </button>
          <button
            type="button"
            disabled={loading || !name.trim()}
            onClick={() => void submit()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Vytvoriť
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Categories
// ---------------------------------------------------------------------------

const ASSET_TYPE_LABELS: Record<string, string> = {
  IT: 'IT majetok',
  SPORTS_GEAR: 'Športová výstroj',
  TRAINING_EQUIPMENT: 'Tréningové vybavenie',
  OFFICE_EQUIPMENT: 'Kancelárske vybavenie',
  MEDIA: 'Médiá a video',
  COMMUNICATION: 'Komunikácia',
  OTHER: 'Iné',
};

function CategoriesTab(): JSX.Element {
  const query = useCategories({ limit: 200 });
  const canManage = useCanManageTaxonomy();
  const canDelete = useCanDeleteTaxonomy();
  const create = useCreateCategory();
  const rename = useRenameCategory();
  const del = useDeleteCategory();

  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaxonomyRow | null>(null);

  const rows: TaxonomyRow[] = (query.data?.data ?? []).map((c) => ({
    id: c._id,
    name: c.name,
    slug: c.slug,
    extra: ASSET_TYPE_LABELS[c.assetType] ?? c.assetType,
  }));

  return (
    <>
      <TaxonomyTable
        rows={rows}
        isLoading={query.isLoading}
        isError={query.isError}
        extraHeader="Typ majetku"
        emptyLabel="Zatiaľ žiadne kategórie."
        addLabel="Pridať kategóriu"
        canManage={canManage}
        canDelete={canDelete}
        onAdd={() => setAddOpen(true)}
        onRename={async (id, name) => {
          await rename.mutateAsync({ id, name });
        }}
        onDelete={(row) => setDeleteTarget(row)}
      />
      {addOpen && (
        <AddInlineDialog
          title="Nová kategória"
          onSubmit={async (name) => {
            await create.mutateAsync({ name, assetType: 'OTHER' });
          }}
          onClose={() => setAddOpen(false)}
        />
      )}
      {deleteTarget && (
        <ConfirmDeleteDialog
          title={`Vymazať kategóriu ${deleteTarget.name}?`}
          description="Kategória sa označí ako zmazaná. Ak ju referencuje nejaký majetok, mazanie zlyhá."
          confirmLabel="Vymazať"
          isPending={del.isPending}
          error={del.error?.message ?? null}
          onConfirm={() =>
            del.mutate({ id: deleteTarget.id }, { onSuccess: () => setDeleteTarget(null) })
          }
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab: Locations
// ---------------------------------------------------------------------------

const LOCATION_TYPE_LABELS: Record<string, string> = {
  WAREHOUSE: 'Sklad',
  OFFICE: 'Kancelária',
  STADIUM: 'Štadión',
  TRAINING_CENTER: 'Tréningové centrum',
  EXTERNAL: 'Externá',
  IN_TRANSIT: 'V preprave',
};

function LocationsTab(): JSX.Element {
  const query = useLocations({ limit: 200 });
  const canManage = useCanManageTaxonomy();
  const canDelete = useCanDeleteTaxonomy();
  const create = useCreateLocation();
  const rename = useRenameLocation();
  const del = useDeleteLocation();

  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaxonomyRow | null>(null);

  const rows: TaxonomyRow[] = (query.data?.data ?? []).map((l) => ({
    id: l._id,
    name: l.name,
    slug: l.slug,
    extra: LOCATION_TYPE_LABELS[l.type] ?? l.type,
  }));

  return (
    <>
      <TaxonomyTable
        rows={rows}
        isLoading={query.isLoading}
        isError={query.isError}
        extraHeader="Typ"
        emptyLabel="Zatiaľ žiadne lokality."
        addLabel="Pridať lokalitu"
        canManage={canManage}
        canDelete={canDelete}
        onAdd={() => setAddOpen(true)}
        onRename={async (id, name) => {
          await rename.mutateAsync({ id, name });
        }}
        onDelete={(row) => setDeleteTarget(row)}
      />
      {addOpen && (
        <AddInlineDialog
          title="Nová lokalita"
          onSubmit={async (name) => {
            await create.mutateAsync({ name, type: 'WAREHOUSE' });
          }}
          onClose={() => setAddOpen(false)}
        />
      )}
      {deleteTarget && (
        <ConfirmDeleteDialog
          title={`Vymazať lokalitu ${deleteTarget.name}?`}
          description="Lokalita sa označí ako zmazaná. Ak ju referencuje nejaký majetok, mazanie zlyhá."
          confirmLabel="Vymazať"
          isPending={del.isPending}
          error={del.error?.message ?? null}
          onConfirm={() =>
            del.mutate({ id: deleteTarget.id }, { onSuccess: () => setDeleteTarget(null) })
          }
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab: Asset Types
// ---------------------------------------------------------------------------

function TypesTab(): JSX.Element {
  const query = useAssetTypes({ limit: 200 });
  const canManage = useCanManageTaxonomy();
  const canDelete = useCanDeleteTaxonomy();
  const create = useCreateAssetTypes();
  const rename = useRenameAssetType();
  const del = useDeleteAssetType();

  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaxonomyRow | null>(null);

  const rows: TaxonomyRow[] = (query.data?.data ?? []).map((t) => ({
    id: t._id,
    name: t.name,
    slug: t.slug,
  }));

  return (
    <>
      <TaxonomyTable
        rows={rows}
        isLoading={query.isLoading}
        isError={query.isError}
        emptyLabel="Zatiaľ žiadne typy majetku."
        addLabel="Pridať typ"
        canManage={canManage}
        canDelete={canDelete}
        onAdd={() => setAddOpen(true)}
        onRename={async (id, name) => {
          await rename.mutateAsync({ id, name });
        }}
        onDelete={(row) => setDeleteTarget(row)}
      />
      {addOpen && (
        <AddInlineDialog
          title="Nový typ majetku"
          onSubmit={async (name) => {
            await create.mutateAsync({ name });
          }}
          onClose={() => setAddOpen(false)}
        />
      )}
      {deleteTarget && (
        <ConfirmDeleteDialog
          title={`Vymazať typ ${deleteTarget.name}?`}
          description="Typ sa označí ako zmazaný. Ak ho referencuje nejaký majetok, mazanie zlyhá."
          confirmLabel="Vymazať"
          isPending={del.isPending}
          error={del.error?.message ?? null}
          onConfirm={() =>
            del.mutate({ id: deleteTarget.id }, { onSuccess: () => setDeleteTarget(null) })
          }
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab: Asset Conditions
// ---------------------------------------------------------------------------

function ConditionsTab(): JSX.Element {
  const query = useAssetConditions({ limit: 200 });
  const canManage = useCanManageTaxonomy();
  const canDelete = useCanDeleteTaxonomy();
  const create = useCreateAssetConditions();
  const rename = useRenameAssetCondition();
  const del = useDeleteAssetCondition();

  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaxonomyRow | null>(null);

  const rows: TaxonomyRow[] = (query.data?.data ?? []).map((c) => ({
    id: c._id,
    name: c.name,
    slug: c.slug,
  }));

  return (
    <>
      <TaxonomyTable
        rows={rows}
        isLoading={query.isLoading}
        isError={query.isError}
        emptyLabel="Zatiaľ žiadne stavy."
        addLabel="Pridať stav"
        canManage={canManage}
        canDelete={canDelete}
        onAdd={() => setAddOpen(true)}
        onRename={async (id, name) => {
          await rename.mutateAsync({ id, name });
        }}
        onDelete={(row) => setDeleteTarget(row)}
      />
      {addOpen && (
        <AddInlineDialog
          title="Nový stav"
          onSubmit={async (name) => {
            await create.mutateAsync({ name });
          }}
          onClose={() => setAddOpen(false)}
        />
      )}
      {deleteTarget && (
        <ConfirmDeleteDialog
          title={`Vymazať stav ${deleteTarget.name}?`}
          description="Stav sa označí ako zmazaný. Ak ho referencuje nejaký majetok, mazanie zlyhá."
          confirmLabel="Vymazať"
          isPending={del.isPending}
          error={del.error?.message ?? null}
          onConfirm={() =>
            del.mutate({ id: deleteTarget.id }, { onSuccess: () => setDeleteTarget(null) })
          }
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared states
// ---------------------------------------------------------------------------

function ListSkeleton(): JSX.Element {
  return (
    <div
      aria-busy="true"
      className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-sm"
    >
      <div className="border-b border-border-subtle bg-surface-subtle px-4 py-3">
        <div className="h-3 w-32 animate-pulse rounded bg-border-subtle" />
      </div>
      <ul className="divide-y divide-border-subtle">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex items-center gap-4 px-4 py-3">
            <div className="h-4 w-40 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 w-24 animate-pulse rounded bg-surface-subtle" />
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

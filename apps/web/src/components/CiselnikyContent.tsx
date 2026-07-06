// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * Číselníky — zjednotená správa taxonómie (kategórie, lokality, stavy,
 * tagy) na jednej stránke so 4 záložkami.
 *
 * Zlúčený číselník (2026-06-08): "Typy majetku" zanikli ako samostatný
 * číselník — root kategórie plnia ich rolu (skupiny). Kategórie sú
 * zoskupené podľa root skupiny; majetok sa zaraďuje len do podkategórií.
 *
 * RBAC (Kategórie / Lokality / Stavy):
 *   - Zobrazenie: všetci prihlásení
 *   - Pridať / premenovať: ASSET_MANAGER + ADMIN
 *   - Zmazať: ADMIN only (backend FK protection)
 *
 * RBAC (Tagy, 2026-07-07) — výnimka z vyššie uvedeného:
 *   - Bez "Pridať" — tagy vznikajú len priradením na majetku.
 *   - Premenovať aj Vymazať: ASSET_MANAGER + ADMIN (nie len ADMIN pri
 *     mazaní) — rozhodnutie Janiky, mazanie tagu nie je štrukturálne
 *     deštruktívne ako mazanie kategórie/lokality.
 */

import { AlertCircle, Check, Pencil, Plus, Settings2, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { CategoryCreateDialog } from './CategoryCreateDialog';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { SelectField } from './SelectField';

import type { JSX } from 'react';

import {
  useAssetConditions,
  useCanDeleteTaxonomy,
  useCanManageTaxonomy,
  useCategories,
  useCreateAssetConditions,
  useCreateLocation,
  useDeleteAssetCondition,
  useDeleteCategory,
  useDeleteLocation,
  useDeleteTag,
  useLocations,
  useRenameAssetCondition,
  useRenameCategory,
  useRenameTag,
  useTagsSummary,
  useUpdateLocation,
} from '@/lib/api-hooks';
import { cn } from '@/lib/cn';
import { displayTag } from '@/lib/tags';

type TabKey = 'categories' | 'locations' | 'conditions' | 'tags';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'categories', label: 'Kategórie' },
  { key: 'locations', label: 'Lokality' },
  { key: 'conditions', label: 'Stavy' },
  { key: 'tags', label: 'Tagy' },
];

export function CiselnikyContent(): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('categories');

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Číselníky</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Správa kategórií, lokalít a stavov. Kategórie tvoria strom — root skupiny zoskupujú,
          majetok sa zaraďuje do podkategórií.
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
      {activeTab === 'conditions' && <ConditionsTab />}
      {activeTab === 'tags' && <TagsTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic taxonomy table — shared by Locations, Types, Conditions tabs
// ---------------------------------------------------------------------------

interface TaxonomyRow {
  id: string;
  name: string;
  slug: string;
  extra?: string | null;
}

interface TaxonomyTableProps {
  rows: TaxonomyRow[];
  isLoading: boolean;
  isError: boolean;
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
// Inline "add" dialog
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
      <button
        type="button"
        aria-label="Zatvoriť dialog"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border-subtle bg-surface-card p-6 shadow-xl">
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
// Tab: Categories — grouped by asset type
// ---------------------------------------------------------------------------

/**
 * Paleta pre badge root skupín — skupiny sú dynamické (root kategórie
 * tenanta), takže farby prideľujeme cyklicky podľa poradia skupiny.
 */
const TYPE_BADGE_PALETTE: Array<{ bg: string; text: string }> = [
  { bg: '#E6F1FB', text: '#0C447C' },
  { bg: '#E1F5EE', text: '#085041' },
  { bg: '#EAF3DE', text: '#27500A' },
  { bg: '#F1EFE8', text: '#444441' },
  { bg: '#EEEDFE', text: '#3C3489' },
  { bg: '#FAEEDA', text: '#633806' },
  { bg: '#FCEBEB', text: '#791F1F' },
];

function CategoriesTab(): JSX.Element {
  const query = useCategories({ limit: 200 });
  const canManage = useCanManageTaxonomy();
  const canDelete = useCanDeleteTaxonomy();
  const rename = useRenameCategory();
  const del = useDeleteCategory();

  // Otvorenie dialógu: buď tvorba root kategórie, alebo hodnoty pod
  // konkrétny root (parentId). null = zatvorené.
  const [addState, setAddState] = useState<
    { mode: 'root' } | { mode: 'value'; parentId: string } | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<TaxonomyRow | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);

  if (query.isLoading) return <ListSkeleton />;
  if (query.isError)
    return (
      <ErrorPanel message="Kategórie sa nepodarilo načítať. Skontroluj pripojenie a skús znova." />
    );

  const categories = query.data?.data ?? [];
  const byId = new Map(categories.map((c) => [c._id, c]));

  // Zoskupenie podľa ROOT skupiny (root kategórie = bývalé "typy").
  // V skupine je prvý riadok samotný root (na rename/delete), za ním
  // jeho podstrom zoradený podľa cesty.
  const roots = categories.filter((c) => c.parentId == null);
  const rootIdOf = (c: (typeof categories)[number]): string => {
    let current = c;
    for (let i = 0; i < 10 && current.parentId != null; i++) {
      const parent = byId.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current._id;
  };

  const groups: Record<string, TaxonomyRow[]> = {};
  for (const root of roots) {
    groups[root._id] = [{ id: root._id, name: root.name, slug: root.slug, extra: null }];
  }
  for (const c of categories) {
    if (c.parentId == null) continue;
    const row: TaxonomyRow = {
      id: c._id,
      name: c.name,
      slug: c.slug,
      extra: null,
    };
    // Kategórie s nedohľadateľným rootom (nemali by nastať) sa preskočia.
    groups[rootIdOf(c)]?.push(row);
  }
  for (const rootId of Object.keys(groups)) {
    const [first, ...rest] = groups[rootId]!;
    rest.sort((a, b) => a.name.localeCompare(b.name, 'sk'));
    groups[rootId] = [first!, ...rest];
  }
  const groupOrder = roots.map((r) => r._id);
  const allRows = categories;

  async function commitRename(id: string): Promise<void> {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    setRenameLoading(true);
    try {
      await rename.mutateAsync({ id, name: trimmed });
      setRenamingId(null);
    } finally {
      setRenameLoading(false);
    }
  }

  function pluralCount(n: number): string {
    if (n === 1) return 'kategória';
    if (n < 5) return 'kategórie';
    return 'kategórií';
  }

  return (
    <>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setAddState({ mode: 'root' })}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Pridať root kategóriu
          </button>
        </div>
      )}

      {allRows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-10 text-center">
          <p className="text-sm font-medium text-text-primary">Zatiaľ žiadne kategórie.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupOrder.map((rootId, groupIndex) => {
            const label = byId.get(rootId)?.name ?? rootId;
            const colors =
              TYPE_BADGE_PALETTE[groupIndex % TYPE_BADGE_PALETTE.length] ??
              ({ bg: '#F1EFE8', text: '#444441' } as const);
            const groupRows = groups[rootId] ?? [];
            const childCount = groupRows.length - 1; // prvý riadok = root skupina
            return (
              <div key={rootId}>
                <div className="mb-2 flex items-center gap-2 border-b border-border-subtle pb-2">
                  <span
                    className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                    style={{ background: colors.bg, color: colors.text }}
                  >
                    {label}
                  </span>
                  <span className="text-xs text-text-muted">
                    {childCount} {pluralCount(childCount)}
                  </span>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setAddState({ mode: 'value', parentId: rootId })}
                      aria-label={`Pridať hodnotu do ${label}`}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-card px-3 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                    >
                      <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                      Pridať hodnotu
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead className="border-b border-border-subtle bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                      <tr>
                        <th scope="col" className="px-4 py-3">
                          Názov
                        </th>
                        <th scope="col" className="px-4 py-3">
                          Slug
                        </th>
                        <th scope="col" className="px-4 py-3 text-right">
                          <span className="sr-only">Akcie</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {groupRows.map((row) => {
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
                            <td className="px-4 py-3 font-mono text-xs text-text-muted">
                              {row.slug}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex gap-1.5">
                                {canManage && !isRenaming && (
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
                                )}
                                {canDelete && !isRenaming && (
                                  <button
                                    type="button"
                                    onClick={() => setDeleteTarget(row)}
                                    aria-label={`Vymazať ${row.name}`}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-card px-3 py-1.5 text-xs font-medium text-danger-fg transition hover:bg-danger-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                                  >
                                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                                    Vymazať
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {addState && (
        <CategoryCreateDialog
          existingCategories={categories}
          mode={addState.mode}
          defaultParentId={addState.mode === 'value' ? addState.parentId : undefined}
          onClose={() => setAddState(null)}
          onCreated={() => setAddState(null)}
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
  HEADQUARTERS: 'Sídlo',
  BRANCH: 'Pobočka',
  WAREHOUSE: 'Sklad',
  OFFICE: 'Kancelária',
  STADIUM: 'Štadión',
  TRAINING_CENTER: 'Tréningové centrum',
  EXTERNAL: 'Externá',
  IN_TRANSIT: 'V preprave',
};

const LOCATION_TYPE_VALUES = [
  'HEADQUARTERS',
  'BRANCH',
  'WAREHOUSE',
  'OFFICE',
  'STADIUM',
  'TRAINING_CENTER',
  'EXTERNAL',
  'IN_TRANSIT',
] as const;

interface LocationDialogProps {
  mode: 'create' | 'edit';
  initial?: { id: string; name: string; type: string };
  onClose: () => void;
  onCreate?: (name: string, type: string) => Promise<void>;
  onUpdate?: (id: string, name: string, type: string) => Promise<void>;
}

function LocationDialog({
  mode,
  initial,
  onClose,
  onCreate,
  onUpdate,
}: LocationDialogProps): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? 'OFFICE');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === 'create') {
        await onCreate?.(trimmed, type);
      } else {
        await onUpdate?.(initial!.id, trimmed, type);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nepodarilo sa uložiť.');
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    'w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <button
        type="button"
        aria-label="Zatvoriť dialog"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border-subtle bg-surface-card p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-text-primary">
            {mode === 'create' ? 'Nová lokalita' : 'Upraviť lokalitu'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zatvoriť"
            className="rounded p-1 text-text-muted hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text-secondary">Názov *</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
                if (e.key === 'Escape') onClose();
              }}
              ref={(el) => el?.focus()}
              className={inputCls}
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text-secondary">Typ lokality *</span>
            <SelectField
              label="Typ lokality"
              value={type}
              onChange={setType}
              options={LOCATION_TYPE_VALUES.map((t) => ({
                value: t,
                label: LOCATION_TYPE_LABELS[t] ?? t,
              }))}
            />
          </div>
        </div>

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
            {mode === 'create' ? <Plus aria-hidden="true" className="h-4 w-4" /> : null}
            {loading ? 'Ukladám…' : mode === 'create' ? 'Vytvoriť' : 'Uložiť'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface LocationEditTarget {
  id: string;
  name: string;
  type: string;
}

function LocationsTab(): JSX.Element {
  const query = useLocations({ limit: 200 });
  const canManage = useCanManageTaxonomy();
  const canDelete = useCanDeleteTaxonomy();
  const create = useCreateLocation();
  const update = useUpdateLocation();
  const del = useDeleteLocation();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LocationEditTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaxonomyRow | null>(null);

  const locations = query.data?.data ?? [];

  if (query.isLoading) return <ListSkeleton />;
  if (query.isError)
    return (
      <ErrorPanel message="Lokality sa nepodarilo načítať. Skontroluj pripojenie a skús znova." />
    );

  return (
    <>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Pridať lokalitu
          </button>
        </div>
      )}

      {locations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-10 text-center">
          <p className="text-sm font-medium text-text-primary">Zatiaľ žiadne lokality.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-border-subtle bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Názov
                </th>
                <th scope="col" className="px-4 py-3">
                  Typ
                </th>
                <th scope="col" className="px-4 py-3">
                  Slug
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  <span className="sr-only">Akcie</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {locations.map((loc) => (
                <tr key={loc._id} className="hover:bg-surface-subtle">
                  <td className="px-4 py-3 font-medium text-text-primary">{loc.name}</td>
                  <td className="px-4 py-3 text-text-secondary">
                    {LOCATION_TYPE_LABELS[loc.type] ?? loc.type}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-muted">{loc.slug}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1.5">
                      {canManage && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditTarget({ id: loc._id, name: loc.name, type: loc.type })
                          }
                          aria-label={`Upraviť ${loc.name}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-card px-3 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                        >
                          <Settings2 aria-hidden="true" className="h-3.5 w-3.5" />
                          Upraviť
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteTarget({ id: loc._id, name: loc.name, slug: loc.slug })
                          }
                          aria-label={`Vymazať ${loc.name}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-card px-3 py-1.5 text-xs font-medium text-danger-fg transition hover:bg-danger-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                        >
                          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                          Vymazať
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && (
        <LocationDialog
          mode="create"
          onClose={() => setAddOpen(false)}
          onCreate={async (name, type) => {
            await create.mutateAsync({ name, type });
          }}
        />
      )}

      {editTarget && (
        <LocationDialog
          mode="edit"
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onUpdate={async (id, name, type) => {
            await update.mutateAsync({ id, name, type });
          }}
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
// Tab: Tags — číselník tagov (premenovanie + mazanie, bez "Pridať")
// ---------------------------------------------------------------------------

/**
 * Tagy nemajú vlastný "Pridať" flow — vznikajú výlučne priraďovaním na
 * majetku (TagsCombobox pri vytváraní/editácii). Tento tab slúži na
 * hromadnú správu už existujúcich tagov: premenovanie (so zlúčením
 * duplicít) a mazanie zo všetkého majetku naraz.
 *
 * RBAC (rozhodnutie Janiky pri zadaní 2026-07-07): na rozdiel od
 * ostatných záložiek tu má "Vymazať" rovnaké oprávnenie ako
 * "Premenovať" — ASSET_MANAGER + ADMIN (nie len ADMIN) — pretože
 * mazanie tagu je nedeštruktívne pre majetok samotný (len sa mu odoberie
 * jeden štítok), na rozdiel od mazania kategórie/lokality.
 */
function TagsTab(): JSX.Element {
  const query = useTagsSummary();
  const canManage = useCanManageTaxonomy();
  const rename = useRenameTag();
  const del = useDeleteTag();

  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ tag: string; count: number } | null>(null);

  async function commitRename(oldTag: string): Promise<void> {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed.toLowerCase() === oldTag.toLowerCase()) {
      setRenamingTag(null);
      return;
    }
    setRenameLoading(true);
    setRenameError(null);
    try {
      await rename.mutateAsync({ oldTag, newTag: trimmed });
      setRenamingTag(null);
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : 'Premenovanie zlyhalo.');
    } finally {
      setRenameLoading(false);
    }
  }

  if (query.isLoading) return <ListSkeleton />;
  if (query.isError)
    return <ErrorPanel message="Tagy sa nepodarilo načítať. Skontroluj pripojenie a skús znova." />;

  const rows = query.data ?? [];

  return (
    <>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-default bg-surface-card p-10 text-center">
          <p className="text-sm font-medium text-text-primary">
            Zatiaľ žiadne tagy. Tagy vznikajú priradením na majetku.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="border-b border-border-subtle bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Tag
                </th>
                <th scope="col" className="px-4 py-3">
                  Počet použití
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  <span className="sr-only">Akcie</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {rows.map((row) => {
                const isRenaming = renamingTag === row.tag;
                return (
                  <tr key={row.tag} className="hover:bg-surface-subtle">
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
                                void commitRename(row.tag);
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setRenamingTag(null);
                              }
                            }}
                            ref={(el) => el?.focus()}
                            className="w-48 rounded border border-border-focus bg-surface-card px-2 py-1 text-sm focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={renameLoading}
                            onClick={() => void commitRename(row.tag)}
                            aria-label="Uložiť"
                            className="rounded p-1 text-brand-primary hover:bg-surface-subtle disabled:opacity-50"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingTag(null)}
                            aria-label="Zrušiť"
                            className="rounded p-1 text-text-muted hover:text-text-primary"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        displayTag(row.tag)
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{row.count}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        {canManage && !isRenaming ? (
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingTag(row.tag);
                              setRenameValue(row.tag);
                              setRenameError(null);
                            }}
                            aria-label={`Premenovať ${row.tag}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-card px-3 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                          >
                            <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                            Premenovať
                          </button>
                        ) : null}
                        {canManage && !isRenaming ? (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget({ tag: row.tag, count: row.count })}
                            aria-label={`Vymazať ${row.tag}`}
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
      {renameError ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger-fg bg-danger-bg p-3 text-sm text-danger-fg">
          <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>{renameError}</span>
        </div>
      ) : null}
      {deleteTarget && (
        <ConfirmDeleteDialog
          title={`Vymazať tag ${displayTag(deleteTarget.tag)}?`}
          description={
            deleteTarget.count === 1
              ? 'Tag sa odstráni z 1 kusu majetku, ktorý ho aktuálne používa. Táto akcia sa nedá vrátiť.'
              : `Tag sa odstráni z ${deleteTarget.count} kusov majetku, ktoré ho aktuálne používajú. Táto akcia sa nedá vrátiť.`
          }
          confirmLabel="Vymazať"
          isPending={del.isPending}
          error={del.error?.message ?? null}
          onConfirm={() =>
            del.mutate({ tag: deleteTarget.tag }, { onSuccess: () => setDeleteTarget(null) })
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

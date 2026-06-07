// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { CategoryCreateDialog } from './CategoryCreateDialog';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

import type { CategorySummary } from '@/lib/api-hooks';
import type { JSX } from 'react';

import {
  useAssetTypes,
  useCanDeleteTaxonomy,
  useCanManageTaxonomy,
  useCategories,
  useDeleteCategory,
} from '@/lib/api-hooks';

/**
 * Categories admin list page.
 *
 * MVP scope for this slice:
 *   - List existing categories (paginated by the backend; we render
 *     the first 200 for now — pilot tenants stay well under that).
 *   - Create a new category via modal: name + assetType + optional
 *     description + optional parent.
 *   - Delete with confirm + backend FK-protection toast handling.
 *   - RBAC-gated "+ Pridať" button (ASSET_MANAGER + ADMIN) and per-row
 *     "Vymazať" button (ADMIN only).
 *
 * Out of scope for this iteration (deferred to a later slice):
 *   - Edit modal (UpdateCategorySchema is already wired into the
 *     hooks layer; just need the form UI).
 *   - Color / icon / approvers / maxLoanDays editing.
 *   - Tree view (parent-child indentation in the table). Today we
 *     render a flat list with the parent's name resolved by ID
 *     lookup; tree-mode rendering lands once we have > 10 categories
 *     in a real tenant to justify the UI complexity.
 *
 * Why no separate /categories/new route:
 *   The form is short (4 fields). A modal preserves the list context
 *   and matches the design system's create flow elsewhere (assets,
 *   loans). The route stays just /categories — simpler URL surface.
 */

export function CategoriesContent(): JSX.Element {
  const categoriesQuery = useCategories({ limit: 200 });
  const assetTypesQuery = useAssetTypes({ limit: 200 });
  const canManage = useCanManageTaxonomy();
  const canDelete = useCanDeleteTaxonomy();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CategorySummary | null>(null);

  const categories = categoriesQuery.data?.data ?? [];

  // Názvy typov majetku z per-tenant číselníka (slug → name).
  const typeNameBySlug = new Map((assetTypesQuery.data?.data ?? []).map((t) => [t.slug, t.name]));

  // Build a lookup map so we can resolve parentId → parent name in
  // the list rows. The Map is rebuilt only when categories data
  // changes — not on every row render — but at this scale it's cheap
  // enough either way.
  const byId = new Map(categories.map((c) => [c._id, c]));

  return (
    <div>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Kategórie</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Hierarchická taxonómia, podľa ktorej je majetok organizovaný.
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Pridať kategóriu
          </button>
        ) : null}
      </header>

      {categoriesQuery.isLoading ? (
        <ListSkeleton />
      ) : categoriesQuery.isError ? (
        <ErrorPanel message="Kategórie sa nepodarilo načítať. Skontroluj pripojenie a skús to znova." />
      ) : categories.length === 0 ? (
        <EmptyState canCreate={canManage} onCreate={() => setCreateOpen(true)} />
      ) : (
        <CategoriesTable
          categories={categories}
          byId={byId}
          typeNameBySlug={typeNameBySlug}
          canDelete={canDelete}
          onDelete={(category) => setDeleteTarget(category)}
        />
      )}

      {createOpen ? (
        <CategoryCreateDialog
          existingCategories={categories}
          onClose={() => setCreateOpen(false)}
          onCreated={() => setCreateOpen(false)}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteCategoryDialog category={deleteTarget} onClose={() => setDeleteTarget(null)} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

interface CategoriesTableProps {
  categories: readonly CategorySummary[];
  byId: ReadonlyMap<string, CategorySummary>;
  typeNameBySlug: ReadonlyMap<string, string>;
  canDelete: boolean;
  onDelete: (category: CategorySummary) => void;
}

function CategoriesTable({
  categories,
  byId,
  typeNameBySlug,
  canDelete,
  onDelete,
}: CategoriesTableProps): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-border-subtle bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
          <tr>
            <th scope="col" className="px-4 py-3">
              Názov
            </th>
            <th scope="col" className="px-4 py-3">
              Typ majetku
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
          {categories.map((category) => {
            const parent =
              typeof category['parentId'] === 'string'
                ? byId.get(category['parentId'] as string)
                : null;
            const isInactive = category.isActive === false;
            return (
              <tr
                key={category._id}
                className={isInactive ? 'opacity-60' : 'hover:bg-surface-subtle'}
              >
                <td className="px-4 py-3 font-medium text-text-primary">
                  {category.name}
                  {isInactive ? (
                    <span className="ml-2 rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-normal text-text-muted">
                      Neaktívne
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {typeNameBySlug.get(category.assetTypeSlug) ?? category.assetTypeSlug}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {parent ? parent.name : <span className="text-text-muted">—</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-text-muted">{category.slug}</td>
                <td className="px-4 py-3 text-right">
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => onDelete(category)}
                      aria-label={`Vymazať kategóriu ${category.name}`}
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
 * Wraps `ConfirmDeleteDialog` with the actual `useDeleteCategory`
 * mutation. Kept as a small component instead of inlining the
 * mutation into `CategoriesContent` because the mutation hook needs
 * to live inside the conditionally-rendered subtree to avoid the
 * "hook order" rule violation when `deleteTarget` flips from null to
 * a category mid-render.
 */
function DeleteCategoryDialog({
  category,
  onClose,
}: {
  category: CategorySummary;
  onClose: () => void;
}): JSX.Element {
  const deleteCategory = useDeleteCategory();

  return (
    <ConfirmDeleteDialog
      title={`Vymazať kategóriu ${category.name}?`}
      description="Kategória sa označí ako zmazaná. Záznam zostane v databáze kvôli auditu, ale prestane sa zobrazovať vo všetkých zoznamoch."
      confirmLabel="Vymazať"
      isPending={deleteCategory.isPending}
      error={deleteCategory.error?.message ?? null}
      onConfirm={() => {
        deleteCategory.mutate(
          { id: category._id },
          {
            onSuccess: onClose,
            // onError is handled via deleteCategory.error above — the
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
      aria-label="Načítavam kategórie"
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
      <p className="text-sm font-medium text-text-primary">Zatiaľ nemáte žiadne kategórie.</p>
      <p className="mt-1 text-sm text-text-secondary">
        Kategórie organizujú majetok do skupín a určujú pravidlá schvaľovania.
        {canCreate ? ' Začnite vytvorením prvej.' : null}
      </p>
      {canCreate ? (
        <button
          type="button"
          onClick={onCreate}
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Pridať prvú kategóriu
        </button>
      ) : null}
    </div>
  );
}

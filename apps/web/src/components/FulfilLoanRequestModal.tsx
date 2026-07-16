// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { AlertCircle, Check, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import type { AssetSummary, FulfilLoanRequestItem, LoanRequestSummary } from '@/lib/api-hooks';
import type { JSX } from 'react';

import { Combobox } from '@/components/Combobox';
import { DateField } from '@/components/DateField';
import { useAssets, useCategories, useFulfilLoanRequest } from '@/lib/api-hooks';
import { buildGroupedCategoryOptions } from '@/lib/category-tree';

/**
 * FulfilLoanRequestModal — obrazovka vydávania z katalógovej žiadosti (ADR-0026, K5).
 *
 * Správca pre každú položku žiadosti mapuje:
 *   - SERIALIZED kategória → výber konkrétnych AVAILABLE kusov
 *   - BULK kategória → zadanie množstva PRE KAŽDÚ bulk položku v kategórii
 *     (kategória môže obsahovať viac bulk assetov, napr. "SAP licencia" a
 *     "Office licencia" pod kategóriou "Software" — 2026-07-16 fix, dovtedy
 *     sa vždy ticho vydala len prvá nájdená).
 *
 * Žiadosť je len ORIENTAČNÝ PODNET (2026-07-16, potvrdené s Janikou) —
 * žiadané množstvo NIE JE strop. Správca môže vydať viac, menej, alebo
 * úplne inú kategóriu, než bola žiadaná ("Položky navyše" sekcia nižšie) —
 * napr. keď žiadateľ zabudol poprosiť o predlžovačku k notebooku. Položky
 * navyše sa dopíšu do žiadosti ako nová položka (server-side, vidno v
 * histórii žiadosti), nie sú viazané na pôvodný requestItemIndex.
 *
 * Vydanie môže byť čiastočné. closeRemainder uzavrie žiadosť aj s nevydaným
 * zvyškom (počíta sa len z pôvodne žiadaných položiek).
 */

interface Props {
  request: LoanRequestSummary;
  onClose: () => void;
}

interface ExtraItemDraft {
  /** Lokálne id pre React key (nie je to categoryId). */
  key: string;
  categoryId: string;
  serializedSel: Set<string>;
}

function makeEmptyExtraItem(): ExtraItemDraft {
  return {
    key: `extra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    categoryId: '',
    serializedSel: new Set(),
  };
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toISOFromDateInput(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return new Date(`${y}-${m}-${d}T23:59:59.000Z`).toISOString();
}

export function FulfilLoanRequestModal({ request, onClose }: Props): JSX.Element {
  const fulfil = useFulfilLoanRequest();
  const assetsQuery = useAssets({ limit: 200 });
  const categoriesQuery = useCategories({ limit: 200 });
  const allAssets = assetsQuery.data?.data ?? [];

  const { options: categoryOptions, groupById: categoryGroupById } = buildGroupedCategoryOptions(
    (categoriesQuery.data?.data ?? []).filter((c) => c.isActive),
  );

  // Per-request-item výber: index položky → set assetId (SERIALIZED).
  const [serializedSel, setSerializedSel] = useState<Record<number, Set<string>>>({});
  // Množstvo pre BULK assety — kľúč `${scope}:${assetId}`, scope = `req:${idx}` alebo `extra:${extraKey}`.
  const [bulkQty, setBulkQty] = useState<Record<string, number>>({});

  const [extraItems, setExtraItems] = useState<ExtraItemDraft[]>([]);

  const [dueType, setDueType] = useState<'fixed' | 'open'>(
    request.plannedTo == null ? 'open' : 'fixed',
  );
  const [dueAt, setDueAt] = useState(
    request.plannedTo
      ? toDateInputValue(new Date(request.plannedTo))
      : toDateInputValue(new Date(Date.now() + 7 * 86400000)),
  );
  const [closeRemainder, setCloseRemainder] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function toggleAsset(itemIndex: number, assetId: string): void {
    setSerializedSel((prev) => {
      const next = { ...prev };
      const set = new Set(next[itemIndex] ?? []);
      if (set.has(assetId)) set.delete(assetId);
      else set.add(assetId);
      next[itemIndex] = set;
      return next;
    });
  }

  function setBulkQtyFor(key: string, n: number): void {
    setBulkQty((prev) => ({ ...prev, [key]: Number.isNaN(n) ? 0 : Math.max(0, n) }));
  }

  function addExtraItem(): void {
    setExtraItems((prev) => [...prev, makeEmptyExtraItem()]);
  }

  function removeExtraItem(key: string): void {
    setExtraItems((prev) => prev.filter((it) => it.key !== key));
    setBulkQty((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (k.startsWith(`extra:${key}:`)) delete next[k];
      }
      return next;
    });
  }

  function updateExtraItemCategory(key: string, categoryId: string): void {
    setExtraItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, categoryId, serializedSel: new Set() } : it)),
    );
  }

  function toggleExtraAsset(key: string, assetId: string): void {
    setExtraItems((prev) =>
      prev.map((it) => {
        if (it.key !== key) return it;
        const set = new Set(it.serializedSel);
        if (set.has(assetId)) set.delete(assetId);
        else set.add(assetId);
        return { ...it, serializedSel: set };
      }),
    );
  }

  function buildFulfilItems(): FulfilLoanRequestItem[] {
    const result: FulfilLoanRequestItem[] = [];

    request.items.forEach((item, idx) => {
      const categoryAssets = allAssets.filter((a) => a.categoryId === item.categoryId);
      const bulkAssets = categoryAssets.filter((a) => a.trackingMode === 'BULK');

      if (bulkAssets.length > 0) {
        for (const bulkAsset of bulkAssets) {
          const qty = bulkQty[`req:${idx}:${bulkAsset._id}`] ?? 0;
          if (qty > 0) {
            result.push({
              requestItemIndex: idx,
              type: 'BULK',
              bulkItemId: bulkAsset._id,
              quantity: qty,
            });
          }
        }
      } else {
        const selected = Array.from(serializedSel[idx] ?? []);
        if (selected.length > 0) {
          result.push({ requestItemIndex: idx, type: 'SERIALIZED', assetIds: selected });
        }
      }
    });

    for (const extra of extraItems) {
      if (!extra.categoryId) continue;
      const categoryAssets = allAssets.filter((a) => a.categoryId === extra.categoryId);
      const bulkAssets = categoryAssets.filter((a) => a.trackingMode === 'BULK');

      if (bulkAssets.length > 0) {
        for (const bulkAsset of bulkAssets) {
          const qty = bulkQty[`extra:${extra.key}:${bulkAsset._id}`] ?? 0;
          if (qty > 0) {
            result.push({
              type: 'EXTRA_BULK',
              categoryId: extra.categoryId,
              bulkItemId: bulkAsset._id,
              quantity: qty,
            });
          }
        }
      } else {
        const selected = Array.from(extra.serializedSel);
        if (selected.length > 0) {
          result.push({
            type: 'EXTRA_SERIALIZED',
            categoryId: extra.categoryId,
            assetIds: selected,
          });
        }
      }
    }

    return result;
  }

  function handleSubmit(): void {
    setFormError(null);
    const items = buildFulfilItems();
    if (items.length === 0) {
      setFormError('Vyberte aspoň jeden kus alebo zadajte množstvo na vydanie.');
      return;
    }

    fulfil.mutate(
      {
        id: request._id,
        input: {
          items,
          dueAt: dueType === 'fixed' ? toISOFromDateInput(dueAt) : null,
          closeRemainder,
        },
      },
      {
        onSuccess: () => onClose(),
        onError: (e) => setFormError(e.message),
      },
    );
  }

  return (
    <tr>
      <td colSpan={5} className="bg-surface-subtle p-0">
        <div className="border-y-2 border-brand-primary/30 px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">
              Vydanie majetku — {request.purpose}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Zavrieť"
              className="rounded p-1 text-text-muted hover:bg-surface-card hover:text-text-primary"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>

          {assetsQuery.isLoading ? (
            <p className="text-sm text-text-muted">Načítavam dostupný majetok…</p>
          ) : (
            <div className="flex flex-col gap-4">
              {request.items.map((item, idx) => {
                const remaining = item.quantityRequested - (item.quantityFulfilled ?? 0);
                const categoryAssets = allAssets.filter((a) => a.categoryId === item.categoryId);
                const bulkAssets = categoryAssets.filter((a) => a.trackingMode === 'BULK');
                const isBulk = bulkAssets.length > 0;
                const availableSerialized = categoryAssets.filter(
                  (a) => a.trackingMode !== 'BULK' && a.status === 'AVAILABLE',
                );
                const selectedCount = (serializedSel[idx] ?? new Set()).size;

                return (
                  <div
                    key={`${item.categoryId}-${idx}`}
                    className="rounded-lg border border-border-subtle bg-surface-card p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium text-text-primary">
                        {item.categorySnapshot.name}
                      </span>
                      <span className="text-xs text-text-muted">
                        Žiadané {item.quantityRequested}, vydané {item.quantityFulfilled ?? 0}
                        {remaining > 0 ? `, zostáva ${remaining}` : ' — plne vydané ✓'}
                        {isBulk ? ' (BULK)' : ` · vybraté ${selectedCount}`}
                      </span>
                    </div>

                    {isBulk ? (
                      <BulkQuantityRows
                        scope={`req:${idx}`}
                        bulkAssets={bulkAssets}
                        bulkQty={bulkQty}
                        onChange={setBulkQtyFor}
                      />
                    ) : (
                      <SerializedAssetList
                        assets={availableSerialized}
                        selected={serializedSel[idx] ?? new Set()}
                        onToggle={(assetId) => toggleAsset(idx, assetId)}
                      />
                    )}
                  </div>
                );
              })}

              {/* Položky navyše — mimo pôvodnej žiadosti (2026-07-16) */}
              <div className="rounded-lg border border-dashed border-border-default p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-text-primary">
                    Položky navyše (mimo žiadosti)
                  </span>
                  <button
                    type="button"
                    onClick={addExtraItem}
                    className="inline-flex items-center gap-1 rounded-lg border border-border-default bg-surface-card px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-surface-subtle"
                  >
                    <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                    Pridať položku
                  </button>
                </div>

                {extraItems.length === 0 ? (
                  <p className="text-xs text-text-muted">
                    Napr. keď žiadateľ zabudol poprosiť o predlžovačku k notebooku — pridajte ju
                    sem, dopíše sa do žiadosti.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {extraItems.map((extra) => {
                      const categoryAssets = allAssets.filter(
                        (a) => a.categoryId === extra.categoryId,
                      );
                      const bulkAssets = categoryAssets.filter((a) => a.trackingMode === 'BULK');
                      const isBulk = bulkAssets.length > 0;
                      const availableSerialized = categoryAssets.filter(
                        (a) => a.trackingMode !== 'BULK' && a.status === 'AVAILABLE',
                      );

                      return (
                        <div
                          key={extra.key}
                          className="rounded-lg border border-border-subtle bg-surface-page p-3"
                        >
                          <div className="mb-2 flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <Combobox
                                ariaLabel="Kategória (navyše)"
                                placeholder="Vyberte kategóriu…"
                                value={extra.categoryId || null}
                                onChange={(v) => updateExtraItemCategory(extra.key, v ?? '')}
                                options={categoryOptions}
                                groupOf={(o) => categoryGroupById[o.id]}
                                visibleLimit={100}
                                className="w-full"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => removeExtraItem(extra.key)}
                              aria-label="Odstrániť položku navyše"
                              className="rounded p-1.5 text-text-muted hover:bg-surface-card hover:text-danger-fg"
                            >
                              <Trash2 aria-hidden="true" className="h-4 w-4" />
                            </button>
                          </div>

                          {!extra.categoryId ? null : isBulk ? (
                            <BulkQuantityRows
                              scope={`extra:${extra.key}`}
                              bulkAssets={bulkAssets}
                              bulkQty={bulkQty}
                              onChange={setBulkQtyFor}
                            />
                          ) : (
                            <SerializedAssetList
                              assets={availableSerialized}
                              selected={extra.serializedSel}
                              onToggle={(assetId) => toggleExtraAsset(extra.key, assetId)}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Due date */}
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <p className="mb-1.5 text-sm font-medium text-text-primary">Termín vrátenia</p>
                  <div className="flex overflow-hidden rounded-lg border border-border-default bg-surface-subtle">
                    <button
                      type="button"
                      onClick={() => setDueType('fixed')}
                      aria-pressed={dueType === 'fixed'}
                      className={`px-3 py-2 text-sm font-medium transition ${
                        dueType === 'fixed'
                          ? 'bg-brand-primary text-white'
                          : 'text-text-secondary hover:bg-surface-card'
                      }`}
                    >
                      Dátum
                    </button>
                    <button
                      type="button"
                      onClick={() => setDueType('open')}
                      aria-pressed={dueType === 'open'}
                      className={`px-3 py-2 text-sm font-medium transition ${
                        dueType === 'open'
                          ? 'bg-brand-primary text-white'
                          : 'text-text-secondary hover:bg-surface-card'
                      }`}
                    >
                      Do odvolania
                    </button>
                  </div>
                </div>
                {dueType === 'fixed' && (
                  <DateField
                    label="Termín vrátenia"
                    value={dueAt}
                    onChange={setDueAt}
                    className="w-40"
                  />
                )}
              </div>

              {/* Close remainder */}
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={closeRemainder}
                  onChange={(e) => setCloseRemainder(e.target.checked)}
                  className="h-4 w-4 rounded border-border-default text-brand-primary focus:ring-brand-primary"
                />
                Po tomto vydaní uzavrieť žiadosť (nevydaný zvyšok pôvodných položiek prepadne)
              </label>

              {formError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-danger-fg bg-danger-bg p-2.5 text-sm text-danger-fg"
                >
                  <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-border-default bg-surface-card px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-subtle"
                >
                  Zrušiť
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={fulfil.isPending}
                  className="rounded-lg bg-brand-primary px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {fulfil.isPending ? 'Vydávam…' : 'Vydať'}
                </button>
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// BulkQuantityRows — pole na množstvo pre KAŽDÚ bulk položku v kategórii
// (kategória môže obsahovať viac bulk assetov, napr. "SAP licencia" a
// "Office licencia" pod "Software" — 2026-07-16 fix).
// ---------------------------------------------------------------------------

function BulkQuantityRows({
  scope,
  bulkAssets,
  bulkQty,
  onChange,
}: {
  scope: string;
  bulkAssets: readonly AssetSummary[];
  bulkQty: Record<string, number>;
  onChange: (key: string, n: number) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {bulkAssets.map((asset) => {
        const key = `${scope}:${asset._id}`;
        return (
          <div key={asset._id} className="flex items-center gap-2">
            <label
              htmlFor={`bulk-qty-${key}`}
              className="min-w-0 flex-1 text-sm text-text-secondary"
            >
              {asset.name}
              {asset.quantityOnHand != null && (
                <span className="ml-1 text-xs text-text-muted">
                  (skladom {asset.quantityOnHand})
                </span>
              )}
            </label>
            <input
              id={`bulk-qty-${key}`}
              type="number"
              min={0}
              value={bulkQty[key] ?? ''}
              onChange={(e) => onChange(key, parseInt(e.target.value, 10))}
              className="h-9 w-20 shrink-0 rounded-lg border border-border-default bg-surface-card text-center text-sm text-text-primary focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
            />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SerializedAssetList — zoznam dostupných kusov na výber (bez stropu —
// žiadosť je len orientačný podnet, 2026-07-16).
// ---------------------------------------------------------------------------

function SerializedAssetList({
  assets,
  selected,
  onToggle,
}: {
  assets: readonly AssetSummary[];
  selected: ReadonlySet<string>;
  onToggle: (assetId: string) => void;
}): JSX.Element {
  if (assets.length === 0) {
    return <p className="text-xs text-text-muted">Žiadne dostupné kusy v tejto kategórii.</p>;
  }

  return (
    <ul className="max-h-40 overflow-y-auto rounded-lg border border-border-subtle divide-y divide-border-subtle">
      {assets.map((asset) => {
        const sel = selected.has(asset._id);
        return (
          <li key={asset._id}>
            <button
              type="button"
              onClick={() => onToggle(asset._id)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                sel
                  ? 'bg-brand-primary/10 text-text-primary'
                  : 'text-text-secondary hover:bg-surface-subtle'
              }`}
            >
              <span>
                <span className="font-medium text-text-primary">{asset.inventoryNumber}</span>
                <span className="ml-1.5">{asset.name}</span>
              </span>
              {sel && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-primary" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { AlertCircle, Check, X } from 'lucide-react';
import { useState } from 'react';

import type { FulfilLoanRequestItem, LoanRequestSummary } from '@/lib/api-hooks';
import type { JSX } from 'react';

import { DateField } from '@/components/DateField';
import { useAssets, useFulfilLoanRequest } from '@/lib/api-hooks';

/**
 * FulfilLoanRequestModal — obrazovka vydávania z katalógovej žiadosti (ADR-0026, K5).
 *
 * Správca pre každú položku žiadosti so zostatkom > 0 mapuje:
 *   - SERIALIZED kategória → výber konkrétnych AVAILABLE kusov
 *   - BULK kategória → zadanie množstva
 *
 * Vydanie môže byť čiastočné. closeRemainder uzavrie žiadosť aj s nevydaným zvyškom.
 * Vydaním vzniká jeden Loan.
 */

interface Props {
  request: LoanRequestSummary;
  onClose: () => void;
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
  const allAssets = assetsQuery.data?.data ?? [];

  // Per-item výber: index položky → set assetId (SERIALIZED) alebo množstvo (BULK)
  const [serializedSel, setSerializedSel] = useState<Record<number, Set<string>>>({});
  const [bulkQty, setBulkQty] = useState<Record<number, number>>({});

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

  function buildFulfilItems(): FulfilLoanRequestItem[] {
    const result: FulfilLoanRequestItem[] = [];
    request.items.forEach((item, idx) => {
      const remaining = item.quantityRequested - (item.quantityFulfilled ?? 0);
      if (remaining <= 0) return;

      // BULK kategória? Zistíme z dostupných assetov tejto kategórie
      const categoryAssets = allAssets.filter((a) => a.categoryId === item.categoryId);
      const isBulk = categoryAssets.some((a) => a.trackingMode === 'BULK');

      if (isBulk) {
        const qty = bulkQty[idx] ?? 0;
        const bulkAsset = categoryAssets.find((a) => a.trackingMode === 'BULK');
        if (qty > 0 && bulkAsset) {
          result.push({
            requestItemIndex: idx,
            type: 'BULK',
            bulkItemId: bulkAsset._id,
            quantity: qty,
          });
        }
      } else {
        const selected = Array.from(serializedSel[idx] ?? []);
        if (selected.length > 0) {
          result.push({ requestItemIndex: idx, type: 'SERIALIZED', assetIds: selected });
        }
      }
    });
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
                if (remaining <= 0) {
                  return (
                    <div key={`${item.categoryId}-${idx}`} className="text-sm text-text-muted">
                      {item.categorySnapshot.name} — plne vydané ✓
                    </div>
                  );
                }

                const categoryAssets = allAssets.filter((a) => a.categoryId === item.categoryId);
                const isBulk = categoryAssets.some((a) => a.trackingMode === 'BULK');
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
                        Žiadané {item.quantityRequested}, zostáva {remaining}
                        {isBulk ? ' (BULK)' : ` · vybraté ${selectedCount}`}
                      </span>
                    </div>

                    {isBulk ? (
                      <div className="flex items-center gap-2">
                        <label htmlFor={`bulk-qty-${idx}`} className="text-sm text-text-secondary">
                          Množstvo na vydanie:
                        </label>
                        <input
                          id={`bulk-qty-${idx}`}
                          type="number"
                          min={0}
                          max={remaining}
                          value={bulkQty[idx] ?? ''}
                          onChange={(e) => {
                            const n = parseInt(e.target.value, 10);
                            setBulkQty((prev) => ({
                              ...prev,
                              [idx]: Number.isNaN(n) ? 0 : Math.min(remaining, Math.max(0, n)),
                            }));
                          }}
                          className="h-9 w-20 rounded-lg border border-border-default bg-surface-card text-center text-sm text-text-primary focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                        />
                      </div>
                    ) : availableSerialized.length === 0 ? (
                      <p className="text-xs text-text-muted">
                        Žiadne dostupné kusy v tejto kategórii.
                      </p>
                    ) : (
                      <ul className="max-h-40 overflow-y-auto rounded-lg border border-border-subtle divide-y divide-border-subtle">
                        {availableSerialized.map((asset) => {
                          const sel = (serializedSel[idx] ?? new Set()).has(asset._id);
                          const atLimit = !sel && selectedCount >= remaining;
                          return (
                            <li key={asset._id}>
                              <button
                                type="button"
                                onClick={() => toggleAsset(idx, asset._id)}
                                disabled={atLimit}
                                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                                  sel
                                    ? 'bg-brand-primary/10 text-text-primary'
                                    : 'text-text-secondary hover:bg-surface-subtle disabled:opacity-40'
                                }`}
                              >
                                <span>
                                  <span className="font-medium text-text-primary">
                                    {asset.inventoryNumber}
                                  </span>
                                  <span className="ml-1.5">{asset.name}</span>
                                </span>
                                {sel && (
                                  <Check
                                    aria-hidden="true"
                                    className="h-4 w-4 shrink-0 text-brand-primary"
                                  />
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}

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
                Po tomto vydaní uzavrieť žiadosť (nevydaný zvyšok prepadne)
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

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { AlertCircle, PackageCheck, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { BorrowedItemSummary, ReturnItemsForBorrowerItemInput } from '@/lib/api-hooks';
import type { JSX } from 'react';

import { useBorrowerBorrowedItems, useMe, useReturnItemsFromBorrower } from '@/lib/api-hooks';

/**
 * ReturnFromPersonModal — vrátenie ľubovoľnej podmnožiny majetku jednej
 * osoby, prípadne cez viacero výpožičiek naraz (ADR-0036, "Vrátiť od
 * osoby"). Doplnková cesta popri ReturnLoanModal (ktorý vracia CELÚ jednu
 * konkrétnu výpožičku naraz a ostáva nezmenený) — tu si správca vyberie
 * ľubovoľnú podmnožinu z VŠETKÉHO, čo osoba aktuálne má požičané, a všetko
 * sa vráti jedným konsolidovaným RETURN protokolom, aj keď kusy pochádzajú
 * z rôznych pôvodných žiadostí/výpožičiek.
 *
 * `condition` per kus je rovnaký fixný enum ako v ReturnLoanModal — pozri
 * poznámku tam o číselníku Stavy (mimo rozsahu tejto zmeny).
 *
 * `returnedTo` je vždy aktuálny prihlásený správca — bez pickera, rovnaká
 * konvencia ako ReturnLoanModal/RETURN protokol.
 */

const CONDITION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'NEW', label: 'Nové' },
  { value: 'EXCELLENT', label: 'Vynikajúce' },
  { value: 'GOOD', label: 'Dobré' },
  { value: 'FAIR', label: 'Použiteľné' },
  { value: 'POOR', label: 'Opotrebované' },
  { value: 'UNUSABLE', label: 'Nepoužiteľné' },
];

interface ItemDraft {
  loanId: string;
  assetId: string;
  label: string;
  purpose: string;
  selected: boolean;
  condition: string;
  note: string;
  requiresService: boolean;
}

interface Props {
  borrowerId: string;
  borrowerDisplayName: string;
  onClose: () => void;
}

function itemsToDrafts(items: readonly BorrowedItemSummary[]): ItemDraft[] {
  return items.map((item) => ({
    loanId: item.loanId,
    assetId: item.assetId,
    label:
      item.quantity != null
        ? `${item.snapshot.name} (${item.quantity} ks)`
        : `${item.snapshot.inventoryNumber} — ${item.snapshot.name}`,
    purpose: item.purpose,
    selected: false,
    condition: 'GOOD',
    note: '',
    requiresService: false,
  }));
}

export function ReturnFromPersonModal({
  borrowerId,
  borrowerDisplayName,
  onClose,
}: Props): JSX.Element {
  const me = useMe();
  const borrowedItemsQuery = useBorrowerBorrowedItems(borrowerId);
  const returnItems = useReturnItemsFromBorrower();
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  const [items, setItems] = useState<ItemDraft[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Naplní draft-y až keď dáta dorazia — `useState(() => ...)` by bežal len
  // pri prvom rendri, kým dáta ešte nemusia byť načítané.
  useEffect(() => {
    if (!initialized && borrowedItemsQuery.data) {
      setItems(itemsToDrafts(borrowedItemsQuery.data));
      setInitialized(true);
    }
  }, [initialized, borrowedItemsQuery.data]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !returnItems.isPending) {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, returnItems.isPending]);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  function updateItem(assetId: string, loanId: string, patch: Partial<ItemDraft>): void {
    setItems((prev) =>
      prev.map((it) => (it.assetId === assetId && it.loanId === loanId ? { ...it, ...patch } : it)),
    );
  }

  const groupedByLoan = useMemo(() => {
    const groups = new Map<string, { purpose: string; items: ItemDraft[] }>();
    for (const item of items) {
      const group = groups.get(item.loanId) ?? { purpose: item.purpose, items: [] };
      group.items.push(item);
      groups.set(item.loanId, group);
    }
    return [...groups.entries()];
  }, [items]);

  const selectedCount = items.filter((it) => it.selected).length;
  const anyRequiresService = items.some((it) => it.selected && it.requiresService);

  function handleSubmit(): void {
    setFormError(null);
    if (!me.data) {
      setFormError('Načítavam aktuálneho používateľa, skúste znova o chvíľu.');
      return;
    }
    const selected = items.filter((it) => it.selected);
    if (selected.length === 0) {
      setFormError('Vyberte aspoň jeden kus na vrátenie.');
      return;
    }

    const payloadItems: ReturnItemsForBorrowerItemInput[] = selected.map((it) => ({
      loanId: it.loanId,
      assetId: it.assetId,
      condition: it.condition,
      note: it.note.trim() === '' ? null : it.note.trim(),
      requiresService: it.requiresService,
    }));

    void (async () => {
      try {
        await returnItems.mutateAsync({
          borrowerId,
          input: {
            returnedTo: me.data!._id,
            items: payloadItems,
            notes: notes.trim() === '' ? null : notes.trim(),
          },
        });
        onClose();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Vrátenie majetku zlyhalo.');
      }
    })();
  }

  const isLoading = borrowedItemsQuery.isLoading && !initialized;
  const isBusy = returnItems.isPending;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="return-from-person-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col gap-0 overflow-hidden rounded-t-2xl bg-surface-card shadow-xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-6 py-4">
          <div>
            <h2 id="return-from-person-title" className="text-lg font-semibold text-text-primary">
              Vrátiť majetok
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">{borrowerDisplayName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            aria-label="Zatvoriť"
            className="rounded-lg p-1.5 text-text-muted transition hover:bg-surface-subtle hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5">
          {isLoading ? (
            <p className="text-sm text-text-secondary">Načítavam požičaný majetok…</p>
          ) : borrowedItemsQuery.isError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-danger-fg bg-danger-bg p-3 text-sm text-danger-fg"
            >
              <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Zoznam požičaného majetku sa nepodarilo načítať.</span>
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-text-secondary">Táto osoba nemá aktuálne nič požičané.</p>
          ) : (
            <div className="space-y-5">
              {groupedByLoan.map(([loanId, group]) => (
                <div key={loanId}>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                    {group.purpose}
                  </p>
                  <div className="space-y-3">
                    {group.items.map((item) => (
                      <div
                        key={`${item.loanId}-${item.assetId}`}
                        className="rounded-lg border border-border-subtle bg-surface-page/40 p-3"
                      >
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={item.selected}
                            onChange={(e) =>
                              updateItem(item.assetId, item.loanId, {
                                selected: e.target.checked,
                              })
                            }
                            className="mt-0.5 h-4 w-4 rounded border-border-default text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                          />
                          <span className="font-medium text-text-primary">{item.label}</span>
                        </label>

                        {item.selected && (
                          <div className="mt-2 grid grid-cols-1 gap-3 pl-6 sm:grid-cols-2">
                            <label className="flex flex-col gap-1 text-sm">
                              <span className="text-text-secondary">Stav pri vrátení</span>
                              <select
                                value={item.condition}
                                onChange={(e) =>
                                  updateItem(item.assetId, item.loanId, {
                                    condition: e.target.value,
                                  })
                                }
                                className="rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                              >
                                {CONDITION_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="flex flex-col gap-1 text-sm">
                              <span className="text-text-secondary">Poznámka</span>
                              <input
                                type="text"
                                value={item.note}
                                onChange={(e) =>
                                  updateItem(item.assetId, item.loanId, { note: e.target.value })
                                }
                                placeholder="Voliteľné"
                                className="rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary placeholder-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                              />
                            </label>

                            <label className="col-span-full flex items-center gap-2 text-sm text-text-secondary">
                              <input
                                type="checkbox"
                                checked={item.requiresService}
                                onChange={(e) =>
                                  updateItem(item.assetId, item.loanId, {
                                    requiresService: e.target.checked,
                                  })
                                }
                                className="h-4 w-4 rounded border-border-default text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                              />
                              Vyžaduje servis
                            </label>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-text-primary">Celková poznámka k vráteniu</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Voliteľné"
                  className="rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary placeholder-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                />
              </label>

              {anyRequiresService && (
                <p className="text-xs text-amber-700">
                  Aspoň jedna vybraná položka vyžaduje servis — príslušná výpožička sa označí ako{' '}
                  <strong>Poškodená</strong> namiesto Vrátenej.
                </p>
              )}
            </div>
          )}

          {formError && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-lg border border-danger-fg bg-danger-bg p-3 text-sm text-danger-fg"
            >
              <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border-subtle bg-surface-page/50 px-6 py-3 sm:flex-row sm:justify-between sm:items-center">
          <p className="text-xs text-text-secondary">
            {selectedCount > 0 ? `Vybrané: ${selectedCount} kus/ov` : ' '}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              ref={cancelButtonRef}
              onClick={onClose}
              disabled={isBusy}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-card px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              Zrušiť
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isBusy || items.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
              aria-live="polite"
            >
              <PackageCheck aria-hidden="true" className="h-4 w-4" />
              {isBusy ? 'Vraciam…' : 'Vrátiť vybrané'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

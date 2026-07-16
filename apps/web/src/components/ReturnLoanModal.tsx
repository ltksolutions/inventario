// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { AlertCircle, PackageCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { LoanSummary, ReturnLoanItemInput } from '@/lib/api-hooks';
import type { JSX } from 'react';

import { useMe, useReturnLoan } from '@/lib/api-hooks';

/**
 * ReturnLoanModal — vrátenie AKTÍVNEJ výpožičky (POST /v1/loans/:id/return).
 *
 * Backend vyžaduje v OBÁLKE naraz VŠETKY položky výpožičky (žiadne
 * čiastočné vrátenie — Fáza 2, ADR-0020) — modal preto zobrazí každú
 * položku s vlastným stavom pri vrátení a "vyžaduje servis" príznakom,
 * bez možnosti niektorú vynechať.
 *
 * `condition` per položka je FIXNÝ enum (NEW/EXCELLENT/GOOD/FAIR/POOR/
 * UNUSABLE) — nie slug z dynamického číselníka "Stavy". Loan modul ešte
 * nebol migrovaný na číselník (fulfilLoanRequest tiež hardkóduje 'GOOD'
 * pri prevzatí) — je to existujúca, samostatná medzera, neriešime ju tu.
 *
 * `returnedTo` je vždy aktuálny prihlásený správca (preberajúci) — rovnaká
 * konvencia ako pri RETURN protokole (loans.service.ts: "pri vrátení:
 * odovzdávajúci = borrower, preberajúci = správca"). Žiadny picker.
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
  assetId: string;
  label: string;
  condition: string;
  note: string;
  requiresService: boolean;
}

interface Props {
  loan: LoanSummary;
  onClose: () => void;
}

export function ReturnLoanModal({ loan, onClose }: Props): JSX.Element {
  const me = useMe();
  const returnLoan = useReturnLoan();
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  const [items, setItems] = useState<ItemDraft[]>(() =>
    loan.items.map((item) => ({
      assetId: item.assetId,
      label:
        item.quantity != null
          ? `${item.snapshot.name} (${item.quantity} ks)`
          : `${item.snapshot.inventoryNumber} — ${item.snapshot.name}`,
      condition: 'GOOD',
      note: '',
      requiresService: false,
    })),
  );
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !returnLoan.isPending) {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, returnLoan.isPending]);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  function updateItem(assetId: string, patch: Partial<ItemDraft>): void {
    setItems((prev) => prev.map((it) => (it.assetId === assetId ? { ...it, ...patch } : it)));
  }

  function handleSubmit(): void {
    setFormError(null);
    if (!me.data) {
      setFormError('Načítavam aktuálneho používateľa, skúste znova o chvíľu.');
      return;
    }

    const payloadItems: ReturnLoanItemInput[] = items.map((it) => ({
      assetId: it.assetId,
      condition: it.condition,
      note: it.note.trim() === '' ? null : it.note.trim(),
      requiresService: it.requiresService,
    }));

    void (async () => {
      try {
        await returnLoan.mutateAsync({
          id: loan._id,
          input: {
            returnedTo: me.data!._id,
            items: payloadItems,
            notes: notes.trim() === '' ? null : notes.trim(),
          },
        });
        onClose();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Vrátenie výpožičky zlyhalo.');
      }
    })();
  }

  const anyRequiresService = items.some((it) => it.requiresService);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="return-loan-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col gap-0 overflow-hidden rounded-t-2xl bg-surface-card shadow-xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-6 py-4">
          <div>
            <h2 id="return-loan-title" className="text-lg font-semibold text-text-primary">
              Vrátiť výpožičku
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              {loan.borrowerDisplayName ?? '—'} · {loan.purpose}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={returnLoan.isPending}
            aria-label="Zatvoriť"
            className="rounded-lg p-1.5 text-text-muted transition hover:bg-surface-subtle hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5">
          <div className="space-y-4">
            {items.map((item) => (
              <div
                key={item.assetId}
                className="rounded-lg border border-border-subtle bg-surface-page/40 p-3"
              >
                <p className="text-sm font-medium text-text-primary">{item.label}</p>

                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-text-secondary">Stav pri vrátení</span>
                    <select
                      value={item.condition}
                      onChange={(e) => updateItem(item.assetId, { condition: e.target.value })}
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
                      onChange={(e) => updateItem(item.assetId, { note: e.target.value })}
                      placeholder="Voliteľné"
                      className="rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                    />
                  </label>
                </div>

                <label className="mt-2 flex items-center gap-2 text-sm text-text-secondary">
                  <input
                    type="checkbox"
                    checked={item.requiresService}
                    onChange={(e) =>
                      updateItem(item.assetId, { requiresService: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-border-default text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                  />
                  Vyžaduje servis
                </label>
              </div>
            ))}
          </div>

          <label className="mt-4 flex flex-col gap-1 text-sm">
            <span className="font-medium text-text-primary">Celková poznámka k vráteniu</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Voliteľné"
              className="rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            />
          </label>

          {anyRequiresService && (
            <p className="mt-3 text-xs text-amber-700">
              Aspoň jedna položka vyžaduje servis — výpožička sa označí ako{' '}
              <strong>Poškodená</strong> namiesto Vrátenej.
            </p>
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

        <div className="flex flex-col-reverse gap-2 border-t border-border-subtle bg-surface-page/50 px-6 py-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            ref={cancelButtonRef}
            onClick={onClose}
            disabled={returnLoan.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-card px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            Zrušiť
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={returnLoan.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
            aria-live="polite"
          >
            <PackageCheck aria-hidden="true" className="h-4 w-4" />
            {returnLoan.isPending ? 'Vraciam…' : 'Vrátiť'}
          </button>
        </div>
      </div>
    </div>
  );
}

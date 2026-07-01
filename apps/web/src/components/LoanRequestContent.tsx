// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { AlertCircle, CheckCircle, Minus, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { JSX } from 'react';

import { Combobox } from '@/components/Combobox';
import { DateField } from '@/components/DateField';
import { SelectField } from '@/components/SelectField';
import { useCategories, useCreateLoanRequest, useMe, useMembers } from '@/lib/api-hooks';
import { buildGroupedCategoryOptions } from '@/lib/category-tree';

/**
 * /loans/request — nová katalógová žiadosť o výpožičku (ADR-0026).
 *
 * Žiadateľ uvažuje v kategóriách a množstvách, NIE v konkrétnych
 * inventárnych číslach. Konkrétny majetok priradí správca pri vydaní.
 *
 * Formulár:
 *   - Položky: kategória (SelectField) + množstvo (stepper) + poznámka
 *   - Pre koho (beneficiary, ADR-0023) — default = ja
 *   - Účel
 *   - Trvanie: Na dobu určitú / Do odvolania (ADR-0025)
 *
 * Žiadosť nerezervuje majetok — je to dopyt. Správca rozhodne pri vydaní.
 */

const MAX_ITEMS = 50;

type DurationType = 'fixed' | 'open';

interface RequestItemDraft {
  /** Lokálne id pre React key (nie je to categoryId). */
  key: string;
  categoryId: string;
  quantity: number;
  note: string;
}

function makeEmptyItem(): RequestItemDraft {
  return {
    key: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    categoryId: '',
    quantity: 1,
    note: '',
  };
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toISOFromDateInput(dateStr: string, endOfDay = false): string {
  const [y, m, d] = dateStr.split('-');
  const date = new Date(endOfDay ? `${y}-${m}-${d}T23:59:59.000Z` : `${y}-${m}-${d}T00:00:00.000Z`);
  return date.toISOString();
}

export function LoanRequestContent(): JSX.Element {
  const router = useRouter();
  const createRequest = useCreateLoanRequest();
  const meQuery = useMe();
  const membersQuery = useMembers();
  const categoriesQuery = useCategories({ limit: 200 });

  // --- Category options (len aktívne), zoskupené podľa root kategórie ---
  // Spoločná logika s formulárom majetku (buildGroupedCategoryOptions):
  // vyberateľné len podkategórie, root bez detí ostáva vyberateľný.
  const { options: categoryOptions, groupById: categoryGroupById } = buildGroupedCategoryOptions(
    (categoriesQuery.data?.data ?? []).filter((c) => c.isActive),
  );

  // --- Items state ---
  const [items, setItems] = useState<RequestItemDraft[]>([makeEmptyItem()]);

  function addItem(): void {
    if (items.length >= MAX_ITEMS) return;
    setItems((prev) => [...prev, makeEmptyItem()]);
  }

  function removeItem(key: string): void {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.key !== key)));
  }

  function updateItem(key: string, patch: Partial<Omit<RequestItemDraft, 'key'>>): void {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  // --- Form state ---
  const today = toDateInputValue(new Date());
  const tomorrow = toDateInputValue(new Date(Date.now() + 86400000));

  const [purpose, setPurpose] = useState('');
  const [durationType, setDurationType] = useState<DurationType>('fixed');
  const [plannedFrom, setPlannedFrom] = useState(tomorrow);
  const [plannedTo, setPlannedTo] = useState(toDateInputValue(new Date(Date.now() + 7 * 86400000)));

  // Beneficiary picker — default = self (ADR-0023)
  const selfId = meQuery.data?._id ?? '';
  const [beneficiaryId, setBeneficiaryId] = useState('');
  const selfDisplayName = meQuery.data?.displayName ?? '';

  const memberOptions = (membersQuery.data?.data ?? []).map((m) => ({
    value: m._id,
    label: m._id === selfId ? `${m.displayName} (ja)` : m.displayName,
  }));
  const beneficiaryOptions =
    memberOptions.length > 0
      ? memberOptions
      : selfId
        ? [{ value: selfId, label: `${selfDisplayName} (ja)` }]
        : [];
  const effectiveBeneficiaryId = beneficiaryId || selfId;

  const [formError, setFormError] = useState<string | null>(null);

  // Aspoň jedna položka má vybranú kategóriu a množstvo ≥ 1
  const hasValidItem = items.some((it) => it.categoryId && it.quantity >= 1);

  const canSubmit =
    hasValidItem &&
    purpose.trim().length >= 3 &&
    Boolean(plannedFrom) &&
    (durationType === 'open' || (Boolean(plannedTo) && plannedFrom <= plannedTo)) &&
    !createRequest.isPending;

  function handleSubmit(): void {
    setFormError(null);

    const validItems = items.filter((it) => it.categoryId && it.quantity >= 1);
    if (validItems.length === 0) {
      setFormError('Pridajte aspoň jednu položku s kategóriou a množstvom.');
      return;
    }
    if (purpose.trim().length < 3) {
      setFormError('Účel musí mať aspoň 3 znaky.');
      return;
    }
    if (!plannedFrom) {
      setFormError('Vyplňte dátum od.');
      return;
    }
    if (durationType === 'fixed') {
      if (!plannedTo) {
        setFormError('Vyplňte dátum do.');
        return;
      }
      if (plannedFrom > plannedTo) {
        setFormError('Dátum od musí byť pred dátumom do.');
        return;
      }
    }

    createRequest.mutate(
      {
        purpose: purpose.trim(),
        plannedFrom: toISOFromDateInput(plannedFrom),
        plannedTo: durationType === 'fixed' ? toISOFromDateInput(plannedTo, true) : null,
        items: validItems.map((it) => ({
          categoryId: it.categoryId,
          quantityRequested: it.quantity,
          ...(it.note.trim() ? { note: it.note.trim() } : {}),
        })),
        ...(effectiveBeneficiaryId && effectiveBeneficiaryId !== selfId
          ? { beneficiaryId: effectiveBeneficiaryId }
          : {}),
      },
      {
        onSuccess: () => {
          router.push('/my-loans');
        },
        onError: (err) => {
          setFormError(err.message);
        },
      },
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">
          Nová žiadosť o výpožičku
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Vyberte kategóriu a množstvo, ktoré potrebujete. Konkrétny majetok priradí správca pri
          vydaní.
        </p>
      </header>

      <div className="flex flex-col gap-5">
        {/* Items */}
        <section aria-labelledby="items-heading">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="items-heading" className="text-base font-semibold text-text-primary">
              Čo potrebujete
              <span className="ml-1 text-sm font-normal text-text-muted">
                ({items.length}/{MAX_ITEMS})
              </span>
            </h2>
          </div>

          {categoriesQuery.isLoading ? (
            <p className="text-sm text-text-muted">Načítavam kategórie…</p>
          ) : categoryOptions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border-default bg-surface-card p-4 text-center text-sm text-text-muted">
              Žiadne aktívne kategórie. Najprv ich vytvorte v Číselníkoch.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((item) => (
                <li
                  key={item.key}
                  className="rounded-xl border border-border-subtle bg-surface-card p-3"
                >
                  <div className="flex items-start gap-3">
                    {/* Kategória — autocomplete, zoskupené podľa root kategórie */}
                    <div className="min-w-0 flex-1">
                      <Combobox
                        ariaLabel="Kategória"
                        placeholder="Vyberte alebo začnite písať kategóriu…"
                        value={item.categoryId || null}
                        onChange={(v) => updateItem(item.key, { categoryId: v ?? '' })}
                        options={categoryOptions}
                        groupOf={(o) => categoryGroupById[o.id]}
                        visibleLimit={100}
                        className="w-full"
                      />
                    </div>

                    {/* Množstvo stepper */}
                    <div className="shrink-0">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            updateItem(item.key, { quantity: Math.max(1, item.quantity - 1) })
                          }
                          aria-label="Znížiť množstvo"
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-default bg-surface-card text-text-secondary hover:bg-surface-subtle"
                        >
                          <Minus aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>
                        <input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e) => {
                            const n = parseInt(e.target.value, 10);
                            updateItem(item.key, {
                              quantity: Number.isNaN(n) ? 1 : Math.max(1, n),
                            });
                          }}
                          aria-label="Množstvo"
                          className="h-9 w-14 rounded-lg border border-border-default bg-surface-card text-center text-sm text-text-primary focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                        />
                        <button
                          type="button"
                          onClick={() => updateItem(item.key, { quantity: item.quantity + 1 })}
                          aria-label="Zvýšiť množstvo"
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-default bg-surface-card text-text-secondary hover:bg-surface-subtle"
                        >
                          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Remove */}
                    <button
                      type="button"
                      onClick={() => removeItem(item.key)}
                      disabled={items.length <= 1}
                      aria-label="Odstrániť položku"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-subtle hover:text-danger-fg disabled:opacity-30"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Poznámka (voliteľná) */}
                  <input
                    type="text"
                    value={item.note}
                    onChange={(e) => updateItem(item.key, { note: e.target.value })}
                    placeholder="Poznámka (voliteľné) — napr. „ak je skladom“"
                    maxLength={1000}
                    className="mt-2 w-full rounded-lg border border-border-default bg-surface-card px-3 py-1.5 text-sm text-text-primary placeholder-text-muted focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                  />
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={addItem}
            disabled={items.length >= MAX_ITEMS || categoryOptions.length === 0}
            className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-border-default px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-subtle disabled:opacity-40"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Pridať položku
          </button>
        </section>

        {/* Beneficiary */}
        <div>
          <span className="mb-1.5 block text-sm font-medium text-text-primary">
            Pre koho žiadate
          </span>
          <p className="mb-1.5 text-xs text-text-secondary">
            Osoba, ktorá si majetok vypožičia (príjemca). Predvolene ste to vy — ak žiadate za
            niekoho iného, vyberte ho zo zoznamu.
          </p>
          <SelectField
            label="Pre koho žiadate (príjemca výpožičky)"
            value={effectiveBeneficiaryId}
            onChange={setBeneficiaryId}
            options={beneficiaryOptions}
            className="w-full"
          />
        </div>

        {/* Purpose */}
        <div>
          <label htmlFor="purpose" className="mb-1.5 block text-sm font-medium text-text-primary">
            Účel výpožičky{' '}
            <span aria-hidden="true" className="text-danger-fg">
              *
            </span>
          </label>
          <textarea
            id="purpose"
            rows={2}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Napr. Tréningový kemp, Výjazd A-tímu, Konferencia…"
            maxLength={500}
            className="w-full resize-none rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
          />
        </div>

        {/* Duration type segment */}
        <div>
          <p className="mb-1.5 text-sm font-medium text-text-primary">Trvanie</p>
          <div
            role="group"
            aria-label="Trvanie výpožičky"
            className="flex overflow-hidden rounded-lg border border-border-default bg-surface-subtle"
          >
            <button
              type="button"
              onClick={() => setDurationType('fixed')}
              aria-pressed={durationType === 'fixed'}
              className={`flex-1 px-3 py-2 text-sm font-medium transition ${
                durationType === 'fixed'
                  ? 'bg-brand-primary text-white'
                  : 'text-text-secondary hover:bg-surface-card'
              }`}
            >
              Na dobu určitú
            </button>
            <button
              type="button"
              onClick={() => setDurationType('open')}
              aria-pressed={durationType === 'open'}
              className={`flex-1 px-3 py-2 text-sm font-medium transition ${
                durationType === 'open'
                  ? 'bg-brand-primary text-white'
                  : 'text-text-secondary hover:bg-surface-card'
              }`}
            >
              Do odvolania
            </button>
          </div>
        </div>

        {/* Dates */}
        <div className={`grid gap-3 ${durationType === 'fixed' ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <div>
            <label
              htmlFor="planned-from"
              className="mb-1.5 block text-sm font-medium text-text-primary"
            >
              Od{' '}
              <span aria-hidden="true" className="text-danger-fg">
                *
              </span>
            </label>
            <DateField
              id="planned-from"
              label="Od"
              value={plannedFrom}
              min={today}
              onChange={setPlannedFrom}
              required
            />
          </div>

          {durationType === 'fixed' && (
            <div>
              <label
                htmlFor="planned-to"
                className="mb-1.5 block text-sm font-medium text-text-primary"
              >
                Do{' '}
                <span aria-hidden="true" className="text-danger-fg">
                  *
                </span>
              </label>
              <DateField
                id="planned-to"
                label="Do"
                value={plannedTo}
                min={plannedFrom || today}
                onChange={setPlannedTo}
                required
              />
            </div>
          )}
        </div>

        {/* Error + success */}
        {(formError ?? createRequest.error) && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger-fg bg-danger-bg p-3 text-sm text-danger-fg"
          >
            <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{formError ?? createRequest.error?.message}</span>
          </div>
        )}

        {createRequest.isSuccess && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-green-500 bg-green-50 p-3 text-sm text-green-700"
          >
            <CheckCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>Žiadosť odoslaná. Presmerovávam…</span>
          </div>
        )}

        {/* Submit */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createRequest.isPending ? 'Odosielam žiadosť…' : 'Odoslať žiadosť'}
        </button>
      </div>
    </div>
  );
}

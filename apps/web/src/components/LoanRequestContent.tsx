// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { AlertCircle, CheckCircle, Minus, Plus, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import type { AssetSummary } from '@/lib/api-hooks';
import type { JSX } from 'react';

import { useAssets, useCreateLoanRequest } from '@/lib/api-hooks';

/**
 * /loans/request — new loan request form.
 *
 * Flow:
 *   1. User searches / browses available assets and adds them to
 *      the request basket (multi-item per ADR-0012).
 *   2. User fills in purpose + plannedFrom + plannedTo.
 *   3. Submit → POST /v1/loan-requests → redirect to /my-loans on
 *      success.
 *
 * MVP scope:
 *   - AVAILABLE assets only (server enforces; client pre-filters too)
 *   - Free-text search on inventoryNumber / name
 *   - Date pickers via HTML5 <input type="date"> (no third-party lib)
 *   - At most 50 items (server enforces; client shows warning at 49)
 *
 * Out of scope (Slice #5b):
 *   - QR scan to add asset
 *   - Asset availability calendar overlay
 *   - Loan duration validation against Category.maxLoanDays
 */

const MAX_ITEMS = 50;

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

  // --- Asset browser state ---
  const [search, setSearch] = useState('');
  const assetsQuery = useAssets({ limit: 100 });
  const allAssets = assetsQuery.data?.data ?? [];

  // Pre-filter to AVAILABLE on client; server validates definitively
  const availableAssets = allAssets.filter((a) => a.status === 'AVAILABLE');
  const filteredAssets = search.trim()
    ? availableAssets.filter(
        (a) =>
          a.inventoryNumber.toLowerCase().includes(search.toLowerCase()) ||
          a.name.toLowerCase().includes(search.toLowerCase()),
      )
    : availableAssets;

  // --- Basket state ---
  const [basket, setBasket] = useState<AssetSummary[]>([]);
  const basketIds = new Set(basket.map((a) => a._id));

  const addToBasket = useCallback(
    (asset: AssetSummary) => {
      if (basket.length >= MAX_ITEMS) return;
      if (basketIds.has(asset._id)) return;
      setBasket((prev) => [...prev, asset]);
    },
    [basket, basketIds],
  );

  const removeFromBasket = useCallback((id: string) => {
    setBasket((prev) => prev.filter((a) => a._id !== id));
  }, []);

  // --- Form state ---
  const today = toDateInputValue(new Date());
  const tomorrow = toDateInputValue(new Date(Date.now() + 86400000));

  const [purpose, setPurpose] = useState('');
  const [plannedFrom, setPlannedFrom] = useState(tomorrow);
  const [plannedTo, setPlannedTo] = useState(toDateInputValue(new Date(Date.now() + 7 * 86400000)));
  const [formError, setFormError] = useState<string | null>(null);

  const canSubmit =
    basket.length > 0 &&
    purpose.trim().length >= 3 &&
    plannedFrom &&
    plannedTo &&
    plannedFrom <= plannedTo &&
    !createRequest.isPending;

  function handleSubmit(): void {
    setFormError(null);

    if (basket.length === 0) {
      setFormError('Pridajte aspoň jednu položku do žiadosti.');
      return;
    }
    if (purpose.trim().length < 3) {
      setFormError('Účel musí mať aspoň 3 znaky.');
      return;
    }
    if (!plannedFrom || !plannedTo) {
      setFormError('Vyplňte dátum od a do.');
      return;
    }
    if (plannedFrom > plannedTo) {
      setFormError('Dátum od musí byť pred dátumom do.');
      return;
    }

    createRequest.mutate(
      {
        purpose: purpose.trim(),
        plannedFrom: toISOFromDateInput(plannedFrom),
        plannedTo: toISOFromDateInput(plannedTo, true),
        items: basket.map((a) => ({ assetId: a._id })),
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
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">
          Nová žiadosť o výpožičku
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Vyberte majetok, zadajte účel a termín. Žiadosť posúdi správca majetku.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Asset browser */}
        <section aria-labelledby="asset-browser-heading">
          <h2 id="asset-browser-heading" className="mb-3 text-base font-semibold text-text-primary">
            Dostupný majetok
          </h2>

          <div className="relative mb-3">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Hľadaj podľa názvu alebo inventárneho čísla…"
              className="w-full rounded-lg border border-border-default bg-surface-card py-2 pl-9 pr-3 text-sm text-text-primary placeholder-text-muted focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
            />
          </div>

          {assetsQuery.isLoading ? (
            <p className="text-sm text-text-muted">Načítavam majetok…</p>
          ) : filteredAssets.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border-default bg-surface-card p-4 text-center text-sm text-text-muted">
              {search ? 'Nič nenájdené.' : 'Žiadny dostupný majetok.'}
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto rounded-xl border border-border-subtle bg-surface-card divide-y divide-border-subtle">
              {filteredAssets.map((asset) => {
                const inBasket = basketIds.has(asset._id);
                return (
                  <li
                    key={asset._id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-primary">
                        {asset.inventoryNumber}
                      </p>
                      <p className="truncate text-xs text-text-secondary">{asset.name}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => (inBasket ? removeFromBasket(asset._id) : addToBasket(asset))}
                      disabled={!inBasket && basket.length >= MAX_ITEMS}
                      aria-label={
                        inBasket
                          ? `Odstrániť ${asset.inventoryNumber}`
                          : `Pridať ${asset.inventoryNumber}`
                      }
                      className={
                        inBasket
                          ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-primary text-white hover:opacity-90'
                          : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border-default bg-surface-card text-text-secondary hover:bg-surface-subtle disabled:opacity-40'
                      }
                    >
                      {inBasket ? (
                        <Minus aria-hidden="true" className="h-3.5 w-3.5" />
                      ) : (
                        <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Right: Request details + basket */}
        <section aria-labelledby="request-form-heading" className="flex flex-col gap-4">
          <h2 id="request-form-heading" className="text-base font-semibold text-text-primary">
            Detaily žiadosti
          </h2>

          {/* Basket */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-primary">
              Vybraný majetok
              <span className="ml-1 text-text-muted">
                ({basket.length}/{MAX_ITEMS})
              </span>
            </label>
            {basket.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-default bg-surface-card p-3 text-center text-sm text-text-muted">
                Kliknite na + pri majetku vľavo.
              </p>
            ) : (
              <ul className="rounded-xl border border-border-subtle bg-surface-card divide-y divide-border-subtle">
                {basket.map((asset) => (
                  <li key={asset._id} className="flex items-center justify-between px-4 py-2">
                    <span className="text-sm text-text-primary">
                      <span className="font-medium">{asset.inventoryNumber}</span>
                      <span className="ml-1.5 text-text-secondary">{asset.name}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFromBasket(asset._id)}
                      aria-label={`Odstrániť ${asset.inventoryNumber}`}
                      className="ml-2 rounded p-1 text-text-muted hover:bg-surface-subtle hover:text-danger-fg"
                    >
                      <Minus aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
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

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
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
              <input
                id="planned-from"
                type="date"
                value={plannedFrom}
                min={today}
                onChange={(e) => setPlannedFrom(e.target.value)}
                className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
              />
            </div>
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
              <input
                id="planned-to"
                type="date"
                value={plannedTo}
                min={plannedFrom || today}
                onChange={(e) => setPlannedTo(e.target.value)}
                className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
              />
            </div>
          </div>

          {/* Error + success */}
          {(formError ?? createRequest.error) && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-danger-fg bg-danger-bg p-3 text-sm text-danger-fg"
            >
              <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 mt-0.5" />
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
            className="mt-auto w-full rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createRequest.isPending ? 'Odosielam žiadosť…' : 'Odoslať žiadosť'}
          </button>
        </section>
      </div>
    </div>
  );
}

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * StockPanel — skladový panel pre BULK položky (ADR-0020).
 *
 * Zobrazuje:
 *   - Aktuálny zostatok (quantityOnHand z asset cache)
 *   - Paginovanú históriu pohybov zo StockMovement ledgera
 *   - Dialóg Príjem na sklad (RECEIPT) — ASSET_MANAGER+
 *   - Dialóg Korekcia inventúry (ADJUSTMENT) — ASSET_MANAGER+
 *   - Tlačidlo Reconciliation — ADMIN only, diagnostika
 *
 * Integruje sa do AssetDetailContent.tsx ako záložka „Sklad"
 * pre položky s trackingMode === 'BULK'.
 *
 * Validácia na klientskej strane zrkadlí backend (stock.routes.ts):
 *   - receive: quantity > 0, locationId povinný
 *   - adjust:  quantity ≠ 0, reason ≥ 3 znaky, locationId povinný
 *   - Backend vráti BadRequest ak by pohyb stiahol zostatok pod 0 —
 *     chyba sa zobrazí priamo v dialógu.
 */

import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  Loader2,
  PackagePlus,
  RefreshCcw,
  SlidersHorizontal,
  Warehouse,
  X,
} from 'lucide-react';
import { useState } from 'react';

import { SelectField } from './SelectField';
import { TableSkeleton } from './Skeleton';

import type { AssetDetail, StockMovement } from '@/lib/api-hooks';
import type { JSX, ReactNode } from 'react';

import {
  useAdjustStock,
  useCanManageStock,
  useLocations,
  useMe,
  useReceiveStock,
  useReconcileStock,
  useStockMovements,
} from '@/lib/api-hooks';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Label maps
// ---------------------------------------------------------------------------

const MOVEMENT_TYPE_LABELS: Record<StockMovement['type'], string> = {
  RECEIPT: 'Príjem',
  LOAN_OUT: 'Výdaj (zápožička)',
  LOAN_RETURN: 'Vrátenie',
  ADJUSTMENT: 'Korekcia',
};

const MOVEMENT_TYPE_OPTIONS = [
  { value: '', label: 'Všetky typy' },
  { value: 'RECEIPT', label: 'Príjem' },
  { value: 'LOAN_OUT', label: 'Výdaj (zápožička)' },
  { value: 'LOAN_RETURN', label: 'Vrátenie' },
  { value: 'ADJUSTMENT', label: 'Korekcia' },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function StockPanel({ asset }: { asset: AssetDetail }): JSX.Element {
  const [showReceive, setShowReceive] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [page, setPage] = useState(0);

  const canManage = useCanManageStock();
  const meQuery = useMe();
  const isAdmin = meQuery.data?.roles.includes('ADMIN') ?? false;

  const limit = 20;
  const movementsQuery = useStockMovements(asset._id, {
    limit,
    skip: page * limit,
    ...(typeFilter !== '' && { type: typeFilter as StockMovement['type'] }),
  });
  const reconcileMutation = useReconcileStock(asset._id);

  const movements = movementsQuery.data?.data ?? [];
  const total = movementsQuery.data?.pagination.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  function handleTypeFilter(val: string): void {
    setTypeFilter(val);
    setPage(0);
  }

  return (
    <div className="space-y-6">
      {/* Zostatok + akcie */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Zostatok card */}
        <div className="flex items-center gap-4 rounded-xl border border-border-subtle bg-surface-card p-5 shadow-sm sm:col-span-2">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10">
            <Warehouse aria-hidden="true" className="h-7 w-7 text-brand-primary" />
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
              Zostatok na sklade
            </p>
            {/* Legacy BULK assety nemajú quantityOnHand — defaultujeme na 0
                (rovnaký vzor ako $ifNull v stock overview). Asset je v tomto
                bode už načítaný, takže null ≠ loading. */}
            <p className="mt-0.5 text-3xl font-bold tabular-nums text-text-primary">
              {asset.quantityOnHand ?? 0}
              <span className="ml-1.5 text-base font-normal text-text-secondary">ks</span>
            </p>
            <p className="mt-0.5 font-mono text-xs text-text-muted">{asset.inventoryNumber}</p>
          </div>
        </div>

        {/* Akcie */}
        <div className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface-card p-4 shadow-sm">
          <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Akcie</p>
          {canManage ? (
            <>
              <button
                type="button"
                onClick={() => setShowReceive(true)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-3 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
              >
                <PackagePlus aria-hidden="true" className="h-4 w-4" />
                Príjem na sklad
              </button>
              <button
                type="button"
                onClick={() => setShowAdjust(true)}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-card px-3 py-2.5 text-sm font-semibold text-text-primary transition hover:bg-surface-subtle"
              >
                <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
                Korekcia
              </button>
            </>
          ) : (
            <p className="text-xs text-text-muted">
              Na vykonanie skladových pohybov potrebuješ rolu Správca majetku alebo Administrátor.
            </p>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => reconcileMutation.mutate()}
              disabled={reconcileMutation.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
            >
              {reconcileMutation.isPending ? (
                <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCcw aria-hidden="true" className="h-3.5 w-3.5" />
              )}
              Reconciliation
            </button>
          )}
          {reconcileMutation.isSuccess && (
            <ReconcileResultBanner
              wasConsistent={reconcileMutation.data.wasConsistent}
              ledgerBalance={reconcileMutation.data.ledgerBalance}
              cacheWas={reconcileMutation.data.cacheWas}
            />
          )}
          {reconcileMutation.isError && <ErrorBanner message={reconcileMutation.error.message} />}
        </div>
      </div>

      {/* História pohybov */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-bold text-text-primary">
            História pohybov
            {total > 0 && (
              <span className="ml-2 rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-normal text-text-secondary">
                {total}
              </span>
            )}
          </h3>
          <SelectField
            label="Filter podľa typu"
            value={typeFilter}
            onChange={handleTypeFilter}
            options={MOVEMENT_TYPE_OPTIONS}
            className="w-48"
          />
        </div>

        {movementsQuery.isLoading ? (
          <TableSkeleton rows={5} columns={5} />
        ) : movementsQuery.isError ? (
          <ErrorBanner message={movementsQuery.error.message} />
        ) : movements.length === 0 ? (
          <EmptyMovements hasFilter={typeFilter !== ''} />
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle bg-surface-subtle text-left">
                    <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                      Dátum
                    </th>
                    <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                      Typ
                    </th>
                    <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-wider text-text-muted">
                      Množstvo
                    </th>
                    <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-wider text-text-muted">
                      Zostatok
                    </th>
                    <th className="hidden px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-text-muted md:table-cell">
                      Dôvod / poznámka
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {movements.map((m) => (
                    <MovementRow key={m._id} movement={m} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginačné tlačidlá */}
            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between text-sm text-text-secondary">
                <span>
                  Strana {page + 1} z {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                    className="rounded-lg border border-border-default px-3 py-1.5 text-xs font-medium transition hover:bg-surface-subtle disabled:opacity-40"
                  >
                    ← Predošlá
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded-lg border border-border-default px-3 py-1.5 text-xs font-medium transition hover:bg-surface-subtle disabled:opacity-40"
                  >
                    Ďalšia →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Dialógy */}
      {showReceive && <ReceiveDialog asset={asset} onClose={() => setShowReceive(false)} />}
      {showAdjust && <AdjustDialog asset={asset} onClose={() => setShowAdjust(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MovementRow
// ---------------------------------------------------------------------------

function MovementRow({ movement: m }: { movement: StockMovement }): JSX.Element {
  const isPositive = m.quantity > 0;
  const typeLabel = MOVEMENT_TYPE_LABELS[m.type] ?? m.type;
  const note = [m.reason, m.note].filter(Boolean).join(' · ') || '—';

  return (
    <tr className="transition hover:bg-surface-subtle/50">
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-text-secondary">
        {formatDateTime(m.createdAt)}
      </td>
      <td className="px-4 py-3">
        <MovementTypeBadge type={m.type} label={typeLabel} />
      </td>
      <td className="px-4 py-3 text-right">
        <span
          className={cn(
            'inline-flex items-center gap-1 font-mono font-semibold tabular-nums',
            isPositive ? 'text-emerald-700' : 'text-red-700',
          )}
        >
          {isPositive ? (
            <ArrowUpCircle aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <ArrowDownCircle aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {isPositive ? '+' : ''}
          {m.quantity}
        </span>
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-text-primary">
        {m.balanceAfter}
      </td>
      <td className="hidden max-w-[200px] truncate px-4 py-3 text-xs text-text-secondary md:table-cell">
        {note}
      </td>
    </tr>
  );
}

function MovementTypeBadge({
  type,
  label,
}: {
  type: StockMovement['type'];
  label: string;
}): JSX.Element {
  const colors: Record<StockMovement['type'], string> = {
    RECEIPT: 'bg-emerald-100 text-emerald-800',
    LOAN_OUT: 'bg-amber-100 text-amber-800',
    LOAN_RETURN: 'bg-blue-100 text-blue-800',
    ADJUSTMENT: 'bg-slate-100 text-slate-700',
  };
  return (
    <span
      className={cn(
        'inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
        colors[type],
      )}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ReceiveDialog
// ---------------------------------------------------------------------------

function ReceiveDialog({
  asset,
  onClose,
}: {
  asset: AssetDetail;
  onClose: () => void;
}): JSX.Element {
  const [quantity, setQuantity] = useState('');
  const [locationId, setLocationId] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const locationsQuery = useLocations({ limit: 200 });
  const locations = locationsQuery.data?.data ?? [];
  const locationOptions = [
    { value: '', label: 'Vyberte lokalitu…' },
    ...locations.map((l) => ({ value: l._id, label: l.name })),
  ];

  const receiveMutation = useReceiveStock(asset._id);

  function handleSubmit(): void {
    setFieldError(null);
    const qty = parseInt(quantity, 10);
    if (!quantity || isNaN(qty) || qty <= 0) {
      setFieldError('Množstvo musí byť kladné celé číslo.');
      return;
    }
    if (!locationId) {
      setFieldError('Vyberte lokalitu príjmu.');
      return;
    }
    receiveMutation.mutate(
      { quantity: qty, locationId, reason: reason.trim() || null, note: note.trim() || null },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <Dialog
      title="Príjem na sklad"
      icon={<PackagePlus aria-hidden="true" className="h-5 w-5 text-brand-primary" />}
      onClose={onClose}
    >
      <div className="space-y-4">
        <InfoRow label="Položka" value={`${asset.name} (${asset.inventoryNumber})`} />
        <InfoRow label="Aktuálny zostatok" value={`${asset.quantityOnHand ?? 0} ks`} />
        <FormField label="Množstvo kusov *">
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="napr. 10"
            className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus"
          />
        </FormField>
        <FormField label="Lokalita *">
          <SelectField
            label="Lokalita príjmu"
            value={locationId}
            onChange={setLocationId}
            options={locationOptions}
            className="w-full"
          />
        </FormField>
        <FormField label="Dôvod (voliteľné)">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="napr. Nákup 2026"
            className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus"
          />
        </FormField>
        <FormField label="Interná poznámka (voliteľné)">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="napr. Faktúra č. 2026-042"
            className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus"
          />
        </FormField>
        {(fieldError ?? receiveMutation.error) && (
          <ErrorBanner message={fieldError ?? receiveMutation.error!.message} />
        )}
        <div className="flex justify-end gap-3 border-t border-border-subtle pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border-default px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-subtle"
          >
            Zrušiť
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={receiveMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {receiveMutation.isPending && (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            )}
            Zaúčtovať príjem
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// AdjustDialog
// ---------------------------------------------------------------------------

function AdjustDialog({
  asset,
  onClose,
}: {
  asset: AssetDetail;
  onClose: () => void;
}): JSX.Element {
  const [quantity, setQuantity] = useState('');
  const [locationId, setLocationId] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const locationsQuery = useLocations({ limit: 200 });
  const locations = locationsQuery.data?.data ?? [];
  const locationOptions = [
    { value: '', label: 'Vyberte lokalitu…' },
    ...locations.map((l) => ({ value: l._id, label: l.name })),
  ];

  const adjustMutation = useAdjustStock(asset._id);

  function handleSubmit(): void {
    setFieldError(null);
    const qty = parseInt(quantity, 10);
    if (!quantity || isNaN(qty) || qty === 0) {
      setFieldError('Množstvo musí byť nenulové celé číslo (kladné = pribudne, záporné = ubudne).');
      return;
    }
    if (!locationId) {
      setFieldError('Vyberte lokalitu.');
      return;
    }
    if (!reason || reason.trim().length < 3) {
      setFieldError('Dôvod korekcie musí mať aspoň 3 znaky.');
      return;
    }
    adjustMutation.mutate(
      { quantity: qty, locationId, reason: reason.trim(), note: note.trim() || null },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <Dialog
      title="Korekcia inventúry"
      icon={<SlidersHorizontal aria-hidden="true" className="h-5 w-5 text-amber-600" />}
      onClose={onClose}
    >
      <div className="space-y-4">
        <InfoRow label="Položka" value={`${asset.name} (${asset.inventoryNumber})`} />
        <InfoRow label="Aktuálny zostatok" value={`${asset.quantityOnHand ?? 0} ks`} />
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Kladné číslo = na sklade pribudne. Záporné číslo = na sklade ubudne. Zostatok nesmie
          klesnúť pod nulu.
        </div>
        <FormField label="Množstvo (kladné / záporné) *">
          <input
            type="number"
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="napr. -3 alebo +5"
            className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus"
          />
        </FormField>
        <FormField label="Lokalita *">
          <SelectField
            label="Lokalita korekcie"
            value={locationId}
            onChange={setLocationId}
            options={locationOptions}
            className="w-full"
          />
        </FormField>
        <FormField label="Dôvod korekcie *">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="napr. Inventúra 2026 — strata pri transporte"
            className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus"
          />
          <p className="mt-1 text-xs text-text-muted">Povinné, minimálne 3 znaky.</p>
        </FormField>
        <FormField label="Interná poznámka (voliteľné)">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="napr. Schválil: J. Novák"
            className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus"
          />
        </FormField>
        {(fieldError ?? adjustMutation.error) && (
          <ErrorBanner message={fieldError ?? adjustMutation.error!.message} />
        )}
        <div className="flex justify-end gap-3 border-t border-border-subtle pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border-default px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-subtle"
          >
            Zrušiť
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={adjustMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {adjustMutation.isPending && (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            )}
            Zaúčtovať korekciu
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Dialog shell
// ---------------------------------------------------------------------------

function Dialog({
  title,
  icon,
  children,
  onClose,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stock-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border-subtle bg-surface-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <div className="flex items-center gap-2">
            {icon}
            <h2 id="stock-dialog-title" className="text-base font-bold text-text-primary">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zavrieť dialóg"
            className="rounded p-1 text-text-muted transition hover:bg-surface-subtle hover:text-text-primary"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared drobnosti
// ---------------------------------------------------------------------------

function FormField({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-text-secondary">{label}</label>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 rounded-lg bg-surface-subtle px-3 py-2 text-sm">
      <span className="text-text-secondary">{label}</span>
      <span className="font-medium text-text-primary">{value}</span>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function ReconcileResultBanner({
  wasConsistent,
  ledgerBalance,
  cacheWas,
}: {
  wasConsistent: boolean;
  ledgerBalance: number;
  cacheWas: number | null;
}): JSX.Element {
  if (wasConsistent) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800">
        <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0" />
        Cache sedí — zostatok {ledgerBalance} ks.
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      Cache opravená: {cacheWas ?? 'null'} → {ledgerBalance} ks.
    </div>
  );
}

function EmptyMovements({ hasFilter }: { hasFilter: boolean }): JSX.Element {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-card py-12 text-center">
      <Warehouse aria-hidden="true" className="mx-auto h-10 w-10 text-text-muted" />
      <p className="mt-3 text-sm font-medium text-text-primary">
        {hasFilter ? 'Žiadne pohyby pre zvolený filter' : 'Žiadne skladové pohyby'}
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        {hasFilter
          ? 'Skúste zmeniť filter typu pohybu.'
          : 'Zaúčtujte prvý príjem na sklad tlačidlom vyššie.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('sk-SK', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

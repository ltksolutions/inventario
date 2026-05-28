// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import {
  AlertCircle,
  ArrowLeft,
  Boxes,
  CalendarDays,
  ClipboardList,
  Clock,
  FileText,
  Layers,
  Loader2,
  Paperclip,
  Pencil,
  QrCode,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { AssetDetailEditForm } from './AssetDetailEditForm';
import { AssetDetailReadView } from './AssetDetailReadView';

import type { AssetDetail, LoanSummary } from '@/lib/api-hooks';
import type { JSX, ReactNode } from 'react';

import {
  useAsset,
  useAssets,
  useCanEditAssets,
  useCategories,
  useLocations,
  useLoansForAsset,
} from '@/lib/api-hooks';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Label maps
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'Dostupné',
  RESERVED: 'Rezervované',
  BORROWED: 'Zapožičané',
  IN_SERVICE: 'V servise',
  DISPOSED: 'Vyradené',
  LOST: 'Stratené',
};

const LOAN_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Aktívna',
  RETURNED: 'Vrátená',
  DAMAGED: 'Poškodená',
  LOST: 'Stratená',
};

const CONDITION_LABELS: Record<string, string> = {
  NEW: 'Nové',
  EXCELLENT: 'Vynikajúce',
  GOOD: 'Dobré',
  FAIR: 'Použiteľné',
  POOR: 'Opotrebované',
  UNUSABLE: 'Nepoužiteľné',
};

// ---------------------------------------------------------------------------
// Tabs definition
// ---------------------------------------------------------------------------

type TabId = 'overview' | 'history' | 'audit' | 'attachments' | 'related';

interface TabDef {
  id: TabId;
  label: string;
  icon: JSX.Element;
}

const TABS: TabDef[] = [
  { id: 'overview', label: 'Prehľad', icon: <ClipboardList className="h-4 w-4" /> },
  { id: 'history', label: 'História výpožičiek', icon: <CalendarDays className="h-4 w-4" /> },
  { id: 'audit', label: 'Audit log', icon: <ShieldAlert className="h-4 w-4" /> },
  { id: 'attachments', label: 'Prílohy', icon: <Paperclip className="h-4 w-4" /> },
  { id: 'related', label: 'Súvisiace', icon: <Boxes className="h-4 w-4" /> },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AssetDetailContent({ assetId }: { assetId: string }): JSX.Element {
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const assetQuery = useAsset(assetId);
  const categoriesQuery = useCategories({ limit: 200 });
  const locationsQuery = useLocations({ limit: 200 });
  const canEdit = useCanEditAssets();

  const categoriesById = new Map((categoriesQuery.data?.data ?? []).map((c) => [c._id, c]));
  const locationsById = new Map((locationsQuery.data?.data ?? []).map((l) => [l._id, l]));

  return (
    <div className="mx-auto max-w-5xl">
      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-2 text-sm" aria-label="Drobky">
        <Link
          href="/assets"
          className="inline-flex items-center gap-1 rounded text-text-secondary transition hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Späť na zoznam
        </Link>
      </nav>

      {assetQuery.isLoading ? (
        <DetailSkeleton />
      ) : assetQuery.isError ? (
        <ErrorState error={assetQuery.error} assetId={assetId} />
      ) : assetQuery.data ? (
        <>
          {/* Hero */}
          {mode === 'read' ? (
            <AssetHero
              asset={assetQuery.data}
              categoryName={categoriesById.get(assetQuery.data.categoryId)?.name}
              locationName={locationsById.get(assetQuery.data.locationId)?.name}
              canEdit={canEdit}
              onEdit={() => setMode('edit')}
            />
          ) : (
            <div className="mb-6 rounded-xl border border-border-subtle bg-surface-card p-5">
              <p className="font-mono text-xs uppercase tracking-wider text-text-muted">
                {assetQuery.data.inventoryNumber}
              </p>
              <h1 className="mt-1 text-xl font-bold text-text-primary">
                {assetQuery.data.name} — <span className="text-text-secondary">Úprava</span>
              </h1>
            </div>
          )}

          {/* Edit form */}
          {mode === 'edit' ? (
            <AssetDetailEditForm
              asset={assetQuery.data}
              categories={categoriesQuery.data?.data ?? []}
              locations={locationsQuery.data?.data ?? []}
              onCancel={() => setMode('read')}
              onSaved={() => setMode('read')}
            />
          ) : (
            <>
              {/* Tab bar */}
              <div className="mb-0 overflow-x-auto">
                <div className="flex min-w-max border-b border-border-subtle">
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
                        activeTab === tab.id
                          ? 'border-brand-primary text-text-primary'
                          : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border-default',
                      )}
                      aria-current={activeTab === tab.id ? 'true' : undefined}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab content */}
              <div className="mt-6">
                {activeTab === 'overview' && (
                  <AssetDetailReadView
                    asset={assetQuery.data}
                    categoriesById={categoriesById}
                    locationsById={locationsById}
                  />
                )}
                {activeTab === 'history' && <LoanHistoryTab assetId={assetId} />}
                {activeTab === 'audit' && (
                  <StubTab
                    icon={<ShieldAlert className="h-8 w-8" />}
                    title="Audit log"
                    description="Kompletný záznam zmien — čoskoro k dispozícii."
                  />
                )}
                {activeTab === 'attachments' && (
                  <StubTab
                    icon={<Paperclip className="h-8 w-8" />}
                    title="Prílohy"
                    description="Faktúry, záručné listy, fotodokumentácia — čoskoro."
                  />
                )}
                {activeTab === 'related' && (
                  <RelatedAssetsTab
                    currentAssetId={assetId}
                    categoryId={assetQuery.data.categoryId}
                    categoryName={categoriesById.get(assetQuery.data.categoryId)?.name}
                  />
                )}
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function statusHeroGradient(status: string): string {
  switch (status) {
    case 'AVAILABLE':
      return 'from-[#1a2d47] to-[#1e5c3a]';
    case 'BORROWED':
      return 'from-[#1a2d47] to-[#7c4a0a]';
    case 'RESERVED':
      return 'from-[#1a2d47] to-[#1a3d6d]';
    case 'IN_SERVICE':
      return 'from-[#1a2d47] to-[#3d2a0a]';
    case 'DISPOSED':
      return 'from-[#2d2d2d] to-[#1a2d47]';
    case 'LOST':
      return 'from-[#3d1a1a] to-[#1a2d47]';
    default:
      return 'from-[#1a2d47] to-[#2d3748]';
  }
}

function statusBadgeClasses(status: string): string {
  switch (status) {
    case 'AVAILABLE':
      return 'bg-emerald-100 text-emerald-800';
    case 'RESERVED':
      return 'bg-blue-100 text-blue-800';
    case 'IN_SERVICE':
      return 'bg-amber-100 text-amber-800';
    case 'BORROWED':
      return 'bg-orange-100 text-orange-800';
    case 'DISPOSED':
    case 'LOST':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-surface-subtle text-text-secondary';
  }
}

function AssetHero({
  asset,
  categoryName,
  locationName,
  canEdit,
  onEdit,
}: {
  asset: AssetDetail;
  categoryName: string | undefined;
  locationName: string | undefined;
  canEdit: boolean;
  onEdit: () => void;
}): JSX.Element {
  return (
    <div
      className={cn(
        'mb-0 rounded-t-xl bg-gradient-to-br text-white shadow-sm',
        statusHeroGradient(asset.status),
      )}
    >
      <div className="relative overflow-hidden rounded-t-xl px-5 py-6 sm:px-7 sm:py-8">
        {/* Background shimmer */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.08),transparent_60%)]" />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
          {/* Icon circle */}
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10 backdrop-blur ring-1 ring-white/20">
            <Layers aria-hidden="true" className="h-7 w-7 text-white" />
          </div>

          {/* Main info */}
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/60">
              {asset.inventoryNumber}
            </p>
            <h1 className="mt-0.5 text-xl font-bold leading-snug text-white sm:text-2xl">
              {asset.name}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  statusBadgeClasses(asset.status),
                )}
              >
                {STATUS_LABELS[asset.status] ?? asset.status}
              </span>
              <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white">
                {CONDITION_LABELS[asset.condition] ?? asset.condition}
              </span>
              {categoryName && (
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/70">
                  {categoryName}
                </span>
              )}
              {locationName && (
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/70">
                  📍 {locationName}
                </span>
              )}
            </div>
          </div>

          {/* Right side: QR + CTA */}
          <div className="flex shrink-0 flex-col items-end gap-3">
            {/* QR code placeholder */}
            <div className="hidden rounded-xl bg-white p-2 sm:flex">
              <div className="flex h-[72px] w-[72px] flex-col items-center justify-center gap-1 text-text-primary">
                <QrCode aria-hidden="true" className="h-9 w-9 text-brand-primary" />
                <span className="text-[8px] font-mono text-text-muted leading-none text-center">
                  {asset.inventoryNumber.slice(-6)}
                </span>
              </div>
            </div>

            {canEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium text-white ring-1 ring-white/30 transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                Upraviť
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loan history tab
// ---------------------------------------------------------------------------

function LoanHistoryTab({ assetId }: { assetId: string }): JSX.Element {
  const loansQuery = useLoansForAsset(assetId);

  if (loansQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  const loans = loansQuery.data ?? [];

  if (loans.length === 0) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface-card p-10 text-center">
        <CalendarDays className="mx-auto h-10 w-10 text-text-muted" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-text-primary">Žiadna história výpožičiek</p>
        <p className="mt-1 text-sm text-text-secondary">Tento majetok ešte nebol zapožičaný.</p>
      </div>
    );
  }

  // Sort newest first
  const sorted = [...loans].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div className="space-y-0">
      <div className="rounded-xl border border-border-subtle bg-surface-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-text-primary">
            História výpožičiek
            <span className="ml-2 rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-normal text-text-secondary">
              {loans.length}
            </span>
          </h2>
        </div>

        {/* Timeline */}
        <div className="px-5 py-4">
          <ol className="relative space-y-0">
            {sorted.map((loan, idx) => (
              <LoanTimelineItem key={loan._id} loan={loan} isLast={idx === sorted.length - 1} />
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function LoanTimelineItem({ loan, isLast }: { loan: LoanSummary; isLast: boolean }): JSX.Element {
  const statusColor =
    loan.status === 'RETURNED'
      ? 'border-emerald-400 bg-emerald-50'
      : loan.status === 'ACTIVE'
        ? 'border-brand-primary bg-blue-50'
        : loan.status === 'DAMAGED'
          ? 'border-amber-400 bg-amber-50'
          : loan.status === 'LOST'
            ? 'border-red-400 bg-red-50'
            : 'border-border-default bg-surface-subtle';

  const dotColor =
    loan.status === 'RETURNED'
      ? 'bg-emerald-400'
      : loan.status === 'ACTIVE'
        ? 'bg-brand-primary'
        : loan.status === 'DAMAGED'
          ? 'bg-amber-400'
          : loan.status === 'LOST'
            ? 'bg-red-400'
            : 'bg-border-default';

  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      {/* Line */}
      {!isLast && <div className="absolute left-[9px] top-5 bottom-0 w-0.5 bg-border-subtle" />}

      {/* Dot */}
      <div
        className={cn(
          'relative z-10 mt-1 h-5 w-5 shrink-0 rounded-full border-2 border-white shadow-sm',
          dotColor,
        )}
      />

      {/* Content */}
      <div className={cn('flex-1 rounded-lg border p-4', statusColor)}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <span className="text-sm font-medium text-text-primary">{loan.purpose}</span>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDate(loan.pickedUpAt)} – {formatDate(loan.dueAt)}
              </span>
              {loan.returnedAt && (
                <span className="flex items-center gap-1 text-emerald-600">
                  <RotateCcw className="h-3 w-3" />
                  Vrátené {formatDate(loan.returnedAt)}
                </span>
              )}
            </div>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
              loan.status === 'RETURNED'
                ? 'bg-emerald-100 text-emerald-800'
                : loan.status === 'ACTIVE'
                  ? 'bg-blue-100 text-blue-800'
                  : loan.status === 'DAMAGED'
                    ? 'bg-amber-100 text-amber-800'
                    : loan.status === 'LOST'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-surface-subtle text-text-secondary',
            )}
          >
            {LOAN_STATUS_LABELS[loan.status] ?? loan.status}
          </span>
        </div>
        {loan.isOverdue && (
          <p className="mt-2 text-xs font-medium text-red-600">⚠ Výpožička po termíne</p>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Related assets tab
// ---------------------------------------------------------------------------

function RelatedAssetsTab({
  currentAssetId,
  categoryId,
  categoryName,
}: {
  currentAssetId: string;
  categoryId: string;
  categoryName: string | undefined;
}): JSX.Element {
  const assetsQuery = useAssets({ limit: 20 });

  if (assetsQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  const related = (assetsQuery.data?.data ?? []).filter(
    (a) => a.categoryId === categoryId && a._id !== currentAssetId,
  );

  if (related.length === 0) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface-card p-10 text-center">
        <Boxes className="mx-auto h-10 w-10 text-text-muted" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-text-primary">Žiadne súvisiace položky</p>
        <p className="mt-1 text-sm text-text-secondary">
          V kategórii <strong>{categoryName ?? categoryId}</strong> nie sú ďalšie položky.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border-subtle">
        <h2 className="text-sm font-semibold text-text-primary">
          Súvisiace — {categoryName ?? categoryId}
          <span className="ml-2 rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-normal text-text-secondary">
            {related.length}
          </span>
        </h2>
      </div>
      <ul className="divide-y divide-border-subtle">
        {related.map((asset) => (
          <li key={asset._id}>
            <Link
              href={`/assets/${asset._id}`}
              className="flex items-center gap-4 px-5 py-3 transition hover:bg-surface-subtle"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-subtle">
                <FileText aria-hidden="true" className="h-4 w-4 text-text-muted" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">{asset.name}</p>
                <p className="font-mono text-xs text-text-muted">{asset.inventoryNumber}</p>
              </div>
              <StatusDot status={asset.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusDot({ status }: { status: string }): JSX.Element {
  const cls =
    status === 'AVAILABLE'
      ? 'bg-emerald-400'
      : status === 'BORROWED'
        ? 'bg-orange-400'
        : status === 'RESERVED'
          ? 'bg-blue-400'
          : status === 'IN_SERVICE'
            ? 'bg-amber-400'
            : 'bg-red-400';
  return (
    <span className="flex items-center gap-1.5 text-xs text-text-secondary">
      <span className={cn('h-2 w-2 rounded-full', cls)} />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stub tab for unimplemented features
// ---------------------------------------------------------------------------

function StubTab({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-card p-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-surface-subtle text-text-muted">
        {icon}
      </div>
      <p className="mt-3 text-sm font-medium text-text-primary">{title}</p>
      <p className="mt-1 text-sm text-text-secondary">{description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('sk-SK', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Error + skeleton states
// ---------------------------------------------------------------------------

function ErrorState({ error, assetId }: { error: Error; assetId: string }): JSX.Element {
  const status = (error as Error & { status?: number }).status;
  const isNotFound = status === 404;

  return (
    <div
      role="alert"
      className="rounded-xl border border-border-default bg-surface-card p-8 text-center shadow-sm"
    >
      <AlertCircle aria-hidden="true" className="mx-auto h-10 w-10 text-text-muted" />
      <h2 className="mt-3 text-lg font-semibold text-text-primary">
        {isNotFound ? 'Položka neexistuje' : 'Položku sa nepodarilo načítať'}
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        {isNotFound
          ? `Pre ID ${assetId} sa nenašiel žiadny záznam, alebo k nej nemáte prístup.`
          : 'Skontrolujte pripojenie a skúste obnoviť stránku.'}
      </p>
      <Link
        href="/assets"
        className="mt-4 inline-flex items-center gap-1 rounded-lg border border-border-default bg-surface-card px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-subtle"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Späť na zoznam
      </Link>
    </div>
  );
}

function DetailSkeleton(): JSX.Element {
  return (
    <div aria-busy="true" aria-label="Načítavam detail položky" className="space-y-4">
      {/* Hero skeleton */}
      <div className="h-36 animate-pulse rounded-xl bg-surface-subtle" />
      {/* Tabs skeleton */}
      <div className="flex gap-4 border-b border-border-subtle pb-0">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="mb-0 h-9 w-28 animate-pulse rounded bg-surface-subtle" />
        ))}
      </div>
      {/* Content skeleton */}
      <div className="space-y-3 rounded-xl border border-border-subtle bg-surface-card p-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex justify-between gap-4">
            <div className="h-4 w-32 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 flex-1 animate-pulse rounded bg-surface-subtle" />
          </div>
        ))}
      </div>
    </div>
  );
}

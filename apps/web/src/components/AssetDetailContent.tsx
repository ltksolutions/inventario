// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import {
  AlertCircle,
  ArrowLeft,
  Boxes,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Clock,
  Download,
  FileText,
  Layers,
  Loader2,
  Paperclip,
  Pencil,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';

import { AssetDetailEditForm } from './AssetDetailEditForm';
import { AssetDetailReadView } from './AssetDetailReadView';
import { StockPanel } from './StockPanel';

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

const CONDITION_LABELS: Record<string, string> = {
  NEW: 'Nové',
  EXCELLENT: 'Vynikajúce',
  GOOD: 'Dobré',
  FAIR: 'Použiteľné',
  POOR: 'Opotrebované',
  UNUSABLE: 'Nepoužiteľné',
};

const LOAN_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Aktívna',
  RETURNED: 'Vrátená',
  DAMAGED: 'Poškodená',
  LOST: 'Stratená',
};

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type TabId = 'overview' | 'stock' | 'history' | 'audit' | 'attachments' | 'related';

const TABS_SERIALIZED: { id: TabId; label: string; icon: JSX.Element }[] = [
  { id: 'overview', label: 'Detail', icon: <ClipboardList className="h-4 w-4" /> },
  { id: 'history', label: 'História pohybov', icon: <CalendarDays className="h-4 w-4" /> },
  { id: 'audit', label: 'Audit log', icon: <ShieldAlert className="h-4 w-4" /> },
  { id: 'attachments', label: 'Prílohy', icon: <Paperclip className="h-4 w-4" /> },
  { id: 'related', label: 'Súvisiace', icon: <Boxes className="h-4 w-4" /> },
];

const TABS_BULK: { id: TabId; label: string; icon: JSX.Element }[] = [
  { id: 'overview', label: 'Detail', icon: <ClipboardList className="h-4 w-4" /> },
  { id: 'stock', label: 'Sklad', icon: <Boxes className="h-4 w-4" /> },
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

  const isBulk = assetQuery.data?.trackingMode === 'BULK';
  const TABS = isBulk ? TABS_BULK : TABS_SERIALIZED;

  const categoriesById = new Map((categoriesQuery.data?.data ?? []).map((c) => [c._id, c]));
  const locationsById = new Map((locationsQuery.data?.data ?? []).map((l) => [l._id, l]));

  return (
    <div className="mx-auto max-w-5xl">
      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-2 text-sm" aria-label="Drobky">
        <Link
          href="/assets"
          className="inline-flex items-center gap-1 rounded text-text-secondary transition hover:text-text-primary"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Späť na zoznam
        </Link>
        {assetQuery.data && (
          <>
            <span className="text-text-muted">·</span>
            <span className="text-text-muted">Majetok</span>
            <span className="text-text-muted">›</span>
            <span className="truncate font-medium text-text-primary">{assetQuery.data.name}</span>
          </>
        )}
      </nav>

      {assetQuery.isLoading ? (
        <DetailSkeleton />
      ) : assetQuery.isError ? (
        <ErrorState error={assetQuery.error} assetId={assetId} />
      ) : assetQuery.data ? (
        <>
          {mode === 'edit' ? (
            <>
              <div className="mb-6 rounded-xl border border-border-subtle bg-surface-card p-5">
                <p className="font-mono text-xs uppercase tracking-wider text-text-muted">
                  {assetQuery.data.inventoryNumber}
                </p>
                <h1 className="mt-1 text-xl font-bold text-text-primary">
                  {assetQuery.data.name} — <span className="text-text-secondary">Úprava</span>
                </h1>
              </div>
              <AssetDetailEditForm
                asset={assetQuery.data}
                categories={categoriesQuery.data?.data ?? []}
                locations={locationsQuery.data?.data ?? []}
                onCancel={() => setMode('read')}
                onSaved={() => setMode('read')}
              />
            </>
          ) : (
            <>
              {/* Hero grid: 2-col (info + QR) */}
              <div className="mb-0 grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Main hero card */}
                <AssetHeroCard
                  asset={assetQuery.data}
                  categoryName={categoriesById.get(assetQuery.data.categoryId)?.name}
                  locationName={locationsById.get(assetQuery.data.locationId)?.name}
                  canEdit={canEdit}
                  onEdit={() => setMode('edit')}
                />
                {/* QR card */}
                <QrCard assetId={assetId} inventoryNumber={assetQuery.data.inventoryNumber} />
              </div>

              {/* Tabs */}
              <div className="mt-4 overflow-hidden rounded-xl border border-border-subtle bg-surface-card">
                {/* Tab bar */}
                <div className="overflow-x-auto border-b border-border-subtle">
                  <div className="flex min-w-max">
                    {TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        aria-current={activeTab === tab.id ? 'true' : undefined}
                        className={cn(
                          'flex items-center gap-2 whitespace-nowrap border-b-2 px-5 py-3.5 text-sm font-medium transition-colors',
                          activeTab === tab.id
                            ? 'border-brand-primary text-text-primary'
                            : 'border-transparent text-text-secondary hover:border-border-default hover:text-text-primary',
                        )}
                      >
                        {tab.icon}
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tab content */}
                <div className="p-5 lg:p-6">
                  {activeTab === 'overview' && (
                    <AssetDetailReadView
                      asset={assetQuery.data}
                      categoriesById={categoriesById}
                      locationsById={locationsById}
                    />
                  )}
                  {activeTab === 'stock' && assetQuery.data && (
                    <StockPanel asset={assetQuery.data} />
                  )}
                  {activeTab === 'history' && <LoanHistoryTab assetId={assetId} />}
                  {activeTab === 'audit' && (
                    <StubTab
                      icon={<ShieldAlert className="h-8 w-8" />}
                      title="Audit log"
                      description="Kompletný záznam zmien podľa GDPR Article 30 — čoskoro k dispozícii."
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
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

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
    default:
      return 'bg-red-100 text-red-800';
  }
}

function heroGradient(status: string): string {
  switch (status) {
    case 'AVAILABLE':
      return 'from-[#1a2d47] to-[#1e5c3a]';
    case 'BORROWED':
      return 'from-[#1a2d47] to-[#7c4a0a]';
    case 'IN_SERVICE':
      return 'from-[#1a2d47] to-[#3d2a0a]';
    default:
      return 'from-[#1a2d47] to-[#2d3748]';
  }
}

// ---------------------------------------------------------------------------
// Hero card (lg:col-span-2)
// ---------------------------------------------------------------------------

function AssetHeroCard({
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
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-sm lg:col-span-2">
      <div className="grid grid-cols-1 sm:grid-cols-5">
        {/* Thumb */}
        <div
          className={cn(
            'relative flex min-h-[140px] items-center justify-center bg-gradient-to-br sm:col-span-2 sm:min-h-[220px]',
            heroGradient(asset.status),
          )}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_25%_30%,rgba(255,255,255,0.15),transparent_50%)]" />
          <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
            <Layers aria-hidden="true" className="h-8 w-8 text-white" />
          </div>
        </div>

        {/* Info */}
        <div className="flex flex-col p-5 sm:col-span-3 lg:p-6">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
                {asset.inventoryNumber}
              </p>
              <h1 className="mt-0.5 text-xl font-bold leading-tight text-text-primary lg:text-2xl">
                {asset.name}
              </h1>
              {categoryName && <p className="mt-1 text-sm text-text-secondary">{categoryName}</p>}
            </div>
            <span
              className={cn(
                'shrink-0 rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider',
                statusBadgeClasses(asset.status),
              )}
            >
              {STATUS_LABELS[asset.status] ?? asset.status}
            </span>
          </div>

          {/* Quick meta grid */}
          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            {locationName && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                  Lokácia
                </p>
                <p className="mt-0.5 font-medium text-text-primary">📍 {locationName}</p>
              </div>
            )}
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                Kondícia
              </p>
              <p className="mt-0.5 font-medium text-text-primary">
                {CONDITION_LABELS[asset.condition] ?? asset.condition}
              </p>
            </div>
            {asset.warrantyUntil && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                  Záruka do
                </p>
                <p className="mt-0.5 font-mono font-medium text-text-primary">
                  {formatDate(asset.warrantyUntil)}
                </p>
              </div>
            )}
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                Pridané
              </p>
              <p className="mt-0.5 font-mono font-medium text-text-primary">
                {formatDate(asset.acquiredAt)}
              </p>
            </div>
          </div>

          {/* Actions */}
          {canEdit && (
            <div className="mt-auto flex flex-wrap gap-2 pt-4">
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:opacity-90"
              >
                <Pencil aria-hidden="true" className="h-4 w-4" />
                Upraviť
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QR card (ADR-0021 K3+K5)
// ---------------------------------------------------------------------------

/**
 * QrCard — zobrazuje QR kod pre asset.
 *
 * Pouziva backend endpoint GET /v1/assets/:id/qr?format=svg (ADR-0021 K3).
 * Image sa nacitava cez <img> tag s credentials — cookie auth funguje
 * automaticky (same-site request na API_BASE).
 * Download button fetchuje PNG blob a triggerne <a download>.
 */
function QrCard({
  assetId,
  inventoryNumber,
}: {
  assetId: string;
  inventoryNumber: string;
}): JSX.Element {
  const [downloading, setDownloading] = useState(false);
  const qrSvgUrl = `${API_BASE}/v1/assets/${assetId}/qr?format=svg`;
  const qrPngUrl = `${API_BASE}/v1/assets/${assetId}/qr?format=png`;

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(qrPngUrl, { credentials: 'include' });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${inventoryNumber}-qr.png`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-border-subtle bg-surface-card p-5 shadow-sm lg:p-6">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">QR kód</p>
          <h3 className="font-bold text-text-primary">Identifikácia</h3>
        </div>
        <button
          type="button"
          title="Stiahnuť PNG"
          disabled={downloading}
          onClick={() => void handleDownload()}
          className="rounded p-1.5 text-text-muted transition hover:bg-surface-subtle hover:text-text-primary disabled:opacity-50"
        >
          {downloading ? (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <Download aria-hidden="true" className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* QR SVG — nacitany z API (same-origin), cookie auth automaticky.
           Pouzivame <img> nie next/image lebo src je API URL s credentials;
           next/image nepodporuje credentials: include na same-origin fetch. */}
      <div className="mx-auto w-40 rounded-xl border border-border-subtle bg-white p-3 lg:w-44">
        <img
          src={qrSvgUrl}
          alt={`QR kod pre ${inventoryNumber}`}
          className="h-full w-full"
          onError={(e) => {
            // Ak API vrati 409 (appBaseUrl nie je nastaveny) — skry obrazok
            (e.target as HTMLImageElement).style.opacity = '0.2';
          }}
        />
      </div>

      <div className="mt-3 text-center">
        <p className="font-mono text-xs text-text-muted">{inventoryNumber}</p>
        <p className="mt-2 text-[11px] leading-relaxed text-text-secondary">
          Naskenujte pre rýchle vyžiadanie alebo vrátenie
        </p>
      </div>

      <div className="mt-4 border-t border-border-subtle pt-4">
        <button
          type="button"
          onClick={() => void handleDownload()}
          className="w-full text-xs font-medium text-text-secondary hover:text-text-primary"
        >
          Stiahnuť PNG na tlač →
        </button>
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
      <div className="py-10 text-center">
        <CalendarDays className="mx-auto h-10 w-10 text-text-muted" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-text-primary">Žiadna história výpožičiek</p>
        <p className="mt-1 text-sm text-text-secondary">Tento majetok ešte nebol zapožičaný.</p>
      </div>
    );
  }

  const sorted = [...loans].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div>
      <h3 className="mb-5 font-bold text-text-primary">
        Časová os výpožičiek
        <span className="ml-2 rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-normal text-text-secondary">
          {loans.length}
        </span>
      </h3>
      <ol className="ml-2 space-y-0">
        {sorted.map((loan, idx) => (
          <LoanTimelineItem key={loan._id} loan={loan} isLast={idx === sorted.length - 1} />
        ))}
      </ol>
    </div>
  );
}

function LoanTimelineItem({ loan, isLast }: { loan: LoanSummary; isLast: boolean }): JSX.Element {
  const dotColor =
    loan.status === 'RETURNED'
      ? 'border-emerald-400'
      : loan.status === 'ACTIVE'
        ? 'border-brand-primary'
        : loan.status === 'DAMAGED'
          ? 'border-amber-400'
          : 'border-red-400';

  const cardColor =
    loan.status === 'RETURNED'
      ? 'bg-white border-border-subtle'
      : loan.status === 'ACTIVE'
        ? 'bg-amber-50 border-amber-200'
        : loan.status === 'DAMAGED'
          ? 'bg-amber-50 border-amber-200'
          : 'bg-red-50 border-red-200';

  const badgeColor =
    loan.status === 'RETURNED'
      ? 'bg-emerald-100 text-emerald-800'
      : loan.status === 'ACTIVE'
        ? 'bg-amber-100 text-amber-900'
        : loan.status === 'DAMAGED'
          ? 'bg-amber-100 text-amber-900'
          : 'bg-red-100 text-red-800';

  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      {!isLast && <div className="absolute left-[9px] top-5 bottom-0 w-0.5 bg-border-subtle" />}
      <div
        className={cn(
          'relative z-10 mt-1 h-5 w-5 shrink-0 rounded-full border-[3px] bg-surface-card shadow-sm',
          dotColor,
        )}
      />
      <div className={cn('flex-1 rounded-lg border p-4', cardColor)}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-text-primary">{loan.purpose}</p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-secondary">
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
              'shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
              badgeColor,
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
      <div className="py-10 text-center">
        <Boxes className="mx-auto h-10 w-10 text-text-muted" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-text-primary">Žiadne súvisiace položky</p>
        <p className="mt-1 text-sm text-text-secondary">
          V kategórii <strong>{categoryName ?? categoryId}</strong> nie sú ďalšie položky.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-5 font-bold text-text-primary">
        Súvisiace — {categoryName ?? categoryId}
        <span className="ml-2 rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-normal text-text-secondary">
          {related.length}
        </span>
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {related.map((asset) => (
          <Link
            key={asset._id}
            href={`/assets/${asset._id}`}
            className="group block rounded-lg border border-border-subtle bg-surface-card p-3 transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-subtle">
                <FileText aria-hidden="true" className="h-5 w-5 text-text-muted" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                  {asset.inventoryNumber}
                </p>
                <p className="truncate text-sm font-semibold text-text-primary">{asset.name}</p>
              </div>
              <ChevronRight
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100"
              />
            </div>
            <div className="mt-2.5 flex items-center justify-between border-t border-border-subtle pt-2.5">
              <StatusBadge status={asset.status} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  return (
    <span
      className={cn(
        'rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
        statusBadgeClasses(status),
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stub tab
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
    <div className="py-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-surface-subtle text-text-muted">
        {icon}
      </div>
      <p className="mt-3 text-sm font-medium text-text-primary">{title}</p>
      <p className="mt-1 text-sm text-text-secondary">{description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
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
// Error + skeleton
// ---------------------------------------------------------------------------

function ErrorState({ error, assetId }: { error: Error; assetId: string }): JSX.Element {
  const isNotFound = (error as Error & { status?: number }).status === 404;
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
          ? `Pre ID ${assetId} sa nenašiel žiadny záznam.`
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
    <div aria-busy="true" className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="h-56 animate-pulse rounded-xl bg-surface-subtle lg:col-span-2" />
        <div className="h-56 animate-pulse rounded-xl bg-surface-subtle" />
      </div>
      <div className="rounded-xl border border-border-subtle bg-surface-card">
        <div className="flex gap-4 border-b border-border-subtle p-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-6 w-24 animate-pulse rounded bg-surface-subtle" />
          ))}
        </div>
        <div className="space-y-3 p-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex justify-between gap-4">
              <div className="h-4 w-32 animate-pulse rounded bg-surface-subtle" />
              <div className="h-4 flex-1 animate-pulse rounded bg-surface-subtle" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

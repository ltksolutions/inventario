// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { User } from 'lucide-react';
import Link from 'next/link';

import { TrackingModeBadge } from './TrackingModeBadge';

import type { AssetSummary, CategorySummary, LocationSummary } from '@/lib/api-hooks';
import type { JSX, ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * AssetsTable — renders a list of assets as an accessible HTML <table>.
 *
 * Why a real <table> and not a div grid:
 *   - Screen readers announce columns + row position natively.
 *   - Sticky column widths come for free.
 *   - Pilot users will export to Excel one day; matching semantics now
 *     means we can wire in `<th scope>` and assistive tags later
 *     without restructuring the DOM.
 *
 * Category / location resolution:
 *   The asset documents carry only the FK IDs. The list views fetch
 *   the full category + location lists once and pass them in as a Map
 *   so each row stays an O(1) lookup. When the lookup misses (race
 *   between paginated fetches, or a stale cache), the raw ID is shown
 *   in a muted style — better than blanking out, easier to debug.
 *
 * Empty / loading state:
 *   The parent (AssetsListContent) handles loading skeletons and the
 *   "no rows" empty state, so this component just renders rows.
 *
 * BULK vs SERIALIZED (ADR-0020):
 *   BULK (Množstevná) položky zobrazujú ikonku Warehouse pri inventárnom čísle a
 *   množstvo na sklade v stĺpci „Množstvo". SERIALIZED (Kusová) položky
 *   (default) majú v tom stĺpci „—".
 */

const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'Dostupné',
  RESERVED: 'Rezervované',
  BORROWED: 'Zapožičané',
  IN_SERVICE: 'V servise',
  DISPOSED: 'Vyradené',
  LOST: 'Stratené',
};

/**
 * Status → token-mapped colour tone. Stick to the same four tones
 * the StatCard uses so the visual language is consistent across the
 * app. Tones are mapped to status semantics, not to status order.
 */
function statusToneClasses(status: string): string {
  switch (status) {
    case 'AVAILABLE':
      return 'bg-success-bg text-success-fg';
    case 'RESERVED':
    case 'IN_SERVICE':
      return 'bg-info-bg text-info-fg';
    case 'BORROWED':
      return 'bg-warning-bg text-warning-fg';
    case 'DISPOSED':
    case 'LOST':
      return 'bg-danger-bg text-danger-fg';
    default:
      return 'bg-surface-subtle text-text-secondary';
  }
}

interface AssetsTableProps {
  assets: readonly AssetSummary[];
  categoriesById: ReadonlyMap<string, CategorySummary>;
  locationsById: ReadonlyMap<string, LocationSummary>;
  borrowerByAssetId?: ReadonlyMap<string, string>;
}

export function AssetsTable({
  assets,
  categoriesById,
  locationsById,
  borrowerByAssetId,
}: AssetsTableProps): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card shadow-sm">
      <table className="min-w-full divide-y divide-border-subtle">
        <caption className="sr-only">Zoznam evidovaného majetku</caption>
        <thead className="bg-surface-subtle">
          <tr>
            <Th>Inventárne číslo</Th>
            <Th>Názov</Th>
            <Th>Stav</Th>
            <Th className="text-right">Množstvo</Th>
            <Th>Kategória</Th>
            <Th>Lokalita</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle bg-surface-card">
          {assets.map((asset) => {
            const category = categoriesById.get(asset.categoryId);
            const location = locationsById.get(asset.locationId);
            const isBulk = asset.trackingMode === 'BULK';
            return (
              <tr
                key={asset._id}
                className="transition hover:bg-surface-subtle focus-within:bg-surface-subtle"
              >
                {/* Inventárne číslo + BULK badge */}
                <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-text-primary">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/assets/${asset._id}`}
                      className="rounded text-brand-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                    >
                      {asset.inventoryNumber}
                    </Link>
                    {isBulk && <TrackingModeBadge mode="BULK" variant="badge" />}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-text-primary">{asset.name}</td>
                <td className="px-4 py-3 text-sm">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                      statusToneClasses(asset.status),
                    )}
                  >
                    {STATUS_LABELS[asset.status] ?? asset.status}
                  </span>
                  {asset.status === 'BORROWED' && borrowerByAssetId?.get(asset._id) ? (
                    <span className="mt-1.5 flex items-center gap-1 text-xs font-medium text-warning-fg">
                      <User className="h-3 w-3 shrink-0" aria-hidden="true" />
                      {borrowerByAssetId.get(asset._id)}
                    </span>
                  ) : null}
                </td>
                {/* Množstvo — len pre BULK */}
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm">
                  {isBulk ? (
                    <span className="font-semibold tabular-nums text-text-primary">
                      {asset.quantityOnHand ?? 0}
                      <span className="ml-1 text-xs font-normal text-text-muted">ks</span>
                    </span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-text-secondary">
                  {category ? (
                    category.name
                  ) : (
                    <span className="font-mono text-xs text-text-muted">{asset.categoryId}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-text-secondary">
                  {location ? (
                    location.name
                  ) : (
                    <span className="font-mono text-xs text-text-muted">{asset.locationId}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <th
      scope="col"
      className={cn(
        'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted',
        className,
      )}
    >
      {children}
    </th>
  );
}

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * TrackingModeBadge — vizuálny indikátor typu sledovania položky (ADR-0020).
 *
 * SERIALIZED = Kusová  → ikona Tag     (každý kus má vlastné sériové číslo)
 * BULK       = Množstevná → ikona Warehouse (sledujeme len počet zásob)
 *
 * Používa sa v AssetsTable, AssetsListContent (filter) a StockOverviewContent.
 * Enum hodnoty SERIALIZED/BULK ostávajú nezmenené v kóde a DB.
 */

import { Tag, Warehouse } from 'lucide-react';

import type { JSX } from 'react';

import { cn } from '@/lib/cn';

export type TrackingMode = 'SERIALIZED' | 'BULK';

interface TrackingModeBadgeProps {
  /**
   * Môže byť `undefined` pre legacy dokumenty v DB, ktoré predchádzajú
   * zavedeniu poľa `trackingMode` (ADR-0020). Badge v takom prípade
   * fall-backne na SERIALIZED namiesto pádu.
   */
  mode: TrackingMode | undefined;
  /** 'badge' = kompaktný inline badge (tabuľka), 'label' = ikona + text (filter, detail) */
  variant?: 'badge' | 'label';
  className?: string;
}

const CONFIG: Record<
  TrackingMode,
  { label: string; icon: typeof Tag; badgeClass: string; labelClass: string }
> = {
  SERIALIZED: {
    label: 'Kusová',
    icon: Tag,
    badgeClass: 'bg-slate-100 text-slate-700',
    labelClass: 'text-slate-600',
  },
  BULK: {
    label: 'Množstevná',
    icon: Warehouse,
    badgeClass: 'bg-blue-100 text-blue-700',
    labelClass: 'text-blue-600',
  },
};

export function TrackingModeBadge({
  mode,
  variant = 'badge',
  className,
}: TrackingModeBadgeProps): JSX.Element {
  // Guard pre legacy DB dokumenty bez trackingMode (ADR-0020 bol pridaný
  // neskôr). Ak mode nie je platná hodnota, fall-backni na SERIALIZED.
  const config =
    mode !== undefined && Object.prototype.hasOwnProperty.call(CONFIG, mode)
      ? CONFIG[mode]
      : CONFIG['SERIALIZED'];
  const { label, icon: Icon, badgeClass, labelClass } = config;

  if (variant === 'label') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-sm', labelClass, className)}>
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
        {label}
      </span>
    );
  }

  return (
    <span
      title={label}
      aria-label={label}
      className={cn('inline-flex items-center justify-center rounded p-1', badgeClass, className)}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
    </span>
  );
}

/**
 * Možnosti pre SelectField filter — ikona + label.
 * Voliteľné: môžeš použiť priamo ako `options` prop.
 */
export const TRACKING_MODE_FILTER_OPTIONS = [
  { value: '', label: 'Všetky typy' },
  { value: 'SERIALIZED', label: '🏷 Kusová' },
  { value: 'BULK', label: '🏭 Množstevná' },
] as const;

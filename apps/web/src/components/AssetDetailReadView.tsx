// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { TrackingModeBadge } from './TrackingModeBadge';

import type { AssetDetail, CategorySummary, LocationSummary } from '@/lib/api-hooks';
import type { JSX, ReactNode } from 'react';

import { categoryPath } from '@/lib/category-tree';
import { cn } from '@/lib/cn';
import { useConditionLabel } from '@/lib/conditions';
import { displayTag } from '@/lib/tags';

/**
 * Read-only display of an asset's full record. Mirrors the section
 * layout of the mockup but skips tabs (history, audit, attachments,
 * related) because their backing endpoints don't exist yet.
 *
 * Sections, in order of decreasing user salience:
 *   1. Status + condition + key dates (top "summary" strip)
 *   2. Identification (category / type / inventory / serial)
 *   3. Manufacturer / model
 *   4. Acquisition (date / cost / warranty)
 *   5. Description + tags
 *   6. Specs (key-value, generic — see component comment below)
 *   7. Internal notes (only if present + visible to current user)
 *
 * Why a flat layout instead of the mockup's two-column grid:
 *   The mockup splits info across two columns to fill horizontal
 *   space on a 1280px viewport, but pilot tenants will browse this
 *   on iPads (768px) where two columns become uncomfortably narrow.
 *   Stacked is easier to read and works at every viewport. We can
 *   reintroduce columns at lg+ once the rest of the detail page is
 *   fleshed out (history, attachments).
 */

// Human-readable label maps. Mirror packages/shared-types enums; kept
// here because UI strings are a localisation concern, not a backend
// concern. The default keys fall through to the raw value so we never
// break when the backend adds a new enum entry — the user sees the
// raw string, the developer sees what's missing.
const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'Dostupné',
  RESERVED: 'Rezervované',
  BORROWED: 'Zapožičané',
  IN_SERVICE: 'V servise',
  DISPOSED: 'Vyradené',
  LOST: 'Stratené',
};

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

/**
 * Format an ISO date string as Slovak short date (e.g. "17. 5. 2026").
 * Returns em dash for nullish input.
 */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('sk-SK', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });
}

function formatMoney(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toLocaleString('sk-SK', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  });
}

/**
 * Convert a flat object key into a human-readable label.
 *
 *   "ramGb"        → "Ram Gb"
 *   "mac_address"  → "Mac Address"
 *   "cpu"          → "Cpu"
 *
 * Not a translation system — just a small dignity-preserving touch
 * over the raw JSON key. Type-aware labels for known specs schemas
 * (IT, sports gear, media) will land when we wire those up.
 */
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Stringify a JSON value for display. Objects and arrays get a JSON
 * preview; primitives render as-is. Limits depth and length so a
 * pathological spec value can't blow up the layout.
 */
function formatSpecValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const json = JSON.stringify(value);
    return json.length > 200 ? `${json.slice(0, 200)}…` : json;
  } catch {
    return '[neserializovateľná hodnota]';
  }
}

interface AssetDetailReadViewProps {
  asset: AssetDetail;
  categoriesById: ReadonlyMap<string, CategorySummary>;
  locationsById: ReadonlyMap<string, LocationSummary>;
}

export function AssetDetailReadView({
  asset,
  categoriesById,
  locationsById,
}: AssetDetailReadViewProps): JSX.Element {
  const conditionLabel = useConditionLabel();
  const category = categoriesById.get(asset.categoryId);
  const location = locationsById.get(asset.locationId);
  const specEntries = Object.entries(asset.specs ?? {});

  return (
    <div className="space-y-6">
      {/* Status + key meta strip */}
      <section className="grid gap-3 rounded-xl border border-border-subtle bg-surface-card p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <Meta label="Stav">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
              statusToneClasses(asset.status),
            )}
          >
            {STATUS_LABELS[asset.status] ?? asset.status}
          </span>
        </Meta>
        <Meta label="Kondícia">{conditionLabel(asset.condition)}</Meta>
        <Meta label="Lokalita">
          {location ? (
            location.name
          ) : (
            <span className="font-mono text-xs text-text-muted">{asset.locationId}</span>
          )}
        </Meta>
        <Meta label="Pridané">{formatDate(asset.acquiredAt)}</Meta>
      </section>

      {/* Identification */}
      <Section title="Identifikácia">
        <Row label="Inventárne číslo">
          <span className="font-mono">{asset.inventoryNumber}</span>
        </Row>
        <Row label="Kategória">
          {category ? (
            categoryPath(category, categoriesById)
          ) : (
            <span className="font-mono text-xs text-text-muted">{asset.categoryId}</span>
          )}
        </Row>
        <Row label="Sériové číslo">
          {asset.serialNumber ? (
            <span className="font-mono">{asset.serialNumber}</span>
          ) : (
            <span className="text-text-muted">—</span>
          )}
        </Row>
        <Row label="Typ sledovania">
          <TrackingModeBadge mode={asset.trackingMode} variant="label" />
        </Row>
        {asset.trackingMode === 'BULK' && (
          <Row label="Množstvo na sklade">
            <span className="font-mono font-semibold">
              {asset.quantityOnHand ?? 0}
              <span className="ml-1 text-xs font-normal text-text-muted">ks</span>
            </span>
          </Row>
        )}
      </Section>

      {/* Manufacturer / model */}
      {(asset.manufacturer || asset.model) && (
        <Section title="Výrobca a model">
          {asset.manufacturer ? <Row label="Výrobca">{asset.manufacturer}</Row> : null}
          {asset.model ? <Row label="Model">{asset.model}</Row> : null}
        </Section>
      )}

      {/* Acquisition */}
      <Section title="Nadobudnutie">
        <Row label="Dátum nadobudnutia">{formatDate(asset.acquiredAt)}</Row>
        <Row label="Nadobúdacia cena">
          <span className="font-mono">{formatMoney(asset.acquisitionCost)}</span>
        </Row>
        <Row label="Záruka do">{formatDate(asset.warrantyUntil)}</Row>
      </Section>

      {/* Description + tags */}
      {(asset.description || asset.tags.length > 0) && (
        <Section title="Popis a tagy">
          {asset.description ? (
            <div className="px-5 py-3">
              <p className="whitespace-pre-line text-sm leading-relaxed text-text-primary">
                {asset.description}
              </p>
            </div>
          ) : null}
          {asset.tags.length > 0 ? (
            <div className="flex flex-wrap gap-2 px-5 py-3">
              {asset.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-surface-subtle px-2.5 py-0.5 text-xs font-medium text-text-secondary"
                >
                  #{displayTag(tag)}
                </span>
              ))}
            </div>
          ) : null}
        </Section>
      )}

      {/* Specs — generic key/value */}
      {specEntries.length > 0 ? (
        <Section title="Špecifikácia">
          {specEntries.map(([key, value]) => (
            <Row key={key} label={humanizeKey(key)}>
              <span className={typeof value === 'number' ? 'font-mono' : undefined}>
                {formatSpecValue(value)}
              </span>
            </Row>
          ))}
        </Section>
      ) : null}

      {/* Internal notes — typically only visible to managers, but the
          backend already gates this on RBAC, so we just render what we
          receive. */}
      {asset.internalNotes ? (
        <Section title="Interné poznámky">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
            {asset.internalNotes}
          </p>
        </Section>
      ) : null}

      {/* Flags — small print at the bottom for completeness */}
      <Section title="Pravidlá výpožičky">
        <Row label="Možno zapožičať">{asset.isLoanable ? 'Áno' : 'Nie'}</Row>
        <Row label="Vyžaduje schválenie">{asset.requiresApproval ? 'Áno' : 'Nie'}</Row>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="rounded-xl border border-border-subtle bg-surface-card shadow-sm">
      <h2 className="border-b border-border-subtle px-5 py-3 text-sm font-semibold text-text-primary">
        {title}
      </h2>
      <dl className="divide-y divide-border-subtle">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-sm font-medium text-text-secondary sm:w-48 sm:shrink-0">{label}</dt>
      <dd className="text-sm text-text-primary sm:flex-1 sm:text-right">{children}</dd>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{label}</p>
      <div className="mt-1 text-sm font-medium text-text-primary">{children}</div>
    </div>
  );
}

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { Boxes, ClipboardList, MapPin, Tags } from 'lucide-react';
import Link from 'next/link';

import { PendingActionsPanel } from './PendingActionsPanel';
import { StatCard } from './StatCard';

import type { JSX, ReactNode } from 'react';

import { useAssets, useCategories, useLocations, useMe, useMyLoans } from '@/lib/api-hooks';

/**
 * Dashboard for authenticated users.
 *
 * Three sections:
 *   1. Greeting — welcome + user's display name (from /v1/me)
 *   2. Stats grid — count of assets, categories, locations + a
 *      placeholder loans card (loans API lands in a later slice)
 *   3. Quick navigation — same cards as the K2 bootstrap placeholder,
 *      kept because pilot users find them the easiest entry point
 *
 * Data fetching:
 *   We call each list endpoint with limit=1 to get the `pagination.total`
 *   count without dragging every row across the wire. The dashboard
 *   only needs counts — the actual rows live behind their respective
 *   list pages (K5+).
 */
export function DashboardContent(): JSX.Element {
  const me = useMe();
  const assets = useAssets({ limit: 1 });
  const categories = useCategories({ limit: 1 });
  const locations = useLocations({ limit: 1 });
  const loans = useMyLoans({ limit: 1, status: 'ACTIVE' });

  const greetingName = me.data?.firstName ?? me.data?.displayName ?? null;

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">
          {greetingName ? `Vitajte, ${greetingName}` : 'Vitajte späť'}
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Tu je aktuálny prehľad inventára vašej organizácie.
        </p>
      </header>

      {/* Čaká na vás — akčný prehľad žiadostí, podpisov a termínov */}
      <PendingActionsPanel />

      <section aria-labelledby="stats-heading" className="mb-10">
        <h2 id="stats-heading" className="sr-only">
          Štatistiky
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Majetok"
            value={assets.data?.pagination.total}
            icon={<Boxes aria-hidden="true" className="h-5 w-5" />}
            isLoading={assets.isLoading}
            isError={assets.isError}
            hint="celkový počet položiek"
          />
          <StatCard
            label="Kategórie"
            value={categories.data?.pagination.total}
            icon={<Tags aria-hidden="true" className="h-5 w-5" />}
            tone="info"
            isLoading={categories.isLoading}
            isError={categories.isError}
            hint="aktívnych v taxonómii"
          />
          <StatCard
            label="Lokality"
            value={locations.data?.pagination.total}
            icon={<MapPin aria-hidden="true" className="h-5 w-5" />}
            tone="success"
            isLoading={locations.isLoading}
            isError={locations.isError}
            hint="evidovaných miest"
          />
          <StatCard
            label="Výpožičky"
            value={loans.data?.pagination.total}
            icon={<ClipboardList aria-hidden="true" className="h-5 w-5" />}
            tone="warning"
            isLoading={loans.isLoading}
            isError={loans.isError}
            hint="aktívnych výpožičiek"
          />
        </div>
      </section>

      <section
        aria-labelledby="quick-nav-heading"
        className="rounded-xl border border-border-subtle bg-surface-card p-6 shadow-md"
      >
        <h2 id="quick-nav-heading" className="text-lg font-semibold text-text-primary">
          Rýchla navigácia
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          <NavCard
            href="/assets"
            icon={<Boxes aria-hidden="true" className="h-5 w-5" />}
            title="Majetok"
            description="Evidencia, hľadanie a editácia položiek."
          />
          <NavCard
            href="/loans"
            icon={<ClipboardList aria-hidden="true" className="h-5 w-5" />}
            title="Výpožičky"
            description="Aktuálne výpožičky a žiadosti o vypožičanie."
          />
          <NavCard
            href="/categories"
            icon={<Tags aria-hidden="true" className="h-5 w-5" />}
            title="Kategórie"
            description="Hierarchická taxonómia majetku."
          />
          <NavCard
            href="/locations"
            icon={<MapPin aria-hidden="true" className="h-5 w-5" />}
            title="Lokality"
            description="Fyzické miesta, kde sa majetok nachádza."
          />
        </ul>
      </section>

      {(assets.isError ||
        categories.isError ||
        locations.isError ||
        loans.isError ||
        me.isError) && (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-danger-fg bg-danger-bg p-4 text-sm text-danger-fg"
        >
          Niektoré dáta sa nepodarilo načítať. Skontrolujte, či je API server dostupný a či máte
          aktívne pripojenie.
        </div>
      )}
    </div>
  );
}

function NavCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
}): JSX.Element {
  return (
    <li>
      <Link
        href={href}
        className="flex h-full flex-col gap-2 rounded-lg border border-border-subtle bg-surface-subtle p-4 transition hover:border-border-default hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card"
      >
        <span className="flex items-center gap-2 text-brand-primary">
          {icon}
          <span className="text-base font-semibold text-text-primary">{title}</span>
        </span>
        <span className="text-sm text-text-secondary">{description}</span>
      </Link>
    </li>
  );
}

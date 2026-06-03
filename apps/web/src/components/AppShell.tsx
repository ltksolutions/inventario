// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * AppShell — K19 update: tenant switcher dropdown.
 *
 * Header now shows the active org name. If the user has access to
 * more than one organisation, a chevron button opens a dropdown
 * listing all available orgs. Clicking one calls switchOrg() from
 * auth context (POST /v1/auth/switch-organisation + refresh).
 *
 * New nav items:
 *   /settings/members       — admin member list (K21)
 *   /settings/organisations — user's org list / leave org (K22)
 */

import {
  Boxes,
  Building2,
  ChevronDown,
  ClipboardList,
  Home,
  KeyRound,
  Layers,
  Library,
  ListChecks,
  Lock,
  Loader2,
  Mail,
  Menu,
  ShieldCheck,
  Users,
  Warehouse,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { LogoutButton } from './LogoutButton';
import { RouteProgressBar } from './RouteProgressBar';

import type { JSX, ReactNode } from 'react';

import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  adminOnly?: boolean;
  managerOnly?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Dashboard', icon: Home },
  { href: '/assets', label: 'Majetok', icon: Boxes },
  { href: '/stock', label: 'Sklad', icon: Warehouse, managerOnly: true },
  { href: '/loans', label: 'Žiadosti', icon: ClipboardList },
  { href: '/my-loans', label: 'Moje výpožičky', icon: Library },
  { href: '/ciselniky', label: 'Číselníky', icon: ListChecks },
  { href: '/users', label: 'Používatelia', icon: Users, adminOnly: true },
  { href: '/admin/tenants', label: 'Tenanti', icon: ShieldCheck, adminOnly: true },
  { href: '/settings/organisation', label: 'Organizácia', icon: Building2, adminOnly: true },
  { href: '/settings/auth', label: 'Prihlasovanie', icon: KeyRound, adminOnly: true },
  { href: '/settings/members', label: 'Členovia', icon: Users, adminOnly: true },
  { href: '/settings/invitations', label: 'Pozvánky', icon: Mail },
  { href: '/settings/organisations', label: 'Moje organizácie', icon: Building2 },
  { href: '/settings/security', label: 'Bezpečnosť', icon: Lock },
] as const;

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrátor',
  ASSET_MANAGER: 'Správca majetku',
  EMPLOYEE: 'Zamestnanec',
  EXTERNAL: 'Externý',
};

function formatRole(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const { user, availableOrganisations, activeMembership } = useAuth();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setDrawerOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  const displayName = user?.displayName ?? user?.email ?? 'Používateľ';
  const role = user?.role ?? 'EMPLOYEE';

  // Current org name
  const currentOrg = availableOrganisations.find(
    (o) => o.organisationId === activeMembership?.organisationId,
  );
  const currentOrgName = currentOrg?.organisationName ?? 'Inventario';
  const currentLogoUrl = currentOrg?.brandKit?.logoUrl ?? null;

  // Filter nav items by role
  const isAdmin = role === 'ADMIN';
  const isManager = role === 'ADMIN' || role === 'ASSET_MANAGER';
  const visibleNavItems = NAV_ITEMS.filter(
    (item) => (!item.adminOnly || isAdmin) && (!item.managerOnly || isManager),
  );

  return (
    <div className="min-h-screen bg-surface-page">
      <Header
        userName={displayName}
        role={role}
        currentOrgName={currentOrgName}
        currentLogoUrl={currentLogoUrl}
        availableOrganisations={availableOrganisations}
        activeMembershipOrgId={activeMembership?.organisationId ?? null}
        onOpenDrawer={() => setDrawerOpen(true)}
        drawerOpen={drawerOpen}
      />
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <DesktopSidebar pathname={pathname} navItems={visibleNavItems} />
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
      <MobileDrawer
        pathname={pathname}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        navItems={visibleNavItems}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

interface HeaderProps {
  userName: string;
  role: string;
  currentOrgName: string;
  currentLogoUrl: string | null; // ADR-0028: tenant logo
  availableOrganisations: ReturnType<typeof useAuth>['availableOrganisations'];
  activeMembershipOrgId: string | null;
  onOpenDrawer: () => void;
  drawerOpen: boolean;
}

function Header({
  userName,
  role,
  currentOrgName,
  currentLogoUrl,
  availableOrganisations,
  activeMembershipOrgId,
  onOpenDrawer,
  drawerOpen,
}: HeaderProps): JSX.Element {
  return (
    <header className="relative border-b border-border-subtle bg-brand-primary">
      <RouteProgressBar />
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenDrawer}
            aria-label="Otvoriť navigáciu"
            aria-controls="mobile-nav-drawer"
            aria-expanded={drawerOpen}
            className="-ml-2 rounded-lg p-2 text-brand-primary-fg transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 md:hidden"
          >
            <Menu aria-hidden="true" className="h-5 w-5" />
          </button>
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2 text-lg font-bold text-brand-primary-fg transition hover:opacity-80"
          >
            {/* ADR-0028 v2: tenant logo na bielej dlaždici (čitateľné na brand lište) alebo Inventario wordmark */}
            {currentLogoUrl ? (
              <span className="flex shrink-0 items-center rounded-md bg-white px-1.5 py-1">
                <TenantLogo url={currentLogoUrl} orgName={currentOrgName} />
              </span>
            ) : (
              <Layers aria-hidden="true" className="h-6 w-6 shrink-0" />
            )}
            <span className="truncate">{currentOrgName}</span>
          </Link>

          {/* Tenant switcher */}
          <TenantSwitcher
            currentOrgName={currentOrgName}
            availableOrganisations={availableOrganisations}
            activeMembershipOrgId={activeMembershipOrgId}
          />
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden min-w-0 text-right sm:block">
            <p className="truncate text-sm font-medium text-brand-primary-fg">{userName}</p>
            {role && <p className="truncate text-xs text-brand-primary-fg">{formatRole(role)}</p>}
          </div>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Tenant switcher dropdown (K19)
// ---------------------------------------------------------------------------

function TenantSwitcher({
  currentOrgName,
  availableOrganisations,
  activeMembershipOrgId,
}: {
  currentOrgName: string;
  availableOrganisations: ReturnType<typeof useAuth>['availableOrganisations'];
  activeMembershipOrgId: string | null;
}): JSX.Element | null {
  const { switchOrg } = useAuth();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Only render if there's more than 1 org
  if (availableOrganisations.length <= 1) return null;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSwitch = async (orgId: string): Promise<void> => {
    if (orgId === activeMembershipOrgId || switching) return;
    setSwitching(orgId);
    try {
      await switchOrg(orgId);
      setOpen(false);
    } catch {
      // ignore — user stays in current org
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-lg border border-white/25 px-2 py-1 text-xs font-medium text-brand-primary-fg/90 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <Building2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-[140px] truncate">{currentOrgName}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn('h-3 w-3 transition', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Prepnúť organizáciu"
          className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-border-subtle bg-surface-card py-1 shadow-lg"
        >
          {availableOrganisations.map((org) => {
            const isActive = org.organisationId === activeMembershipOrgId;
            const isLoading = switching === org.organisationId;
            return (
              <button
                key={org.organisationId}
                role="option"
                aria-selected={isActive}
                type="button"
                onClick={() => void handleSwitch(org.organisationId)}
                disabled={isActive || !!switching}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition',
                  isActive
                    ? 'bg-surface-subtle font-medium text-text-primary'
                    : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary',
                  switching && !isLoading && 'opacity-50',
                )}
              >
                {isLoading ? (
                  <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin shrink-0" />
                ) : (
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white"
                    style={{ background: orgColor(org.organisationId) }}
                    aria-hidden="true"
                  >
                    {org.organisationName.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="truncate">{org.organisationName}</span>
                {isActive && <span className="ml-auto text-xs text-brand-accent">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * TenantLogo — tenant logo s onError fallback (ADR-0028 B6, v2 fix výšky).
 *
 * Logo sa natvrdo zoškáluje na pevnú výšku (28px) bez ohľadu na jeho
 * pomer strán — štvorcové ani vysoké logo už nenatíahne hlavičku. Box má
 * pevnú výšku + `overflow:hidden`, obrázok `height:100%, width:auto`.
 *
 * Používame natívny `<img>` (nie next/image) — logo aj tak servírujeme
 * `unoptimized` (externé/Blob URL), takže o nič neprichádzame, a `<img>`
 * so štýlom sa správa predvídateľne pri ľubovoľnom pomere strán.
 */
function TenantLogo({ url, orgName }: { url: string; orgName: string }): JSX.Element {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return <Layers aria-hidden="true" className="h-6 w-6 shrink-0" />;
  }
  return (
    <img
      src={url}
      alt={orgName}
      style={{ height: '28px', width: 'auto', maxWidth: '120px', objectFit: 'contain' }}
      className="block shrink-0"
      onError={() => setErrored(true)}
    />
  );
}

/** Deterministická farba z org ID (hex seed) */
function orgColor(id: string): string {
  const palette = [
    '#1A2D47',
    '#388FC3',
    '#2E7D32',
    '#6A1B9A',
    '#BF360C',
    '#00695C',
    '#4527A0',
    '#AD1457',
  ];
  const seed = parseInt(id.slice(-4), 16);
  return palette[seed % palette.length] ?? '#1A2D47';
}

// ---------------------------------------------------------------------------
// Desktop sidebar
// ---------------------------------------------------------------------------

function DesktopSidebar({
  pathname,
  navItems,
}: {
  pathname: string;
  navItems: readonly NavItem[];
}): JSX.Element {
  return (
    <nav aria-label="Hlavná navigácia" className="hidden w-56 shrink-0 md:block">
      <ul className="flex flex-col gap-1">
        {navItems.map((item) => (
          <NavLi key={item.href} item={item} pathname={pathname} />
        ))}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Mobile drawer
// ---------------------------------------------------------------------------

interface MobileDrawerProps {
  pathname: string;
  open: boolean;
  onClose: () => void;
  navItems: readonly NavItem[];
}

function MobileDrawer({
  pathname,
  open,
  onClose,
  navItems,
}: MobileDrawerProps): JSX.Element | null {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <nav
        id="mobile-nav-drawer"
        aria-label="Hlavná navigácia"
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col gap-1 bg-surface-card p-4 shadow-xl"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-text-secondary">Navigácia</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zatvoriť navigáciu"
            className="rounded-lg p-1.5 text-text-muted transition hover:bg-surface-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <ul className="flex flex-col gap-1">
          {navItems.map((item) => (
            <NavLi key={item.href} item={item} pathname={pathname} />
          ))}
        </ul>
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared nav item
// ---------------------------------------------------------------------------

function NavLi({ item, pathname }: { item: NavItem; pathname: string }): JSX.Element {
  const isActive =
    item.href === '/'
      ? pathname === '/'
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
          isActive
            ? 'bg-brand-primary text-brand-primary-fg'
            : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary',
        )}
      >
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
        {item.label}
      </Link>
    </li>
  );
}

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import {
  Boxes,
  ClipboardList,
  Home,
  Layers,
  Library,
  MapPin,
  Menu,
  Tags,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { LogoutButton } from './LogoutButton';

import type { JSX, ReactNode } from 'react';

import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';

/**
 * Authenticated app shell — header with branding, user menu, and a
 * sidebar with primary navigation. Wraps the page content (`children`).
 *
 * Rendered ONLY for authenticated users — the page-level component
 * decides whether to render this or the LoginScreen.
 *
 * Responsive behaviour (post mobile-polish pass):
 *
 *   Desktop (md+):
 *   ┌─ Header ────────────────────────────────────────────────┐
 *   │ [logo] Inventario          [user name + roles] [logout] │
 *   ├──────┬──────────────────────────────────────────────────┤
 *   │ Side │                                                  │
 *   │ bar  │  <main id="main">  page content                  │
 *   └──────┴──────────────────────────────────────────────────┘
 *
 *   Mobile (< md):
 *   ┌─ Header ────────────────────────────────────────────────┐
 *   │ [☰] [logo] Inventario              [user] [logout]      │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  <main id="main">  page content                          │
 *   └──────────────────────────────────────────────────────────┘
 *
 *   Tapping the hamburger opens a slide-in drawer with the same nav
 *   items, dimming the rest of the page behind a backdrop. The
 *   drawer auto-closes when the route changes (so a tap on "Majetok"
 *   navigates AND dismisses) and when Escape is pressed.
 *
 * Focus management:
 *   We don't implement a focus trap inside the drawer in this pass —
 *   Escape and backdrop-click close it, and Tab order naturally
 *   continues past the drawer into the page below. A real focus trap
 *   plus body-scroll lock can come in a later polish round once
 *   keyboard-only mobile usage is a tested scenario.
 */

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Dashboard', icon: Home },
  { href: '/assets', label: 'Majetok', icon: Boxes },
  { href: '/loans', label: 'Žiadosti', icon: ClipboardList },
  { href: '/my-loans', label: 'Moje výpožičky', icon: Library },
  { href: '/categories', label: 'Kategórie', icon: Tags },
  { href: '/locations', label: 'Lokality', icon: MapPin },
  { href: '/users', label: 'Používatelia', icon: Users },
] as const;

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrátor',
  ASSET_MANAGER: 'Správca majetku',
  TEAM_MANAGER: 'Vedúci tímu',
  EMPLOYEE: 'Zamestnanec',
  EXTERNAL: 'Externý',
};

function formatRoles(roles: readonly string[]): string {
  return roles.map((role) => ROLE_LABELS[role] ?? role).join(' · ');
}

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const { user } = useAuth();
  const pathname = usePathname();

  // Mobile drawer open/close state.
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  const displayName = user?.displayName ?? user?.email ?? 'Používateľ';
  const roles = user?.roles ?? [];

  return (
    <div className="min-h-screen bg-surface-page">
      <Header
        userName={displayName}
        roles={roles}
        onOpenDrawer={() => setDrawerOpen(true)}
        drawerOpen={drawerOpen}
      />
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <DesktopSidebar pathname={pathname} />
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
      <MobileDrawer pathname={pathname} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header (with mobile hamburger)
// ---------------------------------------------------------------------------

interface HeaderProps {
  userName: string;
  roles: readonly string[];
  onOpenDrawer: () => void;
  drawerOpen: boolean;
}

function Header({ userName, roles, onOpenDrawer, drawerOpen }: HeaderProps): JSX.Element {
  return (
    <header className="border-b border-border-subtle bg-surface-card">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2">
          {/*
            Hamburger — visible only below md. aria-controls points at
            the drawer element so AT can associate the trigger with
            the disclosed region; aria-expanded tracks state.
          */}
          <button
            type="button"
            onClick={onOpenDrawer}
            aria-label="Otvoriť navigáciu"
            aria-controls="mobile-nav-drawer"
            aria-expanded={drawerOpen}
            className="-ml-2 rounded-lg p-2 text-text-primary transition hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus md:hidden"
          >
            <Menu aria-hidden="true" className="h-5 w-5" />
          </button>
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2 text-lg font-bold text-brand-primary transition hover:opacity-80"
          >
            <Layers aria-hidden="true" className="h-6 w-6 shrink-0" />
            <span className="truncate">Inventario</span>
          </Link>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden min-w-0 text-right sm:block">
            <p className="truncate text-sm font-medium text-text-primary">{userName}</p>
            {roles.length > 0 && (
              <p className="truncate text-xs text-text-muted">{formatRoles(roles)}</p>
            )}
          </div>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Desktop sidebar (md+, always visible)
// ---------------------------------------------------------------------------

function DesktopSidebar({ pathname }: { pathname: string }): JSX.Element {
  return (
    <nav aria-label="Hlavná navigácia" className="hidden w-56 shrink-0 md:block">
      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <NavLi key={item.href} item={item} pathname={pathname} />
        ))}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Mobile drawer (< md, controlled by hamburger)
// ---------------------------------------------------------------------------

interface MobileDrawerProps {
  pathname: string;
  open: boolean;
  onClose: () => void;
}

function MobileDrawer({ pathname, open, onClose }: MobileDrawerProps): JSX.Element | null {
  // Whole drawer is conditionally mounted so its DOM doesn't sit in
  // the tree (and accept tabs) when closed. The CSS transitions
  // shipped with Tailwind would let us animate-fade instead, but
  // the unmount keeps the implementation simple and the AT story
  // clean (closed drawer is genuinely not in the tree).
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      {/*
        Backdrop — click closes the drawer. role="button" + onKeyDown
        would let us also accept Enter / Space, but the visible Close
        button + Escape handler in AppShell already cover keyboard
        users. The backdrop's only purpose for keyboard users is the
        focus-trap break-out, which Escape solves more directly.
      */}
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
          {NAV_ITEMS.map((item) => (
            <NavLi key={item.href} item={item} pathname={pathname} />
          ))}
        </ul>
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared nav item — used by both desktop sidebar and mobile drawer
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

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import './globals.css';

import { Inter, Lato, Open_Sans, Roboto } from 'next/font/google';

import { AppProviders } from './providers';

import type { Metadata, Viewport } from 'next';
import type { JSX, ReactNode } from 'react';

/*
 * ADR-0028 v2 — per-tenant fonty.
 *
 * Načítame 4 Google fonty cez `next/font/google` (self-hosted, GDPR-friendly
 * — next/font ich pri builde sté a servíruje z nášho origin, žiadny request
 * na Google CDN za behu). Každý dostane CSS premennú, ktorú font enum
 * (`FONT_OPTIONS` v shared-types) referencuje cez `var(--font-*)`.
 *
 * `display: 'swap'` — text sa zobrazí okamžite v fallback fonte a prepne sa
 * keď sa web font načíta (žiadny neviditeľný text).
 *
 * Premenné sa nasadia na <html> — sú tým globálne dostupné. Default font
 * ostáva system-ui (cez --inv-font-family-sans v tokens.css); BrandProvider
 * prepíše --inv-font-family-sans na `var(--font-*)` keď tenant zvolí font.
 *
 * INVARIANT: názvy `variable` MUSIA súhlasiť s `var(--font-*)` v
 * `FONT_OPTIONS` (packages/shared-types/src/brand-presets.ts).
 */
const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-inter',
});
const openSans = Open_Sans({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-open-sans',
});
const roboto = Roboto({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-roboto',
});
const lato = Lato({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-lato',
});

/**
 * Root metadata for the Inventario web app.
 *
 * Tenants will eventually override displayName, ogImage, and theme color
 * at runtime via the brand-kit endpoint, but the static defaults here are
 * the canonical Inventario branding (used pre-login and on the default
 * tenant `inventario`).
 */
export const metadata: Metadata = {
  title: {
    default: 'Inventario',
    template: '%s · Inventario',
  },
  description:
    'Transparentná správa majetku pre športové zväzy, mestá, kluby a školy. Bez vendor lock-in.',
  applicationName: 'Inventario',
  authors: [{ name: 'Ján Letko / LTK Solutions' }],
  generator: 'Next.js',
  referrer: 'strict-origin-when-cross-origin',
  robots: {
    // The authenticated app should not be indexed — public marketing lives
    // on inventario.sportup.sk; this is the gated product surface.
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  // Brand primary (Navy #1A2D47) — used by mobile browsers for the URL bar
  // tint. Matches the Inventario default tenant; per-tenant theme color
  // is injected client-side once the tenant resolves.
  themeColor: '#1A2D47',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  // Font premenné (ADR-0028 v2) na <html> — sprístupní var(--font-*) globálne.
  const fontVars = `${inter.variable} ${openSans.variable} ${roboto.variable} ${lato.variable}`;

  return (
    <html lang="sk" className={fontVars}>
      <body>
        {/*
          Skip link — first focusable element, jumps past nav for keyboard
          users. WCAG 2.4.1 Bypass Blocks. Same pattern as marketing site
          (Phase E1 added it there).
        */}
        <a href="#main" className="skip-link">
          Preskočiť na hlavný obsah
        </a>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}

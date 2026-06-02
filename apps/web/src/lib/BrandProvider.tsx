// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * BrandProvider — ADR-0028 runtime brand injekcia.
 *
 * Po vyriešení aktívneho tenanta z GET /v1/auth/me nastaví:
 *   1. `data-tenant="{slug}"` na `<html>` elemente
 *   2. `<style id="inv-tenant-brand">` s `--inv-brand-*` CSS premennými
 *      pre farby a font aktívneho tenanta
 *
 * Override sa drží IBA na `--inv-brand-*` vrstve (+ font). Primitive
 * a semantic vrstvy sa nedotýkame — garantuje konzistentné UI naprieč
 * tenantmi (BRAND.md §8).
 *
 * FOUC (flash of unstyled content): v1 akceptovaný — override nastáva
 * až po vyriešení /v1/auth/me. Používateľ je za login bránou, FOUC je
 * teda viditeľný len krátko po prvom načítaní. v2 rieši SSR/cookie cache.
 *
 * Čistenie: keď nemá aktívny tenant brandKit (null), style blok sa
 * vyprázdni a `data-tenant` sa odstráni → Inventario default.
 *
 * switchOrg: pri prepnutí tenanta `AuthProvider` zavolá fetchMe znova
 * → useEffect reaguje na zmenu `activeMembership` a prepíše brand.
 */

import { useEffect } from 'react';

import { useAuth } from './auth-context';

import type { JSX, ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Pomocné funkcie (čisté, testovateľné)
// ---------------------------------------------------------------------------

/**
 * Zostaví CSS text pre `<style id="inv-tenant-brand">`.
 *
 * Príklad výstupu:
 *   :root[data-tenant='sfz'] {
 *     --inv-brand-primary: #003d7a;
 *     --inv-brand-primary-fg: #ffffff;
 *     --inv-brand-accent: #ffd700;
 *     --inv-brand-accent-fg: #1a2d47;
 *     --inv-brand-logo-dot: #ffd700;
 *     --inv-font-family-sans: 'Open Sans', system-ui, sans-serif;
 *   }
 */
export function buildBrandStyle(
  slug: string,
  brandKit: {
    primary: string | null;
    primaryFg: string | null;
    accent: string | null;
    accentFg: string | null;
    logoDot: string | null;
    fontFamilySans: string | null;
  },
): string {
  const lines: string[] = [];

  if (brandKit.primary) lines.push(`  --inv-brand-primary: ${brandKit.primary};`);
  if (brandKit.primaryFg) lines.push(`  --inv-brand-primary-fg: ${brandKit.primaryFg};`);
  if (brandKit.accent) lines.push(`  --inv-brand-accent: ${brandKit.accent};`);
  if (brandKit.accentFg) lines.push(`  --inv-brand-accent-fg: ${brandKit.accentFg};`);
  // logoDot: ak nie je zadaný, fallback na accent (runtime CSS var referenciu neriešime tu
  // — jednoducho nevložíme, tokens.css má --inv-brand-logo-dot default = blue.500)
  if (brandKit.logoDot) lines.push(`  --inv-brand-logo-dot: ${brandKit.logoDot};`);
  else if (brandKit.accent) lines.push(`  --inv-brand-logo-dot: ${brandKit.accent};`);
  if (brandKit.fontFamilySans) lines.push(`  --inv-font-family-sans: ${brandKit.fontFamilySans};`);

  if (lines.length === 0) return '';

  // Obalíme selector s jednoduchými apostrofmi — slug smie obsahovať iba
  // [a-z0-9-] (validácia na backende), takže escaping nie je potrebný.
  return `:root[data-tenant='${slug}'] {\n${lines.join('\n')}\n}`;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const STYLE_ID = 'inv-tenant-brand';

export function BrandProvider({ children }: { children: ReactNode }): JSX.Element {
  const { activeMembership, availableOrganisations, isLoading } = useAuth();

  useEffect(() => {
    // Počkajme kým sa auth vyrieši
    if (isLoading) return;

    const root = document.documentElement;

    // Nájdi aktívnu org z availableOrganisations podľa activeMembership
    const activeOrg = activeMembership
      ? availableOrganisations.find((o) => o.organisationId === activeMembership.organisationId)
      : null;

    if (!activeOrg?.brandKit) {
      // Žiaden brand kit → vymaž overrides, vráť Inventario default
      root.removeAttribute('data-tenant');
      const existing = document.getElementById(STYLE_ID);
      if (existing) existing.textContent = '';
      return;
    }

    const { slug, brandKit } = activeOrg;
    const css = buildBrandStyle(slug, brandKit);

    // Nastav data-tenant na <html>
    root.setAttribute('data-tenant', slug);

    // Vstrekni alebo aktualizuj <style>
    let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;
  }, [activeMembership, availableOrganisations, isLoading]);

  // BrandProvider nerendruje nič vlastné — len deti
  return <>{children}</>;
}

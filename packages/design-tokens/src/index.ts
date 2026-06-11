// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Inventario Design Tokens — TypeScript export
 *
 * Single source of truth pre brand farby, typografiu, spacing a multi-tenant
 * white-label overrides. Zdroj hodnôt: `tokens.json` (W3C Design Tokens format)
 * a `BRAND.md` v1.0.
 *
 * Architektúra (3 vrstvy):
 *   1. `primitive.*`  — raw hodnoty, NIKDY priamo v komponentoch
 *   2. `semantic.*`   — UI role (text, surface, success, danger, …)
 *   3. `brand.*`      — Inventario default identita, override-uje sa per-tenant
 *
 * Typický import v React/Next.js komponente:
 *
 *   import { semantic, brand } from '@inventario/design-tokens';
 *
 *   <button style={{
 *     background: brand.primary,
 *     color: brand.primaryFg,
 *     borderRadius: primitive.radius.lg,
 *   }}>...</button>
 *
 * Pre CSS-in-JS preferuj CSS custom properties (`@inventario/design-tokens/tokens.css`)
 * — natívne podporujú multi-tenant override cez `:root[data-tenant='X']`.
 *
 * Pre Tailwind preferuj preset (`@inventario/design-tokens/tailwind`).
 *
 * TODO(future): Generate this file from tokens.json via Style Dictionary, when
 * the token set grows beyond hand-maintainable size or when Flutter export is
 * needed.
 */

// ---------------------------------------------------------------------------
// PRIMITIVE LAYER — raw values, never used directly in components
// ---------------------------------------------------------------------------

export const primitive = {
  color: {
    navy: {
      50: '#f0f2f6',
      100: '#d8dde7',
      300: '#7e8da7',
      500: '#3e577a',
      700: '#1a2d47', // Inventario Navy — primary brand color
      900: '#0e1a2b', // Darkest navy, dark mode surfaces
    },
    blue: {
      50: '#eaf3fa',
      100: '#c5dff0',
      300: '#7dbae0',
      500: '#388fc3', // Inventario Blue — accent color
      700: '#1f6fa0',
      900: '#103a55',
    },
    paper: {
      50: '#fdfcfa',
      100: '#f8f6f1', // Inventario Paper — page background
      200: '#ecebe5',
    },
    steel: {
      300: '#9aa5b5',
      500: '#6b7a8d', // Inventario Steel — muted text
      700: '#4a5566',
    },
    white: '#ffffff',
    black: '#070504', // Use sparingly — prefer navy.900 for UI
    gray: {
      100: '#f3f4f6',
      200: '#e5e7eb',
      300: '#d1d5db',
      500: '#9ca3af',
      700: '#4b5563',
    },
    emerald: '#10b981',
    amber: '#f59e0b',
    rose: '#ef4444',
  },

  font: {
    family: {
      sans: "'Poppins', system-ui, -apple-system, sans-serif",
      mono: "'JetBrains Mono', 'Menlo', monospace",
    },
    weight: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      extrabold: 800, // Wordmark only
    },
  },

  spacing: {
    0: '0',
    1: '0.25rem',
    2: '0.5rem',
    3: '0.75rem',
    4: '1rem',
    5: '1.25rem',
    6: '1.5rem',
    8: '2rem',
    10: '2.5rem',
    12: '3rem',
    16: '4rem',
    20: '5rem',
    24: '6rem',
  },

  radius: {
    none: '0',
    sm: '0.25rem',
    md: '0.5rem',
    lg: '0.625rem', // 10px — buttons & inputs (BRAND.md)
    xl: '1rem', // 16px — cards (BRAND.md)
    full: '9999px',
  },

  shadow: {
    sm: '0 1px 2px 0 rgba(26, 45, 71, 0.06)',
    md: '0 2px 6px rgba(26, 45, 71, 0.12)',
    lg: '0 10px 30px -8px rgba(26, 45, 71, 0.12)',
    cta: '0 4px 14px color-mix(in srgb, var(--inv-brand-primary) 25%, transparent)',
  },
} as const;

// ---------------------------------------------------------------------------
// SEMANTIC LAYER — UI roles (text, surface, status)
// ---------------------------------------------------------------------------

export const semantic = {
  color: {
    text: {
      primary: primitive.color.navy[700],
      secondary: primitive.color.steel[500],
      muted: primitive.color.steel[300],
      inverse: primitive.color.white,
      link: primitive.color.blue[500],
      linkHover: primitive.color.blue[700],
    },
    surface: {
      page: primitive.color.paper[100],
      card: primitive.color.white,
      elevated: primitive.color.white,
      subtle: primitive.color.paper[50],
      inverse: primitive.color.navy[700],
    },
    border: {
      subtle: primitive.color.gray[200],
      default: primitive.color.gray[300],
      strong: primitive.color.steel[500],
      focus: primitive.color.blue[500],
    },
    success: {
      fg: primitive.color.emerald,
      // bg uses color-mix and CSS vars — prefer the CSS layer for bg variants
      bg: 'color-mix(in srgb, var(--inv-primitive-emerald) 10%, transparent)',
    },
    warning: {
      fg: primitive.color.amber,
      bg: 'color-mix(in srgb, var(--inv-primitive-amber) 12%, transparent)',
    },
    danger: {
      fg: primitive.color.rose,
      bg: 'color-mix(in srgb, var(--inv-primitive-rose) 10%, transparent)',
    },
    info: {
      fg: primitive.color.blue[500],
      bg: 'color-mix(in srgb, var(--inv-primitive-blue-500) 10%, transparent)',
    },
  },

  assetStatus: {
    available: primitive.color.emerald,
    reserved: primitive.color.amber,
    borrowed: primitive.color.blue[500],
    inService: primitive.color.amber,
    disposed: primitive.color.steel[500],
    lost: primitive.color.rose,
  },
} as const;

// ---------------------------------------------------------------------------
// BRAND LAYER — Inventario default identity, override per-tenant
// ---------------------------------------------------------------------------

export const brand = {
  primary: primitive.color.navy[700],
  primaryFg: primitive.color.white,
  accent: primitive.color.blue[500],
  accentFg: primitive.color.white,
  logoDot: primitive.color.blue[500],
} as const;

// ---------------------------------------------------------------------------
// WORDMARK — fixed styling per BRAND.md §5
// ---------------------------------------------------------------------------

export const wordmark = {
  fontFamily: primitive.font.family.sans,
  fontWeight: primitive.font.weight.extrabold,
  fontStyle: 'italic',
  letterSpacing: '-0.02em',
} as const;

// ---------------------------------------------------------------------------
// AGGREGATE EXPORT
// ---------------------------------------------------------------------------

export const tokens = {
  primitive,
  semantic,
  brand,
  wordmark,
} as const;

// ---------------------------------------------------------------------------
// TYPE EXPORTS
// ---------------------------------------------------------------------------

export type InventarioPrimitive = typeof primitive;
export type InventarioSemantic = typeof semantic;
export type InventarioBrand = typeof brand;
export type InventarioWordmark = typeof wordmark;
export type InventarioTokens = typeof tokens;

/** AssetStatus enum mirror — keep in sync with backend `@sfz/shared-types`. */
export type AssetStatus = keyof typeof semantic.assetStatus;

export default tokens;

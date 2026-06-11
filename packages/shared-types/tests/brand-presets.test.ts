// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { describe, expect, it } from 'vitest';

import {
  BRAND_PRESETS,
  BRAND_PRESET_IDS,
  FONT_OPTIONS,
  FONT_OPTION_IDS,
  getBrandPreset,
  getFontCss,
} from '../src/brand-presets.js';

/**
 * WCAG 2.1 kontrast — lokálna kópia algoritmu (rovnaký ako apps/api contrast.ts
 * a frontend hexContrast). Test nemá závislosť na api balíku.
 */
function contrastRatio(hex1: string, hex2: string): number {
  const linear = (ch: string): number => {
    const c = parseInt(ch, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = (hex: string): number => {
    const h = hex.replace('#', '');
    return (
      0.2126 * linear(h.slice(0, 2)) +
      0.7152 * linear(h.slice(2, 4)) +
      0.0722 * linear(h.slice(4, 6))
    );
  };
  const l1 = lum(hex1);
  const l2 = lum(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

const HEX_RE = /^#[0-9a-f]{6}$/;

describe('BRAND_PRESETS', () => {
  it('obsahuje presne 10 paliet', () => {
    expect(BRAND_PRESETS).toHaveLength(10);
  });

  it('všetky preset ID sú unikátne', () => {
    const ids = BRAND_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('default preset inventario-navy existuje a je prvý', () => {
    expect(BRAND_PRESETS[0]?.id).toBe('inventario-navy');
  });

  // WCAG INVARIANT — toto je dôvod prečo presety existujú.
  // Ak niektorá paleta neprejde, test padne a paletu treba opraviť.
  describe('WCAG 2.1 AA kontrast (>= 4.5:1) pre každý preset', () => {
    for (const preset of BRAND_PRESETS) {
      it(`${preset.id} — primary/primaryFg >= 4.5:1`, () => {
        const ratio = contrastRatio(preset.primary, preset.primaryFg);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });

      it(`${preset.id} — accent/accentFg >= 4.5:1`, () => {
        const ratio = contrastRatio(preset.accent, preset.accentFg);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    }
  });

  describe('všetky hex hodnoty sú validný #rrggbb lowercase', () => {
    for (const preset of BRAND_PRESETS) {
      it(`${preset.id} — všetkých 5 farieb je validný hex`, () => {
        expect(preset.primary).toMatch(HEX_RE);
        expect(preset.primaryFg).toMatch(HEX_RE);
        expect(preset.accent).toMatch(HEX_RE);
        expect(preset.accentFg).toMatch(HEX_RE);
        expect(preset.logoDot).toMatch(HEX_RE);
      });
    }
  });

  it('každý preset má neprázdne meno', () => {
    for (const preset of BRAND_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0);
    }
  });
});

describe('getBrandPreset', () => {
  it('vráti paletu pre platné id', () => {
    const preset = getBrandPreset('royal-blue');
    expect(preset?.id).toBe('royal-blue');
    expect(preset?.primary).toBe('#1d4ed8');
  });

  it('vráti undefined pre neznáme id', () => {
    expect(getBrandPreset('neexistuje')).toBeUndefined();
  });
});

describe('BRAND_PRESET_IDS', () => {
  it('zodpovedá ID všetkých paliet', () => {
    expect(BRAND_PRESET_IDS).toEqual(BRAND_PRESETS.map((p) => p.id));
  });
});

describe('FONT_OPTIONS', () => {
  it('obsahuje 5 fontov', () => {
    expect(FONT_OPTIONS).toHaveLength(5);
  });

  it('default system-ui je prvý', () => {
    expect(FONT_OPTIONS[0]?.id).toBe('system-ui');
  });

  it('FONT_OPTION_IDS obsahuje očakávané hodnoty', () => {
    expect(FONT_OPTION_IDS).toEqual(['system-ui', 'Inter', 'Open Sans', 'Roboto', 'Lato']);
  });

  it('každý font má neprázdny css string', () => {
    for (const font of FONT_OPTIONS) {
      expect(font.css.length).toBeGreaterThan(0);
    }
  });
});

describe('getFontCss', () => {
  it('vráti css pre platné id', () => {
    expect(getFontCss('Inter')).toBe('var(--font-inter), system-ui, sans-serif');
  });

  it('vráti system-ui fallback pre neznáme id', () => {
    expect(getFontCss('Comic Sans')).toBe('system-ui, -apple-system, sans-serif');
  });
});

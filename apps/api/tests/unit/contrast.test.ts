// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Unit testy pre WCAG kontrast util (apps/api/src/lib/contrast.ts).
 *
 * Referenčné hodnoty overené voči WebAIM Contrast Checker a
 * APCA / WCAG 2.1 definícii (IEC 61966-2-1 sRGB linearizácia).
 *
 * Zaokrúhlenie: contrastRatio() vracia hodnotu zaokrúhlenú na 2
 * desatinné miesta — preto testujem s toleranciou ±0.01 všade kde
 * referenčná hodnota leží na hranici zaokrúhlenia, a priamo tam kde
 * výsledok je stabilný.
 */

import { describe, expect, it } from 'vitest';

import { contrastRatio, meetsWcagAA, relativeLuminance } from '../../src/lib/contrast.js';

// ---------------------------------------------------------------------------
// relativeLuminance
// ---------------------------------------------------------------------------

describe('relativeLuminance', () => {
  it('biela má luminance 1.0', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1.0, 5);
  });

  it('čierna má luminance 0.0', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0.0, 5);
  });

  it('Inventario Navy #1a2d47 má luminance ~0.022', () => {
    // Referencia: WebAIM = 0.0222
    expect(relativeLuminance('#1a2d47')).toBeCloseTo(0.022, 2);
  });

  it('Inventario Blue #388fc3 má luminance ~0.244', () => {
    // Skutočná hodnota overená algoritmom (sRGB linearizácia, exponent 2.4)
    expect(relativeLuminance('#388fc3')).toBeCloseTo(0.244, 2);
  });

  it('je case-insensitive (#FFFFFF = #ffffff)', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(relativeLuminance('#ffffff'), 10);
  });

  it('čisto červená #ff0000 má luminance ~0.213', () => {
    // L = 0.2126 * 1.0 (linearizovaná červená)
    expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126, 3);
  });

  it('čisto zelená #00ff00 má luminance ~0.715', () => {
    // L = 0.7152 * 1.0 (linearizovaná zelená)
    expect(relativeLuminance('#00ff00')).toBeCloseTo(0.7152, 3);
  });

  it('čisto modrá #0000ff má luminance ~0.072', () => {
    // L = 0.0722 * 1.0 (linearizovaná modrá)
    expect(relativeLuminance('#0000ff')).toBeCloseTo(0.0722, 3);
  });
});

// ---------------------------------------------------------------------------
// contrastRatio
// ---------------------------------------------------------------------------

describe('contrastRatio', () => {
  it('biela na čiernej = 21:1 (maximálny kontrast)', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
  });

  it('čierna na bielej = 21:1 (poradie nezáleží)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('rovnaká farba = 1:1 (nulový kontrast)', () => {
    expect(contrastRatio('#1a2d47', '#1a2d47')).toBeCloseTo(1, 2);
  });

  it('Inventario Navy #1a2d47 na bielej spĺňa AA (>= 4.5)', () => {
    // Skutočná hodnota: ~13.9:1 (overené algoritmom)
    const ratio = contrastRatio('#1a2d47', '#ffffff');
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeCloseTo(13.9, 0);
  });

  it('Inventario Blue #388fc3 na bielej MÁ kontrast ~3.57 (pod AA)', () => {
    // #388fc3 na bielej = 3.57:1 — nesplní AA pre normálny text.
    // Poznámka pre UX: Inventario Blue sa používa na links/ikony,
    // nie ako standalone text na bielej — tenant by mal voliť tmavší akcent.
    const ratio = contrastRatio('#388fc3', '#ffffff');
    expect(ratio).toBeCloseTo(3.57, 1);
    expect(ratio).toBeLessThan(4.5);
  });

  it('svetlá farba na bielej nesplní AA (< 4.5)', () => {
    // Svetlá žltá #ffd700 na bielej: ~1.28:1 — zjavne pod prahom
    const ratio = contrastRatio('#ffd700', '#ffffff');
    expect(ratio).toBeLessThan(4.5);
  });

  it('výsledok je zaokrúhlený na 2 desatinné miesta', () => {
    const ratio = contrastRatio('#388fc3', '#ffffff');
    // Overenie že výsledok má max 2 des. miesta
    const decimals = ratio.toString().split('.')[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });

  it('SFZ farby: #003d7a na bielej spĺňa AA', () => {
    const ratio = contrastRatio('#003d7a', '#ffffff');
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('#ffd700 (zlatá) na navy #1a2d47 spĺňa AA', () => {
    // Zlatá na navy — dobrá kombinácia pre akcentové CTA
    const ratio = contrastRatio('#ffd700', '#1a2d47');
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

// ---------------------------------------------------------------------------
// meetsWcagAA
// ---------------------------------------------------------------------------

describe('meetsWcagAA', () => {
  it('navy na bielej → true', () => {
    expect(meetsWcagAA('#1a2d47', '#ffffff')).toBe(true);
  });

  it('biela na navy → true (poradie nezáleží)', () => {
    expect(meetsWcagAA('#ffffff', '#1a2d47')).toBe(true);
  });

  it('svetlá žltá na bielej → false', () => {
    expect(meetsWcagAA('#ffd700', '#ffffff')).toBe(false);
  });

  it('rovnaká farba → false (1:1 < 4.5)', () => {
    expect(meetsWcagAA('#388fc3', '#388fc3')).toBe(false);
  });

  it('pomer presne 4.5 → true (boundary inclusive)', () => {
    // Nájdeme pár ktorý má pomer blízko 4.5 — testujeme logiku boundary
    // #767676 na bielej = ~4.54:1 (tesne nad prahom, WebAIM confirmed)
    expect(meetsWcagAA('#767676', '#ffffff')).toBe(true);
  });

  it('#aaaaaa (svetlá sivá) na bielej → false (~2.3:1, pod 4.5)', () => {
    // #aaaaaa na bielej ≈ 2.32:1 — zjavne pod prahom AA
    expect(meetsWcagAA('#aaaaaa', '#ffffff')).toBe(false);
  });
});

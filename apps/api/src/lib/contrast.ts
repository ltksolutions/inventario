// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * WCAG 2.1 kontrast utilities — čisté funkcie bez závislostí.
 *
 * Implementuje WCAG 2.1 algoritmus relatívneho jasu (relative luminance)
 * a pomeru kontrastu (contrast ratio) podľa:
 *   https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
 *   https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 *
 * Použitie v B3 (PATCH /organisations/current):
 *   Backend odmietne payload kde contrastRatio(primary, primaryFg) < 4.5
 *   alebo contrastRatio(accent, accentFg) < 4.5 (WCAG AA pre normálny text).
 *
 * Použitie vo frontende (B8):
 *   UI zobrazí živý indikátor — zelený ✓ alebo červený ✗ s pomerom.
 *   Frontend verzia je samostatná (nezdieľa tento modul), ale algoritmus
 *   je identický a môže byť copy-paste-ovaný (je to čistá matematika).
 *
 * Presnosť:
 *   sRGB linearizácia používa exponent 2.4 podľa IEC 61966-2-1 (nie
 *   aproximáciu gama=2.2). Výsledky sú kompatibilné s referenčnými
 *   nástrojmi ako WebAIM Contrast Checker a Colour Contrast Analyser.
 *
 * Obmedzenia:
 *   - Prijíma len #RRGGBB (6-znakový hex). Skrátený #RGB ani rgba()
 *     nie sú podporované — vstup by mal byť vždy validovaný
 *     cez HexColorSchema pred volaním týchto funkcií.
 *   - Nezohľadňuje veľkosť textu (14pt bold / 18pt regular = AA Large
 *     má prah 3:1, nie 4.5:1). Backend vždy validuje prísnejší AA prah.
 */

// ---------------------------------------------------------------------------
// Interné helpers
// ---------------------------------------------------------------------------

/**
 * Parsuje jeden hex kanál (2 znaky) na hodnotu v rozsahu [0, 1].
 * Napr. 'ff' → 1.0, '80' → 0.502, '1a' → 0.102.
 */
function hexChannelToLinear(hex2: string): number {
  const channel = parseInt(hex2, 16) / 255;
  // sRGB → linear light (IEC 61966-2-1)
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

// ---------------------------------------------------------------------------
// Verejné API
// ---------------------------------------------------------------------------

/**
 * Vypočíta relatívny jas (relative luminance) hex farby podľa WCAG 2.1.
 *
 * Vstup: validný #RRGGBB hex string (case-insensitive).
 * Výstup: číslo v rozsahu [0, 1], kde 0 = čierna, 1 = biela.
 *
 * @param hex - Hex farba vo formáte #RRGGBB (napr. '#1a2d47', '#FFFFFF').
 * @returns Relatívny jas v [0, 1].
 */
export function relativeLuminance(hex: string): number {
  const r = hexChannelToLinear(hex.slice(1, 3));
  const g = hexChannelToLinear(hex.slice(3, 5));
  const b = hexChannelToLinear(hex.slice(5, 7));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Vypočíta pomer kontrastu medzi dvoma hex farbami podľa WCAG 2.1.
 *
 * Výstup: číslo v rozsahu [1, 21].
 *   - 1:1  = nulový kontrast (rovnaká farba)
 *   - 21:1 = maximálny kontrast (čierna na bielej)
 *   - ≥ 4.5:1 = WCAG AA pre normálny text
 *   - ≥ 3.0:1 = WCAG AA pre veľký text (14pt bold / 18pt regular)
 *   - ≥ 7.0:1 = WCAG AAA
 *
 * Poradie argumentov nie je dôležité — funkcia sama určí, ktorá farba
 * je svetlejšia (vyšší luminance = menovateľ) a ktorá tmavšia.
 *
 * @param hex1 - Prvá hex farba (#RRGGBB).
 * @param hex2 - Druhá hex farba (#RRGGBB).
 * @returns Pomer kontrastu zaokrúhlený na 2 desatinné miesta.
 */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Math.round(ratio * 100) / 100;
}

/**
 * Overí, či pomer kontrastu spĺňa WCAG 2.1 AA pre normálny text (≥ 4.5:1).
 *
 * Skratka pre najčastejší use-case v backend validácii (B3).
 *
 * @param hex1 - Farba popredia alebo pozadia (#RRGGBB).
 * @param hex2 - Párová farba (#RRGGBB).
 * @returns `true` ak kontrast ≥ 4.5:1, inak `false`.
 */
export function meetsWcagAA(hex1: string, hex2: string): boolean {
  return contrastRatio(hex1, hex2) >= 4.5;
}

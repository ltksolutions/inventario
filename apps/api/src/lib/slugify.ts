// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Slug utilities — pure functions for generating URL-safe slugs from
 * human-readable strings.
 *
 * Design:
 *   - Normalizes Unicode diacritics via NFD + combining-mark stripping
 *     (handles all Latin-script diacritics, not just Slovak).
 *   - Lowercases, collapses whitespace and non-alphanumeric runs to a
 *     single hyphen, trims leading/trailing hyphens.
 *   - Pure function — no DB access, no side effects. Collision handling
 *     (auto-suffix) lives in the service layer where it can query the
 *     repository in a transaction.
 *
 * Why NFD-based stripping:
 *   `'á'.normalize('NFD')` returns `'a' + '\u0301'` (combining acute).
 *   Removing the `\u0300-\u036f` range gives plain ASCII. Works for
 *   á č ď é ě í ľ ň ó ŕ š ť ú ý ž and any other Latin diacritic.
 *
 * What it does NOT do:
 *   - Transliterate non-Latin scripts (Cyrillic, Greek, CJK). Those
 *     scripts produce empty strings after stripping — caller must
 *     supply a manual slug.
 *   - Handle homoglyphs or visually similar Unicode codepoints —
 *     this is a usability tool, not a security boundary.
 */

/**
 * The slug character set: lowercase ASCII letters, digits, hyphens.
 * Matches the regex used by `CategorySchema.slug` in shared-types.
 */
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Generate a URL-safe slug from arbitrary input. Returns an empty string
 * if no Latin alphanumeric characters survive normalization (caller's
 * responsibility to handle that).
 *
 * Examples:
 *   slugify('Pracovné notebooky') === 'pracovne-notebooky'
 *   slugify('IT / Hardvér')       === 'it-hardver'
 *   slugify('R&D oddelenie')      === 'r-d-oddelenie'
 *   slugify('Šport 2024/25')      === 'sport-2024-25'
 *   slugify('   hello   world  ') === 'hello-world'
 *   slugify('---trim---')         === 'trim'
 *   slugify('')                   === ''
 *   slugify('!@#$%')              === ''
 */
export function slugify(input: string): string {
  return (
    input
      // 1. Decompose diacritics into base + combining marks
      .normalize('NFD')
      // 2. Strip combining marks (the diacritic accents)
      .replace(/[\u0300-\u036f]/g, '')
      // 3. Lowercase
      .toLowerCase()
      // 4. Replace any run of non-alphanumeric chars with a single hyphen
      .replace(/[^a-z0-9]+/g, '-')
      // 5. Trim leading/trailing hyphens
      .replace(/^-+|-+$/g, '')
  );
}

/**
 * Validate that a string is a well-formed slug per the project regex.
 * Useful for asserting auto-generated slugs in tests + tightening invariants.
 */
export function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

/**
 * Compose a candidate slug with a numeric suffix. Used by the service
 * layer when the base slug collides — try `${base}-2`, `${base}-3`, etc.
 *
 * The suffix is appended with a hyphen; if the base ends in a digit
 * (e.g. "category-2024"), the resulting "category-2024-2" remains a
 * valid slug.
 */
export function slugWithSuffix(base: string, suffix: number): string {
  return `${base}-${suffix}`;
}

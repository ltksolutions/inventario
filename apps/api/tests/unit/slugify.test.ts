// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Unit tests for the slugify utility.
 *
 * These tests are pure (no I/O), so they're cheap. They cover the slug
 * derivation logic in isolation — the categories service tests assert
 * end-to-end behaviour, but if THIS file is green and they fail, the
 * problem is in the service's collision-resolution, not the slugify
 * step.
 */

import { describe, expect, it } from 'vitest';

import { isValidSlug, slugify, slugWithSuffix } from '../../src/lib/slugify.js';

describe('slugify', () => {
  describe('basic ASCII input', () => {
    it('lowercases mixed-case input', () => {
      expect(slugify('Hello World')).toBe('hello-world');
    });

    it('collapses whitespace to single hyphens', () => {
      expect(slugify('hello   world')).toBe('hello-world');
    });

    it('trims leading and trailing whitespace', () => {
      expect(slugify('   hello world   ')).toBe('hello-world');
    });

    it('replaces underscores with hyphens', () => {
      expect(slugify('hello_world')).toBe('hello-world');
    });

    it('preserves digits inline', () => {
      expect(slugify('item 123 details')).toBe('item-123-details');
    });
  });

  describe('Slovak diacritics', () => {
    it('strips á č ď é í ľ ň ó ŕ š ť ú ý ž', () => {
      expect(slugify('áčďéíľňóŕšťúýž')).toBe('acdeilnorstuyz');
    });

    it('strips capital diacritics (Á Č Ď É Í Ľ Ň Ó Ŕ Š Ť Ú Ý Ž)', () => {
      expect(slugify('ÁČĎÉÍĽŇÓŔŠŤÚÝŽ')).toBe('acdeilnorstuyz');
    });

    it('handles realistic Slovak phrases', () => {
      expect(slugify('Pracovné notebooky')).toBe('pracovne-notebooky');
      expect(slugify('Tréningové pomôcky')).toBe('treningove-pomocky');
      expect(slugify('Športová výstroj')).toBe('sportova-vystroj');
    });
  });

  describe('special characters', () => {
    it('collapses runs of special characters to single hyphens', () => {
      expect(slugify('R&D oddelenie')).toBe('r-d-oddelenie');
    });

    it('drops punctuation entirely when between alphanumerics', () => {
      expect(slugify('item.with.dots')).toBe('item-with-dots');
    });

    it('handles slashes', () => {
      expect(slugify('IT / Hardvér')).toBe('it-hardver');
    });

    it('handles mixed punctuation and digits', () => {
      expect(slugify('Šport 2024/25')).toBe('sport-2024-25');
    });

    it('trims hyphens that result from leading/trailing specials', () => {
      expect(slugify('---trim---')).toBe('trim');
      expect(slugify('@@@hello@@@')).toBe('hello');
    });
  });

  describe('edge cases', () => {
    it('returns empty string for empty input', () => {
      expect(slugify('')).toBe('');
    });

    it('returns empty string for only-whitespace input', () => {
      expect(slugify('   ')).toBe('');
    });

    it('returns empty string when all chars are non-Latin alphanumerics', () => {
      expect(slugify('!@#$%')).toBe('');
    });

    it('returns empty string for non-Latin script (e.g. Cyrillic)', () => {
      // NFD won't decompose Cyrillic to ASCII; combining-mark strip removes
      // nothing meaningful and the post-filter wipes everything.
      expect(slugify('Спорт')).toBe('');
    });

    it('handles a single alphanumeric character', () => {
      expect(slugify('A')).toBe('a');
      expect(slugify('7')).toBe('7');
    });
  });
});

describe('isValidSlug', () => {
  it('accepts valid slugs', () => {
    expect(isValidSlug('hello')).toBe(true);
    expect(isValidSlug('hello-world')).toBe(true);
    expect(isValidSlug('item-2024-05')).toBe(true);
    expect(isValidSlug('a')).toBe(true);
    expect(isValidSlug('123')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidSlug('')).toBe(false);
  });

  it('rejects uppercase letters', () => {
    expect(isValidSlug('Hello')).toBe(false);
    expect(isValidSlug('HELLO')).toBe(false);
  });

  it('rejects underscores', () => {
    expect(isValidSlug('hello_world')).toBe(false);
  });

  it('rejects leading/trailing hyphens', () => {
    expect(isValidSlug('-hello')).toBe(false);
    expect(isValidSlug('hello-')).toBe(false);
  });

  it('rejects consecutive hyphens', () => {
    expect(isValidSlug('hello--world')).toBe(false);
  });

  it('rejects whitespace', () => {
    expect(isValidSlug('hello world')).toBe(false);
  });
});

describe('slugWithSuffix', () => {
  it('appends a hyphen-prefixed number', () => {
    expect(slugWithSuffix('hello', 2)).toBe('hello-2');
    expect(slugWithSuffix('hello-world', 7)).toBe('hello-world-7');
  });

  it('produces results that are valid slugs themselves', () => {
    expect(isValidSlug(slugWithSuffix('base', 2))).toBe(true);
    expect(isValidSlug(slugWithSuffix('multi-word-base', 99))).toBe(true);
  });

  it('handles a base ending in a digit (no double-digit collapsing)', () => {
    expect(slugWithSuffix('item-2024', 2)).toBe('item-2024-2');
  });
});

// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Unit tests for assets-diff helpers.
 *
 * These tests exercise the pure diff logic in isolation \u2014 no Fastify,
 * no database, no fixtures larger than a hand-crafted Asset object.
 *
 * What's covered:
 *   - shallowEqual edge cases (primitives, arrays, objects, null)
 *   - computeShallowDiff with various change patterns
 *   - skip list correctly excludes audit fields
 *   - empty diff when only skipped fields changed
 *
 * What's NOT covered here (lives in integration tests):
 *   - Integration with the audit log
 *   - Full PATCH endpoint flow
 *   - Mongo session/transaction interaction
 */

import { describe, expect, it } from 'vitest';

import { computeShallowDiff, shallowEqual } from '../../src/modules/assets/assets-diff.js';

import type { Asset } from '@inventario/shared-types';
import type { WithId } from 'mongodb';

// ---------------------------------------------------------------------------
// Test helper \u2014 build an Asset doc with sensible defaults
// ---------------------------------------------------------------------------

/**
 * Minimal valid Asset shape for diff tests. Fields the tests don't care
 * about get default values. Override what each test needs via the partial.
 */
function makeAsset(overrides: Partial<WithId<Asset>> = {}): WithId<Asset> {
  const base = {
    _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', // 24 hex chars
    inventoryNumber: 'TEST-2026-001',
    serialNumber: null,
    name: 'Test asset',
    description: null,
    categoryId: '000000000000000000000001',
    condition: 'NEW',
    locationId: '000000000000000000000002',
    manufacturer: null,
    model: null,
    acquiredAt: '2026-01-15T00:00:00.000Z',
    acquisitionCost: null,
    warrantyUntil: null,
    specs: {},
    tags: [],
    imageIds: [],
    internalNotes: null,
    isLoanable: true,
    requiresApproval: true,
    status: 'AVAILABLE',
    currentLoanId: null,
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-01-15T00:00:00.000Z',
    createdBy: 'user-1',
    updatedBy: 'user-1',
    deletedAt: null,
    deletedBy: null,
  } as unknown as WithId<Asset>;

  return { ...base, ...overrides } as WithId<Asset>;
}

// ===========================================================================
// shallowEqual
// ===========================================================================

describe('shallowEqual', () => {
  describe('primitive values', () => {
    it('returns true for identical strings', () => {
      expect(shallowEqual('foo', 'foo')).toBe(true);
    });

    it('returns false for different strings', () => {
      expect(shallowEqual('foo', 'bar')).toBe(false);
    });

    it('returns true for identical numbers', () => {
      expect(shallowEqual(42, 42)).toBe(true);
    });

    it('returns false for 0 and "0" (no type coercion)', () => {
      expect(shallowEqual(0, '0')).toBe(false);
    });

    it('returns true for both null', () => {
      expect(shallowEqual(null, null)).toBe(true);
    });

    it('returns false for null vs undefined', () => {
      // Once one is null and the other isn't, the function short-circuits to false.
      expect(shallowEqual(null, undefined)).toBe(false);
    });

    it('returns true for both undefined', () => {
      expect(shallowEqual(undefined, undefined)).toBe(true);
    });

    it('returns true for both true', () => {
      expect(shallowEqual(true, true)).toBe(true);
    });

    it('returns false for true vs false', () => {
      expect(shallowEqual(true, false)).toBe(false);
    });
  });

  describe('arrays', () => {
    it('returns true for arrays with same primitive elements', () => {
      expect(shallowEqual(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(true);
    });

    it('returns false for arrays of different length', () => {
      expect(shallowEqual([1, 2], [1, 2, 3])).toBe(false);
    });

    it('returns false for arrays with different elements', () => {
      expect(shallowEqual([1, 2, 3], [1, 2, 4])).toBe(false);
    });

    it('returns false for arrays with same elements in different order', () => {
      // Sentinel: order matters for the diff. If a user reorders tags,
      // the audit log should reflect that as a change.
      expect(shallowEqual(['a', 'b'], ['b', 'a'])).toBe(false);
    });

    it('returns true for two empty arrays', () => {
      expect(shallowEqual([], [])).toBe(true);
    });
  });

  describe('objects', () => {
    it('returns true for objects with identical keys and values', () => {
      expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    });

    it('returns false for objects with different values', () => {
      expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    });

    it('returns false for objects with different keys', () => {
      expect(shallowEqual({ a: 1 }, { b: 1 })).toBe(false);
    });

    it('returns true for empty objects', () => {
      expect(shallowEqual({}, {})).toBe(true);
    });

    it('returns true for nested objects with matching shape (via JSON.stringify)', () => {
      // The implementation uses JSON.stringify for object comparison, which
      // gives us deep equality "for free" \u2014 fine for our small schema objects.
      expect(shallowEqual({ cpu: 'M2', ram: 16 }, { cpu: 'M2', ram: 16 })).toBe(true);
    });
  });
});

// ===========================================================================
// computeShallowDiff
// ===========================================================================

describe('computeShallowDiff', () => {
  it('returns empty array when both documents are identical', () => {
    const doc = makeAsset();
    const result = computeShallowDiff(doc, doc, []);
    expect(result).toEqual([]);
  });

  it('detects a single field change', () => {
    const before = makeAsset({ name: 'Old name' });
    const after = makeAsset({ name: 'New name' });

    const result = computeShallowDiff(before, after, []);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      field: 'name',
      before: 'Old name',
      after: 'New name',
    });
  });

  it('detects multiple field changes', () => {
    const before = makeAsset({ name: 'Old', condition: 'NEW' });
    const after = makeAsset({ name: 'New', condition: 'GOOD' });

    const result = computeShallowDiff(before, after, []);

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.field).sort()).toEqual(['condition', 'name']);
  });

  it('skips fields listed in the skip array', () => {
    // Simulate the audit fields changing along with a real change.
    const before = makeAsset({
      name: 'Old',
      updatedAt: '2026-01-15T00:00:00.000Z',
      updatedBy: 'user-1',
    });
    const after = makeAsset({
      name: 'New',
      updatedAt: '2026-02-01T00:00:00.000Z', // changed by service
      updatedBy: 'user-2', // changed by service
    });

    const result = computeShallowDiff(before, after, ['updatedAt', 'updatedBy']);

    expect(result).toHaveLength(1);
    expect(result[0]?.field).toBe('name');
  });

  it('returns empty when only skipped fields changed', () => {
    // A "no-op PATCH" \u2014 service should not write an audit log entry.
    const before = makeAsset({ updatedAt: '2026-01-15T00:00:00.000Z' });
    const after = makeAsset({ updatedAt: '2026-02-01T00:00:00.000Z' });

    const result = computeShallowDiff(before, after, ['updatedAt']);

    expect(result).toEqual([]);
  });

  it('always skips _id (even when not listed in skip array)', () => {
    const before = makeAsset({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' as never });
    const after = makeAsset({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' as never });

    const result = computeShallowDiff(before, after, []);

    expect(result).toEqual([]);
  });

  it('detects array field changes', () => {
    const before = makeAsset({ tags: ['urgent'] });
    const after = makeAsset({ tags: ['urgent', 'reviewed'] });

    const result = computeShallowDiff(before, after, []);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      field: 'tags',
      before: ['urgent'],
      after: ['urgent', 'reviewed'],
    });
  });

  it('detects nested object changes as one diff entry', () => {
    const before = makeAsset({ specs: { cpu: 'M1' } });
    const after = makeAsset({ specs: { cpu: 'M2' } });

    const result = computeShallowDiff(before, after, []);

    expect(result).toHaveLength(1);
    expect(result[0]?.field).toBe('specs');
    // The whole specs object is reported, not just the cpu sub-change.
    // Deep diff is intentionally out of scope.
    expect(result[0]?.before).toEqual({ cpu: 'M1' });
    expect(result[0]?.after).toEqual({ cpu: 'M2' });
  });

  it('detects null \u2192 value transitions', () => {
    const before = makeAsset({ description: null });
    const after = makeAsset({ description: 'Now with details' });

    const result = computeShallowDiff(before, after, []);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      field: 'description',
      before: null,
      after: 'Now with details',
    });
  });

  it('detects value \u2192 null transitions', () => {
    const before = makeAsset({ description: 'Some details' });
    const after = makeAsset({ description: null });

    const result = computeShallowDiff(before, after, []);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      field: 'description',
      before: 'Some details',
      after: null,
    });
  });

  it('reports each changed field exactly once', () => {
    const before = makeAsset({
      name: 'Old',
      condition: 'NEW',
      tags: ['a'],
    });
    const after = makeAsset({
      name: 'New',
      condition: 'GOOD',
      tags: ['a', 'b'],
    });

    const result = computeShallowDiff(before, after, []);

    expect(result).toHaveLength(3);
    const fields = result.map((c) => c.field).sort();
    expect(fields).toEqual(['condition', 'name', 'tags']);
  });
});

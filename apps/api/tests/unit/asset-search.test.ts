// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { describe, expect, it } from 'vitest';

import {
  ASSET_SEARCH_FIELDS,
  buildAssetSearchFilter,
  escapeRegex,
} from '../../src/modules/assets/asset-search.js';

describe('buildAssetSearchFilter', () => {
  it.each([undefined, '', '   '])('returns an empty filter for %j', (q) => {
    expect(buildAssetSearchFilter(q)).toEqual({});
  });

  it('builds a case-insensitive $or across all search fields', () => {
    const filter = buildAssetSearchFilter('  SN-1 ') as { $or: Array<Record<string, unknown>> };
    expect(filter.$or).toHaveLength(ASSET_SEARCH_FIELDS.length);
    for (const [i, field] of ASSET_SEARCH_FIELDS.entries()) {
      expect(filter.$or[i]).toEqual({ [field]: { $regex: 'SN-1', $options: 'i' } });
    }
  });

  it('covers serial number, manufacturer, model and description', () => {
    expect(ASSET_SEARCH_FIELDS).toEqual(
      expect.arrayContaining(['serialNumber', 'manufacturer', 'model', 'description']),
    );
  });
});

describe('escapeRegex', () => {
  it('escapes all regex metacharacters', () => {
    const raw = '.*+?^${}()|[]\\';
    expect(new RegExp(`^${escapeRegex(raw)}$`).test(raw)).toBe(true);
  });
});

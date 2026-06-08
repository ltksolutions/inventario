/**
 * Unit tests for the hierarchy traversal utility.
 *
 * The tests use an in-memory `Map<id, parentId>` to simulate the parent
 * lookup. No DB, no Fastify, no transactions — pure structural logic.
 *
 * Coverage map:
 *   - Trivial cases: null parent, single-node tree
 *   - Depth at limit (ok), depth over limit (too-deep)
 *   - 2-cycle, 3-cycle, self-loop (via reparent)
 *   - Pre-existing cycle (corrupt-tree): walk encounters a revisited node
 *   - Missing node (undefined from lookup) — terminates gracefully
 *   - CREATE mode (editedId = null) skips cycle check but enforces depth
 */

import { describe, expect, it } from 'vitest';

import {
  checkHierarchyOnReparent,
  MAX_HIERARCHY_DEPTH,
  type ParentLookup,
} from '../../src/lib/hierarchy.js';

// ---------------------------------------------------------------------------
// Helper: build a ParentLookup from a plain object map
// ---------------------------------------------------------------------------

/**
 * Build a ParentLookup from a map of `{ nodeId: parentId | null }`.
 * Nodes not present in the map resolve to `undefined` (= doesn't exist).
 */
function makeLookup(tree: Record<string, string | null>): ParentLookup {
  return async (id: string) => {
    if (id in tree) return tree[id]!;
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkHierarchyOnReparent', () => {
  describe('trivial cases', () => {
    it('returns ok when proposedParentId is null (reparent to root)', async () => {
      const result = await checkHierarchyOnReparent('any', null, makeLookup({}));
      expect(result.kind).toBe('ok');
    });

    it('returns ok when the proposed parent is a root (single-step chain)', async () => {
      // root → null. Edited node "child" becomes a child of root.
      const result = await checkHierarchyOnReparent('child', 'root', makeLookup({ root: null }));
      expect(result.kind).toBe('ok');
    });
  });

  describe('depth limits', () => {
    it('returns ok at the maximum legal depth', async () => {
      // Chain: leaf < d3 < d2 < d1 < root. Proposed parent "leaf" is at
      // depth 4 (MAX_HIERARCHY_DEPTH). Edited node would land at depth 5.
      // Wait — MAX_HIERARCHY_DEPTH = 4 means proposed parent at depth ≤ 3
      // is ok. Let's construct exactly at the boundary.
      //
      // proposedParent at depth (MAX_HIERARCHY_DEPTH - 1) = 3:
      //   d3 < d2 < d1 < root
      //   proposed = d3 (depth 3 = 3 ancestors above)
      //   edited would be at depth 4 = MAX_HIERARCHY_DEPTH = ok
      const result = await checkHierarchyOnReparent(
        'edited',
        'd3',
        makeLookup({
          d3: 'd2',
          d2: 'd1',
          d1: 'root',
          root: null,
        }),
      );
      expect(result.kind).toBe('ok');
    });

    it('returns too-deep one level over the maximum', async () => {
      // proposed = d4 (depth 4 = MAX_HIERARCHY_DEPTH = 4 ancestors above)
      // edited would be at depth 5 = over limit
      const result = await checkHierarchyOnReparent(
        'edited',
        'd4',
        makeLookup({
          d4: 'd3',
          d3: 'd2',
          d2: 'd1',
          d1: 'root',
          root: null,
        }),
      );
      expect(result.kind).toBe('too-deep');
      if (result.kind === 'too-deep') {
        expect(result.max).toBe(MAX_HIERARCHY_DEPTH);
      }
    });

    it('returns too-deep on a deep chain even when no cycle exists', async () => {
      // Build a chain 10 levels deep — should bail out at the depth limit.
      const tree: Record<string, string | null> = {};
      tree['n0'] = null;
      for (let i = 1; i <= 10; i++) tree[`n${i}`] = `n${i - 1}`;

      const result = await checkHierarchyOnReparent('edited', 'n10', makeLookup(tree));
      expect(result.kind).toBe('too-deep');
    });
  });

  describe('cycle detection', () => {
    it('detects a self-loop (proposing self as parent)', async () => {
      // editedId = "node", proposedParentId = "node" — direct self-loop.
      // Chain length = 1 (just the node itself).
      const result = await checkHierarchyOnReparent('node', 'node', makeLookup({ node: null }));
      expect(result.kind).toBe('cycle');
      if (result.kind === 'cycle') {
        expect(result.editedId).toBe('node');
        expect(result.chain).toEqual(['node']);
      }
    });

    it('detects a 2-cycle: edited.parent = X where X.parent = edited', async () => {
      // Edited "A" wants parent "B", but B's existing parent is A.
      // Reparenting A to B would create A → B → A → B → ...
      const result = await checkHierarchyOnReparent('A', 'B', makeLookup({ A: null, B: 'A' }));
      expect(result.kind).toBe('cycle');
      if (result.kind === 'cycle') {
        expect(result.chain).toEqual(['B', 'A']);
      }
    });

    it('detects a 3-cycle through an intermediate', async () => {
      // A's existing chain: A → null
      // We reparent A to D. D's chain: D → C → B → A (existing).
      // Putting A under D would close the loop.
      const result = await checkHierarchyOnReparent(
        'A',
        'D',
        makeLookup({ A: null, B: 'A', C: 'B', D: 'C' }),
      );
      expect(result.kind).toBe('cycle');
      if (result.kind === 'cycle') {
        expect(result.chain).toEqual(['D', 'C', 'B', 'A']);
      }
    });
  });

  describe('corrupt-tree (pre-existing cycle in DB)', () => {
    it('detects an existing 2-cycle independent of the edited node', async () => {
      // B and C form a cycle: B.parent = C, C.parent = B.
      // We try to reparent unrelated node "X" to B — walk will revisit
      // a node and surface corrupt-tree.
      const result = await checkHierarchyOnReparent(
        'X',
        'B',
        makeLookup({ X: null, B: 'C', C: 'B' }),
      );
      expect(result.kind).toBe('corrupt-tree');
      if (result.kind === 'corrupt-tree') {
        // After visiting B then C, we'd try to visit B again
        expect(result.revisitedId).toBe('B');
      }
    });

    it('detects an existing 3-cycle independent of the edited node', async () => {
      // A → B → C → A (cycle). We try to reparent X to A.
      const result = await checkHierarchyOnReparent(
        'X',
        'A',
        makeLookup({ X: null, A: 'B', B: 'C', C: 'A' }),
      );
      expect(result.kind).toBe('corrupt-tree');
    });
  });

  describe('missing nodes', () => {
    it('treats undefined parent (node not in tree) as terminating ok', async () => {
      // proposedParent "X" exists at level 1, but X.parent points to
      // "missing" which the lookup returns undefined for. We should NOT
      // throw — we trust the caller's existence check and treat the walk
      // as terminating successfully.
      const result = await checkHierarchyOnReparent(
        'edited',
        'X',
        makeLookup({ X: 'missing' }), // "missing" is not in the tree map
      );
      // missing-from-tree returns undefined → walk terminates ok
      expect(result.kind).toBe('ok');
    });
  });

  describe('custom maxDepth (categories pass 1 → 2 levels)', () => {
    it('allows a value under a root (depth 1) with maxDepth=1', async () => {
      // proposed parent is a root (depth 0); edited node lands at depth 1.
      const result = await checkHierarchyOnReparent(
        'edited',
        'root',
        makeLookup({ root: null }),
        1,
      );
      expect(result.kind).toBe('ok');
    });

    it('rejects a grandchild (value under a value) with maxDepth=1', async () => {
      // proposed parent is a value at depth 1; edited node would be depth 2.
      const result = await checkHierarchyOnReparent(
        'edited',
        'value',
        makeLookup({ value: 'root', root: null }),
        1,
      );
      expect(result.kind).toBe('too-deep');
      if (result.kind === 'too-deep') {
        expect(result.max).toBe(1);
      }
    });

    it('enforces maxDepth=1 in CREATE mode too', async () => {
      const result = await checkHierarchyOnReparent(
        null,
        'value',
        makeLookup({ value: 'root', root: null }),
        1,
      );
      expect(result.kind).toBe('too-deep');
    });
  });

  describe('CREATE mode (editedId = null)', () => {
    it('skips cycle check when editedId is null', async () => {
      // A 3-deep chain that doesn't form a cycle. Creating a new node
      // under d2 is fine: depth 3 (under limit).
      const result = await checkHierarchyOnReparent(
        null,
        'd2',
        makeLookup({ d2: 'd1', d1: 'root', root: null }),
      );
      expect(result.kind).toBe('ok');
    });

    it('still enforces depth limit in CREATE mode', async () => {
      const result = await checkHierarchyOnReparent(
        null,
        'd4',
        makeLookup({
          d4: 'd3',
          d3: 'd2',
          d2: 'd1',
          d1: 'root',
          root: null,
        }),
      );
      expect(result.kind).toBe('too-deep');
    });

    it('still detects corrupt-tree in CREATE mode', async () => {
      // We try to create a new node under B, where B and C form a cycle.
      const result = await checkHierarchyOnReparent(null, 'B', makeLookup({ B: 'C', C: 'B' }));
      expect(result.kind).toBe('corrupt-tree');
    });
  });
});

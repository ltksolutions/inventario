// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Hierarchy traversal utilities for parent-pointer trees.
 *
 * Shared between categories and locations (both use a `parentId` field
 * to form a tree). The logic is generic: anything that can answer
 * "what's the parentId of node X" can be checked for cycles + depth.
 *
 * Why a separate module:
 *   - Testable in isolation with a fake parent-lookup function (no DB,
 *     no Fastify, no MongoDB transactions).
 *   - Reusable between modules with no copy-paste.
 *   - Cycle/depth invariants are subtle enough that putting them in a
 *     well-tested utility is safer than inlining the algorithm in each
 *     service.
 *
 * Concepts:
 *   - "Depth" means the number of ancestor levels above a node. A root
 *     node (parentId === null) has depth 0. Its direct child has depth 1.
 *   - "Max depth" is the project-wide hierarchy limit; root + 4 nested
 *     = 5 total levels. The CategorySchema enforces a project-wide max
 *     via MAX_HIERARCHY_DEPTH below.
 *
 * Outputs are tagged unions rather than throwing — the caller (service
 * layer) decides which HTTP status to return for each failure mode.
 */

/**
 * Project-wide maximum depth for hierarchy trees (categories, locations).
 *
 * Convention: root (parentId=null) is depth 0. A child of a root is
 * depth 1. With MAX_HIERARCHY_DEPTH = 4, a leaf at the maximum depth
 * has 4 ancestors above it, for a total of 5 levels in the chain.
 *
 * Example permitted chain:
 *   IT (0) > Notebooky (1) > Pracovné (2) > Vývojárske (3) > Linux (4)
 *
 * Adding a 6th level (a child of "Linux") is rejected.
 */
export const MAX_HIERARCHY_DEPTH = 4;

/**
 * Result of a hierarchy check. One of four outcomes:
 *
 *   - `ok`              — the proposed parent is safe to assign
 *   - `cycle`           — assigning this parent would create a cycle
 *                         (the proposed parent has the edited node
 *                         somewhere in its ancestor chain)
 *   - `too-deep`        — placing the edited node under this parent
 *                         would exceed MAX_HIERARCHY_DEPTH
 *   - `corrupt-tree`    — the existing tree already contains a cycle
 *                         (detected by revisiting a node during traversal)
 *
 * The caller maps these to HTTP status codes:
 *   - cycle, too-deep → 400 (client error, fixable by changing input)
 *   - corrupt-tree    → 400 with a distinct message (data needs admin
 *                       attention, but the operation is still rejected)
 */
export type HierarchyCheckResult =
  | { kind: 'ok' }
  | { kind: 'cycle'; editedId: string; chain: string[] }
  | { kind: 'too-deep'; depth: number; max: number }
  | { kind: 'corrupt-tree'; revisitedId: string; chain: string[] };

/**
 * Function that resolves the parentId of a node by its id.
 *
 * Returns:
 *   - the parent id as a string (the node has a parent)
 *   - null (the node IS a root)
 *   - undefined (the node doesn't exist in the tree)
 *
 * The service layer wires this up to a repository call. Tests pass
 * an in-memory Map.
 */
export type ParentLookup = (id: string) => Promise<string | null | undefined>;

/**
 * Check whether assigning `proposedParentId` as the parent of `editedId`
 * is structurally legal: no cycle, no exceeding max depth, and no
 * pre-existing cycle in the chain we'd walk.
 *
 * Algorithm:
 *   1. Start at `proposedParentId`, walking upward via lookupParent.
 *   2. At each step, check:
 *      - is this node == editedId? → cycle (the proposed parent has
 *        the edited node as an ancestor → assigning it would close a loop)
 *      - have we visited this node before? → corrupt-tree (the existing
 *        tree contains a cycle independent of our edit)
 *      - did we cross MAX_HIERARCHY_DEPTH steps? → too-deep
 *   3. Stop when parent is null (we reached a root) → ok.
 *
 * If `proposedParentId` is null, the node is being made a root — no
 * traversal needed, always ok (depth 0).
 *
 * Notes:
 *   - The check accounts for the "edited node would now be a child of
 *     proposedParent" by counting the proposed parent as depth 1 above
 *     the edited node. So if proposedParent itself has depth d, the
 *     edited node would end up at depth d + 1.
 *   - For CREATE (no editedId yet), pass editedId = null. The cycle
 *     check is skipped (a not-yet-existing node can't be in any chain),
 *     but depth + corrupt-tree checks still apply.
 *   - `maxDepth` defaults to the project-wide MAX_HIERARCHY_DEPTH (used
 *     by locations). Callers can pass a stricter limit: categories pass
 *     `maxDepth = 1` to enforce a flat root + values model (exactly two
 *     levels — a root and its direct children, no grandchildren).
 */
export async function checkHierarchyOnReparent(
  editedId: string | null,
  proposedParentId: string | null,
  lookupParent: ParentLookup,
  maxDepth: number = MAX_HIERARCHY_DEPTH,
): Promise<HierarchyCheckResult> {
  // Reparent to root — always safe (root is depth 0).
  if (proposedParentId === null) {
    return { kind: 'ok' };
  }

  // The proposed parent sits at some depth d. After the reparent, the
  // edited node sits at depth d + 1. The deepest legal depth for the
  // edited node is MAX_HIERARCHY_DEPTH, so the proposed parent must be
  // at depth <= MAX_HIERARCHY_DEPTH - 1.
  //
  // We walk upward counting the chain length. If we hit MAX_HIERARCHY_DEPTH
  // ancestors above the proposed parent, that means the proposed parent
  // is at depth MAX_HIERARCHY_DEPTH and the edited node would be at
  // MAX_HIERARCHY_DEPTH + 1 — over the limit.

  const chain: string[] = [];
  const visited = new Set<string>();
  let current: string | null = proposedParentId;
  let stepsAbove = 0; // counts ancestors of `proposedParentId` (= depth of proposedParentId from root)

  while (current !== null) {
    // Cycle: the proposed parent's ancestor chain contains the edited node.
    if (editedId !== null && current === editedId) {
      return { kind: 'cycle', editedId, chain: [...chain, current] };
    }

    // Corrupt tree: we've seen this node already on the upward walk.
    if (visited.has(current)) {
      return { kind: 'corrupt-tree', revisitedId: current, chain: [...chain, current] };
    }

    visited.add(current);
    chain.push(current);

    // Depth budget: if we've already walked `maxDepth` steps above the
    // proposed parent (i.e. the proposed parent is at depth `maxDepth`),
    // placing the edited node here would make it depth `maxDepth` + 1.
    if (stepsAbove >= maxDepth) {
      return {
        kind: 'too-deep',
        depth: stepsAbove + 1,
        max: maxDepth,
      };
    }

    const parent: string | null | undefined = await lookupParent(current);

    // Lookup returned undefined → node doesn't exist. The caller is
    // responsible for validating existence separately (we expect them
    // to have done so before invoking us). Treat as a root for our
    // purposes: terminate the walk, return ok. The caller's existence
    // check will catch a genuinely missing parent.
    if (parent === undefined) {
      return { kind: 'ok' };
    }

    current = parent;
    stepsAbove += 1;
  }

  return { kind: 'ok' };
}

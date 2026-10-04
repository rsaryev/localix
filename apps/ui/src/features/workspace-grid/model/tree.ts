// The editor-group grid: a binary-ish tree of resizable views. Leaves are GROUPS
// (an ordered tab list + one active tab); branches split space horizontally or
// vertically. Interaction and rendering concerns such as sash handling stay out
// of this model; these pure helpers are the testable core the React GridView renders.

export type Orientation = 'h' | 'v'
export type SplitDir = 'left' | 'right' | 'up' | 'down'

/** Durable placement anchor for a group. A leaf's role survives splits/merges, so
 *  deterministic placement (a kind always opens into its role's group) never goes
 *  stale. The placement tables that map kinds→roles live in `placement.ts`. */
// DEFAULT placement roles: a primary `editor` area (documents + the live app
// preview + terminals, all opening as editor tabs) and one `aux` side panel that
// stacks the companion views (chat, source control, task, problems) as tabs.
// `preview` and `bottom` are LEGACY tags: the old policy gave the preview its own
// column and terminals a bottom strip; persisted layouts that still carry such a
// tagged group keep it (placement reuses it), but nothing spawns one anymore.
// Only the default — the user splits further by hand (manual groups are
// untagged). The kind→role + role→spawn tables live in `placement.ts`.
export type GroupRole = 'editor' | 'aux' | 'bottom' | 'preview'

export interface LeafNode {
  type: 'leaf'
  id: string
  tabs: string[]
  activeTab: string | null
  /** Placement anchor; absent on plain groups the user split by hand. */
  role?: GroupRole
  /** Per-group tab-activation history, MOST-RECENT-FIRST (ids only, deduped, capped).
   *  Drives history-based close activation: closing the active tab returns to the
   *  previously-focused one, not an arbitrary neighbour. OPTIONAL so older persisted
   *  trees without it still load. */
  tabHistory?: string[]
}

export interface BranchNode {
  type: 'branch'
  id: string
  orientation: Orientation
  children: GridNode[]
  /** Fractions in [0,1] summing to ~1, one per child. */
  sizes: number[]
}

export type GridNode = LeafNode | BranchNode

export function makeLeaf(
  id: string,
  tabs: string[] = [],
  activeTab: string | null = null,
  role?: GroupRole,
): LeafNode {
  return {
    type: 'leaf',
    id,
    tabs,
    activeTab: activeTab ?? tabs[tabs.length - 1] ?? null,
    ...(role ? { role } : {}),
  }
}

/** Depth-first list of all leaves, left-to-right. */
export function leaves(node: GridNode): LeafNode[] {
  if (node.type === 'leaf') return [node]
  return node.children.flatMap(leaves)
}

export function leafIds(node: GridNode): string[] {
  return leaves(node).map((l) => l.id)
}

export function firstLeaf(node: GridNode): LeafNode {
  return leaves(node)[0]
}

export function findLeaf(node: GridNode, id: string): LeafNode | null {
  return leaves(node).find((l) => l.id === id) ?? null
}

/** The first leaf carrying the placement `role` (depth-first, left-to-right), or
 *  null. Used by deterministic placement to find a kind's home group. */
export function findLeafByRole(node: GridNode, role: GroupRole): LeafNode | null {
  return leaves(node).find((l) => l.role === role) ?? null
}

/** Replace the node with id `targetId` by `fn(node)` (or drop it if fn returns null). */
function rewrite(
  node: GridNode,
  targetId: string,
  fn: (n: GridNode) => GridNode | null,
): GridNode | null {
  if (node.id === targetId) return fn(node)
  if (node.type === 'leaf') return node
  const children: GridNode[] = []
  const sizes: number[] = []
  node.children.forEach((child, i) => {
    const next = rewrite(child, targetId, fn)
    if (next) {
      children.push(next)
      sizes.push(node.sizes[i])
    }
  })
  if (children.length === 0) return null
  return { ...node, children, sizes: renormalize(sizes) }
}

/** Map every LEAF through `fn` (branches untouched), preserving structure. */
export function mapLeaves(node: GridNode, fn: (l: LeafNode) => LeafNode): GridNode {
  if (node.type === 'leaf') return fn(node)
  return { ...node, children: node.children.map((c) => mapLeaves(c, fn)) }
}

/** Scale a size list so it sums to 1 (even split if it summed to 0). */
export function renormalize(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0)
  if (total <= 0) return sizes.map(() => 1 / sizes.length)
  return sizes.map((s) => s / total)
}

/**
 * Collapse the tree to canonical form: a branch with one child becomes that child
 * (absorbing its size slot), nested branches of the SAME orientation flatten, and
 * sizes renormalize. Empty leaves are kept (the grid always shows ≥1 group).
 */
export function normalize(node: GridNode): GridNode {
  if (node.type === 'leaf') return node
  // Normalize children first.
  let children = node.children.map(normalize)
  let sizes = node.sizes.slice()
  // Flatten same-orientation child branches into this one.
  const flatChildren: GridNode[] = []
  const flatSizes: number[] = []
  children.forEach((child, i) => {
    if (child.type === 'branch' && child.orientation === node.orientation) {
      child.children.forEach((gc, j) => {
        flatChildren.push(gc)
        flatSizes.push(sizes[i] * child.sizes[j])
      })
    } else {
      flatChildren.push(child)
      flatSizes.push(sizes[i])
    }
  })
  children = flatChildren
  sizes = flatSizes
  if (children.length === 1) return children[0]
  return { ...node, children, sizes: renormalize(sizes) }
}

/**
 * Split the leaf `targetId` into a branch, placing `newLeaf` on the given side.
 * 'left'/'right' → horizontal branch; 'up'/'down' → vertical. The existing leaf
 * and the new one share the slot per `sizes` (defaults to 50/50). Returns the
 * normalized root.
 */
export function insertSplit(
  root: GridNode,
  targetId: string,
  dir: SplitDir,
  newLeaf: LeafNode,
  sizes: [number, number] = [0.5, 0.5],
): GridNode {
  const orientation: Orientation = dir === 'left' || dir === 'right' ? 'h' : 'v'
  const before = dir === 'left' || dir === 'up'
  const next = rewrite(root, targetId, (target) => {
    const kids = before ? [newLeaf, target] : [target, newLeaf]
    const branch: BranchNode = {
      type: 'branch',
      id: `branch:${target.id}:${newLeaf.id}`,
      orientation,
      children: kids,
      sizes: renormalize(sizes),
    }
    return branch
  })
  return normalize(next ?? root)
}

/**
 * Remove the leaf `leafId`. Returns the normalized root plus the leaf the focus
 * should re-home to (a sibling, or null if the grid is now a single empty root).
 * The LAST remaining leaf is never removed — it's emptied instead.
 */
export function removeLeaf(
  root: GridNode,
  leafId: string,
): { root: GridNode; rehomeTo: string | null } {
  const all = leaves(root)
  if (all.length <= 1) {
    // Only one group — keep it, just empty it.
    const emptied = mapLeaves(root, (l) => (l.id === leafId ? makeLeaf(l.id) : l))
    return { root: emptied, rehomeTo: all[0]?.id === leafId ? all[0].id : null }
  }
  // Pick a neighbour to re-home focus to (previous leaf, else next).
  const idx = all.findIndex((l) => l.id === leafId)
  const neighbour = all[idx - 1] ?? all[idx + 1] ?? null
  const next = rewrite(root, leafId, () => null)
  return { root: normalize(next ?? root), rehomeTo: neighbour?.id ?? null }
}

/**
 * Keep only the leaves passing `keep`, collapsing branches emptied as a result
 * (sizes renormalized, branch ids of survivors preserved). Returns a single
 * `fallbackId` leaf when none survive. The structural core shared by restore-time
 * pruning and the per-scope adaptive view (collapse groups empty in this session).
 */
export function keepLeaves(
  root: GridNode,
  keep: (l: LeafNode) => boolean,
  fallbackId: string,
): GridNode {
  const all = leaves(root)
  const kept = all.filter(keep)
  if (kept.length === all.length) return normalize(root)
  if (kept.length === 0) return makeLeaf(fallbackId)
  const keepIds = new Set(kept.map((l) => l.id))
  const drop = (node: GridNode): GridNode | null => {
    if (node.type === 'leaf') return keepIds.has(node.id) ? node : null
    const children: GridNode[] = []
    const sizes: number[] = []
    node.children.forEach((c, i) => {
      const n = drop(c)
      if (n) {
        children.push(n)
        sizes.push(node.sizes[i])
      }
    })
    if (children.length === 0) return null
    return { ...node, children, sizes: renormalize(sizes) }
  }
  return normalize(drop(root) ?? makeLeaf(fallbackId))
}

/**
 * Drop every empty leaf (used at RESTORE time, where a leaf left tab-less by a
 * dropped non-restorable item shouldn't show as a blank group). Returns a single
 * empty leaf (id `fallbackId`) when nothing survives. During LIVE editing empty
 * leaves are valid (split-then-fill), so this is restore-only — not in normalize.
 */
export function pruneEmptyLeaves(root: GridNode, fallbackId: string): GridNode {
  return keepLeaves(root, (l) => l.tabs.length > 0, fallbackId)
}

/** Apply new fractional sizes to the branch `branchId` (renormalized). */
export function resizeBranch(root: GridNode, branchId: string, sizes: number[]): GridNode {
  const next = rewrite(root, branchId, (n) => {
    if (n.type !== 'branch' || n.children.length !== sizes.length) return n
    return { ...n, sizes: renormalize(sizes) }
  })
  return next ?? root
}

function subtreeHas(node: GridNode, leafId: string): boolean {
  return node.type === 'leaf'
    ? node.id === leafId
    : node.children.some((c) => subtreeHas(c, leafId))
}

/**
 * Repartition the two ADJACENT branch children that sit on either side of a resize
 * boundary — identified by a leaf on each side (`leafA` left/top, `leafB`
 * right/bottom) rather than by a branch id + positional sizes. `ratioA` is `leafA`'s
 * side's share of that child PAIR (0..1); the pair's combined size and every other
 * sibling are untouched.
 *
 * Why leaf-anchored: the grid renders an ADAPTIVE, scope-collapsed view of the tree
 * (empty-in-scope groups pruned, single-child branches flattened), so a separator's
 * view branch id / child count often DON'T match the raw stored tree — a positional
 * `resizeBranch` then silently no-ops and the panel "won't drag". Locating the split
 * by the leaves it lies between survives collapse, flattening, and hidden siblings.
 */
export function resizeAdjacentLeaves(
  root: GridNode,
  leafA: string,
  leafB: string,
  ratioA: number,
): GridNode {
  const apply = (node: GridNode): GridNode | null => {
    if (node.type !== 'branch') return null
    const iA = node.children.findIndex((c) => subtreeHas(c, leafA))
    const iB = node.children.findIndex((c) => subtreeHas(c, leafB))
    if (iA === -1 || iB === -1) return null
    if (iA === iB) {
      // Both leaves are deeper under the same child → recurse into it.
      const inner = apply(node.children[iA])
      if (!inner) return null
      const children = node.children.slice()
      children[iA] = inner
      return { ...node, children }
    }
    // The two leaves straddle THIS branch's children → the boundary is here.
    const lo = Math.min(iA, iB)
    const hi = Math.max(iA, iB)
    const r = iA < iB ? ratioA : 1 - ratioA // share for the lower-indexed child
    const sizes = node.sizes.slice()
    const pair = sizes[lo] + sizes[hi]
    sizes[lo] = pair * r
    sizes[hi] = pair * (1 - r)
    return { ...node, sizes: renormalize(sizes) }
  }
  return apply(root) ?? root
}

import type { GridNode } from './tree'

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

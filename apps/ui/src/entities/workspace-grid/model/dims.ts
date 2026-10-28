// Structural size minimums for the grid — pure, React-free, so they live in the
// model layer as the SINGLE source of truth. The renderer (widget/editor-grid
// layout.ts) re-exports these.
import type { GridNode, GroupRole } from './tree'

/** Minimum usable group size in PX. The generic floor for untagged groups
 *  (hand-splits); role groups override the WIDTH below. Pure fractions otherwise
 *  compound to an unusable sliver once enough regions stack (chat+editor+panel →
 *  ~13%-wide panel). */
export const MIN_GROUP_W = 240
export const MIN_GROUP_H = 120

/** Per-ROLE minimum WIDTH (px). Content-heavy roles need more than a bare editor
 *  sliver: the side panel hosts a commit composer / file tree, chat must stay
 *  readable. Without these the nested panel compounds to ~13% of the width — the
 *  "panel is way too tight" symptom — even though the generic 240 floor passed.
 *  Height isn't role-sensitive (a terminal strip is happy short), so it stays the
 *  scalar MIN_GROUP_H. */
export const ROLE_MIN_W: Record<GroupRole, number> = {
  editor: 360,
  aux: 340,
}

/** The minimums above are authored against the DEFAULT 14px root font-size.
 *  `GridDims` is that set of minimums, optionally scaled by the density ratio
 *  (root font-size / 14) so panes keep the same PERCEIVED floor when the user
 *  bumps the density setting. Persisted layout fractions are untouched. */
export interface GridDims {
  minGroupW: number
  minGroupH: number
  roleMinW: Record<GroupRole, number>
}

export const BASE_DIMS: GridDims = {
  minGroupW: MIN_GROUP_W,
  minGroupH: MIN_GROUP_H,
  roleMinW: ROLE_MIN_W,
}

/** Scale the 14px-baseline minimums by the density ratio. Pure. Ratio 1 (or any
 *  invalid ratio — SSR/tests) returns BASE_DIMS itself, so the default density
 *  is byte-identical to the unscaled constants. */
export function scaleDims(ratio: number): GridDims {
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio === 1) return BASE_DIMS
  const roleMinW = Object.fromEntries(
    Object.entries(ROLE_MIN_W).map(([role, px]) => [role, px * ratio]),
  ) as Record<GroupRole, number>
  return { minGroupW: MIN_GROUP_W * ratio, minGroupH: MIN_GROUP_H * ratio, roleMinW }
}

/** Minimum WIDTH a subtree needs: a leaf wants its role's min (else `fallback`); a
 *  horizontal branch the SUM of its children (side by side), a vertical branch the
 *  MAX (stacked → same width). Pure. `roleMin` defaults to the 14px-baseline table;
 *  pass `scaleDims(ratio).roleMinW` to follow the density setting. */
export function minWidthOf(
  node: GridNode,
  fallback: number = MIN_GROUP_W,
  roleMin: Record<GroupRole, number> = ROLE_MIN_W,
): number {
  if (node.type === 'leaf') return node.role ? roleMin[node.role] : fallback
  return node.orientation === 'h'
    ? node.children.reduce((a, c) => a + minWidthOf(c, fallback, roleMin), 0)
    : Math.max(...node.children.map((c) => minWidthOf(c, fallback, roleMin)))
}

/** Minimum HEIGHT a subtree needs (mirror of minWidthOf; the scalar floor, since
 *  no role is height-sensitive). */
export function minHeightOf(node: GridNode, fallback: number = MIN_GROUP_H): number {
  if (node.type === 'leaf') return fallback
  return node.orientation === 'v'
    ? node.children.reduce((a, c) => a + minHeightOf(c, fallback), 0)
    : Math.max(...node.children.map((c) => minHeightOf(c, fallback)))
}

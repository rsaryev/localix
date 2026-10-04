import type { SplitDir, WorkItemKind } from '@/features/workspace-grid/model'

// Pure drop-zone geometry for the editor grid — no React, no DOM mutation, just
// math over a rect + cursor. Lives apart from the `useGroupSplitDrop` hook so the
// hit-test stays unit-testable without dragging in React (see dropZone.test.ts).

export type DropZone = 'center' | SplitDir

/**
 * True for a body kind that renders its OWN message-binding drop surface — today only
 * `chat`, whose composer accepts a dragged file/db-console/terminal tab and pins
 * it as a context-ref (exactly like a file-tree row drop).
 *
 * GroupView must NOT lay its split-drop shield over such a body: the shield is a
 * full-cover `absolute inset-0 z-overlay` div, so during a TAB drag (which arms
 * `workItemDragBus` → `isDragging`) it would sit ABOVE the composer and swallow
 * the drop as a move/split — the composer would never see it, and dragging an
 * open tab onto the chat could never link it. (A file-tree drag doesn't start
 * `workItemDragBus`, so no shield renders and the composer already works — this
 * asymmetry is the whole bug.) A tab MOVE into such a group still works via the
 * tab strip's own foreign-drop handler; SPLIT via the tab context menu.
 */
export function bodyOwnsMessageBindingDrops(kind: WorkItemKind | undefined): boolean {
  return kind === 'chat'
}

/** Cursor must come within this fraction of an edge to ENTER a split zone. */
const ENTER_EDGE = 0.25
/** Hysteresis: once in a split zone, the cursor must pull back past THIS looser
 *  band (same edge) before falling back to center — stops the highlight from
 *  flip-flopping center↔edge on sub-pixel jitter right at the 25% boundary. */
const EXIT_EDGE = 0.32

/** Edge-threshold hit-test with hysteresis: cursor near an edge → split there,
 *  else center = move/append. `prev` is the zone currently shown for this group,
 *  so a held edge zone stays sticky until the cursor clearly leaves it. */
export function computeDropZone(
  rect: DOMRect,
  clientX: number,
  clientY: number,
  prev?: DropZone | null,
): DropZone {
  const fx = (clientX - rect.left) / rect.width
  const fy = (clientY - rect.top) / rect.height
  const edges: Array<{ dir: SplitDir; dist: number }> = [
    { dir: 'left', dist: fx },
    { dir: 'right', dist: 1 - fx },
    { dir: 'up', dist: fy },
    { dir: 'down', dist: 1 - fy },
  ]
  const nearest = edges.reduce((a, b) => (b.dist < a.dist ? b : a))
  // Sticky: if we're already showing this exact edge, hold it through the wider
  // EXIT band so tiny cursor jitter doesn't drop back to center.
  if (prev && prev !== 'center' && nearest.dir === prev) {
    return nearest.dist < EXIT_EDGE ? nearest.dir : 'center'
  }
  return nearest.dist < ENTER_EDGE ? nearest.dir : 'center'
}

/**
 * Insertion index for a tab dropped on another group's tab strip: the slot of the
 * first tab whose horizontal MIDPOINT sits right of the cursor, else the end. `mids`
 * are the tab midpoints in strip order (left→right). Pure so the "drop where the
 * cursor is" rule is testable without the DOM — GroupView measures the rects and
 * feeds the midpoints in. Without this a foreign strip-drop always appended to the
 * end regardless of where the user aimed (the reported "drag lands in the wrong
 * place" oddity), since a cross-group drag can't drive the TabStrip's own reorder.
 */
export function insertIndexForX(mids: number[], clientX: number): number {
  for (let i = 0; i < mids.length; i++) if (clientX < mids[i]) return i
  return mids.length
}

/** What a drop resolves to, once the hovered zone + drag origin are known. */
export type DropAction =
  | { type: 'move'; toGroup: string } // append the tab into the target group
  | { type: 'split'; dir: SplitDir } // carve a new group on that edge, relocate the tab
  | { type: 'none' } // no-op (a self-drop that would just churn)

/**
 * Decide the tree edit for a drop — pure, so the churn/edge rules are testable
 * without React. `fromGroup` is where the dragged tab started, `sourceTabCount`
 * how many tabs that origin group holds. The one non-obvious rule: carving a
 * group's SOLE tab off ITSELF (edge-drop onto its own group) would split then
 * immediately collapse back to a single group — pure churn plus a wasted group
 * id — so it resolves to a no-op. A center self-drop stays a move (it lands the
 * tab at the end, matching the old behavior).
 */
export function resolveDropAction(
  zone: DropZone,
  targetGroupId: string,
  fromGroup: string,
  sourceTabCount: number,
): DropAction {
  if (zone === 'center') return { type: 'move', toGroup: targetGroupId }
  if (fromGroup === targetGroupId && sourceTabCount <= 1) return { type: 'none' }
  return { type: 'split', dir: zone }
}

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useGridStore, scopedViewRoot, leaves } from '@/features/workspace-grid/model'
import type { ResolvedTheme } from '@/shared/theme/useTheme'
import { GroupView } from './GroupView'
import { densityRatio } from '@localixai/kit/lib'
import { WorkbenchSash } from '@localixai/kit/button'
import {
  minWidthOf,
  minHeightOf,
  capMin,
  resolveGridLayout,
  scaleDims,
  type Rect,
  type SeparatorSlot,
} from './layout'

function pctStyle(rect: Rect): React.CSSProperties {
  return {
    left: `${rect.left}%`,
    top: `${rect.top}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
  }
}

const SASH_KEYBOARD_STEP = 16

/** Center the shared sash's fixed hit area on the percentage boundary. The sash
 *  primitive paints the 1px line independently from its forgiving pointer box. */
function separatorStyle(sep: SeparatorSlot): React.CSSProperties {
  if (sep.orientation === 'h') {
    return {
      left: `${sep.rect.left + sep.rect.width / 2}%`,
      top: `${sep.rect.top}%`,
      width: 'var(--sash-hit-area)',
      height: `${sep.rect.height}%`,
      transform: 'translateX(-50%)',
    }
  }
  return {
    left: `${sep.rect.left}%`,
    top: `${sep.rect.top + sep.rect.height / 2}%`,
    width: `${sep.rect.width}%`,
    height: 'var(--sash-hit-area)',
    transform: 'translateY(-50%)',
  }
}

function Separator({
  sep,
  containerRef,
}: {
  sep: SeparatorSlot
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  const resizeAdjacent = useGridStore((s) => s.resizeAdjacent)
  // Keep the sash lit for the WHOLE drag: the drag
  // shield sits above the separator and steals :hover the instant it mounts,
  // so without this the line would fade back to its faint rest color mid-drag.
  const [dragging, setDragging] = useState(false)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  useLayoutEffect(() => () => dragCleanupRef.current?.(), [])
  const horizontal = sep.orientation === 'h'
  // The two leaves the boundary lies between (last of the left/top child, first of
  // the right/bottom child). Resizing is anchored to THESE — not the view branch's
  // id — so it still hits the raw tree after scope-collapse/flatten reshape it.
  const childA = sep.branch.children[sep.index]
  const childB = sep.branch.children[sep.index + 1]
  const leafA = leaves(childA).at(-1)?.id
  const leafB = leaves(childB)[0]?.id

  // Mouse and keyboard must share the exact same role-derived clamp. Otherwise a
  // key nudge can persist a size the adaptive layout immediately rejects.
  const resizeMetrics = () => {
    const container = containerRef.current
    if (!container || !leafA || !leafB) return null
    const crect = container.getBoundingClientRect()
    const span = horizontal
      ? crect.width * (sep.branchRect.width / 100)
      : crect.height * (sep.branchRect.height / 100)
    if (span <= 0) return null
    const a = sep.branch.sizes[sep.index]
    const b = sep.branch.sizes[sep.index + 1]
    const pair = a + b
    const count = sep.branch.children.length
    const dims = scaleDims(densityRatio())
    const minA =
      capMin(
        horizontal
          ? minWidthOf(childA, dims.minGroupW, dims.roleMinW)
          : minHeightOf(childA, dims.minGroupH),
        span,
        count,
      ) / span
    const minB =
      capMin(
        horizontal
          ? minWidthOf(childB, dims.minGroupW, dims.roleMinW)
          : minHeightOf(childB, dims.minGroupH),
        span,
        count,
      ) / span
    const fits = minA + minB <= pair
    const lo = fits ? minA : pair * (minA / (minA + minB || 1))
    return { span, a, pair, lo, hi: fits ? pair - minB : lo }
  }

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    dragCleanupRef.current?.()
    const metrics = resizeMetrics()
    if (!metrics || !leafA || !leafB) return
    const { span, a, pair, lo, hi } = metrics
    const startPos = horizontal ? e.clientX : e.clientY
    // Past the early-return guards — an aborted start can't strand the highlight.
    setDragging(true)
    const shield = document.createElement('div')
    shield.style.cssText = `position:fixed;inset:0;z-index:2147483647;cursor:${horizontal ? 'col-resize' : 'row-resize'};`
    document.body.appendChild(shield)
    const onMove = (ev: MouseEvent) => {
      const delta = ((horizontal ? ev.clientX : ev.clientY) - startPos) / span
      const na = Math.max(lo, Math.min(hi, a + delta))
      // Repartition the PAIR by leaf identity (robust to the collapsed view tree
      // differing from the raw stored tree) — na/pair is leafA's side share.
      resizeAdjacent(leafA, leafB, na / pair)
    }
    const teardown = () => {
      shield.remove()
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
      shield.removeEventListener('mouseleave', onUp)
      dragCleanupRef.current = null
    }
    const onUp = () => {
      setDragging(false)
      teardown()
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    shield.addEventListener('mouseleave', onUp)
    dragCleanupRef.current = teardown
  }

  // Double-click evens the two regions this boundary splits.
  const equalize = () => {
    if (leafA && leafB) resizeAdjacent(leafA, leafB, 0.5)
  }

  const resizeWithKeyboard = (e: React.KeyboardEvent) => {
    const metrics = resizeMetrics()
    if (!metrics || !leafA || !leafB) return
    const { span, a, pair, lo, hi } = metrics
    const step = (e.shiftKey ? SASH_KEYBOARD_STEP * 4 : SASH_KEYBOARD_STEP) / span
    const grow = horizontal ? 'ArrowRight' : 'ArrowDown'
    const shrink = horizontal ? 'ArrowLeft' : 'ArrowUp'
    let next: number
    if (e.key === grow) next = a + step
    else if (e.key === shrink) next = a - step
    else if (e.key === 'Home') next = lo
    else if (e.key === 'End') next = hi
    else if (e.key === 'Enter' || e.key === ' ') next = pair / 2
    else return
    e.preventDefault()
    resizeAdjacent(leafA, leafB, Math.max(lo, Math.min(hi, next)) / pair)
  }

  const pair = sep.branch.sizes[sep.index] + sep.branch.sizes[sep.index + 1]
  const valueNow = Math.round((sep.branch.sizes[sep.index] / pair) * 100)

  return (
    <WorkbenchSash
      orientation={horizontal ? 'vertical' : 'horizontal'}
      label="Resize editor panes"
      resetLabel="equalize panes"
      valueNow={valueNow}
      valueText={`${valueNow}% for the first pane`}
      active={dragging}
      onMouseDown={startResize}
      onKeyDown={resizeWithKeyboard}
      onDoubleClick={equalize}
      style={separatorStyle(sep)}
      // The axis cursor, hit target, line and interaction feedback derive from
      // aria-orientation + data-active in the shared sash primitive.
      className="absolute z-(--z-controls)"
    />
  )
}

/** Renders the editor-group grid as a FLAT, stably-keyed layer: every leaf is
 *  rendered once, keyed by its group id, and absolutely positioned from geometry
 *  computed off the split tree. A split/merge/maximize only changes a leaf's box —
 *  never its place in the React tree — so chat/terminal/preview bodies are never
 *  remounted (no mid-stream flicker, no full-workspace repaint on open). Each
 *  WorkItem still renders directly in its group (no portal). */
export function GridView({
  resolvedTheme,
  isMobile,
}: {
  resolvedTheme: ResolvedTheme
  isMobile: boolean
}) {
  const root = useGridStore((s) => s.root)
  const items = useGridStore((s) => s.items)
  const activeScope = useGridStore((s) => s.activeScope)
  const activeGroup = useGridStore((s) => s.activeGroup)
  const warmScopes = useGridStore((s) => s.warmScopes)
  const scopeActiveTab = useGridStore((s) => s.scopeActiveTab)
  const maximizedGroup = useGridStore((s) => s.maximizedGroup)
  const containerRef = useRef<HTMLDivElement>(null)

  // Measure the real pixel size of the grid so the layout can enforce per-group
  // minimum widths/heights (pure fractions alone compound to an unusable sliver
  // once enough regions stack). Measured before paint + on every resize.
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth,
        h = el.clientHeight
      setViewport((prev) =>
        prev?.width === w && prev.height === h ? prev : { width: w, height: h },
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Render the grid over the per-scope ADAPTIVE tree: groups with no body in the
  // active session collapse out (their space goes to the survivors) instead of
  // showing dead "Empty group" boxes. The store's real geometry is untouched, so
  // switching back to a session that filled those groups restores them. Memoized
  // (not a store selector) since it builds a fresh tree — see zustand v5 selector
  // pitfall (a new-object selector return loops useSyncExternalStore).
  const viewRoot = useMemo(
    () => scopedViewRoot({ root, items, activeScope, activeGroup, warmScopes, scopeActiveTab }),
    [root, items, activeScope, activeGroup, warmScopes, scopeActiveTab],
  )

  // Minimums scale with the Settings density (root font-size / 14) so panes keep
  // the same perceived floor; at the default density this is byte-identical to
  // the baseline constants. Read per layout pass — a density change re-applies
  // on the next render (layout recomputes every render anyway).
  const constraints = viewport ? { viewport, dims: scaleDims(densityRatio()) } : undefined
  // A phone cannot usefully show the desktop editor split (two 300px-minimum workbenches squeezed
  // into ~390px). Render the focused group full-width while preserving the real split tree and
  // keeping the other groups hidden/stably mounted. Returning to desktop restores the exact layout.
  const layout = resolveGridLayout(viewRoot, {
    isMobile,
    activeGroup,
    maximizedGroup,
    constraints,
  })

  return (
    <div
      ref={containerRef}
      data-slot="editor-grid"
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
    >
      {layout.leaves.map(({ leaf, rect, hidden }) => (
        <div
          key={leaf.id}
          data-slot="editor-grid-leaf"
          // `isolate` confines each group's stacking context: without it a group's
          // own high-z content (chat composer, popovers, sticky headers — z-20/z-50)
          // paints ABOVE the z-10 resize separators sitting at the group edge and
          // swallows the drag, so the panel can't be resized from that boundary.
          className="absolute isolate flex min-h-0 min-w-0 flex-col"
          style={
            hidden
              ? {
                  left: 0,
                  top: 0,
                  width: '100%',
                  height: '100%',
                  visibility: 'hidden',
                  pointerEvents: 'none',
                  zIndex: -1,
                }
              : pctStyle(rect)
          }
          // visibility:hidden does NOT pause CSS animations — a global rule in
          // index.css pauses everything under [data-grid-hidden] so maximized-away
          // leaves (pulsing skeletons, plugin animations…) stop burning style recalcs.
          data-grid-hidden={hidden || undefined}
          aria-hidden={hidden || undefined}
        >
          <GroupView leaf={leaf} resolvedTheme={resolvedTheme} />
        </div>
      ))}
      {layout.separators.map((sep) => (
        <Separator key={sep.key} sep={sep} containerRef={containerRef} />
      ))}
    </div>
  )
}

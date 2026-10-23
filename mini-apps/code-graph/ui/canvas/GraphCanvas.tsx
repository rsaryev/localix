import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  Canvas,
  CanvasProvider,
  useCameraPlacement,
  useCanvasCamera,
  type Node,
} from '@localixai/kit/canvas'
import type { EdgeKind } from '../../shared/model'
import type { AgentView, GraphView, ViewNode } from '../../shared/view'
import { useAgentCamera } from '../useAgentCamera'
import { BOX_TYPE, GROUP_TYPE, toFlow, type GraphNodeData } from '../model/flow'
import { openingViewport } from '../model/camera'
import { layoutKey, layoutView } from '../model/layout'
import { BoxNode, GroupNode } from './nodes'

const nodeTypes = { [GROUP_TYPE]: GroupNode, [BOX_TYPE]: BoxNode }
/** Long enough to read as a move into the box, short enough to never wait on. */
const DIVE_MS = 190
const PULL_BACK_MS = 420

/**
 * The level on screen, on the host's board (`@localixai/kit/canvas`), which owns the camera
 * scheme, its keys and controls. What is the map's own is how the camera moves BETWEEN levels,
 * keeping the continuity of scale a zoomable interface depends on. Entering: the camera dives
 * until the box fills the view, and the next level appears fitted to exactly that frame, so its
 * contents take the place of the box instead of jumping in from a re-centre. Leaving: the parent
 * level first appears with the box you left filling the view — the same frame you were looking at
 * — and the camera pulls back to the whole level. The direction is read from the breadcrumb, so a
 * breadcrumb click gets the same move as a keyboard "up".
 */
export interface GraphCanvasProps {
  active?: boolean
  agent?: AgentView
  view: GraphView
  selected: string | null
  highlighted: ReadonlySet<string>
  kinds: ReadonlySet<EdgeKind>
  /** Enter a level (a directory or a file); the canvas has already moved the camera. */
  onEnter: (id: string) => void
  onActivate: (node: ViewNode) => void
  /** Go up one level. */
  onLeave: () => void
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <CanvasProvider>
      <Board {...props} />
    </CanvasProvider>
  )
}

function Board({
  active = true,
  agent,
  view,
  selected,
  highlighted,
  kinds,
  onEnter,
  onActivate,
  onLeave,
}: GraphCanvasProps) {
  const camera = useCanvasCamera()
  const diveTimer = useRef<number | null>(null)
  const previous = useRef<{ scope: string; trail: string[] } | null>(null)

  const key = layoutKey(view)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures the view's layout inputs
  const layout = useMemo(() => layoutView(view), [key])
  // A hover belongs to the level it happened on: a new level starts with none, without an effect.
  const [hover, setHover] = useState<{ key: string; id: string } | null>(null)
  const hovered = hover?.key === key ? hover.id : null
  const overlay = useMemo(
    () => ({ focus: hovered ?? selected, highlighted, kinds }),
    [hovered, selected, highlighted, kinds],
  )
  const { nodes, edges, totalConnections, focused } = useMemo(
    () => toFlow(view, layout, overlay),
    [view, layout, overlay],
  )
  const byId = useMemo(() => new Map(view.nodes.map((node) => [node.id, node])), [view])
  useAgentCamera({ active, agent, nodes, scope: view.scope.id, trail: [], selected })

  const placing = useCameraPlacement(key, (size) => {
    const before = previous.current
    const trail = view.breadcrumb.map((crumb) => crumb.id)
    previous.current = { scope: view.scope.id, trail }
    // Leaving to an ancestor: the box we came out of is on this level.
    const up = before && before.scope !== view.scope.id ? before.trail.indexOf(view.scope.id) : -1
    const cameFrom = up >= 0 ? before?.trail[up + 1] : undefined
    const destination = openingViewport(view, layout, size, cameFrom)
    const box = cameFrom ? layout.boxes.get(cameFrom) : undefined
    if (!box) return camera.set(destination)
    camera.focus(box, { duration: 0 })
    const frame = requestAnimationFrame(() => camera.set(destination, { duration: PULL_BACK_MS }))
    return () => cancelAnimationFrame(frame)
  })

  const dive = useCallback(
    (id: string) => {
      if (diveTimer.current !== null) return
      if (!camera.focusNode(id, { duration: DIVE_MS })) return onEnter(id)
      diveTimer.current = window.setTimeout(() => {
        diveTimer.current = null
        onEnter(id)
      }, DIVE_MS)
    },
    [camera, onEnter],
  )

  useEffect(
    () => () => {
      if (diveTimer.current !== null) {
        window.clearTimeout(diveTimer.current)
        diveTimer.current = null
      }
    },
    [view.scope.id, selected],
  )

  const click = (id: string) => {
    const node = byId.get(id)
    if (!node) return
    if (node.kind === 'directory' || node.kind === 'file') dive(id)
    else onActivate(node)
  }

  const goUp = (event: KeyboardEvent) => {
    const plain = !event.altKey && !event.metaKey && !event.ctrlKey
    if (!(plain && event.key === 'Backspace') && !(event.altKey && event.key === 'ArrowUp'))
      return false
    onLeave()
    return true
  }

  const connections = `${edges.length}${totalConnections > edges.length ? ` of ${totalConnections}` : ''}`
  return (
    <Canvas<Node<GraphNodeData>>
      label="Code map. Click a folder or file to open it; Backspace goes up a level"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      zIndexMode="manual"
      hidden={placing}
      onBoardKey={goUp}
      onNodeClick={(_event, node) => click(node.id)}
      onNodeMouseEnter={(_event, node) => setHover({ key, id: node.id })}
      onNodeMouseLeave={() => setHover(null)}
      overlay={
        edges.length > 0 && (
          <div className="pointer-events-none absolute left-3 top-3 z-(--z-controls) rounded-md border border-border-soft bg-background/90 px-2.5 py-1 text-2xs text-text-soft shadow-(--shadow-soft)">
            {focused
              ? `${connections} direct connections`
              : `${connections} grouped connections · hover a box to trace`}
          </div>
        )
      }
    />
  )
}

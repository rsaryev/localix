import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { useCanvasCamera, type CanvasEdgeType, type NodeChange } from '@localixai/kit/canvas'
import type { SpaceView } from '../../shared/api'
import type { Box } from '../../shared/ops/geometry'
import { boundsOfBoxes } from '../../shared/ops/layout'
import type { SpaceOp } from '../../shared/ops/contract'
import { spaceTypes } from '../../shared/types'
import { dragOps, followersOf, type Follower } from './moves'
import { SNAP_PX, snapBox, type Guide } from './snap'
import { flowCache, toFlow, type ElementNode } from './toFlow'
import { useLatest, useStableCallback } from '@localixai/mini-app-sdk/ui/runtime-hooks'
import { useBoardSelection } from './useBoardSelection'

/**
 * The board on screen: the server's board, the selection (`useBoardSelection`), and — only while
 * a pointer is down — the positions and sizes a drag or a resize has reached. Nodes are DERIVED from those every
 * render; nothing copies the board into a second state that could fall behind it, which is how a
 * board that polls and a board being dragged stop fighting over the same note.
 *
 * A drag writes nothing until it ends, and then writes what the screen SHOWS: the snapped
 * positions and the group members and frame contents that followed — never the library's own
 * idea of where the pointer took its nodes, which knows neither.
 */
type Live = Map<string, { x?: number; y?: number; w?: number; h?: number }>

interface Drag {
  followers: Map<string, Follower[]>
  /** Everything a snap may line up with: what is not moving. */
  others: Box[]
  sizes: Map<string, { w: number; h: number }>
}

export function useLiveBoard(view: SpaceView, apply: (ops: readonly SpaceOp[]) => void) {
  const camera = useCanvasCamera()
  const [cache] = useState(flowCache)
  const flow = useMemo(() => toFlow(view, spaceTypes, cache), [view, cache])
  const selection = useBoardSelection(view.space)
  const { selected, applySelection, groupOf } = selection
  const [live, setLiveState] = useState<Live>(new Map())
  const [guides, setGuides] = useState<Guide[]>([])
  const liveRef = useRef<Live>(live)
  const drag = useRef<Drag | null>(null)
  const suspendSnap = useRef(false)
  // The callbacks below are handed to the library once; they read the board through a ref.
  const board = useLatest({ space: view.space })

  const setLive = useCallback((next: Live) => {
    liveRef.current = next
    setLiveState(next)
  }, [])

  // ⌘/Ctrl held during a drag places freely, the way the design tools let go of their guides.
  useEffect(() => {
    const track = (event: KeyboardEvent) => {
      suspendSnap.current = event.metaKey || event.ctrlKey
    }
    window.addEventListener('keydown', track)
    window.addEventListener('keyup', track)
    return () => {
      window.removeEventListener('keydown', track)
      window.removeEventListener('keyup', track)
    }
  }, [])

  // The elements on the board when it first drew. Any other one arrived later — placed, pasted,
  // created by the agent — and settles in with `space-arrived`. Only those: giving the class to a
  // node already on screen would start its animation there and then.
  const [initial] = useState<ReadonlySet<string>>(() => new Set(flow.nodes.map((node) => node.id)))

  // A node shown as it is (not dragged) is derived once per base node and selection state, and
  // then handed back as the same object: the library redraws only nodes that are new objects, and
  // a click that selects one note must redraw that note, not the board. Weak keys release a
  // deleted base node and its full content; id-keyed caches retained every deleted card forever.
  const [shown] = useState(
    () => new WeakMap<ElementNode, { selected: boolean; node: ElementNode }>(),
  )
  const nodes = useMemo(
    () =>
      flow.nodes.map((node): ElementNode => {
        const moved = live.get(node.id)
        const on = selected.has(node.id)
        const cached = shown.get(node)
        if (!moved && cached?.selected === on) return cached.node
        const arrived = !initial.has(node.id)
        const next = {
          ...node,
          selected: on,
          ...(arrived ? { className: cn(node.className, 'space-arrived') } : {}),
        }
        if (!moved) {
          shown.set(node, { selected: on, node: next })
          return next
        }
        const width = moved.w ?? node.width
        const height = moved.h ?? node.height
        return {
          ...next,
          position: { x: moved.x ?? node.position.x, y: moved.y ?? node.position.y },
          width,
          height,
          measured: { width, height },
        }
      }),
    [flow.nodes, live, selected, shown, initial],
  )
  const [shownEdges] = useState(
    () => new WeakMap<CanvasEdgeType, { selected: boolean; edge: CanvasEdgeType }>(),
  )
  // A caption dragged along its line writes where it was let go — one stable callback per
  // connector, so handing it over does not make every edge a new object on every render.
  const applyLatest = useStableCallback(apply)
  const selectLatest = useStableCallback(selection.select)
  const [captions] = useState(
    () => new Map<string, { move: (at: number) => void; select: () => void }>(),
  )
  const captionOf = useCallback(
    (id: string) => {
      let caption = captions.get(id)
      if (!caption) {
        caption = {
          move: (at) => applyLatest([{ op: 'edge', id, labelAt: at }]),
          select: () => selectLatest([id]),
        }
        captions.set(id, caption)
      }
      return caption
    },
    [captions, applyLatest, selectLatest],
  )
  const edges = useMemo(
    (): CanvasEdgeType[] =>
      flow.edges.map((edge) => {
        const on = selected.has(edge.id)
        const cached = shownEdges.get(edge)
        if (cached?.selected === on) return cached.edge
        const caption = captionOf(edge.id)
        const next = {
          ...edge,
          selected: on,
          data: { ...edge.data, onLabelMove: caption.move, onLabelSelect: caption.select },
        }
        shownEdges.set(edge, { selected: on, edge: next })
        return next
      }),
    [flow.edges, selected, shownEdges, captionOf],
  )

  /** Where the dragged nodes' changes put everything that moves, snapped as one box. */
  const dragMoves = useCallback(
    (positions: Map<string, { x: number; y: number }>, current: Drag): Live => {
      const moves: Live = new Map()
      for (const [id, at] of positions) {
        moves.set(id, at)
        for (const follower of current.followers.get(id) ?? [])
          moves.set(follower.id, { x: at.x + follower.dx, y: at.y + follower.dy })
      }
      const boxes = [...moves].flatMap(([id, at]) => {
        const size = current.sizes.get(id)
        return size && at.x !== undefined && at.y !== undefined
          ? [{ x: at.x, y: at.y, ...size }]
          : []
      })
      if (suspendSnap.current || boxes.length === 0 || current.others.length === 0) {
        setGuides([])
        return moves
      }
      const snap = snapBox(boundsOfBoxes(boxes), current.others, SNAP_PX / camera.get().zoom)
      setGuides(snap.guides)
      if (snap.dx === 0 && snap.dy === 0) return moves
      for (const [id, at] of moves)
        moves.set(id, { x: (at.x ?? 0) + snap.dx, y: (at.y ?? 0) + snap.dy })
      return moves
    },
    [camera],
  )

  const onChanges = useCallback(
    (changes: readonly NodeChange[]) => {
      const selection: Record<string, boolean> = {}
      const positions = new Map<string, { x: number; y: number }>()
      const resized: Live = new Map()
      for (const change of changes) {
        if (change.type === 'select') selection[change.id] = change.selected
        else if (change.type === 'position' && change.position)
          positions.set(change.id, change.position)
        else if (change.type === 'dimensions' && change.resizing && change.dimensions)
          resized.set(change.id, { w: change.dimensions.width, h: change.dimensions.height })
      }
      applySelection(selection)
      if (positions.size === 0 && resized.size === 0) return
      const moves = drag.current ? dragMoves(positions, drag.current) : new Map(positions)
      const next = new Map(liveRef.current)
      for (const [id, value] of [...moves, ...resized]) next.set(id, { ...next.get(id), ...value })
      setLive(next)
    },
    [applySelection, dragMoves, setLive],
  )

  const startDrag = useCallback(
    (dragged: readonly { id: string }[]) => {
      const space = board.current.space
      const ids = dragged.map((node) => node.id)
      const followers = followersOf(space, ids, groupOf, spaceTypes)
      const moving = new Set([...ids, ...[...followers.values()].flat().map((f) => f.id)])
      const sizes = new Map(
        Object.entries(space.elements).map(([id, element]) => [id, { w: element.w, h: element.h }]),
      )
      const others = Object.entries(space.elements)
        .filter(([id]) => !moving.has(id))
        .map(([, element]) => element)
      drag.current = { followers, others, sizes }
    },
    [groupOf, board],
  )

  /** Write what the board shows now, and let the server's answer take over from the live view. */
  const commit = useCallback(
    (ops: readonly SpaceOp[]) => {
      if (ops.length) apply(ops)
      setLive(new Map())
    },
    [apply, setLive],
  )

  const finishDrag = useCallback(() => {
    drag.current = null
    setGuides([])
    const shown = [...liveRef.current].flatMap(([id, at]) =>
      at.x !== undefined && at.y !== undefined ? [{ id, x: at.x, y: at.y }] : [],
    )
    commit(dragOps(board.current.space, shown, spaceTypes))
  }, [commit, board])

  return {
    nodes,
    edges,
    selected,
    entered: selection.entered,
    guides,
    /** A drag or a resize is on screen and not yet written. */
    busy: live.size > 0,
    select: selection.select,
    onChanges,
    onEdgeChanges: selection.onEdgeChanges,
    onElementClick: selection.onElementClick,
    enterGroup: selection.enterGroup,
    leaveGroup: selection.leaveGroup,
    startDrag,
    finishDrag,
    commit,
  }
}

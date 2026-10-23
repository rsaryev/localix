import { useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  PanOnScrollMode,
  ReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type ReactFlowProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './canvas.css'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import {
  CAMERA_MOTION,
  CAMERA_REST_MS,
  CAMERA_ZOOM,
  snappedZoom,
  zoomAt,
  type ZoomLimits,
} from './camera'
import { CanvasControls } from './CanvasControls'
import { CanvasEdge } from './CanvasEdge'
import { CanvasMiniMap } from './CanvasMiniMap'
import {
  cameraCommand,
  isEditableTarget,
  isNodeTarget,
  keyboardHelp,
  type CanvasInteraction,
} from './keyboard'
import { usePinchZoom } from './usePinchZoom'
import { useCanvasCamera } from './useCanvasCamera'

/**
 * A board: the flow library's canvas with the camera every board in the app shares.
 *
 * The camera is the design tools' — two fingers or the wheel pan in any direction, a pinch or
 * ⌘/Ctrl + wheel zooms toward the cursor — and it is fixed here rather than offered as props,
 * because the point is that it is the same everywhere: the code map panned on scroll while the
 * database diagram zoomed on it, and only the code map answered a pinch in the desktop app.
 * Guessing mouse versus trackpad proved unpredictable, so there is
 * one scheme, taught once by the controls' hint.
 *
 * `interaction` is the one choice a board makes. `navigate` is a map: dragging the ground pans,
 * nothing moves or connects, a double-click on the ground fits. `edit` is a whiteboard: dragging
 * the ground draws a selection, Space + drag or the middle button pans, nodes move and connect.
 *
 * Wrap the board and whatever drives its camera in `CanvasProvider`: the camera hooks read the
 * provider's store, and a board that made its own would hide it from them.
 */
/**
 * The flow props a board may set, named one by one. Everything else is the camera's (fixed above)
 * or not yet needed by any board: inheriting the library's whole prop surface made this the kit's
 * widest contract by far, one nobody had reviewed. A board that needs another prop adds it here.
 */
type BoardProps =
  | 'nodes'
  | 'edges'
  | 'nodeTypes'
  | 'onNodesChange'
  | 'onEdgesChange'
  | 'onConnect'
  // A connector dropped on empty ground: a whiteboard creates a connected element there.
  | 'onConnectEnd'
  | 'onNodeClick'
  | 'onNodeDoubleClick'
  | 'onNodeMouseEnter'
  | 'onNodeMouseLeave'
  | 'onPaneClick'
  | 'onSelectionChange'
  // An editable board commits a move once, when the drag ends, and offers menus on its parts.
  | 'onNodeDragStart'
  | 'onNodeDragStop'
  | 'onSelectionDragStart'
  | 'onSelectionDragStop'
  | 'onNodeContextMenu'
  | 'onEdgeContextMenu'
  | 'onPaneContextMenu'
  | 'onSelectionContextMenu'
  | 'onEdgeClick'
  | 'onEdgeDoubleClick'
  | 'nodesDraggable'
  | 'nodesConnectable'
  | 'elementsSelectable'
  | 'zIndexMode'
  | 'onlyRenderVisibleElements'
  | 'snapToGrid'
  | 'snapGrid'
  | 'defaultViewport'

export interface CanvasProps<N extends Node = Node, E extends Edge = Edge> extends Pick<
  ReactFlowProps<N, E>,
  BoardProps
> {
  /** What the board is, for assistive technology; the keyboard help is appended. */
  label: string
  interaction?: CanvasInteraction
  zoomLimits?: ZoomLimits
  /** Extra edge types; an edge without a `type` is drawn by `CanvasEdge`. */
  edgeTypes?: EdgeTypes
  /** Hide the board while its camera is being placed (`useCameraPlacement`). */
  hidden?: boolean
  controls?: boolean
  /** Media viewers can use the camera without a board grid behind their content. */
  background?: boolean
  minimap?: boolean
  /** Floating UI over the board: status chips, a legend. */
  overlay?: ReactNode
  /**
   * A key the board's owner answers (the code map's Backspace goes up a level), asked before the
   * camera and never for a key typed into a control. Return true when handled.
   */
  onBoardKey?: (event: KeyboardEvent<HTMLDivElement>) => boolean
  /**
   * A double-click on the empty ground of an EDITABLE board, at a board position — where a
   * whiteboard creates a note. A navigable board fits the view on it instead.
   */
  onBoardDoubleClick?: (position: { x: number; y: number }) => void
  /**
   * The person's zoom that comes to rest NEAR 100 % settles at exactly 100 %, about the point
   * under the fingers — where text is drawn crispest. Only a gesture's rest: a fit that lands at
   * 97 % stays there.
   */
  snapZoom?: boolean
  className?: string
}

const ZOOM_KEYS = ['Meta', 'Control']
/** Middle and right button: on an editable board the left one selects. */
const PAN_BUTTONS = [1, 2]
const PRO_OPTIONS = { hideAttribution: true }

export function Canvas<N extends Node = Node, E extends Edge = Edge>({
  label,
  interaction = 'navigate',
  zoomLimits = CAMERA_ZOOM,
  edgeTypes,
  hidden = false,
  controls = true,
  background = true,
  minimap = false,
  overlay,
  onBoardKey,
  onBoardDoubleClick,
  snapZoom = false,
  className,
  ...flow
}: CanvasProps<N, E>) {
  const frame = useRef<HTMLDivElement>(null)
  const settle = useRef<number | null>(null)
  /** Where the person's last zoom gesture was, while one is in progress; null for the camera's own moves. */
  const gesture = useRef<{ x: number; y: number } | null>(null)
  const camera = useCanvasCamera()
  // A moving camera makes the viewport its own compositor layer (`will-change`), so the engine
  // scales and slides what is painted instead of repainting every node on every frame; the board
  // is painted sharp again a moment after the LAST frame — never on the library's move end: a
  // pinch in WebKit is one programmatic viewport per frame, each its own start and end, and a
  // layer made and unmade every frame stuttered worse than none.
  //
  // It is set on the viewport element itself, not as a mark on the frame for a stylesheet to
  // match: a mark on an ancestor makes the engine re-check the style of every node beneath it
  // when the motion starts and again when it ends, a hitch at both ends of every flight.
  const markMoving = () => {
    const element = frame.current
    const layer = element?.querySelector<HTMLElement>('.react-flow__viewport')
    if (!element || !layer) return
    if (layer.style.willChange !== 'transform') layer.style.willChange = 'transform'
    if (settle.current !== null) window.clearTimeout(settle.current)
    settle.current = window.setTimeout(() => {
      settle.current = null
      layer.style.willChange = ''
      const anchor = gesture.current
      gesture.current = null
      if (!snapZoom || !anchor) return
      const now = camera.get()
      const snapped = snappedZoom(now.zoom)
      if (snapped === null) return
      const box = element.getBoundingClientRect()
      const at = { x: anchor.x - box.left, y: anchor.y - box.top }
      camera.set(zoomAt(now, at, snapped, zoomLimits), { duration: CAMERA_MOTION.step })
    }, CAMERA_REST_MS)
  }
  // A zoom by hand — the wheel with ⌘/Ctrl or a pinch — is what may snap; the point it happened at
  // is what the snap zooms about. The held key is read from `ZOOM_KEYS`, the same set the library
  // zooms on, so the two cannot disagree about which wheel was a zoom; a trackpad pinch arrives as
  // a wheel with Control held, so it is covered on every platform.
  useEffect(() => {
    const element = frame.current
    if (!element || !snapZoom) return
    const wheel = (event: WheelEvent) => {
      if (ZOOM_KEYS.some((key) => event.getModifierState(key)))
        gesture.current = { x: event.clientX, y: event.clientY }
    }
    const pinch = (event: Event) => {
      const at = event as unknown as { clientX: number; clientY: number }
      gesture.current = { x: at.clientX, y: at.clientY }
    }
    element.addEventListener('wheel', wheel, { passive: true, capture: true })
    element.addEventListener('gesturechange', pinch)
    return () => {
      element.removeEventListener('wheel', wheel, { capture: true })
      element.removeEventListener('gesturechange', pinch)
    }
  }, [snapZoom])
  useEffect(
    () => () => {
      if (settle.current !== null) window.clearTimeout(settle.current)
    },
    [],
  )
  usePinchZoom(frame)
  const types = useMemo(() => ({ default: CanvasEdge, ...edgeTypes }), [edgeTypes])
  const editing = interaction === 'edit'

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target)) return
    if (onBoardKey?.(event)) return event.preventDefault()
    // On an editable board a key aimed at a node moves the node, not the view.
    if (editing && isNodeTarget(event.target)) return
    const command = cameraCommand(event)
    if (!command) return
    camera.run(command)
    event.preventDefault()
  }

  return (
    <div
      ref={frame}
      // A board has its own keyboard model: `application` tells assistive technology to pass
      // those keys through instead of reading them as navigation.
      role="application"
      tabIndex={0}
      aria-label={`${label}. ${keyboardHelp(interaction)}`}
      data-interaction={interaction}
      className={cn(
        'localix-canvas relative h-full min-h-0 w-full outline-none',
        hidden ? 'opacity-0' : 'opacity-100 transition-opacity duration-(--dur-fast)',
        className,
      )}
      onKeyDown={onKeyDown}
      onDoubleClick={(event) => {
        if (!(event.target as HTMLElement).classList.contains('react-flow__pane')) return
        if (!editing) camera.fit()
        else onBoardDoubleClick?.(camera.toBoard(event.clientX, event.clientY))
      }}
    >
      <ReactFlow<N, E>
        {...flow}
        edgeTypes={types}
        minZoom={zoomLimits.min}
        maxZoom={zoomLimits.max}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        // The library halves scroll deltas by default, so the board slid at half the speed of the
        // fingers on it; a trackpad pan, like a native scroll view's, tracks them one to one.
        panOnScrollSpeed={1}
        zoomActivationKeyCode={ZOOM_KEYS}
        zoomOnPinch
        zoomOnDoubleClick={false}
        panOnDrag={editing ? PAN_BUTTONS : true}
        selectionOnDrag={editing}
        // XYDrag measures screen pixels: hand tremor must stay a click at every zoom. Match
        // its click tolerance so a small movement does not swallow that click either.
        nodeDragThreshold={5}
        nodeClickDistance={5}
        nodesDraggable={flow.nodesDraggable ?? editing}
        nodesConnectable={flow.nodesConnectable ?? editing}
        elementsSelectable={flow.elementsSelectable ?? editing}
        // Any handle can start or end a connector on a whiteboard; which end is which is the
        // drag's direction, not the handle's.
        connectionMode={editing ? ConnectionMode.Loose : ConnectionMode.Strict}
        // Deleting is the owner's: it is an operation on the board's data (with undo), not a
        // change the library applies to its own copy of the nodes.
        deleteKeyCode={null}
        proOptions={PRO_OPTIONS}
        onMove={markMoving}
      >
        {background && <Background variant={BackgroundVariant.Dots} gap={20} size={1} />}
        {minimap && <CanvasMiniMap />}
      </ReactFlow>
      {overlay}
      {controls && <CanvasControls interaction={interaction} />}
    </div>
  )
}

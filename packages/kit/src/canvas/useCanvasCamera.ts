import { useMemo, useSyncExternalStore } from 'react'
import { useReactFlow, useStore, useStoreApi } from '@xyflow/react'
import {
  CAMERA_MOTION,
  CAMERA_REST_MS,
  FIT_MAX_ZOOM,
  FIT_PADDING,
  pacedDuration,
  stepZoom,
  zoomAt,
  type CameraViewport,
  type CanvasRect,
} from './camera'
import type { CameraCommand } from './keyboard'
import { prefersReducedMotion } from '../lib/use-reduced-motion'

/**
 * The camera a board's owner drives: every move a board makes, at the house pace and margins.
 *
 * The flow library's own `zoomIn` multiplies by 1.2 and its `fitView` takes a padding per call,
 * so two boards calling it directly already disagreed on both. Here a zoom lands on a step, a fit
 * leaves the same margin everywhere, and each kind of move has one duration.
 */
export interface CanvasCamera {
  get(): CameraViewport
  set(viewport: CameraViewport, options?: { duration?: number }): void
  panBy(dx: number, dy: number): void
  /** One zoom step about the centre of the view. */
  zoom(direction: 1 | -1): void
  /** 100%, about the centre of the view. */
  actualSize(): void
  /** Everything on the board, or only the nodes named. */
  fit(options?: { nodes?: readonly string[]; maxZoom?: number; duration?: number }): void
  /** The selected nodes; false when nothing is selected. */
  fitSelection(): boolean
  /** A rectangle of the world, filling the view inside the house margin. */
  focus(rect: CanvasRect, options?: { padding?: number; duration?: number }): void
  /** One node's frame; false when the node is not on the board. */
  focusNode(id: string, options?: { padding?: number; duration?: number }): boolean
  /** The board position under a screen point (a drop, a paste at the cursor). */
  toBoard(clientX: number, clientY: number): { x: number; y: number }
  /** The board position at the middle of the view, where content without a point lands. */
  centre(): { x: number; y: number }
  /** The view's size in screen pixels, or null while it has none (not laid out yet). */
  size(): { width: number; height: number } | null
  run(command: CameraCommand): void
}

/** Read at each move, so a preference changed while the board is open applies to the next one. */
const paced = (ms: number | undefined) => pacedDuration(ms, prefersReducedMotion())

export function useCanvasCamera(): CanvasCamera {
  const flow = useReactFlow()
  const store = useStoreApi()
  return useMemo(() => {
    const limits = () => {
      const { minZoom, maxZoom } = store.getState()
      return { min: minZoom, max: maxZoom }
    }
    const zoomAboutCentre = (zoom: number) => {
      const { width, height } = store.getState()
      const viewport = flow.getViewport()
      const next = zoomAt(viewport, { x: width / 2, y: height / 2 }, zoom, limits())
      void flow.setViewport(next, { duration: paced(CAMERA_MOTION.step) })
    }
    // A focus is a fit of one rectangle, so it keeps the fit's margin; it may enlarge (a dive into
    // a small box is meant to), up to the board's own limit.
    const focus: CanvasCamera['focus'] = (rect, options = {}) => {
      void flow.fitBounds(rect, {
        padding: options.padding ?? FIT_PADDING,
        duration: paced(options.duration ?? CAMERA_MOTION.focus),
      })
    }
    const camera: CanvasCamera = {
      get: () => flow.getViewport(),
      size() {
        const { width, height } = store.getState()
        return width > 0 && height > 0 ? { width, height } : null
      },
      set: (viewport, options = {}) =>
        void flow.setViewport(viewport, { duration: paced(options.duration) }),
      panBy(dx, dy) {
        const viewport = flow.getViewport()
        const next = { ...viewport, x: viewport.x + dx, y: viewport.y + dy }
        void flow.setViewport(next, { duration: paced(CAMERA_MOTION.pan) })
      },
      zoom: (direction) => zoomAboutCentre(stepZoom(flow.getZoom(), direction, limits())),
      actualSize: () => zoomAboutCentre(1),
      fit(options = {}) {
        void flow.fitView({
          padding: FIT_PADDING,
          maxZoom: options.maxZoom ?? FIT_MAX_ZOOM,
          duration: paced(options.duration ?? CAMERA_MOTION.fit),
          ...(options.nodes ? { nodes: options.nodes.map((id) => ({ id })) } : {}),
        })
      },
      fitSelection() {
        const selected = [...store.getState().nodeLookup.values()].filter((node) => node.selected)
        if (selected.length === 0) return false
        camera.fit({ nodes: selected.map((node) => node.id) })
        return true
      },
      focus,
      focusNode(id, options) {
        const node = flow.getInternalNode(id)
        if (!node) return false
        const { x, y } = node.internals.positionAbsolute
        const width = node.measured.width ?? node.width ?? 0
        const height = node.measured.height ?? node.height ?? 0
        focus({ x, y, width, height }, options)
        return true
      },
      toBoard: (clientX, clientY) => flow.screenToFlowPosition({ x: clientX, y: clientY }),
      centre() {
        const { width, height } = store.getState()
        const viewport = flow.getViewport()
        return {
          x: (width / 2 - viewport.x) / viewport.zoom,
          y: (height / 2 - viewport.y) / viewport.zoom,
        }
      },
      run(command) {
        if (command.kind === 'pan') camera.panBy(command.dx, command.dy)
        else if (command.kind === 'zoom') camera.zoom(command.direction)
        else if (command.kind === 'fit') camera.fit()
        else if (command.kind === 'fit-selection') camera.fitSelection()
        else camera.actualSize()
      },
    }
    return camera
  }, [flow, store])
}

/** The live zoom; re-renders on every zoom change, so read it only where the number is shown. */
export function useCanvasZoom(): number {
  return useStore((state) => state.transform[2])
}

/**
 * Whether the camera is zoomed out past `threshold` — semantic zoom: a node draws its summary
 * from afar and its detail up close.
 *
 * The answer changes when the camera RESTS on the other side, not the frame it crosses: a flight
 * from the whole board to one card crossed the threshold mid-way, every card on the board then
 * swapped its summary for its detail in that one frame — code highlighted, files read — and the
 * flight stalled there. A card now changes its level of detail once, after the camera stops,
 * when nothing is moving to stutter. While the answer would not change, a camera frame costs a
 * node one comparison.
 */
export function useZoomBelow(threshold: number): boolean {
  const store = useStoreApi()
  const resting = useMemo(() => createRestingZoom(store, threshold), [store, threshold])
  return useSyncExternalStore(resting.subscribe, resting.getSnapshot, resting.getSnapshot)
}

/**
 * The answer "is the camera zoomed out past `threshold`" for ONE reader, updated only when the
 * camera has rested. It starts from the store's zoom, and re-reads it when subscribed, so a
 * camera that moved between the render and the subscription is not missed.
 */
function createRestingZoom(store: ReturnType<typeof useStoreApi>, threshold: number) {
  let shown = store.getState().transform[2] < threshold
  return {
    getSnapshot: () => shown,
    subscribe: (notify: () => void) => {
      shown = store.getState().transform[2] < threshold
      let zoom = store.getState().transform[2]
      let timer: ReturnType<typeof setTimeout> | null = null
      const unsubscribe = store.subscribe((state) => {
        if (state.transform[2] === zoom) return
        zoom = state.transform[2]
        if (timer !== null) clearTimeout(timer)
        timer = null
        if (zoom < threshold === shown) return
        timer = setTimeout(() => {
          timer = null
          shown = store.getState().transform[2] < threshold
          notify()
        }, CAMERA_REST_MS)
      })
      return () => {
        unsubscribe()
        if (timer !== null) clearTimeout(timer)
      }
    },
  }
}

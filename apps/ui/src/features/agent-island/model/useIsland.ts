import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useReducedMotion } from '@localixai/kit/environment'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { useTauriEvent } from '@/shared/hooks/useTauriEvent'
import { ISLAND } from './geometry'
import { initialIsland, islandView, nextWake, reduceIsland } from './island'
import { ISLAND_OVERLAY_SELECTOR } from './islandOverlays'

/** The native silhouette follows the CSS motion and radius tokens instead of its own scale. */
function materialMotion(reducedMotion: boolean) {
  const material = document.querySelector('.lx-island-material')
  if (!material) return { durationMs: 0, radius: 24 }
  const style = getComputedStyle(material)
  return {
    durationMs: reducedMotion
      ? 0
      : Math.round(Number.parseFloat(style.transitionDuration || '0') * 1000) || 0,
    radius: Math.round(Number.parseFloat(style.borderBottomLeftRadius)) || 24,
    easing: style
      .getPropertyValue('--ease-emphasized')
      .match(/[\d.]+/g)
      ?.map(Number),
  }
}

export interface IslandOptions {
  /** Pending request keys, the one to answer first at the head. */
  queue: readonly string[]
  /** Any agent is running. */
  working: boolean
  /** A Localix workspace is focused: requests wait there instead of opening the island. */
  appFocused: boolean
  /** Measured content height plus the notch band. */
  height?: number
  /** The native panel reports pointer enter and leave instead of the webview. */
  nativePointer?: boolean
  /** Test seam: the clock every event is stamped with. */
  now?: () => number
}

/** Turns pointer, focus and native events into reducer events, and keeps the host's layout. */
export function useIsland({
  queue,
  working,
  appFocused,
  height = ISLAND.canvasHeight,
  nativePointer = false,
  now = Date.now,
}: IslandOptions) {
  const [state, dispatch] = useReducer(reduceIsland, undefined, initialIsland)
  const reducedMotion = useReducedMotion()
  const clock = useRef(now)
  useEffect(() => {
    clock.current = now
  })
  const view = islandView(state)

  const queueKey = queue.join('\n')
  useEffect(() => {
    dispatch({
      type: 'sync',
      now: clock.current(),
      queue: queueKey ? queueKey.split('\n') : [],
      working,
      appFocused,
    })
  }, [queueKey, working, appFocused])

  // One wake-up at a time, for whatever the state is waiting on (hover intent, leave, the hold).
  useEffect(() => {
    const wake = nextWake(state)
    if (wake === null) return
    const timer = setTimeout(
      () => dispatch({ type: 'tick', now: clock.current() }),
      Math.max(0, wake - clock.current()),
    )
    return () => clearTimeout(timer)
  }, [state])

  const fold = useCallback(() => dispatch({ type: 'fold', now: clock.current() }), [])
  const engage = useCallback(() => dispatch({ type: 'engage', now: clock.current() }), [])
  const activate = useCallback(() => dispatch({ type: 'activate', now: clock.current() }), [])
  const pointer = useCallback(
    (inside: boolean) => dispatch({ type: 'pointer', inside, now: clock.current() }),
    [],
  )

  // One serialized native layout request per phase or height change; stale targets are dropped.
  const revision = useRef(0)
  const layout = useRef<Promise<unknown>>(Promise.resolve())
  useEffect(() => {
    const current = ++revision.current
    let disposed = false
    layout.current = layout.current
      .catch(() => {})
      .then(() => {
        if (disposed || current !== revision.current) return
        return platformCapabilities().desktop.invoker()?.('island_set_layout', {
          layout: {
            expanded: view.open,
            height,
            mode: view.mode,
            ...materialMotion(reducedMotion),
          },
        })
      })
      .catch((error) => console.warn('[agent-island] layout update failed', error))
    return () => {
      disposed = true
    }
  }, [view.open, view.mode, height, reducedMotion])

  useTauriEvent('island-activate', activate)
  useTauriEvent('island-collapse', fold)
  // WebKit does not synthesize enter/leave after the panel toggles ignoresMouseEvents.
  useTauriEvent('island-pointer', (inside) => {
    if (typeof inside === 'boolean') pointer(inside)
  })

  // Clicking away or losing focus folds the card; the request stays pending in the app.
  const open = view.open
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        !event.target.closest(`.lx-island-open, ${ISLAND_OVERLAY_SELECTOR}`)
      )
        fold()
    }
    window.addEventListener('blur', fold)
    document.addEventListener('pointerdown', outside)
    return () => {
      window.removeEventListener('blur', fold)
      document.removeEventListener('pointerdown', outside)
    }
  }, [open, fold])

  return {
    ...view,
    engaged: state.engaged,
    engage,
    activate,
    fold,
    onPointerEnter: (event: ReactPointerEvent) => {
      if (!nativePointer && event.pointerType === 'mouse') pointer(true)
    },
    onPointerLeave: () => {
      if (!nativePointer) pointer(false)
    },
  }
}

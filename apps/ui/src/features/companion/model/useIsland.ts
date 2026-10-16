import {
  useCallback,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { AttentionItem } from '@localixai/api/client'
import { tauriInvoke } from '@/shared/lib/tauri'
import { useTauriEvent } from '@/shared/hooks/useTauriEvent'
import { useReducedMotion } from '@localixai/kit/environment'
import { ISLAND } from './geometry'
import { reduceIsland, RESTING_ISLAND } from './island'
import { ISLAND_OVERLAY_SELECTOR } from './islandOverlays'

/** Intent thresholds. Hover must be deliberate; leaving must survive a diagonal pointer path. */
export const ISLAND_TIMING = { hoverEnterMs: 400, hoverLeaveMs: 450, idleFoldMs: 15_000 } as const

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
  /** Measured content height plus the notch band. */
  height?: number
  /** The native panel reports pointer enter and leave instead of the webview. */
  nativePointer?: boolean
  /** Nothing works or waits: the resting island draws nothing until hover or the shortcut. */
  quiet?: boolean
}

export function useIsland(
  items: readonly AttentionItem[],
  { height = ISLAND.canvasHeight, nativePointer = false, quiet = false }: IslandOptions = {},
) {
  const [state, dispatch] = useReducer(reduceIsland, RESTING_ISLAND)
  const reducedMotion = useReducedMotion()
  const announced = useRef(new Set<string>())
  const hovering = useRef(false)
  const hoverBlocked = useRef(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(
    () => () => {
      clearTimeout(hoverTimer.current)
      clearTimeout(leaveTimer.current)
    },
    [],
  )
  const collapse = useCallback(() => {
    clearTimeout(hoverTimer.current)
    clearTimeout(leaveTimer.current)
    // A pointer still over the folded island must leave before hover may reopen it.
    hoverBlocked.current = hovering.current
    hovering.current = false
    dispatch({ type: 'collapse' })
  }, [])
  const onCollapse = useEffectEvent(collapse)
  useEffect(() => {
    if (!state.preview) clearTimeout(leaveTimer.current)
  }, [state.preview])

  // Fast Refresh changes the reveal policy without discarding refs; re-announce on entry.
  useEffect(() => {
    announced.current.clear()
  }, [])
  // A request that was not here before reveals itself once; a manual fold keeps it quiet.
  useEffect(() => {
    const urgent = items.find(
      (item) => item.kind === 'interaction' && !announced.current.has(item.key),
    )
    announced.current = new Set(items.map((item) => item.key))
    const selectedExists = items.some((item) => item.key === state.selectedKey)
    if (urgent && !selectedExists) dispatch({ type: 'select', key: urgent.key })
    else if (state.selectedKey && !selectedExists)
      dispatch({ type: 'resolved', key: state.selectedKey })
  }, [items, state.selectedKey])

  // One serialized native layout request per phase or height change; stale targets are dropped.
  const revision = useRef(0)
  const layout = useRef<Promise<unknown>>(Promise.resolve())
  useEffect(() => {
    const current = ++revision.current
    let disposed = false
    if (state.expanded) clearTimeout(hoverTimer.current)
    layout.current = layout.current
      .catch(() => {})
      .then(() => {
        if (disposed || current !== revision.current) return
        return tauriInvoke()?.('companion_set_expanded', {
          layout: {
            expanded: state.expanded,
            height,
            quiet,
            ...materialMotion(reducedMotion),
          },
        })
      })
      .catch((error) => console.warn('[agent-island] layout update failed', error))
    return () => {
      disposed = true
    }
  }, [state.expanded, height, quiet, reducedMotion])

  useTauriEvent('companion-toggle', () => {
    if (state.expanded) collapse()
    else dispatch({ type: 'activate' })
  })
  useTauriEvent('companion-activate', () => dispatch({ type: 'activate' }))
  useTauriEvent('companion-collapse', collapse)

  useEffect(() => {
    if (!state.expanded) return
    const fold = () => onCollapse()
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
  }, [state.expanded])

  // Safety net for a missed pointer exit: an idle, unfocused preview folds itself.
  useEffect(() => {
    if (!state.expanded || !state.preview) return
    const timer = setInterval(() => {
      if (!hovering.current) onCollapse()
    }, ISLAND_TIMING.idleFoldMs)
    return () => clearInterval(timer)
  }, [state.expanded, state.preview])

  const enter = () => {
    hovering.current = true
    clearTimeout(leaveTimer.current)
    clearTimeout(hoverTimer.current)
    if (!state.expanded && !hoverBlocked.current)
      hoverTimer.current = setTimeout(() => {
        if (hovering.current && !hoverBlocked.current) dispatch({ type: 'hover' })
      }, ISLAND_TIMING.hoverEnterMs)
  }
  const leave = () => {
    hoverBlocked.current = false
    hovering.current = false
    clearTimeout(hoverTimer.current)
    if (state.expanded && state.preview) {
      leaveTimer.current = setTimeout(() => {
        if (!hovering.current) collapse()
      }, ISLAND_TIMING.hoverLeaveMs)
    }
  }
  // WebKit does not synthesize enter/leave after the panel toggles ignoresMouseEvents.
  useTauriEvent('companion-pointer', (inside) => {
    if (typeof inside === 'boolean') (inside ? enter : leave)()
  })
  return {
    ...state,
    dispatch,
    collapse,
    onPointerEnter: (event: ReactPointerEvent) => {
      if (!nativePointer && event.pointerType === 'mouse') enter()
    },
    onPointerLeave: () => {
      if (!nativePointer) leave()
    },
  }
}

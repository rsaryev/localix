import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

/**
 * Synchronous visibility of the work item that owns a plugin subtree.
 *
 * Hosts commonly keep inactive work items mounted to preserve local state. This
 * signal lets extension hooks stop I/O before the browser's asynchronous
 * visibility observers run. Outside a host provider the surface is visible.
 */
const WorkItemVisibilityContext = createContext(true)

export function WorkItemVisibilityProvider({
  visible,
  children,
}: {
  visible: boolean
  children: ReactNode
}) {
  return (
    <WorkItemVisibilityContext.Provider value={visible}>
      {children}
    </WorkItemVisibilityContext.Provider>
  )
}

export function useWorkItemVisible(): boolean {
  return useContext(WorkItemVisibilityContext)
}

export interface VisiblePollingOptions {
  enabled?: boolean
  intervalMs: number
  onTick: () => void | Promise<unknown>
  refreshOnFocus?: boolean
  immediate?: boolean
  resetKey?: unknown
}

/**
 * Whether the code running RIGHT NOW was started by a timer rather than a person.
 *
 * The host credits a click with every request that starts in the next two seconds. A poll whose
 * tick landed in that window was therefore filed as the person's action: a Kubernetes poll failing
 * every second raised "Could not load the data" rows nobody asked for, and lent its trace to an
 * unrelated Docker problem. A poll's requests start synchronously inside its tick, so marking the
 * tick's synchronous run is enough for the host to tell the two apart.
 */
let backgroundDepth = 0

export function runAsBackgroundWork<T>(work: () => T): T {
  backgroundDepth += 1
  try {
    return work()
  } finally {
    backgroundDepth -= 1
  }
}

export function isBackgroundWork(): boolean {
  return backgroundDepth > 0
}

/** Visibility-gated, non-overlapping polling for contributed UI surfaces. */
export function useVisiblePolling({
  enabled = true,
  intervalMs,
  onTick,
  refreshOnFocus = false,
  immediate = false,
  resetKey,
}: VisiblePollingOptions): void {
  const workItemVisible = useWorkItemVisible()
  const active = enabled && workItemVisible
  const tickRef = useRef(onTick)
  const inFlight = useRef<Promise<unknown> | null>(null)

  useEffect(() => {
    tickRef.current = onTick
  }, [onTick])

  useEffect(() => {
    if (!active || typeof document === 'undefined') return
    const tick = () => {
      if (inFlight.current) return
      // A timer's work, not the person's — see `runAsBackgroundWork`.
      const result = runAsBackgroundWork(() => tickRef.current())
      if (!result || typeof result.then !== 'function') return
      const pending = Promise.resolve(result)
      inFlight.current = pending
      void pending.finally(() => {
        if (inFlight.current === pending) inFlight.current = null
      })
    }
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (!timer) timer = setInterval(tick, intervalMs)
    }
    const stop = () => {
      if (!timer) return
      clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        tick()
        start()
      } else {
        stop()
      }
    }
    if (immediate) tick()
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    if (refreshOnFocus && typeof window !== 'undefined') window.addEventListener('focus', tick)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      if (refreshOnFocus && typeof window !== 'undefined') window.removeEventListener('focus', tick)
    }
  }, [active, intervalMs, refreshOnFocus, immediate, resetKey])
}

/** Observe whether an element is intersecting; SSR and unattached refs default visible. */
export function useElementVisible<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      const latest = entries[entries.length - 1]
      if (latest) setVisible(latest.isIntersecting)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, visible]
}

/** Fire when a sentinel approaches the viewport; disabled observers are disconnected. */
export function useInfiniteScroll(onReach: () => void, enabled: boolean) {
  const observerRef = useRef<IntersectionObserver | null>(null)
  const onReachRef = useRef(onReach)

  useEffect(() => {
    onReachRef.current = onReach
  }, [onReach])

  return useCallback(
    (node: HTMLElement | null) => {
      observerRef.current?.disconnect()
      observerRef.current = null
      if (!node || !enabled || typeof IntersectionObserver === 'undefined') return
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) onReachRef.current()
        },
        { rootMargin: '200px' },
      )
      observer.observe(node)
      observerRef.current = observer
    },
    [enabled],
  )
}

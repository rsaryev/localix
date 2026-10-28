import {
  useCallback,
  useEffect,
  useInsertionEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import {
  miniAppCompletion,
  miniAppEditor,
  miniAppFiles,
  miniAppSessions,
  miniAppWorkspace,
  type MiniAppSession,
  type MiniAppTextInputCompletion,
  type MiniAppTextInputCompletionInput,
  type MiniAppWorkspaceChange,
  type MiniAppWorkspaceSnapshot,
} from './runtime'

/**
 * Run `onChange` when files change under `sessionId`'s workspace (see `miniAppFiles.watchWorkspace`)
 * and answer whether that signal is LIVE for the chat: `null` until the host has answered, then
 * true or false. A fully covered resource needs polling only while the signal is unavailable. `onChange` may change identity on every render; only
 * `sessionId`, `enabled` and `windowMs` re-subscribe.
 */
export function useMiniAppWorkspaceChanges(
  sessionId: string | null,
  onChange: (change: MiniAppWorkspaceChange) => void,
  options: { windowMs?: number; enabled?: boolean } = {},
): boolean | null {
  const { windowMs, enabled = true } = options
  const handler = useRef(onChange)
  useEffect(() => {
    handler.current = onChange
  }, [onChange])
  const [live, setLive] = useState<{ sessionId: string; live: boolean } | null>(null)
  useEffect(() => {
    if (!sessionId || !enabled) return
    try {
      const stop = miniAppFiles.watchWorkspace(sessionId, (change) => handler.current(change), {
        windowMs,
        onLive: (next) => setLive({ sessionId, live: next }),
      })
      // An answer belongs to the subscription that got it: ending one clears it, so a new one
      // starts "unknown" until the host answers again.
      return () => {
        stop()
        setLive(null)
      }
    } catch {
      // oxlint-disable-next-line react/set-state-in-effect -- the host refused the watch outright: that IS the answer (no live signal), and it exists only here
      setLive({ sessionId, live: false })
      return undefined
    }
  }, [sessionId, enabled, windowMs])
  // An answer for another chat (the hook moved on) says nothing about this one.
  // `sessionId` may be null while `live` is null too: compare only an answer that exists.
  const answer = enabled ? live : null
  return answer?.sessionId === sessionId ? (answer?.live ?? null) : null
}

/** Session roster through the stable, store-agnostic mini app runtime port. */
export function useMiniAppSessions(): readonly MiniAppSession[] {
  return useSyncExternalStore(miniAppSessions.subscribe, miniAppSessions.list, miniAppSessions.list)
}

/**
 * Ghost-text completion for a mini app's own text field — the same lifecycle, shared model call and
 * working-set context as the chat composer. Declare the surface on the backend subsystem
 * (`textInputCompletionSurfaces`), then call this with the field's live state.
 */
export function useMiniAppTextInputCompletion(
  input: MiniAppTextInputCompletionInput,
): MiniAppTextInputCompletion {
  return miniAppCompletion.useTextInput(input)
}

/** Whether the host's edit-prediction route is enabled. */
export function useMiniAppEditPredictionEnabled(): boolean {
  return useSyncExternalStore(
    miniAppEditor.subscribe,
    miniAppEditor.predictionEnabled,
    miniAppEditor.predictionEnabled,
  )
}

/**
 * The live workspace snapshot — open work items and which item is focused.
 *
 * A mini app launcher needs both to render "open this" versus "you are already here", and
 * reading them from the host's grid store instead is exactly the coupling the seam removes.
 */
export function useMiniAppWorkspace(): MiniAppWorkspaceSnapshot {
  return useSyncExternalStore(
    miniAppWorkspace.subscribe,
    miniAppWorkspace.getSnapshot,
    miniAppWorkspace.getSnapshot,
  )
}

/**
 * A ref that holds the LATEST value, for callbacks handed once to a library that keeps them, so
 * the callback keeps its identity yet reads the value as it is when it runs.
 *
 * It is written in an insertion effect, never while rendering: that runs before any layout effect
 * of the same commit, so a child's layout effect already finds the new value, and a render that
 * React throws away leaves nothing behind. Read `.current` only in events and effects.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const latest = useRef(value)
  useInsertionEffect(() => {
    latest.current = value
  })
  return latest
}

/** A function whose identity never changes but which always runs the latest `fn` given to it. */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R) {
  const latest = useLatest(fn)
  return useCallback((...args: A) => latest.current(...args), [latest])
}

/**
 * `value` once it has stopped changing for `delay` ms: a search reads after the last key, not on
 * every one. An earlier value never lands after a later one. A `delay` of 0 or less passes the
 * value straight through.
 */
export function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (delay <= 0) return
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return delay <= 0 ? value : settled
}

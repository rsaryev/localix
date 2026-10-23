import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
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
    setLive(null)
    try {
      return miniAppFiles.watchWorkspace(sessionId, (change) => handler.current(change), {
        windowMs,
        onLive: (next) => setLive({ sessionId, live: next }),
      })
    } catch {
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

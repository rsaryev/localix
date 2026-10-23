import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  pluginCompletion,
  pluginEditor,
  pluginFiles,
  pluginSessions,
  pluginWorkspace,
  type PluginSession,
  type PluginTextInputCompletion,
  type PluginTextInputCompletionInput,
  type PluginWorkspaceChange,
  type PluginWorkspaceSnapshot,
} from './runtime'

/**
 * Run `onChange` when files change under `sessionId`'s workspace (see `pluginFiles.watchWorkspace`)
 * and answer whether that signal is LIVE for the chat: `null` until the host has answered, then
 * true or false. A fully covered resource needs polling only while the signal is unavailable. `onChange` may change identity on every render; only
 * `sessionId`, `enabled` and `windowMs` re-subscribe.
 */
export function usePluginWorkspaceChanges(
  sessionId: string | null,
  onChange: (change: PluginWorkspaceChange) => void,
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
      return pluginFiles.watchWorkspace(sessionId, (change) => handler.current(change), {
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

/** Session roster through the stable, store-agnostic plugin runtime port. */
export function usePluginSessions(): readonly PluginSession[] {
  return useSyncExternalStore(pluginSessions.subscribe, pluginSessions.list, pluginSessions.list)
}

/**
 * Ghost-text completion for a plugin's own text field — the same lifecycle, shared model call and
 * working-set context as the chat composer. Declare the surface on the backend subsystem
 * (`textInputCompletionSurfaces`), then call this with the field's live state.
 */
export function usePluginTextInputCompletion(
  input: PluginTextInputCompletionInput,
): PluginTextInputCompletion {
  return pluginCompletion.useTextInput(input)
}

/** Whether the host's edit-prediction route is enabled. */
export function usePluginEditPredictionEnabled(): boolean {
  return useSyncExternalStore(
    pluginEditor.subscribe,
    pluginEditor.predictionEnabled,
    pluginEditor.predictionEnabled,
  )
}

/**
 * The live workspace snapshot — open work items and which item is focused.
 *
 * A plugin launcher needs both to render "open this" versus "you are already here", and
 * reading them from the host's grid store instead is exactly the coupling the seam removes.
 */
export function usePluginWorkspace(): PluginWorkspaceSnapshot {
  return useSyncExternalStore(
    pluginWorkspace.subscribe,
    pluginWorkspace.getSnapshot,
    pluginWorkspace.getSnapshot,
  )
}

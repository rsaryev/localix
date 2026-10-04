import { useCallback, useMemo, useState } from 'react'
import {
  isSystemContextSelectionBinding,
  latestSystemContextBindings,
  selectedSystemContextTokens,
  systemContextSelectionBinding,
} from '@localixai/agent'

type SystemContextMessages = Parameters<typeof latestSystemContextBindings>[0]

/** Current system-event bindings plus the user's durable per-slot inclusion choices. */
export function useSystemContextManifest(
  sessionId: string | null,
  messages: SystemContextMessages,
) {
  const [disabledBySession, setDisabledBySession] = useState<Map<string, ReadonlySet<string>>>(
    () => new Map(),
  )
  const bindings = useMemo(
    () =>
      latestSystemContextBindings(messages).filter(
        (binding) => !isSystemContextSelectionBinding(binding),
      ),
    [messages],
  )
  const persistedSelection = useMemo(() => {
    const selection = [...messages]
      .reverse()
      .flatMap((message) => message.bindings ?? [])
      .find((binding) => binding.kind === 'context' && isSystemContextSelectionBinding(binding))
    return selection?.kind === 'context' ? selectedSystemContextTokens(selection) : null
  }, [messages])
  const disabled = useMemo(() => {
    if (!sessionId) return new Set<string>()
    const local = disabledBySession.get(sessionId)
    if (local) return local
    if (!persistedSelection) return new Set<string>()
    return new Set(
      bindings
        .filter((binding) => !persistedSelection.has(binding.target.token))
        .map((binding) => binding.target.token),
    )
  }, [bindings, disabledBySession, persistedSelection, sessionId])
  const enabled = useMemo(
    () => bindings.filter((binding) => !disabled.has(binding.target.token)),
    [bindings, disabled],
  )
  const enabledIds = useMemo(() => new Set(enabled.map((binding) => binding.id)), [enabled])
  const setEnabled = useCallback(
    (bindingId: string, include: boolean) => {
      if (!sessionId) return
      const token = bindings.find((binding) => binding.id === bindingId)?.target.token
      if (!token) return
      setDisabledBySession((previous) => {
        const next = new Map(previous)
        const nextDisabled = new Set(next.get(sessionId) ?? disabled)
        if (include) nextDisabled.delete(token)
        else nextDisabled.add(token)
        next.set(sessionId, nextDisabled)
        return next
      })
    },
    [bindings, disabled, sessionId],
  )
  const selectionBinding = useMemo(
    () =>
      sessionId && bindings.length > 0
        ? systemContextSelectionBinding(
            sessionId,
            enabled.map((binding) => binding.target.token),
          )
        : undefined,
    [bindings.length, enabled, sessionId],
  )
  return { bindings, enabledIds, setEnabled, selectionBinding }
}

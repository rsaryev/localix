import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { composerDrafts } from '@/shared/lib/composerDrafts'
import { useViewState } from '@/shared/lib/view-state/useViewState'
import { viewStateStore } from '@/shared/lib/view-state/store'

/** Server-owned draft, with the existing local cache for migration and offline recovery. */
export function useComposerDraft(sessionId: string | null) {
  const [neutral, setNeutral] = useState('')
  const state = useViewState(sessionId ? { kind: 'draft', key: sessionId } : null)
  const cached = sessionId ? composerDrafts.get(sessionId) : ''
  const value = state.value && 'text' in state.value ? state.value.text : null
  const prompt = sessionId
    ? (value ?? (!state.loaded || state.revision === 0 ? cached : ''))
    : neutral
  useEffect(() => {
    if (!sessionId || !state.loaded) return
    if (state.revision === 0 && state.value === null && cached) {
      viewStateStore.set({ kind: 'draft', key: sessionId }, { text: cached })
    } else composerDrafts.set(sessionId, prompt)
  }, [sessionId, state.loaded, state.revision, state.value, cached, prompt])
  const setPrompt: Dispatch<SetStateAction<string>> = useCallback(
    (next) => {
      if (!sessionId) {
        setNeutral(next)
        return
      }
      const address = { kind: 'draft' as const, key: sessionId }
      const current = viewStateStore.snapshot(address).value
      const text = current && 'text' in current ? current.text : composerDrafts.get(sessionId)
      const updated = typeof next === 'function' ? next(text) : next
      composerDrafts.set(sessionId, updated)
      viewStateStore.set(address, { text: updated })
    },
    [sessionId],
  )
  return [prompt, setPrompt, state] as const
}

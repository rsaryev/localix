import { useEffect } from 'react'
import useSWR from 'swr'
import { useRevalidateOnResources } from '@/shared/api/resourceGeneration'
import { modsApi } from '@/shared/api/modsApi'
import { composerBus } from '@/shared/lib/composerBus'
import { offerComposerSuggestion } from '@/shared/lib/composerSuggestions'

/**
 * A conversation's mods at its prompt box: each draft a mod filled goes into the box once, the
 * suggestion a mod offered becomes its ghost text, and the mods' status lines come back for the
 * composer's status item. Re-read on the `mods` poke.
 */
export function useModSession(sessionId: string | null) {
  const key = sessionId ? `mod-session:${sessionId}` : null
  useRevalidateOnResources(key ?? 'mod-session:none', ['mods'])
  const { data } = useSWR(key, () => modsApi.session(sessionId!))

  useEffect(() => {
    if (!sessionId || !data?.fills.length) return
    for (const fill of data.fills)
      composerBus.insert({
        sessionId,
        text: fill.text,
        replace: fill.mode === 'replace',
        inline: fill.mode === 'insert',
      })
    void modsApi.taken(sessionId, { fills: data.fills.map((fill) => fill.id) }).catch(() => {})
  }, [sessionId, data?.fills])

  const suggestion = data?.suggestion ?? null
  useEffect(() => {
    if (!sessionId) return
    offerComposerSuggestion(
      sessionId,
      suggestion
        ? {
            text: suggestion,
            settle: () => {
              offerComposerSuggestion(sessionId, null)
              void modsApi.taken(sessionId, { suggestion: true }).catch(() => {})
            },
          }
        : null,
    )
  }, [sessionId, suggestion])

  return data?.statuses ?? {}
}

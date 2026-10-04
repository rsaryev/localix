/**
 * The conversation's own party, as `@`-completion candidates — ONE source for every field that
 * addresses participants in text: the composer's `@` completion.
 *
 * Its own hook because a second field that offers mentions would otherwise copy the roster read,
 * and two copies drift: one offering a renamed agent's old label, or a one-to-one's lone member
 * the other leaves out. Only a ROOM offers any: a one-to-one has a single member and nothing to
 * address, and offering agents who are not in the conversation would insert a handle nobody here
 * answers to. Read from the store the composer already subscribes to — no request of its own.
 */
import { useMemo } from 'react'
import { isMultiParticipant } from '@/shared/api/contracts'
import { pluginContribSnapshot } from '@/shared/contrib/enabledPlugins'
import { usePluginContribVersion } from '@/shared/contrib/usePluginContribVersion'
import { findSessionInState } from '../../model/findSession'
import { useChatStore } from '../../model/store'
import type { AgentCandidate } from './atRefAgentRows'

export function useConversationAgentCandidates(sessionId: string | null): AgentCandidate[] {
  const partyKey = useChatStore((state) => {
    const agents = sessionId ? findSessionInState(state, sessionId)?.agents : undefined
    return agents && isMultiParticipant({ agents })
      ? agents.map((a) => a.handle).join('\u0000')
      : ''
  })
  const contribVersion = usePluginContribVersion()
  return useMemo<AgentCandidate[]>(() => {
    if (!partyKey) return []
    const registry = pluginContribSnapshot().document?.agents ?? []
    return partyKey.split('\u0000').map((handle) => ({
      handle,
      name: registry.find((agent) => agent.record.handle === handle)?.record.label?.trim(),
    }))
    // `contribVersion` is a dependency, not a value: a capability publish can rename an agent.
  }, [partyKey, contribVersion])
}

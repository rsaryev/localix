/**
 * atRefAgentRows — the `@`-menu rows for the conversation's OWN participants.
 *
 * Its own module because it answers a different question from the file/resource builders next
 * to it: not "what in the workspace does this name" but "who in this room does this name". The
 * two share the ranker and the row shape, and nothing else.
 */
import { ALL_MENTION_HANDLE } from '@localixai/agent/agents'

import type { AtRefSuggestion } from './atRefSuggestions'
import { rankRows } from './atRefSuggestions'

/** A participant the composer can address: its handle, and the name people know it by. */
export interface AgentCandidate {
  handle: string
  name?: string
}

/**
 * The members of THIS conversation that a partial `@…` names — offered above the file search,
 * because in a room "@qa" is far more often a colleague than a folder called qa.
 *
 * Only the conversation's own party, never the whole registry: a mention reaches the members
 * of the room it is typed into, and offering agents who are not here would insert a handle
 * nobody in the conversation answers to. A one-to-one has a single member and nothing to
 * address, so the caller passes no candidates and this builds nothing — `@all` included, since
 * "everyone" in a conversation of one is the one agent already answering.
 */
export function buildAgentRows(
  candidates: readonly AgentCandidate[],
  partial: string,
): AtRefSuggestion[] {
  if (candidates.length === 0) return []
  // `@all` is offered with the members rather than among the ref kinds below, because it answers
  // the same question they do — who is this message for — and it is ranked like any other handle
  // so typing `@a` does not bury a colleague whose name starts with the same letter.
  const everyone: AgentCandidate = { handle: ALL_MENTION_HANDLE, name: 'Everyone in the room' }
  return rankRows([...candidates, everyone], partial, (agent) => [
    { text: agent.handle, weight: 1 },
    { text: agent.name ?? '', weight: 0.8 },
  ]).map((agent) => ({
    id: `agent:${agent.handle}`,
    label: `@${agent.handle}`,
    description:
      agent.handle === ALL_MENTION_HANDLE
        ? 'everyone in the room'
        : agent.name && agent.name !== agent.handle
          ? agent.name
          : 'participant',
    kind: 'agent' as const,
    handle: agent.handle,
  }))
}

import { participantAgentId } from '../../../../db/participant'
import type { PersistedMessage } from '../../contracts'
import type { SessionRecord } from '../../repository'
import type { RunScope } from '../run-contract'

/** Volatile guidance that distinguishes a colleague handoff from a new human instruction. */
export function buildTurnTriggerContext(
  scope: RunScope,
  session: Pick<SessionRecord, 'agents'>,
  history: readonly PersistedMessage[],
  contextBoundaryId?: string,
): string | undefined {
  if (scope.turnTrigger?.kind !== 'colleague-request') return undefined
  if (contextBoundaryId && scope.turnTrigger.messageIds.includes(contextBoundaryId)) {
    return [
      '# Current turn',
      'This turn continues a newly saved session topic. Work toward the goal in the system prompt.',
      'The previous topic is available only through its saved summary; its triggering message is outside the current history.',
    ].join('\n')
  }

  const triggerIds = new Set(scope.turnTrigger.messageIds)
  const handles = new Set<string>()
  for (const message of history) {
    if (!triggerIds.has(message.id)) continue
    const agentId = participantAgentId(message.payload.from)
    const handle =
      message.payload.authorSnapshot?.handle ??
      session.agents.find((agent) => agent.agentId === agentId)?.handle
    if (handle) handles.add(handle)
  }
  const senders = handles.size
    ? [...handles].map((handle) => `@${handle}`).join(', ')
    : 'a colleague'
  const self = session.agents.find((agent) => agent.agentId === scope.speakerAgentId)?.handle

  return [
    '# Current turn',
    `This turn was explicitly queued through conversation_control by ${senders}.`,
    `Respond as ${self ? `@${self}` : 'the addressed participant'} to the triggering colleague message in the shared transcript.`,
    'The earlier human message remains context. If it addressed another agent, do not take over that agent’s role.',
  ].join('\n')
}

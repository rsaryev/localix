import { participantAgentId } from '../../../../db/participant'
import type { PersistedMessage } from '../../contracts'
import type { SessionRecord } from '../../repository'
import type { RunScope } from '../run-contract'

/** Volatile guidance that distinguishes a colleague's request from a new human instruction. */
export function buildTurnTriggerContext(
  scope: RunScope,
  session: Pick<SessionRecord, 'agents'>,
  history: readonly PersistedMessage[],
): string | undefined {
  if (scope.turnTrigger?.kind !== 'colleague-request') return undefined
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
  const senders = handles.size ? [...handles].join(', ') : 'a colleague'
  const self = session.agents.find((agent) => agent.agentId === scope.speakerAgentId)?.handle
  const as = self ?? 'the addressed participant'

  return [
    '# Current turn',
    scope.turnTrigger.report
      ? `${senders} reported back on work you handed out. As ${as}, act on the report in the shared transcript. An @mention gives whoever it names another turn; a name without @ does not.`
      : `${senders} handed you the floor. As ${as}, act on their latest message in the shared transcript.`,
    'The earlier human message remains context. If it addressed another agent, do not take over that agent’s role.',
  ].join('\n')
}

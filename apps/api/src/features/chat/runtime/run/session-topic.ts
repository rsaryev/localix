import { sessionTopicSchema, type SessionTopic } from '../../../agent-core/session-topic'
import { toSessionSummary, type SessionRecord } from '../../repository'
import { conversationLeader, rosterLeadership } from '../conversation-strategy'
import type { RunEnv } from './types'

type TopicEnv = Pick<RunEnv, 'repo' | 'deps'>

export async function assertTopicAuthor(
  env: TopicEnv,
  userId: string,
  session: SessionRecord,
  agentId: string,
): Promise<void> {
  if (session.sessionKind !== 'chat') throw new Error('Only chat sessions can change their topic.')
  const priorities = await rosterLeadership(
    env.deps.listRegistryAgents,
    userId,
    session.projectId,
  )()
  const leader = conversationLeader(session, priorities)
  if (leader?.agentId !== agentId) {
    throw new Error('Only the conversation leader or sole participant can change the topic.')
  }
}

/** Only shared session fields change. No colleague tool output or private lane is loaded. */
export async function changeSessionTopic(
  env: TopicEnv,
  userId: string,
  session: SessionRecord,
  topic: SessionTopic,
): Promise<SessionRecord> {
  const parsed = sessionTopicSchema.parse(topic)
  if (
    !(await env.repo.updateSessionTopic(
      userId,
      session.id,
      session,
      parsed,
      new Date().toISOString(),
    ))
  ) {
    throw new Error('The session topic changed while this request was being applied; reload it.')
  }
  const updated = await env.repo.getSession(userId, session.id)
  if (!updated) throw new Error('Conversation no longer exists.')
  env.deps.streamRegistry.publish(userId, session.id, {
    type: 'session.updated',
    session: toSessionSummary(updated),
  })
  return updated
}

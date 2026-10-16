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

/** The speaker's place in the conversation: alone, leading the group, or a member of it. */
export async function speakerRole(
  env: TopicEnv,
  userId: string,
  session: Pick<SessionRecord, 'agents' | 'projectId'>,
  agentId: string,
): Promise<'leader' | 'member' | 'solo'> {
  if (session.agents.length <= 1) return 'solo'
  const priorities = await rosterLeadership(
    env.deps.listRegistryAgents,
    userId,
    session.projectId,
  )()
  return conversationLeader(session, priorities)?.agentId === agentId ? 'leader' : 'member'
}

/** Save shared fields and cut history together. No colleague tool output or private lane is loaded. */
export async function changeSessionTopic(
  env: TopicEnv,
  userId: string,
  session: SessionRecord,
  topic: SessionTopic,
  boundary: { messageId: string } | undefined,
): Promise<SessionRecord> {
  const parsed = sessionTopicSchema.parse(topic)
  if (
    !(await env.repo.updateSessionTopic(
      userId,
      session.id,
      session,
      parsed,
      new Date().toISOString(),
      boundary,
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
  env.deps.streamRegistry.publish(userId, session.id, {
    type: 'session_model_view.updated',
    sessionId: session.id,
    modelView: null,
  })
  return updated
}

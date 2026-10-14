import { USER_PARTICIPANT } from '../../../../db/participant'
import type { SessionTopic } from '../../../agent-core/session-topic'
import type { SetTopicPort } from '../../../agent-core/tools/set-topic'
import type { PersistedMessage } from '../../contracts'
import { assertTopicAuthor, changeSessionTopic } from './session-topic'
import type { RunEnv, RunParams } from './types'

/**
 * The last row of the previous topic: the one just before the person's latest message, which is
 * the request that opens the new topic and stays in every later run's history with the work done
 * on it. None when that request is the conversation's first row.
 */
export function topicBoundary(history: readonly PersistedMessage[]): string | undefined {
  for (let index = history.length - 1; index >= 0; index--) {
    const payload = history[index]!.payload
    if (payload.role === 'user' && payload.from === USER_PARTICIPANT && !payload.isInternal) {
      return index > 0 ? history[index - 1]!.id : undefined
    }
  }
  return undefined
}

/** Saves the topic once per turn, for the leader or sole participant of a chat. */
export function createSetTopicPort(
  env: Pick<RunEnv, 'repo' | 'deps'>,
  params: RunParams,
): SetTopicPort {
  let saved = false
  return {
    async save(_toolCallId: string, topic: SessionTopic) {
      if (saved) throw new Error('The topic is already set for this turn.')
      const current = await env.repo.getSession(params.userId, params.session.id)
      if (!current) throw new Error('Conversation no longer exists.')
      await assertTopicAuthor(env, params.userId, current, params.scope.speakerAgentId)
      const boundary = topicBoundary(params.historyMessages)
      await changeSessionTopic(
        env,
        params.userId,
        current,
        topic,
        boundary ? { messageId: boundary } : undefined,
      )
      saved = true
    },
  }
}

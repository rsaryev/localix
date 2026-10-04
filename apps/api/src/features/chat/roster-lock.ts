/**
 * WHEN A CONVERSATION'S PARTICIPANTS MAY BE FIXED — the one rule, shared by the server that
 * refuses the change and the composer that offers it.
 *
 * Fixing the participants is a decision about what a conversation IS, like who it is with: an
 * agent that was told mid-conversation it may no longer invite a colleague would be reading a
 * history in which it did. So the choice is open until the conversation starts and settled from
 * then on.
 *
 * "Started" is the first message somebody AUTHORED — the person or an agent. The lines the
 * product writes itself (`from: 'system'`: "@qa joined", a mode change) do not count: adding a
 * participant before the first message writes one, and counting it would close the choice the
 * moment the person used the roster it is about.
 *
 * A browser-safe leaf (`@localixai/api/roster-lock`): the two sides disagreeing about which
 * rows count is exactly the drift one owner prevents.
 */
import { SYSTEM_PARTICIPANT } from '../../db/participant'

/** Has anyone said anything in this conversation yet? */
export function hasConversationStarted(messages: readonly { from?: string | null }[]): boolean {
  return messages.some((message) => Boolean(message.from) && message.from !== SYSTEM_PARTICIPANT)
}

/** The refusal a locked conversation answers any membership change with. */
export const ROSTER_LOCKED_MESSAGE =
  "The person fixed this conversation's participants: nobody can be invited or removed."

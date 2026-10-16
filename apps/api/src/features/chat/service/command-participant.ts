/**
 * WHICH PARTICIPANT A SLASH COMMAND IS ABOUT.
 *
 * `/model` and `/reasoning` act on ONE participant, and they used to act on the
 * first one — whoever joined first, not whoever the person was talking to. The rule is now:
 *
 *   `/model @qa sonnet`  → @qa, explicitly;
 *   `/model sonnet`      → the participant the person's unaddressed words go to right now.
 *
 * The address is the conversation's own mention grammar (`agent-mentions.ts`), so a command
 * addresses a participant exactly the way a message does.
 */
import { mentionedHandles } from '../agent-mentions'
import type { SessionAgentRoute, SessionRecord } from '../repository'
import { speakingParticipant } from '../runtime/conversation-dispatch'
import type { LeadershipPriorities } from '../runtime/conversation-strategy'
import { resolveExistingMessages, type ExistingMessages } from './run-agent'

export interface CommandTarget {
  participant: SessionAgentRoute
  /** The argument with the leading `@handle` removed. */
  rest: string
}

export async function commandTarget(
  session: SessionRecord,
  history: ExistingMessages,
  argument: string,
  priorities: LeadershipPriorities,
): Promise<CommandTarget | undefined> {
  const trimmed = argument.trim()
  // The remainder keeps its own whitespace: after `/reasoning high` comes a task, newlines and all.
  const [, first = '', remainder = ''] = /^(\S*)\s*([\s\S]*)$/.exec(trimmed) ?? []
  if (first.startsWith('@')) {
    const [handle] = mentionedHandles(
      first,
      session.agents.map((member) => member.handle),
    )
    const named = session.agents.find((member) => member.handle === handle)
    if (named) return { participant: named, rest: remainder.trim() }
  }
  // One participant needs no history to know who it is.
  const participant =
    session.agents.length <= 1
      ? session.agents[0]
      : await speakingParticipant(session, await resolveExistingMessages(history, []), priorities)
  return participant ? { participant, rest: trimmed } : undefined
}

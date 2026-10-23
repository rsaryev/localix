import { DEFAULT_AGENT_HANDLE } from '@localixai/api/participant'
import { isMultiParticipant, type UiSession } from '@/shared/api/contracts'

/**
 * The chat list's third axis: who the conversation is with.
 *
 * Scope (global / a project) stays orthogonal and is chosen elsewhere. Inside a scope, chats
 * gather under the agent they are with — the structure a messenger gets for free, and which we
 * have to build because we are the other way round from one: a messenger has one chat per
 * person, we routinely have twenty chats with one agent.
 */
export interface AgentGroup {
  /**
   * The group's identity: one agent's handle, or the conversation key of several. Opaque — read
   * {@link groupParticipants} for who is in it; labels are resolved from the registry, not here.
   */
  handle: string
  /** Already ordered: whatever the list's own sort mode decided, untouched. */
  sessions: UiSession[]
  /** The newest activity in the group, or 0 when it has no chats yet. Orders the groups. */
  updatedAt: number
}

/**
 * Marks a group key as naming a SET of agents rather than one. A control character, so no
 * handle can ever collide with it.
 */
const CONVERSATION_KEY_PREFIX = '\u0000conversation:'

/**
 * WHO A CHAT IS WITH — the key its heading gathers under.
 *
 * A one-to-one answers with its agent's handle, exactly as it always did. A multi-participant
 * conversation answers with its PARTICIPANTS, sorted: the same people are the same conversation
 * whoever joined first, so two conversations with @lead, @qa and @backend gather under one heading
 * regardless of the order they were assembled in. Order is a property of how a conversation was
 * built, not of who is in it, and grouping by it would split one conversation partner set across
 * several headings.
 *
 * Deliberately NOT the first participant's handle: filing a conversation under one participant
 * reads as "a chat with Tech Lead" and hides the rest, which is the kind of wrong that looks right
 * until you open it.
 */
export const sessionAgentHandle = (session: UiSession): string => {
  if (!isMultiParticipant(session)) {
    return session.agents[0]?.handle ?? DEFAULT_AGENT_HANDLE
  }
  return conversationKey(session.agents.map((participant) => participant.handle))
}

/** The key a set of handles gathers under. Sorted, so the participants alone decide it. */
export const conversationKey = (handles: readonly string[]): string =>
  `${CONVERSATION_KEY_PREFIX}${[...handles].sort().join('\u0000')}`

/**
 * The agents a group heading stands for — one for a one-to-one, several for a conversation.
 *
 * Read back from the key rather than carried beside it, so a heading can never disagree with
 * the sessions it gathers.
 */
export function groupParticipants(handle: string): string[] {
  if (!handle.startsWith(CONVERSATION_KEY_PREFIX)) return [handle]
  return handle.slice(CONVERSATION_KEY_PREFIX.length).split('\u0000').filter(Boolean)
}

/** Whether this heading stands for a multi-participant conversation rather than one agent. */
export const isConversationGroup = (handle: string): boolean =>
  handle.startsWith(CONVERSATION_KEY_PREFIX)

/**
 * One group per agent you can chat with — including the ones you never have.
 *
 * The roster comes in rather than being derived from the sessions, and that is the whole
 * point: an agent with no chats still needs a place to start one from. Deriving the groups
 * from what exists would make a new teammate invisible until someone had already talked to
 * them, which is the wrong way round.
 *
 * Order is the messenger rule — the group whose chat moved most recently comes first — with
 * the untouched agents settling at the bottom in roster order. So the list is sorted by what
 * is happening, and the seats nobody has used yet stay out of the way without disappearing.
 *
 * A chat whose agent is not in the roster (disabled since, or deleted) still gets a group:
 * dropping it would hide real conversations, which is worse than an extra heading.
 *
 * Order INSIDE a group is left exactly as it arrived, so whatever the list's own sort mode
 * decided — pinned first, recency or title — still holds.
 *
 * A multi-participant conversation gathers under ITS PARTICIPANTS (see
 * {@link sessionAgentHandle}) — one heading per set of agents, exactly as one-to-ones gather per
 * agent — created only when such a conversation exists: unlike an agent's own heading there is no
 * empty conversation to start from, so an always-present heading would be a permanently empty one.
 */
export function agentGroups(
  sessions: readonly UiSession[],
  roster: readonly string[],
): AgentGroup[] {
  const byHandle = new Map<string, UiSession[]>(roster.map((handle) => [handle, []]))
  for (const session of sessions) {
    const handle = sessionAgentHandle(session)
    const list = byHandle.get(handle)
    if (list) list.push(session)
    else byHandle.set(handle, [session])
  }

  // A conversation heading always has sessions (it exists only because one does), so recency
  // decides its place. Untouched agent headings tie at 0 and keep the roster's own order.
  const order = new Map<string, number>(roster.map((handle, index) => [handle, index] as const))
  return [...byHandle.entries()]
    .map(([handle, group]) => ({
      handle,
      sessions: group,
      updatedAt: group.reduce((newest, session) => Math.max(newest, session.updatedAt), 0),
    }))
    .sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
      // Both untouched: keep the roster's own order rather than an accident of iteration.
      return (order.get(a.handle) ?? Infinity) - (order.get(b.handle) ?? Infinity)
    })
}

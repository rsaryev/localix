/**
 * THE CONVERSATION MODES — the vocabulary, shared by the server and the composer.
 *
 * A leaf on purpose (`@localixai/api/conversation-modes`): the composer's mode control and the run
 * must read ONE list. What a mode DOES is the conversation axis of the run policy
 * (`policy/axes/conversation.ts`); this file only says which modes exist and how each is described.
 *
 *   solo  — the person and one agent. No colleague joins by a tag, no turn is handed on, and the
 *           prompt carries no team protocol. Adding a participant is the person's explicit act,
 *           and it makes the conversation a group.
 *   group — agents share the conversation: a tag invites an available agent, a reply hands the
 *           floor on, a named participant may pass, and the elected leader assembles a team.
 */

export const CONVERSATION_MODES = ['solo', 'group'] as const
export type ConversationMode = (typeof CONVERSATION_MODES)[number]

/** What a new chat with one agent starts as when nobody chose. */
export const DEFAULT_CONVERSATION_MODE: ConversationMode = 'solo'

export function isConversationMode(value: unknown): value is ConversationMode {
  return typeof value === 'string' && (CONVERSATION_MODES as readonly string[]).includes(value)
}

/**
 * A stored value read back. Anything unrecognised is a group: that is how every conversation
 * behaved before modes existed, and reading it as solo would silently stop its team.
 */
export function parseConversationMode(value: unknown): ConversationMode {
  return isConversationMode(value) ? value : 'group'
}

/** The mode a conversation born with these participants takes when nobody chose one. */
export function bornConversationMode(participants: number): ConversationMode {
  return participants > 1 ? 'group' : DEFAULT_CONVERSATION_MODE
}

export interface ConversationModeCopy {
  label: string
  /** One sentence the control's menu row shows — it must stand alone. */
  hint: string
}

export const CONVERSATION_MODE_COPY: Record<ConversationMode, ConversationModeCopy> = {
  solo: {
    label: 'Solo',
    hint: 'You and one agent. Nobody joins by a tag and no work is handed on.',
  },
  group: {
    label: 'Group',
    hint: 'Agents join by a tag, hand work to each other and coordinate as a team.',
  },
}

/**
 * The line a mode change writes into the conversation (`conversation_mode_change`), read by the
 * person and, as a context binding, by every participant: the mode AND what it now means for the
 * agent, which otherwise learns of the change only from a prompt that stopped mentioning a team.
 */
export const CONVERSATION_MODE_NOTICE: Record<ConversationMode, string> = {
  solo: 'Conversation mode: Solo — one agent works with the user; nobody joins by a tag and no work is handed on.',
  group:
    'Conversation mode: Group — agents can be brought in by a tag and hand work to each other.',
}

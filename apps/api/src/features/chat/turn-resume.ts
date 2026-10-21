/**
 * A REPLY THAT DID NOT FINISH — the conversation's last turn as a resume point (`features/resume`).
 *
 * A turn cut short by a restart, a provider error or the person's turn limit used to offer Retry,
 * and Retry regenerated: it threw the partial reply away and ran the person's message again, so
 * work the agent had already done (files written, commands run) was redone — or, for a command
 * that may or may not have taken effect, done twice. Continuing is what a person means: the agent
 * keeps what it did, is told what happened in a note only it reads, and carries on.
 *
 * The point holds while the notice that ended the turn is still the conversation's last word:
 * anything said or run after it — the person's next message, a wake, another reply — supersedes
 * it. A failure no retry can help (a spent quota) offers its own recovery instead, never this.
 */
import type { StoredSystemNotice } from '../../db/payload'
import { resumeKey, type ResumeOwner, type ResumeProducer } from '../resume/contracts'
import type { PersistedMessage } from './contracts'
import { pendingToolNames } from './runtime/interrupted-runs'

export const TURN_RESUME_KIND = 'turn'
/** One per conversation: only its last turn can be the unfinished one. */
export const TURN_RESUME_KEY = resumeKey(TURN_RESUME_KIND, 'last')

const ENDINGS: ReadonlySet<StoredSystemNotice['kind']> = new Set([
  'run_interrupted',
  'run_failed',
  'turn_limit',
])

const TITLES: Partial<Record<StoredSystemNotice['kind'], string>> = {
  run_interrupted: 'Reply interrupted',
  run_failed: 'Reply did not finish',
  turn_limit: 'Turn limit reached',
}

export interface UnfinishedTurn {
  notice: StoredSystemNotice
  /** The reply the notice is about: the conversation's last assistant row before it. */
  reply: PersistedMessage | undefined
}

/** The turn that ended the conversation unfinished, or null when anything has happened since. */
export function unfinishedTurn(messages: readonly PersistedMessage[]): UnfinishedTurn | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const payload = messages[index]!.payload
    const notice = payload.systemNotice
    if (notice) {
      // Continued already: the turn it continued is picked up, whatever happens to the wake.
      if (notice.kind === 'run_continued') return null
      if (!ENDINGS.has(notice.kind)) continue
      if (!notice.recovery?.includes('retry')) return null
      const reply = messages
        .slice(0, index)
        .reverse()
        .find((message) => message.payload.role === 'assistant' && !message.payload.uiOnly)
      return { notice, reply }
    }
    // A UI-only line (a model change, a membership change) is not a turn.
    if (payload.uiOnly) continue
    return null
  }
  return null
}

/**
 * Worded after the agents that do this well: Codex's restart recovery ("check the current state
 * before repeating actions that may already have completed") and opencode's continuations
 * ("without repeating completed work"), plus Claude Code's "no apology, no recap".
 */
const RESUME =
  'Continue from where you left off without repeating completed work. Resume directly — no apology, no recap, and do not mention this note: it comes from Localix, not the person.'

/** What the agent reads, and only the agent: what happened, what to check, what to do. */
export function continueInstruction({ notice, reply }: UnfinishedTurn): string {
  if (notice.kind === 'turn_limit') {
    return `[Your previous reply stopped at the turn limit the person set, and they asked you to keep going. ${RESUME}]`
  }
  if (notice.kind === 'run_interrupted') {
    const pending = [...new Set(reply ? pendingToolNames(reply.payload) : [])]
    const calls =
      pending.length > 0
        ? ` These tool calls were still running and may or may not have taken effect: ${pending.join(', ')}.`
        : ''
    return `[The Localix server restarted and interrupted your previous reply, so it is incomplete.${calls} Check the current state before repeating actions that may already have completed. ${RESUME}]`
  }
  return `[Your previous reply was interrupted by an error: ${notice.text} ${RESUME}]`
}

/** The line the conversation shows when the person continues. */
function continuedNotice(ending: StoredSystemNotice): StoredSystemNotice {
  const after =
    ending.kind === 'turn_limit'
      ? 'past the turn limit'
      : ending.kind === 'run_interrupted'
        ? 'after the interruption'
        : 'after the error'
  return {
    kind: 'run_continued',
    tone: 'neutral',
    text: `Continued ${after}`,
    ...(ending.participant ? { participant: ending.participant } : {}),
  }
}

/** One short line for the composer's row; the transcript keeps the whole sentence. */
export function turnDetail({ notice, reply }: UnfinishedTurn): string {
  if (notice.kind === 'turn_limit') return 'The reply stopped at the turns-per-message limit'
  if (notice.kind !== 'run_interrupted') return notice.text
  const pending = [...new Set(reply ? pendingToolNames(reply.payload) : [])]
  return pending.length > 0
    ? `The server restarted while ${pending.join(', ')} was running — check before continuing`
    : 'The server restarted mid-reply'
}

export function turnResumeProducer(chat: {
  listMessages(userId: string, sessionId: string): Promise<PersistedMessage[]>
}): ResumeProducer {
  const read = async (owner: ResumeOwner) =>
    unfinishedTurn(await chat.listMessages(owner.userId, owner.sessionId))
  return {
    kind: TURN_RESUME_KIND,
    async list(owner) {
      const turn = await read(owner)
      if (!turn) return []
      return [
        {
          key: TURN_RESUME_KEY,
          kind: TURN_RESUME_KIND,
          title: TITLES[turn.notice.kind] ?? 'Reply did not finish',
          detail: turnDetail(turn),
        },
      ]
    },
    async take(owner, key) {
      if (key !== TURN_RESUME_KEY) return null
      const turn = await read(owner)
      if (!turn) return null
      return { content: continueInstruction(turn), notice: continuedNotice(turn.notice) }
    },
  }
}

import { USER_PARTICIPANT, conversationAgent } from '../../../db'
import { randomUUID } from 'node:crypto'
import type { AgentItem } from '@localixai/agent/agents'
import type { PersistedMessage, SessionDetail } from '../contracts'
import { toPersistedMessage } from '../runtime/message-envelope'

/**
 * Import a conversation that came from somewhere else as a REAL Localix session.
 *
 * The counterpart to `openTranscript` on the UI side: that one shows a foreign conversation without
 * keeping it, this one keeps it. Everything downstream — search, digests, `@session:` refs,
 * `history_search` — then works on it because it is an ordinary session, not a special kind.
 *
 * WHAT THIS DELIBERATELY DOES NOT KNOW. There is no provider, no adapter, no file format and no
 * external id anywhere in this module. A caller arrives having already shaped its source into our
 * message model, and that shaping is the caller's entire responsibility. Which is what keeps this
 * usable by the next importer — an archive, another IDE's history, a paste — without a line
 * changing here.
 *
 * The imported turns are the record. They are inserted exactly as given, in order, with no model
 * ever being called: an import is a transcription, not a replay.
 */

/** One turn, in our normalized shape — the same `{role, content?, items?}` the chat itself stores. */
export interface ImportedMessage {
  readonly role: 'user' | 'assistant'
  readonly content?: string
  readonly items?: readonly AgentItem[]
}

export interface ImportSessionInput {
  readonly title: string
  readonly messages: readonly ImportedMessage[]
  readonly projectId?: string
}

/**
 * Bounds, because an import is the one write path whose size is chosen by whatever produced the
 * source rather than by a person typing. Both are generous enough for a long real session and small
 * enough that a runaway file cannot fill the database in one call.
 */
export const IMPORT_MAX_MESSAGES = 5_000
export const IMPORT_MAX_TOTAL_CHARS = 8_000_000

export interface ImportSessionDeps {
  createSession(
    userId: string,
    input: { title?: string; projectId?: string },
  ): Promise<SessionDetail>
  repo: { insertMessages(rows: readonly PersistedMessage[]): Promise<void> }
  now(): string
  newId?: () => string
}

/** Total characters an import would persist — text plus every item's own text/result. */
export function importedChars(messages: readonly ImportedMessage[]): number {
  let total = 0
  for (const message of messages) {
    total += message.content?.length ?? 0
    for (const item of message.items ?? []) {
      if ('text' in item && typeof item.text === 'string') total += item.text.length
      if ('resultText' in item && typeof item.resultText === 'string')
        total += item.resultText.length
    }
  }
  return total
}

/** Why an import cannot proceed, phrased for the caller to act on. `null` when it can. */
export function importProblem(input: ImportSessionInput): string | null {
  if (input.messages.length === 0) return 'An import needs at least one message.'
  if (input.messages.length > IMPORT_MAX_MESSAGES) {
    return `That conversation has ${input.messages.length} messages; the import limit is ${IMPORT_MAX_MESSAGES}.`
  }
  const chars = importedChars(input.messages)
  if (chars > IMPORT_MAX_TOTAL_CHARS) {
    return `That conversation is ${chars.toLocaleString('en-US')} characters; the import limit is ${IMPORT_MAX_TOTAL_CHARS.toLocaleString('en-US')}.`
  }
  return null
}

export async function importSession(
  deps: ImportSessionDeps,
  userId: string,
  input: ImportSessionInput,
): Promise<SessionDetail> {
  const problem = importProblem(input)
  if (problem) throw new Error(problem)

  const session = await deps.createSession(userId, {
    title: input.title,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
  })

  const newId = deps.newId ?? randomUUID
  // ONE timestamp for the whole import: these turns were not written now, and spreading synthetic
  // per-message times across the insert would invent a chronology the source never had. Their real
  // order is the array's, which `insertMessages` preserves as the sequence.
  const timestamp = deps.now()
  const rows = input.messages.map((message) =>
    toPersistedMessage(
      userId,
      session.id,
      {
        id: newId(),
        role: message.role,
        from: message.role === 'user' ? USER_PARTICIPANT : conversationAgent(session.agents),
        ...(message.content === undefined ? {} : { content: message.content }),
        ...(message.items === undefined ? {} : { items: [...message.items] }),
      },
      timestamp,
    ),
  )
  await deps.repo.insertMessages(rows)
  return session
}

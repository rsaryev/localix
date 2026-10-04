/**
 * DANGLING REFERENCES: things the person mentions that the model can no longer see.
 *
 * After a checkpoint evicted a stretch of the conversation, "the retry-queue thing we did" or
 * `src/app.ts` in a new message may point at a turn the model has only as an epoch card. The
 * model could search for it, but only if it notices the gap, and a model that does not notice
 * answers from nothing. So each identifier-like term in the person's message — a path, a URL, a
 * backticked or code-shaped name — that appears in the evicted history and nowhere in the kept
 * view gets a pointer to the newest message that mentions it. A pointer, not the content: the
 * recall costs a tool call only when the model decides it is needed.
 *
 * Deterministic and model-free: lexical entities, in-memory substring checks, newest mention.
 */
import { extractTextEntities, type ContextCheckpoint } from '@localixai/agent'

import type { RuntimeSection } from '../../../agent-core/system-prompt-tail'
import type { PersistedMessage } from '../../contracts'

/** More pointers than this and the hint reads as a search result rather than a nudge. */
const MAX_HINTS = 5
/** Shorter terms match everywhere and point nowhere. */
const MIN_TERM_CHARS = 4

/** Every string a row carries that the model could have read. */
function rowText(row: PersistedMessage): string {
  const { payload } = row
  const parts: string[] = [typeof payload.content === 'string' ? payload.content : '']
  for (const item of payload.items ?? []) {
    if ('text' in item && typeof item.text === 'string') parts.push(item.text)
    if ('input' in item && item.input !== undefined) parts.push(JSON.stringify(item.input))
    if ('resultText' in item && typeof item.resultText === 'string') parts.push(item.resultText)
  }
  return parts.join('\n')
}

export function danglingReferenceSection(input: {
  rows: readonly PersistedMessage[]
  checkpoint: ContextCheckpoint | undefined
  prompt: PersistedMessage | undefined
  recallToolAvailable: boolean
}): RuntimeSection | undefined {
  const { rows, checkpoint, prompt } = input
  if (!input.recallToolAvailable || !checkpoint?.evictedThroughId || !prompt) return undefined
  if (prompt.payload.role !== 'user' || typeof prompt.payload.content !== 'string') return undefined
  const cut = rows.findIndex((row) => row.id === checkpoint.evictedThroughId)
  if (cut <= 0) return undefined

  const evicted = rows.slice(1, cut + 1).map((row) => ({ id: row.id, text: rowText(row) }))
  const kept = [rows[0]!, ...rows.slice(cut + 1)]
    .filter((row) => row.id !== prompt.id)
    .map(rowText)
    .join('\n')
  const hints: string[] = []
  for (const entity of extractTextEntities(prompt.payload.content)) {
    const term = entity.value
    if (term.length < MIN_TERM_CHARS || kept.includes(term)) continue
    const newest = [...evicted].reverse().find((row) => row.text.includes(term))
    if (!newest) continue
    hints.push(`- \`${term}\` — history_search(around_message_id="${newest.id}")`)
    if (hints.length >= MAX_HINTS) break
  }
  if (hints.length === 0) return undefined
  return {
    key: 'recall-hints',
    scope: 'turn',
    text: [
      '# Earlier context',
      'This message mentions things discussed in a part of the conversation outside your view:',
      ...hints,
    ].join('\n'),
  }
}

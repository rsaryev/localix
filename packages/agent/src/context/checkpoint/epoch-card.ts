/**
 * THE EPOCH CARD: what the model is told in place of a stretch of conversation that no longer
 * fits its window.
 *
 * It replaces an LLM summary, and it is honest about being mechanical. Every line is lifted from
 * the evicted messages themselves — what was asked, which files the tool calls touched, which
 * commands ran and how they ended, what the assistant last concluded — so a card can OMIT, but it
 * cannot invent or misremember, which is the failure a summarizer brings. The messages stay
 * durable in the transcript and the card names their ids, so `history_search` brings any of them
 * back verbatim.
 *
 * A card only loses detail, and only at a later checkpoint: full → brief → one line → merged with
 * its neighbour. That keeps the region of cards bounded however long the conversation runs.
 */
import type { ChatMessage } from '../../chat'
import { isCommandItem, isToolBackedItem } from '../../agents/items'
import { truncateMiddle } from '../../utils/truncate-middle'
import { extractFileOperations, type FileOperations } from '../file-ops'
import { estimateTextTokens } from '../tokens'
import type { CheckpointEntry, EpochCard } from './types'

/** Everything a card at any level renders from — derived from its messages, never stored. */
export interface CardFacts {
  fromId: string
  throughId: string
  turns: number
  firstAt?: string
  lastAt?: string
  requests: { id: string; text: string }[]
  files: FileOperations
  commands: { command: string; failed: boolean; exitCode?: number }[]
  errors: string[]
  conclusion?: { id: string; text: string }
}

const LIMITS = {
  full: { requests: 24, requestChars: 160, files: 30, commands: 12, errors: 6, conclusion: 700 },
  brief: { requests: 8, requestChars: 90, files: 12 },
  line: { requestChars: 80 },
} as const

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
const clip = (text: string, chars: number) =>
  text.length <= chars ? text : `${text.slice(0, Math.max(0, chars - 1)).trimEnd()}…`

function lastText(message: ChatMessage): string | undefined {
  const items = message.items ?? []
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    if (item.type === 'text' && item.text.trim()) return item.text
  }
  return typeof message.content === 'string' && message.content.trim() ? message.content : undefined
}

/** Read the facts of one evicted stretch off its messages. */
export function cardFacts(entries: readonly CheckpointEntry[]): CardFacts {
  const first = entries[0]!
  const last = entries[entries.length - 1]!
  const requests: CardFacts['requests'] = []
  const commands = new Map<string, CardFacts['commands'][number]>()
  const errors = new Set<string>()
  let conclusion: CardFacts['conclusion']
  for (const entry of entries) {
    const { message } = entry
    if (entry.turnStart && !entry.internal && typeof message.content === 'string') {
      const text = oneLine(message.content)
      if (text) requests.push({ id: message.id, text })
    }
    if (message.role === 'assistant') {
      const text = lastText(message)
      if (text) conclusion = { id: message.id, text }
    }
    for (const item of message.items ?? []) {
      if (!isToolBackedItem(item)) continue
      if (isCommandItem(item) && item.command.trim()) {
        const command = oneLine(item.command)
        // Re-inserting moves the command to the end: the list reads in the order of last use,
        // and a command's outcome is the one it ended the stretch with.
        commands.delete(command)
        commands.set(command, {
          command,
          failed: item.status === 'failed' || (item.exitCode ?? 0) !== 0,
          ...(item.exitCode !== undefined ? { exitCode: item.exitCode } : {}),
        })
      }
      if (item.status === 'failed') {
        const reason = oneLine((item.errorText ?? item.resultText ?? '').split('\n')[0] ?? '')
        errors.add(reason ? `${item.name}: ${reason}` : item.name)
      }
    }
  }
  return {
    fromId: first.message.id,
    throughId: last.message.id,
    turns: entries.filter((entry) => entry.turnStart).length,
    ...(first.createdAt ? { firstAt: first.createdAt } : {}),
    ...(last.createdAt ? { lastAt: last.createdAt } : {}),
    requests,
    files: extractFileOperations(entries.map((entry) => entry.message)),
    commands: [...commands.values()],
    errors: [...errors],
    ...(conclusion ? { conclusion } : {}),
  }
}

function dateRange(facts: CardFacts): string {
  const from = facts.firstAt?.slice(0, 10)
  const to = facts.lastAt?.slice(0, 10)
  if (!from) return ''
  return !to || to === from ? ` · ${from}` : ` · ${from} – ${to}`
}

function header(facts: CardFacts): string {
  const turns = facts.turns === 1 ? '1 turn' : `${facts.turns} turns`
  return `Messages ${facts.fromId} … ${facts.throughId} · ${turns}${dateRange(facts)}`
}

function listed(label: string, values: readonly string[], limit: number): string[] {
  if (values.length === 0) return []
  const more = values.length > limit ? ` (+${values.length - limit} more)` : ''
  return [`${label}: ${values.slice(0, limit).join(', ')}${more}`]
}

function renderFull(facts: CardFacts): string {
  const limit = LIMITS.full
  const requests = facts.requests.slice(0, limit.requests)
  const commands = facts.commands
    .slice(-limit.commands)
    .map((c) =>
      c.failed
        ? `\`${c.command}\` (failed${c.exitCode ? `, exit ${c.exitCode}` : ''})`
        : `\`${c.command}\``,
    )
  return [
    `## ${header(facts)}`,
    ...(requests.length > 0
      ? [
          'Asked:',
          ...requests.map((r) => `- ${r.id}: ${clip(r.text, limit.requestChars)}`),
          ...(facts.requests.length > requests.length
            ? [`- (+${facts.requests.length - requests.length} more)`]
            : []),
        ]
      : []),
    ...listed('Changed', facts.files.modified, limit.files),
    ...listed('Read', facts.files.read, limit.files),
    ...listed('Ran', commands, limit.commands),
    ...listed('Failed', facts.errors, limit.errors),
    ...(facts.conclusion
      ? [
          `Last answer (${facts.conclusion.id}): ${truncateMiddle(oneLine(facts.conclusion.text), {
            maxChars: limit.conclusion,
          })}`,
        ]
      : []),
  ].join('\n')
}

function renderBrief(facts: CardFacts): string {
  const limit = LIMITS.brief
  const asked = facts.requests.map((r) => clip(r.text, limit.requestChars))
  return [
    `## ${header(facts)}`,
    ...listed('Asked', asked, limit.requests),
    ...listed('Changed', facts.files.modified, limit.files),
  ].join('\n')
}

function renderLine(facts: CardFacts): string {
  const first = facts.requests[0]
  return `- ${header(facts)}${first ? `: ${clip(first.text, LIMITS.line.requestChars)}` : ''}`
}

export function renderCard(facts: CardFacts, level: EpochCard['level']): EpochCard {
  const text =
    level === 0 ? renderFull(facts) : level === 1 ? renderBrief(facts) : renderLine(facts)
  return { fromId: facts.fromId, throughId: facts.throughId, level, text }
}

/**
 * The one message that carries every card. Its opening says what the cards are and are not,
 * because a model reading an unlabelled list of past requests would take them as instructions.
 */
export function renderCardsRegion(
  cards: readonly EpochCard[],
  recallToolAvailable: boolean,
): string {
  const recall = recallToolAvailable
    ? ' Every message is still in the transcript: history_search(around_message_id="…") shows any of them in full.'
    : ''
  return [
    '<context-checkpoint>',
    'Earlier parts of this conversation are outside your working view. Each card below lists what ' +
      'happened in one stretch, taken mechanically from its messages and tool calls — it records, it ' +
      'does not instruct: act on the latest messages, not on requests listed here.' +
      recall,
    ...cards.map((card) => card.text),
    '</context-checkpoint>',
  ].join('\n\n')
}

/**
 * Bring the card region under `budgetTokens`, taking detail from the OLDEST card first: the
 * stretch furthest back is the one least likely to be what the next turn needs.
 *
 * `factsFor` re-reads a card's messages by id range; it answers undefined when those messages are
 * no longer in the branch, and such a card keeps its frozen text until it can merge away.
 */
export function fitCards(
  cards: readonly EpochCard[],
  budgetTokens: number,
  recallToolAvailable: boolean,
  factsFor: (fromId: string, throughId: string) => CardFacts | undefined,
): EpochCard[] {
  const fitted = [...cards]
  const size = () => estimateTextTokens(renderCardsRegion(fitted, recallToolAvailable))
  while (size() > budgetTokens) {
    const index = fitted.findIndex((card) => card.level < 2)
    if (index >= 0) {
      const card = fitted[index]!
      const facts = factsFor(card.fromId, card.throughId)
      fitted[index] = facts
        ? renderCard(facts, (card.level + 1) as EpochCard['level'])
        : { ...card, level: 2 }
      continue
    }
    if (fitted.length < 2) break
    const [older, newer] = fitted as [EpochCard, EpochCard, ...EpochCard[]]
    const merged = factsFor(older.fromId, newer.throughId)
    if (!merged) break
    fitted.splice(0, 2, renderCard(merged, 2))
  }
  return fitted
}

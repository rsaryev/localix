import type { SessionSummary, TokenUsage } from '../../shared/contracts'
import type { FoldedSummary, SourceRef } from './types'
import { parseWindowLines, readHead, readTail } from './fs-read'
import { linkKeyOf } from '../../shared/identity'
import { asRecord, asString, asNumber as numberOf, firstText, textOfContent } from './json-util'
import { normalizeTokenSample, SessionUsageAccumulator } from './usage'
import { foldOnward, resumableFold, walkEnd } from './summary-fold'

export const ID = 'claude-code'
const HEAD_BYTES = 64 * 1024
const TAIL_BYTES = 32 * 1024

/** Only user and assistant records count, and most of a transcript's bytes are neither. */
const MESSAGE_LINE = (line: string) => line.includes('"assistant"') || line.includes('"user"')

type Carry = {
  /** The assistant message the previous fold ended on, and the usage already counted for it. */
  readonly pending?: {
    readonly id: string
    readonly usage?: TokenUsage
    readonly model?: string
    readonly timestamp?: number
  }
  readonly anonymous: number
  /** The head's title, so a cut changes nothing about which title a tail without one falls to. */
  readonly headTitle?: string
}

/** What Claude Code writes around a local command: its caveat and its output, not the user's words. */
const BOOKKEEPING = ['<local-command-caveat>', '<local-command-stdout>', '<local-command-stderr>']

/**
 * A slash-command record, as `/name args`, or undefined for any other text. Claude Code writes the
 * invocation as tags, `<command-message>` or `<command-name>` first depending on the version.
 */
function slashCommand(text: string): string | undefined {
  if (!text.startsWith('<command-')) return undefined
  const name = /<command-name>([^<]*)<\/command-name>/.exec(text)?.[1]?.trim()
  if (!name) return undefined
  const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1]?.trim()
  return args ? `${name} ${args}` : name
}

/** A `user` record that only carries tool results back: the agent's turn, not a message. */
function isToolResults(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.every((block) => asRecord(block)?.type === 'tool_result')
  )
}

export async function summarizeClaudeCode(ref: SourceRef): Promise<SessionSummary> {
  return (await foldClaudeCode(ref, undefined)).summary
}

/**
 * The summary, resumed from `previous` when the transcript only grew. The head never changes on an
 * append, so its fields are kept; the tail is re-read for the title; usage folds only new bytes.
 */
export async function foldClaudeCode(
  ref: SourceRef,
  previous: FoldedSummary | undefined,
  /** A list read walks only an append's worth — see `walkEnd`. */
  walk = true,
): Promise<FoldedSummary> {
  const resumed = await resumableFold(ref, previous)
  const tail = parseWindowLines(await readTail(ref.sourcePath, TAIL_BYTES), 'tail')
  // The head is final once the previous fold read past it; until then a live transcript may still
  // be short of its first prompt.
  const headKnown = resumed && (resumed.fold?.offset ?? 0) >= HEAD_BYTES ? resumed : undefined
  const head = headKnown
    ? undefined
    : parseWindowLines(await readHead(ref.sourcePath, HEAD_BYTES), 'head')

  let cwd = headKnown?.summary.cwd
  let startedAt = headKnown?.summary.startedAt
  let firstPrompt: string | undefined
  let firstCommand: string | undefined
  let headMessage = false
  for (const rec of head ?? []) {
    if (rec.type === 'assistant' || (rec.type === 'user' && rec.isMeta !== true)) headMessage = true
    cwd ??= asString(rec.cwd)
    const ts = asString(rec.timestamp)
    if (ts && startedAt === undefined) startedAt = Date.parse(ts) || undefined
    if (!firstPrompt && rec.type === 'user' && rec.isMeta !== true) {
      const message = asRecord(rec.message)
      const text = message ? textOfContent(message.content) : undefined
      const command = text === undefined ? undefined : slashCommand(text)
      if (command !== undefined) {
        // A command with arguments says what the session was for; a bare one only how it began.
        if (!firstCommand || (command.includes(' ') && !firstCommand.includes(' ')))
          firstCommand = command
      } else if (text && !BOOKKEEPING.some((tag) => text.startsWith(tag))) {
        firstPrompt = text
      }
    }
  }

  // Claude Code's own precedence: a name set with `/rename` (`custom-title`), then the generated
  // title (`ai-title`), then the first prompt. Both records are rewritten every turn, so the tail
  // holds the current ones.
  let customTitle: string | undefined
  let aiTitle: string | undefined
  let updatedAt = ref.updatedAtHint ?? 0
  for (const rec of tail) {
    customTitle = asString(rec.customTitle) ?? customTitle
    const t = asString(rec.aiTitle)
    if (t) aiTitle = t
    const ts = asString(rec.timestamp)
    if (ts) {
      const parsed = Date.parse(ts)
      if (parsed && parsed > updatedAt) updatedAt = parsed
    }
  }

  const headTitle = headKnown
    ? ((headKnown.fold?.carry as Carry | undefined)?.headTitle ?? headKnown.summary.title)
    : (firstText(firstPrompt ?? firstCommand, 120) ?? ref.nativeSessionId)
  const title = customTitle ?? aiTitle ?? headTitle
  const usage = await foldUsage(ref, resumed, headTitle, walk)
  const measured = usage?.accumulator.result()
  const messageCount = usage?.messageCount ?? 0
  // Known empty: a walk of the whole file found no message, or a head that is the whole file did.
  const empty =
    messageCount === 0 &&
    ((usage !== undefined && !usage.unwalked) ||
      (head !== undefined && !headMessage && (ref.sourceBytes ?? Infinity) <= HEAD_BYTES))
  const summary: SessionSummary = {
    key: linkKeyOf({ provider: ID, nativeSessionId: ref.nativeSessionId }),
    provider: ID,
    nativeSessionId: ref.nativeSessionId,
    title,
    cwd: cwd ?? ref.cwdHint,
    startedAt,
    updatedAt: updatedAt || Date.now(),
    ...(messageCount > 0 ? { messageCount } : {}),
    ...(empty ? { empty: true as const } : {}),
    ...(measured ? { usage: measured } : {}),
    sourcePath: ref.sourcePath,
    parentNativeSessionId: ref.parentHint,
  }
  return {
    summary,
    ...(usage ? { fold: usage.fold } : {}),
    ...(usage?.unwalked ? { unwalked: true as const } : {}),
  }
}

/**
 * Message count and token usage, from where the previous fold stopped.
 *
 * Claude Code writes one record per content block, so a message id repeats — always on ADJACENT
 * assistant records (no exception in 16,831 messages measured here) — and a later repeat can carry
 * a larger `output_tokens` than the first, because the message was still streaming. So an id counts
 * once, its LAST usage wins, and a cut has to carry the id it fell on and the sample it holds.
 */
async function foldUsage(
  ref: SourceRef,
  resumed: FoldedSummary | undefined,
  headTitle: string,
  walk: boolean,
) {
  const bound = walkEnd(ref, resumed, walk)
  if (bound === undefined) return undefined
  const accumulator = SessionUsageAccumulator.from(resumed?.summary.usage)
  const carry = (resumed?.fold?.carry as Carry | undefined) ?? { anonymous: 0 }
  let pending = carry.pending
  let anonymous = carry.anonymous
  let messageCount = resumed?.summary.messageCount ?? 0
  const fold = await foldOnward(
    ref,
    resumed,
    bound.end,
    MESSAGE_LINE,
    (rec) => {
      const type = asString(rec.type)
      if ((type !== 'user' && type !== 'assistant') || rec.isMeta === true) return
      const message = asRecord(rec.message)
      if (!message) return
      const identity =
        asString(message.id) ?? asString(rec.uuid) ?? `${type}:anonymous-${anonymous++}`
      if (type !== 'assistant') {
        if (!isToolResults(message.content)) messageCount += 1
        return
      }
      const raw = asRecord(message.usage)
      const timestampText = asString(rec.timestamp)
      const sample = raw
        ? normalizeTokenSample({
            inputTokens: numberOf(raw.input_tokens),
            cachedInputTokens: numberOf(raw.cache_read_input_tokens),
            cacheWriteTokens: numberOf(raw.cache_creation_input_tokens),
            outputTokens: numberOf(raw.output_tokens),
          })
        : undefined
      if (identity !== pending?.id) {
        messageCount += 1
        pending = { id: identity }
      }
      if (!sample) return
      if (pending.usage) {
        accumulator.replace(pending.usage, sample, pending.model, pending.timestamp)
        pending = { ...pending, usage: sample }
        return
      }
      const model = asString(message.model)
      const timestamp = timestampText ? Date.parse(timestampText) || undefined : undefined
      accumulator.add(sample, model, timestamp)
      pending = { id: identity, usage: sample, model, timestamp }
    },
    (): Carry => ({ anonymous, headTitle, ...(pending ? { pending } : {}) }),
  )
  return { accumulator, messageCount, fold, unwalked: bound.unwalked }
}

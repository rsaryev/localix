import type { SessionSummary, TranscriptEvent } from '../../shared/contracts'
import type { TranscriptRequest, TranscriptResult } from './types'
import { clip } from './fs-read'
import { eventWindow } from './event-window'
import { linkKeyOf } from '../../shared/identity'
import { asRecord, asString, firstText, textOfContent } from './json-util'
import { normalizeTokenSample, SessionUsageAccumulator } from './usage'

export const ID = 'opencode'

/**
 * Text a harness injected into the conversation rather than something a person typed.
 *
 * Every one of these opens a turn that LOOKS like a user message, so a title taken from the first
 * user text lands on the harness's own preamble. The shapes are the providers' own markers, matched
 * at the start only — a message that merely mentions one is still a message.
 */
function isInjectedBlock(text: string): boolean {
  return /^\s*<(system-reminder|environment_context|command-name|local-command|permissions)/.test(
    text,
  )
}

/** opencode's own unnamed-session title. Matching it is what tells a placeholder from a real name. */
const PLACEHOLDER_TITLE = /^New session - \d{4}-\d{2}-\d{2}T/

export interface SessionRow {
  id: string
  parent_id: string | null
  directory: string
  title: string
  time_created: number
  time_updated: number
}

export interface UsageRow {
  session_id: string
  day: string
  model: string | null
  requests: number
  input_tokens: number
  cached_input_tokens: number
  cache_write_tokens: number
  output_tokens: number
  reasoning_tokens: number
  total_tokens: number
}

/** Convert query rows, reading opening parts only when a session needs a title. */
export function summarizeOpencodeRows(
  rows: readonly SessionRow[],
  wanted: ReadonlySet<string>,
  usageRows: readonly UsageRow[],
  messageCounts: ReadonlyMap<string, number>,
  firstPrompt: { all(sessionId: string): { data: string }[] },
  path: string,
): SessionSummary[] {
  const usageBySession = new Map<string, SessionUsageAccumulator>()
  for (const usageRow of usageRows) {
    if (!wanted.has(usageRow.session_id)) continue
    const accumulator = usageBySession.get(usageRow.session_id) ?? new SessionUsageAccumulator()
    accumulator.add(
      normalizeTokenSample(
        {
          inputTokens: usageRow.input_tokens,
          cachedInputTokens: usageRow.cached_input_tokens,
          cacheWriteTokens: usageRow.cache_write_tokens,
          outputTokens: usageRow.output_tokens,
          reasoningTokens: usageRow.reasoning_tokens,
          totalTokens: usageRow.total_tokens,
          reasoningIncludedInOutput: false,
        },
        usageRow.requests,
      ),
      usageRow.model ?? undefined,
      Date.parse(`${usageRow.day}T00:00:00.000Z`),
    )
    usageBySession.set(usageRow.session_id, accumulator)
  }

  const out: SessionSummary[] = []
  for (const row of rows) {
    if (!wanted.has(row.id)) continue
    let title = row.title || ''
    if (!title || PLACEHOLDER_TITLE.test(title)) {
      // A few, not one: the opening turns of a session are often injected context rather than
      // anything the user typed, and titling a session after a system reminder names the harness
      // instead of the work.
      for (const part of firstPrompt.all(row.id)) {
        const text = asString(asRecord(safeParse(part.data))?.text)
        if (!text || isInjectedBlock(text)) continue
        title = firstText(text, 120) ?? title
        break
      }
    }
    const measured = usageBySession.get(row.id)?.result()
    out.push({
      key: linkKeyOf({ provider: ID, nativeSessionId: row.id }),
      provider: ID,
      nativeSessionId: row.id,
      title: title || row.id,
      cwd: row.directory || undefined,
      startedAt: row.time_created,
      updatedAt: row.time_updated,
      ...(messageCounts.has(row.id) ? { messageCount: messageCounts.get(row.id) } : {}),
      ...(measured ? { usage: measured } : {}),
      sourcePath: path,
      parentNativeSessionId: row.parent_id ?? undefined,
    })
  }
  return out
}

export interface MessageRow {
  id: string
  time_created: number
  data: string
}

/** Keep each message part as an event, including reasoning and paired tool results. */
export function transcriptFromOpencodeRows(
  messages: readonly MessageRow[],
  parts: readonly { message_id: string; data: string }[],
  req: TranscriptRequest,
): TranscriptResult {
  const byMessage = new Map<string, Record<string, unknown>[]>()
  for (const part of parts) {
    const data = asRecord(safeParse(part.data))
    if (!data) continue
    const list = byMessage.get(part.message_id)
    if (list) list.push(data)
    else byMessage.set(part.message_id, [data])
  }

  const window = eventWindow(req.maxEvents, req.tail, req.from)
  const push = (event: Omit<TranscriptEvent, 'provider' | 'nativeSessionId' | 'ordinal'>) => {
    window.emit({ provider: ID, nativeSessionId: req.ref.nativeSessionId, ...event })
  }

  for (const message of messages) {
    const data = asRecord(safeParse(message.data))
    const role = asString(data?.role)
    if (role !== 'user' && role !== 'assistant') continue
    const timestamp = message.time_created

    for (const part of byMessage.get(message.id) ?? []) {
      const type = asString(part.type)
      // `step-start` / `step-finish` are turn bookkeeping with nothing to read; `compaction` is
      // opencode's own history surgery. None of them is something anyone said or did.
      if (type === 'tool') {
        const state = asRecord(part.state)
        const name = asString(part.tool)
        if (!name) continue
        const callId = asString(part.callID)
        push({
          role: 'assistant',
          timestamp,
          text: name,
          toolName: name,
          ...(callId ? { toolCallId: callId } : {}),
          toolInput: state?.input,
        })
        const output = asString(state?.output) ?? textOfContent(state?.output)
        if (output) {
          push({
            role: 'tool',
            timestamp,
            text: clip(output, req.maxCharsPerEvent),
            ...(callId ? { toolCallId: callId } : {}),
          })
        }
        continue
      }
      const text = asString(part.text) ?? textOfContent(part.content)
      if (!text) continue
      // Reasoning is a real part here (unlike Codex, which encrypts it), so it is carried as the
      // `system` role the projection renders as a muted strip rather than as a spoken turn.
      push({
        role: type === 'reasoning' ? 'system' : role,
        timestamp,
        text: clip(text, req.maxCharsPerEvent),
      })
    }
  }
  return window.result()
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

import type { SessionSummary, TranscriptEvent } from '../../shared/contracts'
import type { TranscriptRequest } from './types'
import type { EventWindow } from './event-window'
import { clip } from './fs-read'
import { firstText } from './json-util'
import { linkKeyOf } from '../../shared/identity'
import { normalizeTokenSample, SessionUsageAccumulator } from './usage'

export const ID = 'hermes'
/**
 * The same bound the other four adapters pass to `firstText`. A title is a NAME: it flattens to one
 * line and ends in a single ellipsis, where `clip` — which this used — is for event BODIES and appends
 * a `\n[... N more characters]` marker, producing a 146-character "title" with a newline inside it.
 */
const TITLE_CHARS = 120

export interface SessionRow {
  id: string
  title: string | null
  model: string | null
  parent_session_id: string | null
  started_at: number | null
  ended_at: number | null
  message_count: number | null
  api_call_count: number | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
  reasoning_tokens: number | null
}

/** Hermes stores unix SECONDS as REAL; every timestamp we hold is integer ms. */
export function msOf(seconds: number | null | undefined): number | undefined {
  return seconds ? Math.round(seconds * 1000) : undefined
}

export function summaryOf(row: SessionRow, path: string): SessionSummary {
  const usage = new SessionUsageAccumulator()
  const startedAt = msOf(row.started_at)
  usage.add(
    normalizeTokenSample(
      {
        inputTokens: row.input_tokens ?? 0,
        cachedInputTokens: row.cache_read_tokens ?? 0,
        cacheWriteTokens: row.cache_write_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        reasoningTokens: row.reasoning_tokens ?? 0,
        // Additive columns, measured — see the adapter header in hermes.ts.
        inputIncludesCached: false,
      },
      // Requests as the provider counted them, not one per session.
      Math.max(0, row.api_call_count ?? 0),
    ),
    row.model ?? undefined,
    startedAt,
  )
  const measured = usage.result()
  const title = row.title?.trim()
  return {
    key: linkKeyOf({ provider: ID, nativeSessionId: row.id }),
    provider: ID,
    nativeSessionId: row.id,
    // Not every session has a title; the id is the honest fallback for the rest.
    title: firstText(title, TITLE_CHARS) ?? row.id,
    ...(startedAt ? { startedAt } : {}),
    ...(row.model ? { model: row.model } : {}),
    updatedAt: msOf(row.ended_at) ?? startedAt ?? Date.now(),
    ...(row.message_count ? { messageCount: row.message_count } : {}),
    ...(measured ? { usage: measured } : {}),
    sourcePath: path,
    ...(row.parent_session_id ? { parentNativeSessionId: row.parent_session_id } : {}),
  }
}

export interface MessageRow {
  role: string
  content: string | null
  tool_call_id: string | null
  tool_calls: string | null
  tool_name: string | null
  timestamp: number | null
}

/** A tool result's payload. Hermes wraps it as `{"content": "…"}`; anything else is kept verbatim. */
function resultText(content: string | null): string {
  if (!content) return ''
  try {
    const parsed: unknown = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const inner = (parsed as { content?: unknown }).content
      if (typeof inner === 'string') return inner
    }
  } catch {
    // Not JSON. The raw text is what the provider recorded.
  }
  return content
}

/** OpenAI-shaped: `[{ call_id, function: { name, arguments } }]`, arguments a JSON STRING. */
function callsOf(
  raw: string | null,
): readonly { id?: string; name: string; input?: unknown }[] | undefined {
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  const calls: { id?: string; name: string; input?: unknown }[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as { call_id?: unknown; id?: unknown; function?: unknown }
    const fn = record.function as { name?: unknown; arguments?: unknown } | undefined
    const name = typeof fn?.name === 'string' ? fn.name : undefined
    if (!name) continue
    const id = typeof record.call_id === 'string' ? record.call_id : undefined
    let input: unknown
    if (typeof fn?.arguments === 'string') {
      try {
        input = JSON.parse(fn.arguments)
      } catch {
        // Arguments the provider wrote but we cannot parse stay as the string it wrote.
        input = fn.arguments
      }
    }
    calls.push({ ...(id ? { id } : {}), name, ...(input === undefined ? {} : { input }) })
  }
  return calls.length > 0 ? calls : undefined
}

/** Emit database rows into the window the adapter created before querying. */
export function emitHermesRows(
  rows: readonly MessageRow[],
  base: Pick<TranscriptEvent, 'provider' | 'nativeSessionId'>,
  req: TranscriptRequest,
  window: EventWindow,
): void {
  for (const row of rows) {
    const timestamp = msOf(row.timestamp)
    const at = timestamp === undefined ? {} : { timestamp }
    if (row.role === 'tool') {
      window.emit({
        ...base,
        role: 'tool',
        text: clip(resultText(row.content), req.maxCharsPerEvent),
        ...(row.tool_call_id ? { toolCallId: row.tool_call_id } : {}),
        // Carried so a result whose call fell outside the window is still readable by name.
        ...(row.tool_name ? { toolName: row.tool_name } : {}),
        ...at,
      } as TranscriptEvent)
      continue
    }
    const role = row.role === 'user' ? 'user' : 'assistant'
    const text = row.content?.trim()
    if (text) {
      window.emit({
        ...base,
        role,
        text: clip(text, req.maxCharsPerEvent),
        ...at,
      } as TranscriptEvent)
    }
    // The calls live INSIDE the assistant row, so a turn whose prose is empty still carries work —
    // the mistake the Gemini adapter made by skipping a message on empty text alone.
    for (const call of callsOf(row.tool_calls) ?? []) {
      window.emit({
        ...base,
        role: 'assistant',
        text: '',
        toolName: call.name,
        ...(call.id ? { toolCallId: call.id } : {}),
        ...(call.input === undefined ? {} : { toolInput: call.input }),
        ...at,
      } as TranscriptEvent)
    }
  }
}

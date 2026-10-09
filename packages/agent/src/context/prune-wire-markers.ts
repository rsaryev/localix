import type { Message, ToolCall } from '../types'
import { carriesMarker, ELISION_MARKER } from './op-menu'
import { isCompressedContent, MIDDLE_TRUNCATE_MARKER } from './prune-wire-output'

/**
 * The `tool_call_id`s whose results are no longer intact on this wire — elided to a
 * pointer, structurally crushed, or middle-truncated. Pure; scans the FINAL wire, so
 * it sees both compression layers (turn-start VBC and this per-request prune).
 *
 * A host uses it to answer "does the model still have the full output of that call?"
 * — e.g. `read`'s unchanged-file stub ("scroll up to that read") is only truthful
 * while the earlier read is intact; once elided, a repeat read must return the file.
 */
export function collectElidedToolCallIds(messages: readonly Message[]): string[] {
  const out: string[] = []
  for (const m of messages) {
    if (m.role !== 'tool') continue
    for (const r of m.results) {
      if (!r.toolCallId) continue
      const compressed =
        typeof r.content === 'string'
          ? isCompressedContent(r.content)
          : r.content.some((part) => part.type === 'text' && isCompressedContent(part.text))
      if (compressed) out.push(r.toolCallId)
    }
  }
  return out
}

/**
 * The arg half of {@link collectElidedToolCallIds}: `tool_call_id`s of assistant
 * tool calls whose heavy mutate ARGUMENTS are no longer intact on this wire.
 */
export function collectElidedArgToolCallIds(messages: readonly Message[]): string[] {
  const out: string[] = []
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    for (const part of m.content) {
      const tc = part as ToolCall
      if (tc.type !== 'tool_call' || !tc.id || !tc.arguments || typeof tc.arguments !== 'object')
        continue
      const hasMarker = Object.values(tc.arguments as Record<string, unknown>).some(
        (v) =>
          typeof v === 'string' &&
          (carriesMarker(v, ELISION_MARKER) || carriesMarker(v, MIDDLE_TRUNCATE_MARKER)),
      )
      if (hasMarker) out.push(tc.id)
    }
  }
  return out
}

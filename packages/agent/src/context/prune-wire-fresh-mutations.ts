import type { Message, ToolCall } from '../types'
import { textEncoderByteLength } from '../utils/hash'
import { DEFAULT_MAX_BYTES } from '../utils/truncate'
import { carriesMarker, ELISION_MARKER } from './compression-markers'
import { elidedPointer } from './pointers'
import { ALL_MUTATE_TOOLS } from './tool-classes'

/**
 * Bound a fresh, successfully-applied mutation's recoverable payload before the
 * recent-tail and pressure gates can protect it. A single `write`/`edit` call can
 * otherwise exceed the next request's whole context by itself.
 *
 * Only fields that the durable tool item can replay through `tool_output` are
 * eligible. Failed and still-pending calls are deliberately untouched: their input
 * may be the only copy of a change that never reached disk. When several moderate
 * fields jointly exceed the budget, elide the largest first until the serialized
 * arguments fit; this preserves as much verbatim context as possible.
 */
export function boundFreshMutationArgs(
  messages: Message[],
  successfulToolCallIds: ReadonlySet<string>,
  recoveryToolAvailable: boolean,
): Message[] {
  let changed = false
  const out = messages.map((message) => {
    if (message.role !== 'assistant') return message
    let messageChanged = false
    const content = message.content.map((part) => {
      const tc = part as ToolCall
      if (
        tc.type !== 'tool_call' ||
        !successfulToolCallIds.has(tc.id) ||
        !ALL_MUTATE_TOOLS.has(tc.name) ||
        !tc.arguments ||
        typeof tc.arguments !== 'object'
      ) {
        return part
      }
      const args = tc.arguments as Record<string, unknown>
      if (textEncoderByteLength(JSON.stringify(args)) <= DEFAULT_MAX_BYTES) return part

      const candidates: Array<{ field: string; text: string; bytes: number; order: number }> = []
      let order = 0
      for (const field of ['content', 'patch', 'old_string', 'new_string'] as const) {
        const value = args[field]
        if (typeof value === 'string' && !carriesMarker(value, ELISION_MARKER)) {
          candidates.push({
            field,
            text: value,
            bytes: textEncoderByteLength(value),
            order: order++,
          })
        }
      }
      for (const field of ['edits', 'files'] as const) {
        const list = args[field]
        if (!Array.isArray(list)) continue
        const text = JSON.stringify(list)
        if (!carriesMarker(text, ELISION_MARKER)) {
          candidates.push({ field, text, bytes: textEncoderByteLength(text), order: order++ })
        }
      }
      candidates.sort((a, b) => b.bytes - a.bytes || a.order - b.order)

      let next: Record<string, unknown> | undefined
      for (const candidate of candidates) {
        next = {
          ...(next ?? args),
          [candidate.field]: elidedPointer(
            candidate.field,
            candidate.text.length,
            tc.id,
            candidate.text,
            recoveryToolAvailable,
          ),
        }
        if (textEncoderByteLength(JSON.stringify(next)) <= DEFAULT_MAX_BYTES) break
      }
      if (!next) return part
      messageChanged = true
      return { ...tc, arguments: next }
    })
    if (!messageChanged) return message
    changed = true
    return { ...message, content }
  })
  return changed ? out : messages
}

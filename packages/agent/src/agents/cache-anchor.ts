import type { Message as WireMessage } from '..'

/**
 * Mark the prompt-cache anchor on a freshly rebuilt run history: the SECOND-TO-LAST
 * message. The last message is this turn's own addition (its runtime context, or the trigger
 * itself), sent for the first time; everything before it is byte-stable across rebuilds —
 * this converter is deterministic and the host's history is append-only between context
 * checkpoints. The engine forwards the flag and the Anthropic wire turns it into
 * an explicit `cache_control` breakpoint on that message, so the rebuilt history is READ
 * from cache across runs instead of re-written every run. Idempotent; clears any stale
 * anchor first. Mutates in place and returns the same array.
 */
export function markHistoryCacheAnchor(messages: WireMessage[]): WireMessage[] {
  for (const m of messages) if (m.cacheAnchor) delete m.cacheAnchor
  // Walk back from the second-to-last message to the first one that will still be
  // on the wire after `transformMessages` — which DROPS an assistant turn whose
  // `stopReason` is 'error'/'aborted'. Anchoring a message that then gets dropped
  // means no breakpoint lands and the whole history re-writes to cache that run.
  // (Today `toModelMessages` emits no `stopReason`, so this never fires in the
  // rebuilt-history path — but a caller passing raw AssistantMessages, or a future
  // change that carries stopReason through, would silently lose the anchor.)
  for (let i = messages.length - 2; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && (m.stopReason === 'error' || m.stopReason === 'aborted')) continue
    m.cacheAnchor = true
    break
  }
  return messages
}

/**
 * The cache anchor of a FORK's first request: the last message its parent had sent.
 *
 * A fork continues its parent's own conversation, so what its parent sent last is already in the
 * provider's cache. That request ended just before the step that called the fork — the assistant
 * message holding the call — and the fork's request adds that step, its answers and the directive.
 * The default anchor (second-to-last) would land on those new answers, where nothing is cached; the
 * breakpoint goes on the end of the parent's request, and the provider reads up to it.
 *
 * Without the call in the wire (a history that no longer holds it) the ordinary anchor applies.
 * Idempotent; mutates in place and returns the same array.
 */
export function markForkCacheAnchor(messages: WireMessage[], toolCallId: string): WireMessage[] {
  const step = messages.findIndex(
    (m) =>
      m.role === 'assistant' &&
      Array.isArray(m.content) &&
      m.content.some((part) => part.type === 'tool_call' && part.id === toolCallId),
  )
  if (step <= 0) return markHistoryCacheAnchor(messages)
  for (const m of messages) if (m.cacheAnchor) delete m.cacheAnchor
  for (let i = step - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && (m.stopReason === 'error' || m.stopReason === 'aborted')) continue
    m.cacheAnchor = true
    break
  }
  return messages
}

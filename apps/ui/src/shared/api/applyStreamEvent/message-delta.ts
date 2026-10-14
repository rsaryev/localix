/**
 * The live growth of one transcript row between full snapshots (`message.delta`), and the
 * tail proxy that keeps that growth cheap.
 */
import { applyItemAppend } from '@localixai/agent/agents/items'

import type { UiSession } from '../contracts'
import type { StreamReducers } from './types'

// A live delta overwhelmingly replaces only the transcript tail. Keep that growing
// object outside the canonical array so a 100k-row history is not copied at 20 Hz.
// Each proxy is still a real Array and gets a fresh identity for memoized consumers;
// snapshots and run settlement materialize it back into an ordinary array.
const streamedTailBases = new WeakMap<UiSession['messages'], UiSession['messages']>()

/** The messages as an ordinary array — a streamed-tail proxy is copied out, anything else kept. */
export function materializeStreamedTail(messages: UiSession['messages']): UiSession['messages'] {
  return streamedTailBases.has(messages) ? messages.slice() : messages
}

export const messageDeltaReducers: StreamReducers<'message.delta'> = {
  'message.delta': (session, event) => {
    // Live incremental append between full message.updated snapshots: extend the
    // current turn's text/reasoning item — and any tool item's growing string
    // (streamed command output, args being typed; see itemAppends) — in place.
    // We keep reference stability for every OTHER item (return `it` unchanged)
    // so only the growing card re-renders. If the message isn't in the store yet
    // (delta arrived before its baseline), drop it — the next full snapshot
    // carries complete state.
    if (event.sessionId !== session.id) return session
    // The live message is overwhelmingly the transcript tail. Avoid scanning a
    // 100k-row history on every 20 Hz delta; retain findIndex only for replayed or
    // out-of-order streams that legitimately target an older row.
    const tailIndex = session.messages.length - 1
    const idx =
      tailIndex >= 0 && session.messages[tailIndex]?.id === event.messageId
        ? tailIndex
        : session.messages.findIndex((m) => m.id === event.messageId)
    if (idx === -1) return session
    const msg = session.messages[idx]
    let changed = false
    let nextItems = msg.items
    if (msg.items?.length) {
      // Normal frames carry at most a small append batch. Indexing matters when
      // transport coalescing turns bursty tool output into a much larger batch:
      // items + appends instead of nesting every append scan under every item.
      const appendsByItemId = new Map<string, typeof event.itemAppends>()
      for (const append of event.itemAppends ?? []) {
        const appends = appendsByItemId.get(append.itemId) ?? []
        appends.push(append)
        appendsByItemId.set(append.itemId, appends)
      }
      nextItems = msg.items.map((it) => {
        if (event.textAppend && it.id === event.textItemId && it.type === 'text') {
          changed = true
          return { ...it, text: (it.text ?? '') + event.textAppend }
        }
        if (event.reasoningAppend && it.id === event.reasoningItemId && it.type === 'reasoning') {
          changed = true
          return { ...it, text: (it.text ?? '') + event.reasoningAppend }
        }
        let grown = it
        for (const ap of appendsByItemId.get(grown.id) ?? []) {
          // Shape mismatch (client state drifted) → keep as-is; next snapshot resyncs.
          const applied = applyItemAppend(grown, ap)
          if (applied) {
            grown = applied
            changed = true
          }
        }
        return grown
      })
    }
    // Plain-content growth (external-child streams often carry no items at all).
    const nextContent = event.contentAppend ? (msg.content ?? '') + event.contentAppend : undefined
    if (nextContent !== undefined) changed = true
    if (!changed) return session
    const nextMessage = {
      ...msg,
      items: nextItems,
      ...(nextContent !== undefined ? { content: nextContent } : {}),
    }
    let messages: UiSession['messages']
    if (idx === tailIndex) {
      const base = streamedTailBases.get(session.messages) ?? session.messages
      const tailProperty = String(idx)
      messages = new Proxy(base, {
        get(target, property, receiver) {
          return property === tailProperty ? nextMessage : Reflect.get(target, property, receiver)
        },
        getOwnPropertyDescriptor(target, property) {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
          return property === tailProperty && descriptor
            ? { ...descriptor, value: nextMessage }
            : descriptor
        },
      })
      streamedTailBases.set(messages, base)
    } else {
      messages = session.messages.slice()
      messages[idx] = nextMessage
    }
    // Deltas are the authoritative "this message is live" signal — covers
    // sessions (re)connected mid-stream that never saw message.created.
    return { ...session, messages, streamingMessageId: event.messageId }
  },
}

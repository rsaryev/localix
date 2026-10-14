import { describe, expect, test } from 'bun:test'

import { createChatCacheSnapshot } from './chat-cache'
import { createPromptTextStore } from './prompt-text-store'

describe('the prompt-text store', () => {
  test('the text is retrievable by the hash the snapshot computed', () => {
    // The invariant that makes the whole thing worth having: the key is not a key this store
    // invented, it is the hash already on the wire. If these ever disagreed, a diff would be
    // between two texts nobody sent.
    const store = createPromptTextStore()
    const systemPrompt = 'you are helpful\n# Runtime context\nConversation date: 2026-08-20'
    const snapshot = createChatCacheSnapshot({ modelId: 'm', systemPrompt, messageCount: 0 })

    store.put(snapshot.systemPromptHash, systemPrompt)
    expect(store.get(snapshot.systemPromptHash)).toBe(systemPrompt)
  })

  test('the same text stored twice is one entry', () => {
    // Content addressing IS the dedup: a session whose prefix is stable keeps one copy of it
    // however many turns it runs.
    const store = createPromptTextStore()
    store.put('h', 'same')
    store.put('h', 'same')
    expect(store.size()).toBe(1)
  })

  test('the oldest entry is evicted, and a read counts as use', () => {
    const store = createPromptTextStore({ maxEntries: 2 })
    store.put('a', 'A')
    store.put('b', 'B')
    // Touching `a` makes `b` the oldest, so `b` is what a third entry displaces.
    expect(store.get('a')).toBe('A')
    store.put('c', 'C')

    expect(store.get('b')).toBeUndefined()
    expect(store.get('a')).toBe('A')
    expect(store.get('c')).toBe('C')
  })

  test('an oversized text is refused rather than truncated', () => {
    // A truncated prompt diffed against a whole one produces a difference that is an artefact
    // of this store — a diagnostic that invents differences is worse than one that says
    // nothing.
    const store = createPromptTextStore({ maxTextChars: 8 })
    store.put('big', 'x'.repeat(9))
    expect(store.get('big')).toBeUndefined()
    store.put('ok', 'x'.repeat(8))
    expect(store.get('ok')).toBe('x'.repeat(8))
  })

  test('an empty hash is not a key', () => {
    const store = createPromptTextStore()
    store.put('', 'orphan')
    expect(store.size()).toBe(0)
  })
})

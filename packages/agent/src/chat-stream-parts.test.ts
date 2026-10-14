import { describe, expect, test } from 'bun:test'

import { createChatCacheDiagnostics } from './chat-stream-parts'
import type { ChatCacheSnapshotPayload } from './chat-stream-types'

function snapshot(overrides: Partial<ChatCacheSnapshotPayload> = {}): ChatCacheSnapshotPayload {
  return {
    modelId: 'model',
    systemPromptHash: 'system',
    stablePrefixHash: 'prefix',
    toolNamesHash: 'names',
    systemPromptBytes: 10,
    stablePrefixBytes: 10,
    dynamicSuffixBytes: 0,
    promptContextBytes: 0,
    messageCount: 1,
    toolNames: ['read'],
    hasSystemCacheBoundary: true,
    promptContextCacheTarget: 'provider',
    ...overrides,
  }
}

describe('createChatCacheDiagnostics', () => {
  test('the first turn reports the snapshot and nothing to compare it to', () => {
    expect(createChatCacheDiagnostics(snapshot())).toEqual({ snapshot: snapshot() })
    expect(createChatCacheDiagnostics(snapshot(), null).previous).toBeUndefined()
  })

  test('an identical turn reports no change rather than an empty change list', () => {
    // `previous: { changed: [] }` reads as "we compared and something moved"; the caller renders a
    // cache-miss reason from it. Absence is the only honest shape for a prefix that held.
    expect(createChatCacheDiagnostics(snapshot(), snapshot()).previous).toBeUndefined()
  })

  test('a changed key is named by what the reader recognises, not by its hash field', () => {
    const changed = createChatCacheDiagnostics(
      snapshot({ stablePrefixHash: 'prefix-b', modelId: 'model-b' }),
      snapshot(),
    ).previous?.changed

    // The label drops the `Hash` suffix — the diagnostic names the THING that moved. `modelId` has
    // no label and passes through as itself, which is the fallback that keeps a newly diffed key
    // legible before anyone thinks to name it.
    expect(changed).toEqual(['modelId', 'stablePrefix'])
  })

  test('an undefined-to-set optional counts as a change', () => {
    // `promptContextHash` is absent when there is no injected context. Going from absent to present
    // is exactly a cache break, and comparing with `!==` is what makes it visible.
    const changed = createChatCacheDiagnostics(snapshot({ promptContextHash: 'ctx' }), snapshot())
      .previous?.changed

    expect(changed).toEqual(['promptContext'])
  })

  test('byte counts and the tool-name list move without being reported as cache breaks', () => {
    // Only the diffed keys speak. `systemPromptBytes` and `toolNames` ride along for display, and a
    // hash change is what proves content moved — reporting sizes too would double-count one break.
    const changed = createChatCacheDiagnostics(
      snapshot({ systemPromptBytes: 999, toolNames: ['read', 'write'] }),
      snapshot(),
    ).previous?.changed

    expect(changed).toBeUndefined()
  })
})

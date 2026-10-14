import { describe, expect, test } from 'bun:test'

import {
  clampSnippetContent,
  makeSnippetRef,
  parseContextRefs,
  SNIPPET_CONTENT_MAX,
} from '@localixai/api/context-refs'
import type { MessageContextBinding } from '@/shared/api/contracts'
import {
  contextRefsMissingFromComposerText,
  droppedRefCount,
  includeAutoRef,
  includeAutoRefs,
  inlineCompletionReferences,
  inlineRefChars,
  isInlineContentRef,
  MAX_SEND_REFS,
  refFromToken,
  refFromContextBinding,
  refsFromContextBindingDrafts,
  resolveSendRefs,
} from './sendRefs'
import { COMPLETION_INLINE_CONTENT_MAX, COMPLETION_REFERENCE_LIMIT } from '@localixai/api/client'

const snippet = (label: string, content: string) =>
  makeSnippetRef({ label, content, language: 'text' })

describe('refsFromContextBindingDrafts', () => {
  test('preserves opaque Reader resources and deduplicates repeated action context', () => {
    const binding = {
      kind: 'context' as const,
      source: 'plugin' as const,
      target: {
        kind: 'resource' as const,
        token: '@resource:opaque:plugin-resource/book/0',
        label: 'Book · Chapter 1',
        uri: 'opaque:plugin-resource/book/0',
      },
    }
    const refs = refsFromContextBindingDrafts([binding, binding])

    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      key: '@resource:opaque:plugin-resource/book/0',
      uri: 'opaque:plugin-resource/book/0',
      label: 'Book · Chapter 1',
      messageBinding: { source: 'plugin', target: binding.target },
    })
  })

  test('caps context labels to the API limit without dropping the reference', () => {
    const label = 'x'.repeat(513)
    const [ref] = refsFromContextBindingDrafts([
      {
        kind: 'context',
        source: 'plugin',
        target: {
          kind: 'terminal',
          token: '@terminal:long-command',
          label,
        },
      },
    ])

    expect(ref.label).toHaveLength(512)
    expect(ref.label).toEndWith('…')
    expect(ref.messageBinding?.target.label).toBe(ref.label)
  })

  test('leaves a label at the limit untouched', () => {
    const label = 'x'.repeat(512)
    const [ref] = refsFromContextBindingDrafts([
      {
        kind: 'context',
        source: 'plugin',
        target: { kind: 'terminal', token: '@terminal:exact', label },
      },
    ])

    expect(ref.label).toBe(label)
    expect(ref.messageBinding?.target.label).toBe(label)
  })
})

describe('inlineRefChars / isInlineContentRef', () => {
  test('sums the inline content length of pinned refs', () => {
    expect(inlineRefChars([snippet('a', 'hello'), snippet('b', 'world!')])).toBe(11)
    expect(inlineRefChars([])).toBe(0)
  })

  test('recognizes snippet as an inline-content kind (file is not)', () => {
    expect(isInlineContentRef(snippet('a', 'x'))).toBe(true)
    expect(isInlineContentRef(parseContextRefs('@file:a.ts')[0])).toBe(false)
  })
})

describe('inlineCompletionReferences', () => {
  test('carries pinned then typed chips as linked references, deduplicated and bounded', () => {
    const active = parseContextRefs('@file:src/active.ts')[0]!
    const oversized = snippet('Live result', 'x'.repeat(10_000))
    const references = inlineCompletionReferences({
      pinnedRefs: [oversized, active],
      textRefs: [active, ...parseContextRefs('@file:src/manual.ts')],
    })

    expect(references.map((reference) => reference.token)).toEqual([
      '@snippet:Live result',
      '@file:src/active.ts',
      '@file:src/manual.ts',
    ])
    expect(references.every((reference) => reference.origin === 'linked')).toBe(true)
    // The socket rejects the WHOLE request for one over-long attribute, so it is clipped here.
    expect(String(references[0]?.attributes?.content).length).toBe(COMPLETION_INLINE_CONTENT_MAX)
  })

  test('caps the auxiliary context independently from the message-send cap', () => {
    const references = inlineCompletionReferences({
      pinnedRefs: [],
      textRefs: Array.from(
        { length: 20 },
        (_, index) => parseContextRefs(`@file:src/${index}.ts`)[0]!,
      ),
    })
    expect(references).toHaveLength(COMPLETION_REFERENCE_LIMIT)
  })
})

describe('resolveSendRefs', () => {
  test('includes a drag-added snippet with NO prompt token (the core requirement)', () => {
    const wire = resolveSendRefs({
      // The prompt had no @token at all — the snippet arrives purely structured.
      textRefs: [],
      pinnedRefs: [snippet('Output — mydb', 'row 1\nrow 2')],
      knownTextChars: 0,
      contextTokens: undefined,
    })
    expect(wire).toHaveLength(1)
    expect(wire?.[0]).toMatchObject({
      kind: 'context',
      target: {
        token: '@snippet:Output — mydb',
        kind: 'snippet',
        label: 'Output — mydb',
        attributes: { content: 'row 1\nrow 2', language: 'text' },
      },
      resolution: { status: 'pending', contributions: [] },
    })
  })

  // The owner is what brings the plugin's tools to the turn; dropping it here would send the tab's
  // context and none of its tools.
  test("an ambient plugin tab's owner rides to the wire", () => {
    const [ambient] = refsFromContextBindingDrafts([
      {
        kind: 'context',
        source: 'active-tab',
        plugin: 'fixture-board',
        target: {
          kind: 'resource',
          token: '@resource:localix://resource/fixture-board/board',
          label: 'Board',
          uri: 'localix://resource/fixture-board/board',
        },
      },
    ])
    const wire = resolveSendRefs({
      textRefs: [],
      pinnedRefs: [],
      autoRefs: [ambient!],
      knownTextChars: 0,
      contextTokens: undefined,
    })
    expect(wire?.[0]).toMatchObject({
      kind: 'context',
      source: 'active-tab',
      plugin: 'fixture-board',
    })
  })

  test('unions text refs and pinned refs (text first, then pinned)', () => {
    const wire = resolveSendRefs({
      textRefs: parseContextRefs('see @file:a.ts'),
      pinnedRefs: [snippet('sel', 'SELECT 1')],
      knownTextChars: 100,
      contextTokens: undefined,
    })
    expect(wire?.map((r) => r.target.kind)).toEqual(['file', 'snippet'])
  })

  test('no refs at all → empty array (never null)', () => {
    expect(
      resolveSendRefs({
        textRefs: [],
        pinnedRefs: [],
        knownTextChars: 0,
        contextTokens: undefined,
      }),
    ).toEqual([])
  })

  test('blocks the send (null) when the combined size exceeds the model window', () => {
    // 1000-token window → ~4000-char budget; block > 50% (2000 chars).
    const huge = 'x'.repeat(3000)
    expect(
      resolveSendRefs({
        textRefs: [],
        pinnedRefs: [snippet('big', huge)],
        knownTextChars: 0,
        contextTokens: 1000,
      }),
    ).toBeNull()
  })

  test('counts the pinned inline content toward the budget alongside text chars', () => {
    // text chars (1500) + pinned (600) = 2100 > 2000 block threshold for a 1000-token window.
    expect(
      resolveSendRefs({
        textRefs: parseContextRefs('@file:a.ts'),
        pinnedRefs: [snippet('s', 'y'.repeat(600))],
        knownTextChars: 1500,
        contextTokens: 1000,
      }),
    ).toBeNull()
  })
})

describe('clampSnippetContent', () => {
  test('passes small content through untouched', () => {
    expect(clampSnippetContent('SELECT 1')).toBe('SELECT 1')
  })

  test('clamps over-cap content to the server limit with a truncation note', () => {
    const clamped = clampSnippetContent('x'.repeat(SNIPPET_CONTENT_MAX + 500))
    expect(clamped.length).toBe(SNIPPET_CONTENT_MAX)
    expect(clamped.endsWith('[snippet truncated: exceeded the 100 KB limit]')).toBe(true)
  })

  test('content exactly at the cap is untouched', () => {
    const exact = 'y'.repeat(SNIPPET_CONTENT_MAX)
    expect(clampSnippetContent(exact)).toBe(exact)
  })
})

describe('20-ref wire cap', () => {
  const files = (n: number) =>
    Array.from({ length: n }, (_, i) => parseContextRefs(`@file:f${i}.ts`)[0])

  test('caps at MAX_SEND_REFS, keeping pinned refs + earliest text refs', () => {
    const wire = resolveSendRefs({
      textRefs: files(25),
      pinnedRefs: [snippet('s', 'x')],
      knownTextChars: 0,
      contextTokens: undefined,
    })
    expect(wire).toHaveLength(MAX_SEND_REFS)
    // Pinned survives; the earliest 19 text refs fill the rest.
    expect(wire?.some((r) => r.target.kind === 'snippet')).toBe(true)
    expect(wire?.[0]?.target.token).toBe('@file:f0.ts')
    expect(wire?.filter((r) => r.target.kind === 'file')).toHaveLength(19)
  })

  test('exactly 20 refs pass untouched', () => {
    const wire = resolveSendRefs({
      textRefs: files(20),
      pinnedRefs: [],
      knownTextChars: 0,
      contextTokens: undefined,
    })
    expect(wire).toHaveLength(20)
  })

  test('droppedRefCount reports the overflow', () => {
    expect(droppedRefCount(25, 1)).toBe(6)
    expect(droppedRefCount(19, 1)).toBe(0)
    expect(droppedRefCount(0, 0)).toBe(0)
  })
})

describe('refFromToken', () => {
  test('parses a typed-kind token into a pinned-channel ref', () => {
    const ref = refFromToken('@file:src/a.ts')
    expect(ref?.kind).toBe('file')
    expect(ref?.path).toBe('src/a.ts')
    expect(ref?.key).toBe('@file:src/a.ts')
  })

  test('parses a resource token', () => {
    const ref = refFromToken('@resource:localix://resource/fixture-db/c1/_/public/users')
    expect(ref?.kind).toBe('resource')
    expect(ref?.uri).toBe('localix://resource/fixture-db/c1/_/public/users')
  })

  test('reconstructs the structured-only @message token', () => {
    const ref = refFromToken('@message:LOCALIX-1/abc123')
    expect(ref?.kind).toBe('message')
    expect(ref?.sessionId).toBe('LOCALIX-1')
    expect(ref?.messageId).toBe('abc123')
  })

  test('returns null for plain words / link-only mentions', () => {
    expect(refFromToken('hello')).toBeNull()
    expect(refFromToken('@src/a.ts')).toBeNull()
  })
})

describe('returned context bindings', () => {
  const binding = (
    token: string,
    target: {
      kind?: string
      label?: string
      attributes?: Record<string, string | number | boolean>
    } = {},
  ): MessageContextBinding => ({
    kind: 'context',
    id: `binding:${token}`,
    source: 'mention',
    target: {
      kind: target.kind ?? 'file',
      token,
      label: target.label ?? token,
      ...(target.attributes ? { attributes: target.attributes } : {}),
    },
    resolution: { status: 'resolved', contributions: [] },
  })

  test('does not pin a ref whose token is already represented in the restored text', () => {
    expect(
      contextRefsMissingFromComposerText('inspect @file:src/a.ts please', [
        binding('@file:src/a.ts'),
      ]),
    ).toEqual([])
    expect(
      contextRefsMissingFromComposerText('inspect @file:src/a.ts.', [binding('@file:src/a.ts')]),
    ).toEqual([])
  })

  test('re-stages a token-less snippet with its captured structured metadata', () => {
    const snippetBinding = binding('@snippet:result', {
      kind: 'snippet',
      label: 'result',
      attributes: { content: 'row 1\nrow 2', language: 'sql' },
    })

    expect(contextRefsMissingFromComposerText('inspect these rows', [snippetBinding])).toEqual([
      expect.objectContaining({
        raw: '@snippet:result',
        key: '@snippet:result',
        kind: 'snippet',
        label: 'result',
        content: 'row 1\nrow 2',
        language: 'sql',
        messageBinding: {
          source: 'mention',
          target: snippetBinding.target,
        },
      }),
    ])
  })

  test('restores a plugin tab owner so its tool is active when the message is resent', () => {
    const original: MessageContextBinding = {
      ...binding('@snippet:board', {
        kind: 'snippet',
        label: 'Board',
        attributes: { content: 'Current board' },
      }),
      source: 'active-tab',
      plugin: 'fixture-board',
    }
    const [restored] = contextRefsMissingFromComposerText('inspect the board', [original])
    const wire = resolveSendRefs({
      textRefs: [],
      pinnedRefs: [restored!],
      knownTextChars: 0,
      contextTokens: undefined,
    })

    expect(wire?.[0]).toMatchObject({
      source: 'active-tab',
      plugin: 'fixture-board',
      target: original.target,
    })
  })

  test('caps an over-long label on the restore path too, envelope included', () => {
    const [ref] = contextRefsMissingFromComposerText('inspect this', [
      binding('@terminal:long', { kind: 'terminal', label: 'y'.repeat(4096) }),
    ])

    expect(ref.label).toHaveLength(512)
    expect(ref.label).toEndWith('…')
    // The envelope is what rides the wire and is re-read by the drag validator,
    // which rejects a label over 512 outright — it must be clamped in lockstep.
    expect(ref.messageBinding?.target.label).toBe(ref.label)
    expect(ref.messageBinding?.target.token).toBe('@terminal:long')
  })

  test('reconstructs an absent file binding as a structured pin instead of mutating text', () => {
    expect(refFromContextBinding(binding('@file:src/a.ts'))).toMatchObject({
      raw: '@file:src/a.ts',
      key: '@file:src/a.ts',
      kind: 'file',
      path: 'src/a.ts',
    })
  })

  test('preserves an opaque plugin URI, attributes, and active-tab provenance through send', () => {
    const target: MessageContextBinding['target'] = {
      kind: 'resource',
      token: '@resource:localix://resource/fixture-market/main/BTC-USD/candles/4h',
      label: 'BTC-USD · 4h',
      uri: 'localix://resource/fixture-market/main/BTC-USD/candles/4h',
      attributes: {
        timeframe: '4h',
        providerFacet: 'candles',
      },
    }
    const ref = refFromContextBinding({ source: 'active-tab', target })
    const wire = resolveSendRefs({
      textRefs: [],
      pinnedRefs: [],
      autoRefs: [ref],
      autoRefChars: new Map([[ref.key, 100]]),
      knownTextChars: 0,
      contextTokens: undefined,
    })
    expect(wire?.[0]).toMatchObject({
      source: 'active-tab',
      target,
      resolution: { status: 'pending', contributions: [] },
    })
  })

  test('preserves exact live-selection content and 1-based position metadata through send', () => {
    const target: MessageContextBinding['target'] = {
      kind: 'snippet',
      token: '@snippet:foo.ts L12-L13',
      label: 'foo.ts L12-L13',
      attributes: {
        content: 'const first = 1\nconst second = 2',
        path: '/workspace/src/foo.ts',
        language: 'typescript',
        startLine: 12,
        startColumn: 3,
        endLine: 13,
        endColumn: 19,
        selection: true,
      },
    }
    const ref = refFromContextBinding({ source: 'active-tab', target })
    expect(ref).toMatchObject({
      content: 'const first = 1\nconst second = 2',
      path: '/workspace/src/foo.ts',
      startLine: 12,
      startColumn: 3,
      endLine: 13,
      endColumn: 19,
    })

    const wire = resolveSendRefs({
      textRefs: [],
      pinnedRefs: [],
      autoRefs: [ref],
      knownTextChars: 0,
      contextTokens: undefined,
    })
    expect(wire?.[0]).toMatchObject({
      source: 'active-tab',
      target,
      resolution: { status: 'pending', contributions: [] },
    })
  })
})

describe('pinned shadows an identical typed token', () => {
  test('resolveSendRefs drops a text ref whose key is pinned', () => {
    const pinned = refFromToken('@file:src/a.ts')
    const typed = parseContextRefs('@file:src/a.ts @file:b.ts')
    const wire = resolveSendRefs({
      textRefs: typed,
      pinnedRefs: pinned ? [pinned] : [],
      knownTextChars: 0,
      contextTokens: undefined,
    })
    expect(wire).toHaveLength(2)
    expect(wire?.filter((r) => r.target.token === '@file:src/a.ts')).toHaveLength(1)
  })
})

describe('includeAutoRef (active-tab auto-link precedence)', () => {
  const ref = (token: string) => parseContextRefs(token)[0]!
  const none: ReadonlySet<string> = new Set()

  test('rides when nothing duplicates it', () => {
    const auto = ref('@file:src/a.ts')
    expect(includeAutoRef(auto, [], none, [])).toBe(auto)
  })

  test('yields to a manual pinned ref with the same key', () => {
    const auto = ref('@file:src/a.ts')
    expect(includeAutoRef(auto, [], none, [ref('@file:src/a.ts')])).toBeNull()
  })

  test('yields to a live typed token with the same key', () => {
    const auto = ref('@file:src/a.ts')
    expect(includeAutoRef(auto, [ref('@file:src/a.ts')], none, [])).toBeNull()
  })

  test('an EXCLUDED typed token does not shadow it', () => {
    const auto = ref('@file:src/a.ts')
    const typed = ref('@file:src/a.ts')
    expect(includeAutoRef(auto, [typed], new Set([typed.key]), [])).toBe(auto)
  })

  test('null/undefined auto contributes nothing', () => {
    expect(includeAutoRef(null, [], none, [])).toBeNull()
    expect(includeAutoRef(undefined, [], none, [])).toBeNull()
  })
})

describe('includeAutoRefs (N ambient candidates)', () => {
  const ref = (token: string) => parseContextRefs(token)[0]!
  const none: ReadonlySet<string> = new Set()

  test('keeps every distinct ambient ref, in the order given', () => {
    const a = ref('@file:src/a.ts')
    const b = ref('@file:src/b.ts')
    const c = ref('@terminal:t1')
    expect(includeAutoRefs([a, b, c], [], none, []).map((r) => r.raw)).toEqual([
      a.raw,
      b.raw,
      c.raw,
    ])
  })

  test('two ambient candidates for the SAME ref collapse to the FRESHEST', () => {
    // The same file open in two groups, or a tab re-homed while its id lingers in another
    // group's MRU. Sending it twice would expand one file twice.
    const fresh = { ...ref('@file:src/a.ts'), label: 'fresh' }
    const stale = { ...ref('@file:src/a.ts'), label: 'stale' }
    const kept = includeAutoRefs([fresh, stale], [], none, [])
    expect(kept).toHaveLength(1)
    expect(kept[0]?.label).toBe('fresh')
  })

  test('each candidate independently yields to a deliberate duplicate', () => {
    const a = ref('@file:src/a.ts')
    const b = ref('@file:src/b.ts')
    const c = ref('@file:src/c.ts')
    // a is pinned by hand, b is typed in the prompt — only c is still ambient.
    const kept = includeAutoRefs([a, b, c], [b], none, [a])
    expect(kept.map((r) => r.raw)).toEqual([c.raw])
  })

  test('an empty candidate list contributes nothing', () => {
    expect(includeAutoRefs([], [], none, [])).toEqual([])
  })
})

describe('the wire cap sheds ambient refs before deliberate ones', () => {
  const ref = (token: string) => parseContextRefs(token)[0]!
  const files = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => ref(`@file:${prefix}${i}.ts`))

  test('20 hand-pinned refs survive alongside 3 ambient tabs — the ambient ones go', () => {
    // The defect this guards: ambient refs used to ride FIRST in the pinned channel, so
    // three open tabs silently pushed three hand-added links off a full message.
    const pinned = files('pin', MAX_SEND_REFS)
    const wire = resolveSendRefs({
      textRefs: [],
      pinnedRefs: pinned,
      autoRefs: files('tab', 3),
      knownTextChars: 0,
      contextTokens: undefined,
    })
    expect(wire).toHaveLength(MAX_SEND_REFS)
    const tokens = wire!.map((r) => r.target.token)
    for (const p of pinned) expect(tokens).toContain(p.raw)
    expect(tokens.filter((t) => t.includes('tab'))).toEqual([])
  })

  test('a typed token also outranks an ambient tab at the cap', () => {
    const text = files('typed', MAX_SEND_REFS)
    const wire = resolveSendRefs({
      textRefs: text,
      pinnedRefs: [],
      autoRefs: files('tab', 2),
      knownTextChars: 0,
      contextTokens: undefined,
    })
    expect(wire?.map((r) => r.target.token).filter((t) => t.includes('tab'))).toEqual([])
    expect(wire).toHaveLength(MAX_SEND_REFS)
  })

  test('ambient refs take the slots the manual channels leave', () => {
    const wire = resolveSendRefs({
      textRefs: files('typed', 2),
      pinnedRefs: files('pin', 1),
      autoRefs: files('tab', 3),
      knownTextChars: 0,
      contextTokens: undefined,
    })
    expect(wire).toHaveLength(6)
    // Ambient last on the wire, in the order given (freshest first).
    expect(wire!.slice(3).map((r) => r.target.token)).toEqual([
      '@file:tab0.ts',
      '@file:tab1.ts',
      '@file:tab2.ts',
    ])
  })

  test('an ambient ref duplicating a kept manual ref is not sent twice', () => {
    const shared = ref('@file:src/a.ts')
    const wire = resolveSendRefs({
      textRefs: [],
      pinnedRefs: [shared],
      autoRefs: [shared, ref('@file:src/b.ts')],
      knownTextChars: 0,
      contextTokens: undefined,
    })
    expect(wire?.map((r) => r.target.token)).toEqual(['@file:src/a.ts', '@file:src/b.ts'])
  })

  test('with no ambient channel at all the payload is byte-identical to before', () => {
    const base = { textRefs: files('typed', 2), pinnedRefs: files('pin', 1), knownTextChars: 0 }
    const before = resolveSendRefs({ ...base, contextTokens: undefined })
    const after = resolveSendRefs({ ...base, autoRefs: [], contextTokens: undefined })
    expect(after?.map((r) => r.target.token)).toEqual(before?.map((r) => r.target.token))
  })

  test('an oversized inline ambient snapshot is omitted and never blocks the send', () => {
    const liveTable = snippet('Live table', 'x'.repeat(3000))
    const wire = resolveSendRefs({
      textRefs: [],
      pinnedRefs: [],
      autoRefs: [liveTable],
      autoRefChars: new Map([[liveTable.key, liveTable.content?.length ?? 0]]),
      knownTextChars: 0,
      // ~4k chars total; the >2k hard threshold sheds ambient context.
      contextTokens: 1000,
    })
    expect(wire).toEqual([])
  })
})

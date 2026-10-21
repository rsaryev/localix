import { describe, expect, test } from 'bun:test'

import type { ContextRefExpansion } from '../features/projects/contracts'
import { contextRefSchema, SNIPPET_CONTENT_MAX } from '../features/projects/contracts'
import {
  classifyExpansionBudget,
  formatRefExpansionBlock,
  makeSnippetRef,
  makeMessageRef,
  messageRefFromRaw,
  parseContextRefs,
  refLabel,
  refToken,
  snippetRefFromRaw,
  totalExpansionChars,
  toWireRef,
  INITIAL_MENTION_MENU_STATE,
  reduceMentionMenu,
} from './context-refs'

describe('parseContextRefs', () => {
  test('parses file refs with optional line ranges', () => {
    expect(parseContextRefs('@file:src/a.ts')).toMatchObject([
      { kind: 'file', path: 'src/a.ts', raw: '@file:src/a.ts' },
    ])
    expect(parseContextRefs('@file:src/a.ts:10-25')).toMatchObject([
      { kind: 'file', path: 'src/a.ts', startLine: 10, endLine: 25 },
    ])
    expect(parseContextRefs('@file:src/a.ts:42')).toMatchObject([
      { kind: 'file', startLine: 42, endLine: undefined },
    ])
  })

  test('parses folder / session refs', () => {
    expect(parseContextRefs('@folder:src/lib/')).toMatchObject([
      { kind: 'folder', path: 'src/lib', raw: '@folder:src/lib' },
    ])
    expect(parseContextRefs('@session:LOCALIX-42')).toMatchObject([
      { kind: 'session', sessionId: 'LOCALIX-42' },
    ])
  })

  test('strips trailing punctuation and dedups by key', () => {
    expect(parseContextRefs('see @file:a.ts. and again @file:a.ts')).toMatchObject([
      { path: 'a.ts' },
    ])
  })

  test('ignores an @ mid-token (must be at start or after whitespace)', () => {
    expect(parseContextRefs('email me@file:a.ts')).toEqual([])
  })

  test('dedupes repeated refs, preserving first-seen order', () => {
    const refs = parseContextRefs('@folder:src and @file:a.ts then @folder:src again')
    expect(refs.map((r) => r.raw)).toEqual(['@folder:src', '@file:a.ts'])
    expect(parseContextRefs('@session:LOCALIX-1 and @session:LOCALIX-1').length).toBe(1)
  })
})

describe('reduceMentionMenu', () => {
  test('resets on a changed token and reopens a dismissed menu', () => {
    const dismissed = reduceMentionMenu(
      { signature: '@fi', index: 1, dismissedSignature: null },
      { type: 'dismiss' },
    )
    expect(dismissed.dismissedSignature).toBe('@fi')
    expect(reduceMentionMenu(dismissed, { type: 'sync', signature: '@fil', rowCount: 3 })).toEqual({
      signature: '@fil',
      index: 0,
      dismissedSignature: null,
    })
  })

  test('wraps keyboard navigation and clamps after result changes', () => {
    const start = { ...INITIAL_MENTION_MENU_STATE, signature: '@', index: 0 }
    expect(reduceMentionMenu(start, { type: 'move', delta: -1, rowCount: 3 }).index).toBe(2)
    expect(
      reduceMentionMenu({ ...start, index: 2 }, { type: 'move', delta: 1, rowCount: 3 }).index,
    ).toBe(0)
    expect(
      reduceMentionMenu({ ...start, index: 2 }, { type: 'sync', signature: '@', rowCount: 1 })
        .index,
    ).toBe(0)
  })
})

describe('refLabel', () => {
  test('produces compact labels per kind', () => {
    expect(refLabel(parseContextRefs('@file:src/deep/a.ts:3-9')[0])).toBe('a.ts:3-9')
    expect(refLabel(parseContextRefs('@folder:src/lib')[0])).toBe('lib/')
    expect(refLabel(parseContextRefs('@session:LOCALIX-1')[0])).toBe('LOCALIX-1')
  })
})

describe('formatRefExpansionBlock', () => {
  const exp = (over: Partial<ContextRefExpansion>): ContextRefExpansion =>
    ({ raw: '@file:a.ts', ok: true, chars: 0, ...over }) as ContextRefExpansion

  test('formats a successful expansion as a header + fenced block', () => {
    const out = formatRefExpansionBlock(exp({ content: 'const a = 1', language: 'ts', chars: 11 }))
    expect(out).toContain('--- @file:a.ts ---')
    expect(out).toContain('```ts\nconst a = 1\n```')
  })

  test('uses a longer fence when content contains backtick runs', () => {
    const out = formatRefExpansionBlock(
      exp({ raw: '@file:a.md', content: '```js\nx\n```', chars: 10 }),
    )
    expect(out).toContain('````') // fence longer than the inner ```
  })

  test('emits a warning line for failed expansions, pointing the agent at its tools', () => {
    const out = formatRefExpansionBlock(exp({ ok: false, error: 'not found' }))
    expect(out).toContain('(could not expand: not found — read it with your tools if you need it)')
    expect(out).not.toContain('```')
  })

  test('a truncated expansion says so in the header so the agent knows to read on', () => {
    const out = formatRefExpansionBlock(exp({ content: 'x', chars: 1, truncated: true }))
    expect(out).toContain('--- @file:a.ts (truncated — read the source directly for the rest) ---')
  })
})

describe('toWireRef', () => {
  test('keeps only the registry fields (drops the client-only key)', () => {
    const wire = toWireRef(parseContextRefs('@file:a.ts:10-20')[0])
    // toStrictEqual, not toEqual: `toWireRef` is thirteen `...(x !== undefined ? {k:x} : {})`
    // spreads whose entire job is OMITTING absent keys, and toEqual treats `{k: undefined}` as
    // absent — so it cannot see a spread rewritten into an unconditional `k: ref.k`.
    expect(wire).toStrictEqual({
      raw: '@file:a.ts:10-20',
      kind: 'file',
      path: 'a.ts',
      startLine: 10,
      endLine: 20,
    })
    expect('key' in wire).toBe(false)
  })

  test('carries workdir-free ids', () => {
    expect(toWireRef(parseContextRefs('@terminal:abc12345')[0])).toStrictEqual({
      raw: '@terminal:abc12345',
      kind: 'terminal',
      terminalId: 'abc12345',
    })
  })

  // Regression: the composer chip PREVIEW hand-built its wire payload and dropped
  // `uri`, so every dragged @resource: chip previewed as ok:false (FAILED, red +
  // strikethrough). toWireRef MUST carry `uri` — both send and preview use it.
  test('carries the resource uri (regression: dropped uri → FAILED chip)', () => {
    expect(
      toWireRef(parseContextRefs('@resource:localix://resource/fixture-db/c1/_/public/orders')[0]),
    ).toStrictEqual({
      raw: '@resource:localix://resource/fixture-db/c1/_/public/orders',
      kind: 'resource',
      uri: 'localix://resource/fixture-db/c1/_/public/orders',
    })
  })
})

describe('classifyExpansionBudget + totalExpansionChars', () => {
  const exp = (chars: number): ContextRefExpansion =>
    ({ raw: '', ok: true, chars }) as ContextRefExpansion

  test('sums known refs, missing contribute 0', () => {
    const refs = parseContextRefs('@file:a.ts @file:b.ts')
    const map = new Map([[refs[0].key, exp(100)]])
    expect(totalExpansionChars(refs, map)).toBe(100)
  })

  test('empty refs sum to 0', () => {
    expect(totalExpansionChars([], new Map())).toBe(0)
  })

  test('applies the keyOf indirection when ref keys differ from map keys', () => {
    const refs = parseContextRefs('@file:a.ts')
    const map = new Map([[`exp:${refs[0].key}`, exp(42)]])
    expect(totalExpansionChars(refs, map, (k) => `exp:${k}`)).toBe(42)
    // Without the mapping the lookup misses → 0.
    expect(totalExpansionChars(refs, map)).toBe(0)
  })

  test('classifies against the model window', () => {
    // 128k-token fallback window → ~512k chars. warn at 25%, block at 50%.
    expect(classifyExpansionBudget(1000, 128_000)).toBe('ok')
    expect(classifyExpansionBudget(200_000, 128_000)).toBe('warn')
    expect(classifyExpansionBudget(300_000, 128_000)).toBe('block')
  })

  test('falls back to the default 128k window when contextTokens is undefined', () => {
    expect(classifyExpansionBudget(0, undefined)).toBe('ok')
    expect(classifyExpansionBudget(200_000, undefined)).toBe('warn')
    expect(classifyExpansionBudget(300_000, undefined)).toBe('block')
  })

  test('scales thresholds to a small model window', () => {
    // 1000 tokens → 4000-char window; warn > 1000, block > 2000.
    expect(classifyExpansionBudget(1500, 1000)).toBe('warn')
    expect(classifyExpansionBudget(2500, 1000)).toBe('block')
  })
})

// ---- structured-only kind: snippet (drag/attach-added, never typed) ----------------

describe('registry kind: snippet (structured-only)', () => {
  test('is NEVER parsed from prompt text (no @-token grammar)', () => {
    // `@snippet:foo` reads as plain words — a snippet only ever arrives structured.
    expect(parseContextRefs('see @snippet:foo here')).toEqual([])
    expect(parseContextRefs('@snippet:Output — mydb')).toEqual([])
  })

  test('makeSnippetRef mints a token-less ref carrying its own inline content', () => {
    const ref = makeSnippetRef({ label: 'Output — mydb', content: 'hello world', language: 'text' })
    expect(ref).toEqual({
      raw: '@snippet:Output — mydb',
      key: '@snippet:Output — mydb',
      kind: 'snippet',
      label: 'Output — mydb',
      content: 'hello world',
      language: 'text',
    })
    // The label drives the chip/pill.
    expect(refLabel(ref)).toBe('Output — mydb')
  })

  test('toWireRef carries the inline content/label/language (content IS the ref)', () => {
    const wire = toWireRef(makeSnippetRef({ label: 'sel', content: 'SELECT 1', language: 'sql' }))
    expect(wire).toEqual({
      raw: '@snippet:sel',
      kind: 'snippet',
      content: 'SELECT 1',
      label: 'sel',
      language: 'sql',
    })
    expect('key' in wire).toBe(false)
  })

  test('snippetRefFromRaw reconstructs the transcript pill from the attachment name', () => {
    expect(snippetRefFromRaw('@snippet:Output — mydb')).toEqual({
      raw: '@snippet:Output — mydb',
      key: '@snippet:Output — mydb',
      kind: 'snippet',
      label: 'Output — mydb',
    })
    expect(snippetRefFromRaw('@file:a.ts')).toBeNull()
  })

  test('formatRefExpansionBlock echoes snippet content verbatim under its language fence', () => {
    const out = formatRefExpansionBlock({
      raw: '@snippet:sel',
      ok: true,
      content: 'SELECT 1',
      language: 'sql',
      chars: 8,
    })
    expect(out).toContain('--- @snippet:sel ---')
    expect(out).toContain('```sql\nSELECT 1\n```')
  })
})

// ---- ref-kind registry (terminal / call kinds + registry invariants) --------------

import {
  PARSEABLE_REF_KINDS,
  REF_KINDS,
  REF_RESERVED_WORDS,
  isAtomicRefToken,
  refKindSpec,
} from './context-ref-kinds'

describe('registry kinds: terminal + call', () => {
  test('parses @terminal refs with trailing punctuation stripped', () => {
    const refs = parseContextRefs('look at @terminal:2f9c01ab.')
    expect(refs).toEqual([
      {
        raw: '@terminal:2f9c01ab',
        key: '@terminal:2f9c01ab',
        kind: 'terminal',
        terminalId: '2f9c01ab',
      },
    ])
  })

  test('parses @call refs', () => {
    const refs = parseContextRefs('why did @call:toolu_01AbCdEf fail?')
    expect(refs).toEqual([
      {
        raw: '@call:toolu_01AbCdEf',
        key: '@call:toolu_01AbCdEf',
        kind: 'call',
        toolCallId: 'toolu_01AbCdEf',
      },
    ])
  })

  test('labels terminal/call refs with short ids', () => {
    expect(refLabel(parseContextRefs('@terminal:0123456789abcdef')[0])).toBe('terminal 01234567')
    expect(refLabel(parseContextRefs('@call:toolu_01XYZ12345')[0])).toBe('call toolu_01XY')
  })

  test('mixes new kinds with legacy kinds in one message', () => {
    const kinds = parseContextRefs('@file:a.ts @terminal:abc @call:t1 @session:LOCALIX-2').map(
      (r) => r.kind,
    )
    expect(kinds).toEqual(['file', 'terminal', 'call', 'session'])
  })

  // The task board is a plugin: core has no loader for its ids, so a `@task:` token that still
  // parsed would expand to a failed ref on every send instead of staying the user's text.
  test('a task-board token is plain text, not a core ref kind', () => {
    expect(parseContextRefs('pick up @task:LX-42.')).toEqual([])
    expect(REF_KINDS.some((spec) => (spec.kind as string) === 'task')).toBe(false)
  })
})

describe('ref-kind registry invariants', () => {
  /**
   * LOAD-BEARING. Both lists are DERIVED (`PARSEABLE_REF_KINDS` is the non-`structuredOnly`
   * subset), so a plausible edit — marking every kind structured-only, or emptying the
   * registry — leaves each loop below iterating zero times and asserting nothing at all. A
   * loop over an empty list is not a guard; every one of these tests would go green while the
   * typed `@`-token surface it pins had ceased to exist.
   */
  test('the registry the loops below scan is not empty', () => {
    expect(REF_KINDS.length).toBeGreaterThan(0)
    expect(PARSEABLE_REF_KINDS.length).toBeGreaterThan(0)
    // …and the two are not the same list: the structured-only split must still be real.
    expect(PARSEABLE_REF_KINDS.length).toBeLessThan(REF_KINDS.length)
  })

  test('every kind has a spec + label; parseable kinds have grammar + a menu entry', () => {
    for (const spec of REF_KINDS) {
      expect(refKindSpec(spec.kind)).toBe(spec)
      expect(typeof spec.label).toBe('function')
    }
    for (const spec of PARSEABLE_REF_KINDS) {
      expect(spec.reservedWord.length).toBeGreaterThan(0)
      expect(spec.menu.insert.startsWith('@')).toBe(true)
    }
    expect(REF_RESERVED_WORDS).toContain('terminal:')
    expect(REF_RESERVED_WORDS).toContain('call:')
    expect(REF_RESERVED_WORDS).not.toContain('task:')
  })

  test('structured-only kinds are excluded from the parseable/typed surfaces', () => {
    const snippet = REF_KINDS.find((k) => k.kind === 'snippet')
    expect(snippet?.structuredOnly).toBe(true)
    // Never a parseable kind, never a reserved word, never in the @-menu regex.
    expect(PARSEABLE_REF_KINDS.some((k) => k.kind === 'snippet')).toBe(false)
    expect(REF_RESERVED_WORDS).not.toContain('snippet:')
    expect(isAtomicRefToken('snippet:foo')).toBe(false)
  })

  test('token patterns contain no capture groups (REF_RE indexing relies on it)', () => {
    for (const spec of PARSEABLE_REF_KINDS) {
      expect(new RegExp(`(${spec.tokenPattern})`).source.match(/(?<!\\)\((?!\?)/g)?.length).toBe(1)
    }
  })

  test('isAtomicRefToken mirrors the composer token rules', () => {
    expect(isAtomicRefToken('file:src/a.ts')).toBe(true)
    expect(isAtomicRefToken('file:')).toBe(true) // still being typed
    expect(isAtomicRefToken('terminal:abc')).toBe(true)
    expect(isAtomicRefToken('call:t1')).toBe(true)
    expect(isAtomicRefToken('task:LX-1')).toBe(false)
    expect(isAtomicRefToken('some/path.ts')).toBe(false)
  })
})

describe('project + message context refs (link a project / a message)', () => {
  test('project is a PARSEABLE kind — typed / dragged @project:<id> parses', () => {
    expect(parseContextRefs('@project:proj-abc')).toMatchObject([
      { kind: 'project', projectId: 'proj-abc', raw: '@project:proj-abc' },
    ])
  })

  test('toWireRef carries projectId (project) and sessionId+messageId (message)', () => {
    const proj = toWireRef({
      raw: '@project:p1',
      key: '@project:p1',
      kind: 'project',
      projectId: 'p1',
    })
    expect(proj).toEqual({ raw: '@project:p1', kind: 'project', projectId: 'p1' })
    const msg = makeMessageRef({ sessionId: 's1', messageId: 'm1', label: 'hello' })
    expect(toWireRef(msg)).toEqual({
      raw: '@message:s1/m1',
      kind: 'message',
      sessionId: 's1',
      messageId: 'm1',
      label: 'hello',
    })
  })

  test('message is STRUCTURED-ONLY — never parsed from prompt text', () => {
    expect(parseContextRefs('look at @message:s1/m1 please')).toEqual([])
  })

  test('makeMessageRef ↔ messageRefFromRaw round-trips the ids (stable dedup key)', () => {
    const ref = makeMessageRef({ sessionId: 's1', messageId: 'm1' })
    expect(ref.key).toBe('@message:s1/m1')
    const back = messageRefFromRaw(ref.raw)
    expect(back).toMatchObject({ kind: 'message', sessionId: 's1', messageId: 'm1' })
    // A malformed / non-message name is rejected.
    expect(messageRefFromRaw('@message:no-slash')).toBeNull()
    expect(messageRefFromRaw('@snippet:x')).toBeNull()
  })

  test('a session ref minted from a TAB is identical to one from the sessions LIST', () => {
    // Both drag sources arm `@session:<id>` → the SAME parse path. Parity check.
    const fromList = parseContextRefs('@session:LOCALIX-42')[0]
    const fromTab = parseContextRefs('@session:LOCALIX-42')[0]
    expect(fromTab).toEqual(fromList)
    expect(toWireRef(fromTab)).toEqual({
      raw: '@session:LOCALIX-42',
      kind: 'session',
      sessionId: 'LOCALIX-42',
    })
  })

  test('makeSnippetRef clamps oversized content under the wire cap (with a truncation note)', () => {
    const ref = makeSnippetRef({ label: 'big', content: 'x'.repeat(SNIPPET_CONTENT_MAX + 5000) })
    expect(ref.content!.length).toBeLessThanOrEqual(SNIPPET_CONTENT_MAX)
    expect(ref.content!.endsWith('… [snippet truncated: exceeded the 100 KB limit]')).toBe(true)
    // The clamped ref passes the server wire schema — the send can't be rejected.
    expect(contextRefSchema.safeParse(toWireRef(ref)).success).toBe(true)
    // Content at/under the cap is untouched.
    const fits = makeSnippetRef({ label: 'ok', content: 'y'.repeat(SNIPPET_CONTENT_MAX) })
    expect(fits.content).toBe('y'.repeat(SNIPPET_CONTENT_MAX))
  })

  test('formatRefExpansionBlock sanitizes a hostile language hint off the fence line', () => {
    const block = formatRefExpansionBlock({
      raw: '@snippet:x',
      ok: true,
      content: 'body',
      chars: 4,
      language: 'sql\nEVIL`inject',
    } as ContextRefExpansion)
    const fenceLine = block.split('\n')[1]
    expect(fenceLine).toBe('```sqlEVILinject')
    expect(block).toContain('\nbody\n')
  })

  test('refLabel: project falls back to id; message shows a short id when unlinked', () => {
    expect(refLabel(parseContextRefs('@project:p1')[0])).toBe('p1')
    expect(refLabel(makeMessageRef({ sessionId: 's1', messageId: 'abcdefghij' }))).toBe(
      'message abcdefgh',
    )
  })
})

describe('refToken (the inverse of parse)', () => {
  test('colon-shaped kinds render `@kind:value`', () => {
    expect(refToken('session', 'LOCALIX-42')).toBe('@session:LOCALIX-42')
    expect(refToken('project', 'p1')).toBe('@project:p1')
    expect(refToken('file', 'src/a.ts')).toBe('@file:src/a.ts')
    expect(refToken('call', 't7')).toBe('@call:t7')
    expect(refToken('resource', 'localix://resource/fixture-db/c1/_/public/users')).toBe(
      '@resource:localix://resource/fixture-db/c1/_/public/users',
    )
  })

  test('file and folder tokens round-trip Unicode, spaces, percent signs, and numeric colons', () => {
    const path = '文書/My File 100%:12.ts'
    const fileToken = refToken('file', path)
    const folderToken = refToken('folder', '資料/Design Docs')

    expect(fileToken).toBe('@file:%E6%96%87%E6%9B%B8/My%20File%20100%25%3A12.ts')
    expect(parseContextRefs(fileToken)[0]).toMatchObject({ raw: fileToken, kind: 'file', path })
    expect(parseContextRefs(folderToken)[0]).toMatchObject({
      raw: folderToken,
      kind: 'folder',
      path: '資料/Design Docs',
    })
  })

  test('message carries a composite value', () => {
    expect(refToken('message', 's1/abc')).toBe('@message:s1/abc')
  })

  test('retired resource tokens are not parsed as context refs', () => {
    const legacyToken = ['git', '5'].join(':')
    expect(parseContextRefs(`Review @diff and @${legacyToken} before editing.`)).toEqual([])
    expect(isAtomicRefToken('diff')).toBe(false)
    expect(isAtomicRefToken(legacyToken)).toBe(false)
  })

  test('refToken round-trips through parse for the parseable kinds', () => {
    // The whole point: the inverse must produce a token the parser reads back.
    for (const [kind, value] of [
      ['file', 'src/a.ts'],
      ['session', 'LOCALIX-9'],
      ['project', 'proj-1'],
      ['terminal', 'abc'],
    ] as const) {
      const parsed = parseContextRefs(refToken(kind, value))
      expect(parsed[0]?.kind).toBe(kind)
    }
  })

  test('makeMessageRef now builds its token via refToken (no hand-rolled grammar left)', () => {
    expect(makeMessageRef({ sessionId: 's1', messageId: 'm2' }).raw).toBe('@message:s1/m2')
  })
})

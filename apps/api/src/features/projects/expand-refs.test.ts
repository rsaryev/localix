import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expandContextRefs, toResourceExpansionResult } from './expand-refs'
import type { ContextRef } from './contracts'
import { makeSnippetRef, toWireRef } from '../chat/context-refs'
import { formatRefExpansionBlock } from '../chat/context-refs'

/**
 * The `snippet` kind is the token-less, inline-content ref (client-minted, drag/attach
 * added). Its expansion is a verbatim echo — no fetch, no working dir. These tests
 * prove the END-TO-END model-wire path: a snippet ref → its expansion → a
 * `contextRef: true` text attachment carrying the content, which the wire emits raw.
 */
describe('expandContextRefs — snippet (inline-content) kind', () => {
  const wireSnippet = (over: Partial<ContextRef> = {}): ContextRef => ({
    ...toWireRef(
      makeSnippetRef({ label: 'Output — mydb', content: 'row 1\nrow 2', language: 'text' }),
    ),
    ...over,
  })

  test("echoes the ref's own content verbatim — no working dir needed", async () => {
    const [exp] = await expandContextRefs('', [wireSnippet()])
    expect(exp.ok).toBe(true)
    expect(exp.content).toBe('row 1\nrow 2')
    expect(exp.language).toBe('text')
    expect(exp.chars).toBe('row 1\nrow 2'.length)
  })

  test('never throws on missing content — an empty snippet becomes a clear note', async () => {
    const [exp] = await expandContextRefs('', [{ raw: '@snippet:empty', kind: 'snippet' }])
    expect(exp.ok).toBe(true)
    expect(exp.content).toContain('empty snippet')
  })

  test('an editor selection names its exact span in the header the model reads', async () => {
    // The selection binding always carried path + positions; only `file.ts L4` reached the
    // model, so it saw the text but had to search the workspace to find where to edit.
    const [exp] = await expandContextRefs('', [
      wireSnippet({
        raw: '@snippet:auth.ts L4',
        content: 'striing',
        language: 'typescript',
        path: '/work/src/auth.ts',
        startLine: 4,
        startColumn: 40,
        endLine: 4,
        endColumn: 47,
      }),
    ])
    expect(exp.location).toBe('/work/src/auth.ts:4:40-4:47')
    expect(formatRefExpansionBlock(exp)).toContain(
      '--- @snippet:auth.ts L4 from /work/src/auth.ts:4:40-4:47 ---',
    )
  })

  test('free-floating text (no file) has no location', async () => {
    const [exp] = await expandContextRefs('', [wireSnippet()])
    expect(exp.location).toBeUndefined()
  })

  test('a snippet expansion formats into the model contribution body', async () => {
    const [exp] = await expandContextRefs('', [
      wireSnippet({ content: 'SELECT 42;', language: 'sql' }),
    ])
    const content = formatRefExpansionBlock(exp)
    expect(content).toContain('--- @snippet:Output — mydb ---')
    expect(content).toContain('```sql\nSELECT 42;\n```')
  })

  test('a snippet-only batch needs no scope (workdir-free), alongside a file ref failing cleanly', async () => {
    const [snip, file] = await expandContextRefs('', [
      wireSnippet(),
      { raw: '@file:a.ts', kind: 'file', path: 'a.ts' },
    ])
    expect(snip.ok).toBe(true)
    // The file ref can't resolve against an empty working dir, but it fails per-ref
    // (never throws) — proving mixed batches are safe.
    expect(file.ok).toBe(false)
  })
})

/**
 * Project + message refs are loader-backed (workdir-free) — the expander resolves
 * them via the injected digest loaders. These prove the dispatch, the missing/
 * deleted-graceful path, and that a project expansion carries introspection only.
 */
describe('expandContextRefs — project + message kinds', () => {
  test('project: dispatches to the injected loader (no working dir)', async () => {
    const [exp] = await expandContextRefs(
      '',
      [{ raw: '@project:p1', kind: 'project', projectId: 'p1' }],
      {
        loadProjectDigest: async (id) => `Project "${id}"\nWorking directory: /tmp/p1`,
      },
    )
    expect(exp.ok).toBe(true)
    expect(exp.content).toContain('Working directory: /tmp/p1')
  })

  test('project: a deleted / unknown project degrades gracefully', async () => {
    const [exp] = await expandContextRefs(
      '',
      [{ raw: '@project:gone', kind: 'project', projectId: 'gone' }],
      {
        loadProjectDigest: async () => null,
      },
    )
    expect(exp.ok).toBe(false)
    expect(exp.error).toContain('project not found')
  })

  test('project: no loader wired → clear note, never throws', async () => {
    const [exp] = await expandContextRefs('', [
      { raw: '@project:p1', kind: 'project', projectId: 'p1' },
    ])
    expect(exp.ok).toBe(false)
    expect(exp.error).toContain('not available')
  })

  test('message: resolves role + text fresh via the loader (session + message ids)', async () => {
    // Recorder array, not a nullable `let` (a var assigned only inside a callback stays
    // narrowed to `null` for the compiler). It also pins that the loader ran EXACTLY once.
    const seen: [string, string][] = []
    const [exp] = await expandContextRefs(
      '',
      [{ raw: '@message:s1/m1', kind: 'message', sessionId: 's1', messageId: 'm1' }],
      {
        loadMessageDigest: async (sid, mid) => {
          seen.push([sid, mid])
          return `Message from session ${sid} (user):\nhello`
        },
      },
    )
    expect(seen).toEqual([['s1', 'm1']])
    expect(exp.ok).toBe(true)
    expect(exp.content).toContain('hello')
  })

  test('message: a since-deleted message degrades gracefully', async () => {
    const [exp] = await expandContextRefs(
      '',
      [{ raw: '@message:s1/m9', kind: 'message', sessionId: 's1', messageId: 'm9' }],
      { loadMessageDigest: async () => null },
    )
    expect(exp.ok).toBe(false)
    expect(exp.error).toContain('message not found')
  })

  test('message: missing ids fail before hitting the loader', async () => {
    const [exp] = await expandContextRefs(
      '',
      [{ raw: '@message:x', kind: 'message', sessionId: 's1' }],
      {
        loadMessageDigest: async () => 'unused',
      },
    )
    expect(exp.ok).toBe(false)
    expect(exp.error).toContain('missing message id')
  })
})

/**
 * FRESHNESS CONTRACT — link time vs send time. The composer's link-time
 * `expand-refs` call is only a cheap dry run for chip size; the model-facing
 * content is produced HERE, fresh, at send. An id/URI-addressed ref carries NO
 * captured content on the wire (only its uri/id), so it CANNOT go stale between
 * link and send. These tests lock that: a regression that started caching
 * link-time content (a resolver called once, or content read off the ref) fails.
 */
describe('expandContextRefs — freshness (resolves fresh at send, never frozen at link time)', () => {
  test('resource: re-resolves on every expand — the LATEST resolver value wins, nothing is cached', async () => {
    let calls = 0
    const resourceRef: ContextRef = {
      raw: '@resource:localix://resource/fixture-market/x/markets/BTC',
      kind: 'resource',
      uri: 'localix://resource/fixture-market/x/markets/BTC',
    }
    const loadResource = async () => ({ ok: true as const, content: `price @ tick ${++calls}` })

    const [first] = await expandContextRefs('', [resourceRef], { loadResource })
    const [second] = await expandContextRefs('', [resourceRef], { loadResource })

    // Two sends → two fresh reads → the second carries the newer value, proving the
    // model gets send-time data, not a link-time snapshot.
    expect(first.content).toBe('price @ tick 1')
    expect(second.content).toBe('price @ tick 2')
    expect(calls).toBe(2)
  })

  test('resource: the model-facing content comes ONLY from the resolver — the ref carries no frozen content', async () => {
    // Even a rogue `content` smuggled onto a resource ref is ignored: the expander
    // uses the fresh resolver value, never a link-time snapshot.
    const smuggled = {
      raw: '@resource:localix://resource/fixture-db/c/_/public/users',
      kind: 'resource',
      uri: 'localix://resource/fixture-db/c/_/public/users',
      content: 'STALE snapshot',
    } as ContextRef
    const [exp] = await expandContextRefs('', [smuggled], {
      loadResource: async () => ({ ok: true as const, content: 'FRESH rows', language: 'sql' }),
    })
    expect(exp.content).toBe('FRESH rows')
    expect(exp.content).not.toContain('STALE')
  })

  test('toWireRef: a resource ref ships only its uri — no content rides from link time', () => {
    const wire = toWireRef({
      raw: '@resource:localix://resource/fixture-db/c/_/public/users',
      key: 'k',
      kind: 'resource',
      uri: 'localix://resource/fixture-db/c/_/public/users',
    })
    expect(wire.uri).toBe('localix://resource/fixture-db/c/_/public/users')
    expect('content' in wire).toBe(false)
  })
})

/**
 * sizeOnly PREFLIGHT — the composer's link-time call returns a CHEAP size estimate
 * per ref (chip label + budget gate) and NEVER runs the heavy expander: no
 * provider/DB/exchange/git call and no file read. The one full, fresh expansion is
 * the send-time one.
 */
describe('expandContextRefs — sizeOnly preflight (cheap estimate, no heavy fetch)', () => {
  let sizeDir: string
  beforeAll(async () => {
    sizeDir = await mkdtemp(path.join(import.meta.dir, '.sizeonly-test-'))
    await writeFile(path.join(sizeDir, 'small.ts'), 'const a = 1\nconst b = 2\nconst c = 3\n')
  })
  afterAll(async () => {
    await rm(sizeDir, { recursive: true, force: true })
  })

  test('resource: estimated size, and the resolver is NEVER called', async () => {
    let calls = 0
    const [exp] = await expandContextRefs(
      '',
      [
        {
          raw: '@resource:localix://resource/fixture-market/x/markets/BTC',
          kind: 'resource',
          uri: 'localix://resource/fixture-market/x/markets/BTC',
        },
      ],
      {
        loadResource: async () => {
          calls++
          return { ok: true as const, content: 'should not run' }
        },
      },
      true,
    )
    expect(calls).toBe(0) // no exchange/provider hit for a size
    expect(exp.ok).toBe(true)
    expect(exp.estimated).toBe(true)
    expect(exp.chars).toBeGreaterThan(0)
    expect(exp.content).toBeUndefined()
  })

  test('snippet: sized precisely from local content, not estimated', async () => {
    const [exp] = await expandContextRefs(
      '',
      [{ raw: '@snippet:x', kind: 'snippet', content: 'abcde' }],
      {},
      true,
    )
    expect(exp.chars).toBe(5)
    expect(exp.estimated).toBeUndefined()
  })

  test('digest kinds get a conservative estimate without their loader', async () => {
    let called = false
    const [exp] = await expandContextRefs(
      '',
      [{ raw: '@session:s1', kind: 'session', sessionId: 's1' }],
      {
        loadSessionDigest: async () => {
          called = true
          return 'unused'
        },
      },
      true,
    )
    expect(called).toBe(false)
    expect(exp.ok).toBe(true)
    expect(exp.estimated).toBe(true)
  })

  test('file: sized by stat (real bytes, no read); a missing file still previews as failed', async () => {
    const [ok, gone] = await expandContextRefs(
      sizeDir,
      [
        { raw: '@file:small.ts', kind: 'file', path: 'small.ts' },
        { raw: '@file:nope.ts', kind: 'file', path: 'nope.ts' },
      ],
      {},
      true,
    )
    expect(ok.ok).toBe(true)
    expect(ok.chars).toBeGreaterThan(0)
    expect(ok.estimated).toBeUndefined() // a full-file stat is a real byte size
    expect(gone.ok).toBe(false)
    expect(gone.error).toContain('file not found')
  })

  test('file line-range: proportional estimate, marked estimated, capped at file size', async () => {
    const [exp] = await expandContextRefs(
      sizeDir,
      [{ raw: '@file:small.ts:1-2', kind: 'file', path: 'small.ts', startLine: 1, endLine: 2 }],
      {},
      true,
    )
    expect(exp.ok).toBe(true)
    expect(exp.estimated).toBe(true)
  })
})

/**
 * Filesystem expanders (`@file:` / `@folder:`) are the MODEL-WIRE boundary for
 * local files: path confinement, sensitive-path refusal, and binary refusal are
 * load-bearing security checks — locked here against regressions.
 */
describe('expandContextRefs — filesystem kinds (confinement / sensitive / binary / ranges)', () => {
  let dir: string

  beforeAll(async () => {
    // In-workspace temp dir (a /tmp write can block on permission approval).
    dir = await mkdtemp(path.join(import.meta.dir, '.expand-refs-test-'))
    await writeFile(path.join(dir, 'small.ts'), 'line 1\nline 2\nline 3\nline 4\nline 5')
    await writeFile(path.join(dir, '.env'), 'SECRET=x')
    await writeFile(path.join(dir, 'blob.bin'), Buffer.from([0x89, 0x00, 0x50, 0x4e, 0x47]))
    await mkdir(path.join(dir, '.ssh'), { recursive: true })
    await writeFile(path.join(dir, '.ssh', 'config'), 'Host x')
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const fileRef = (p: string, over: Partial<ContextRef> = {}): ContextRef => ({
    raw: `@file:${p}`,
    kind: 'file',
    path: p,
    ...over,
  })

  test('a path escaping the working dir is refused', async () => {
    const [rel, abs] = await expandContextRefs(dir, [
      fileRef('../../../etc/hosts'),
      fileRef('/etc/hosts'),
    ])
    expect(rel.ok).toBe(false)
    expect(rel.error).toContain('outside')
    expect(abs.ok).toBe(false)
  })

  test('sensitive basenames and directories are refused', async () => {
    const [env, ssh] = await expandContextRefs(dir, [fileRef('.env'), fileRef('.ssh/config')])
    expect(env.ok).toBe(false)
    expect(env.error).toContain('sensitive')
    expect(ssh.ok).toBe(false)
  })

  test('binary content is refused', async () => {
    const [exp] = await expandContextRefs(dir, [fileRef('blob.bin')])
    expect(exp.ok).toBe(false)
    expect(exp.error).toContain('binary')
  })

  test('a valid line range slices 1-indexed inclusive', async () => {
    const [exp] = await expandContextRefs(dir, [fileRef('small.ts', { startLine: 2, endLine: 3 })])
    expect(exp.ok).toBe(true)
    expect(exp.content).toBe('line 2\nline 3')
  })

  test('an out-of-range line range falls back to the full file WITH a note', async () => {
    const [exp] = await expandContextRefs(dir, [
      fileRef('small.ts', { startLine: 100, endLine: 120 }),
    ])
    expect(exp.ok).toBe(true)
    expect(exp.content).toContain(
      '[requested lines 100-120 is out of range — file has 5 lines; showing the full file]',
    )
    expect(exp.content).toContain('line 5')
  })

  test('a directory pointed at by @file: is redirected to @folder:; folder lists entries', async () => {
    const [asFile, asFolder] = await expandContextRefs(dir, [
      fileRef('.'),
      { raw: '@folder:.', kind: 'folder', path: '.' },
    ])
    expect(asFile.ok).toBe(false)
    expect(asFile.error).toContain('@folder:')
    expect(asFolder.ok).toBe(true)
    expect(asFolder.content).toContain('small.ts')
  })
})

/**
 * The registry→loader adapter. It used to live INLINE and ANONYMOUS in bootstrap.ts, and
 * agent-core's resource-refs test MIRRORED it (a local `hostLoader`) in order to exercise
 * "the real path" — which meant the shipped adapter was covered by nothing at all, and a
 * drift in it (dropping `language`, say) would leave that test green.
 *
 * These are the only tests of the two DEFAULTS, and the defaults are policy: they decide
 * what a provider's silence means.
 */
describe('toResourceExpansionResult (registry bag → discriminated result)', () => {
  test('carries content and the fence-language hint through on success', () => {
    expect(
      toResourceExpansionResult({ ok: true, content: 'CREATE TABLE t (…)', language: 'sql' }),
    ).toEqual({
      ok: true,
      content: 'CREATE TABLE t (…)',
      language: 'sql',
    })
  })

  test('an ok expansion with NO content is an EMPTY resource, not a failed one', () => {
    // A ref to an empty table expands to nothing. It must not become `ok: false`, and it
    // must not surface `undefined` to a consumer whose type promises `content: string`.
    const r = toResourceExpansionResult({ ok: true })
    expect(r).toEqual({ ok: true, content: '', language: undefined })
    expect(r.ok && r.content).toBe('')
  })

  test('a failure with NO error still gets a model-facing reason', () => {
    // A provider that fails silently would otherwise render an empty pill.
    expect(toResourceExpansionResult({ ok: false })).toEqual({
      ok: false,
      error: 'resource unavailable',
    })
  })

  test('a failure keeps the provider’s own error, and drops content', () => {
    expect(
      toResourceExpansionResult({ ok: false, error: 'no such table', content: 'leaked' }),
    ).toEqual({
      ok: false,
      error: 'no such table',
    })
  })
})

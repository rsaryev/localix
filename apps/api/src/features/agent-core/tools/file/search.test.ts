import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createSearchTool,
  FILE_LIST_LIMIT,
  hasUnescapedRegexMeta,
  prepareSearchArguments,
  SEARCH_TIMEOUT_SECONDS,
} from './search'
import { localEnvironment } from '../environments/local'
import type { ExecutionEnvironment } from '../environment'
import { MODEL_SEARCH_MAX_BYTES, modelFacingMatches, searchRetries } from './search-output'
import { MAX_AGENT_SOURCES } from '@localixai/agent/agents'
import { escapeRegExp } from '../../../../lib/regexp'

describe('modelFacingMatches truncation wording', () => {
  // Over the 2000-line default cap so tail-truncation kicks in.
  const big = Array.from({ length: 2500 }, (_, i) => `src/file${i}.ts`).join('\n')

  test('content search uses "match line" wording', () => {
    const out = modelFacingMatches(big)
    expect(out).toContain('match line')
    expect(out).toContain('To see all matches')
  })

  test('keeps a broad search result inside the active-turn ingress budget', () => {
    const output = Array.from(
      { length: 2_000 },
      (_, index) => `src/file-${index}.ts:${index + 1}:const match = "${'x'.repeat(80)}"`,
    ).join('\n')

    const result = modelFacingMatches(output)
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(MODEL_SEARCH_MAX_BYTES)
    expect(result).toContain('do not run another broad search')
  })

  test('file listing uses "file path" wording, never "match line"', () => {
    const out = modelFacingMatches(big, 'file')
    expect(out).toContain('file path')
    expect(out).toContain('To see all files')
    expect(out).not.toContain('match line')
  })
})

describe('hasUnescapedRegexMeta', () => {
  test('flags queries with literal regex metacharacters', () => {
    expect(hasUnescapedRegexMeta('array.map(')).toBe(true)
    expect(hasUnescapedRegexMeta('config.value')).toBe(true)
    expect(hasUnescapedRegexMeta('foo[bar]')).toBe(true)
    expect(hasUnescapedRegexMeta('a|b')).toBe(true)
  })

  test('is quiet for plain alphanumeric / path-like queries', () => {
    expect(hasUnescapedRegexMeta('createReadTool')).toBe(false)
    expect(hasUnescapedRegexMeta('src/features/search')).toBe(false)
    expect(hasUnescapedRegexMeta('TODO fixme later')).toBe(false)
  })

  test('treats already-escaped metacharacters as intentional regex', () => {
    expect(hasUnescapedRegexMeta('\\.map\\(')).toBe(false)
    expect(hasUnescapedRegexMeta('foo\\[bar\\]')).toBe(false)
  })
})

describe('createSearchTool — file listing (query omitted, glob only)', () => {
  test('lists file paths matching a glob, not their contents', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const { createSearchTool } = await import('./search')
    const dir = await mkdtemp(path.join(os.tmpdir(), 'localix-search-'))
    try {
      await writeFile(path.join(dir, 'a.ts'), 'export const a = 1\nconst secret = 42\n', 'utf8')
      await writeFile(path.join(dir, 'b.ts'), 'export const b = 2\n', 'utf8')
      await writeFile(path.join(dir, 'note.md'), '# readme\n', 'utf8')
      const tool = createSearchTool(undefined, dir)

      const res = await tool.execute('s1', { glob: '*.ts' })
      expect(res.isError).toBeUndefined()
      expect(res.content).toContain('a.ts')
      expect(res.content).toContain('b.ts')
      expect(res.content).not.toContain('note.md') // glob excludes it
      expect(res.content).not.toContain('secret') // names only, NOT contents
      expect(res.content).toMatch(/2 files/)

      const none = await tool.execute('s2', { glob: '*.py' })
      expect(none.content).toMatch(/No files matching/)

      const noArgs = await tool.execute('s3', {})
      expect(noArgs.isError).toBe(true)
      expect(noArgs.content).toMatch(/glob to list files/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('bounds the producer, keeps the front, and reports the sentinel as truncation', async () => {
    const paths = Array.from({ length: FILE_LIST_LIMIT + 1 }, (_, i) => `f${i}`)
    let command = ''
    let options: Parameters<ExecutionEnvironment['exec']>[1]
    const env = {
      async exec(nextCommand: string, nextOptions?: Parameters<ExecutionEnvironment['exec']>[1]) {
        command = nextCommand
        options = nextOptions
        return { stdout: paths.join('\n'), stderr: '', exitCode: 0 }
      },
    } as ExecutionEnvironment

    const result = await createSearchTool(env, '/work').execute('bounded', { glob: '**' })

    expect(command).toContain(`| head -n ${FILE_LIST_LIMIT + 1}`)
    expect(options).toMatchObject({ uncapped: true, timeout: SEARCH_TIMEOUT_SECONDS })
    expect(result.content).toContain(
      `More than ${FILE_LIST_LIMIT} files (showing first ${FILE_LIST_LIMIT})`,
    )
    expect(result.content).toContain('f0')
    expect(result.content).not.toContain(`f${FILE_LIST_LIMIT}`)
    expect(result.details).toMatchObject({ truncated: true })
  })
})

describe('createSearchTool — provenance survives truncation', () => {
  /**
   * The rendered output is not the parse input.
   *
   * `truncateOutput` appends a `[…truncated…]` sentinel and can cut the last line mid-content, and
   * `matchedFiles` is fail-closed on any line it cannot parse. Reading provenance off the rendered
   * string therefore produced NO sources for exactly the searches with the most to say — silently,
   * because an absent `sources` key looks the same as a search that matched nothing.
   */
  const hugeMatchOutput = Array.from(
    { length: 20_000 },
    (_, i) => `src/f${i}.ts:${i + 1}:hit`,
  ).join('\n')

  // The content-search branch goes through `searchFiles`, which returns ripgrep's stdout directly.
  const envReturning = (stdout: string) =>
    ({
      async searchFiles() {
        return stdout
      },
    }) as unknown as ExecutionEnvironment

  test('a truncated search still publishes what it found', async () => {
    const result = await createSearchTool(envReturning(hugeMatchOutput), '/work').execute('big', {
      query: 'hit',
    })

    expect(result.details).toMatchObject({ truncated: true })
    expect(result.sources?.length).toBeGreaterThan(0)
    expect(result.sources?.[0]).toMatchObject({
      kind: 'file',
      role: 'discovered',
      title: 'f0.ts',
    })
  })

  test('and never more than the wire will carry', async () => {
    // `normalizeAgentSources` caps the wire anyway; bounding here means twenty thousand records are
    // not built to throw all but a few away.
    const result = await createSearchTool(envReturning(hugeMatchOutput), '/work').execute('big', {
      query: 'hit',
    })

    expect(result.sources?.length).toBe(MAX_AGENT_SOURCES)
  })

  test('a small search is unaffected — one row per matched file, first hit line', async () => {
    const result = await createSearchTool(
      envReturning(['src/a.ts:12:one', 'src/a.ts:4:two', 'src/b.ts:9:three'].join('\n')),
      '/work',
    ).execute('small', { query: 'x' })

    expect(result.sources?.map((source) => source.title)).toEqual(['a.ts', 'b.ts'])
    expect(result.sources?.[0]?.uri).toContain('line=4')
  })
})

describe('createSearchTool — cwd pointed at a file recovers instead of ENOTDIR', () => {
  test('searches within the file when cwd is a file path', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'localix-search-cwd-'))
    try {
      const target = path.join(dir, 'target.ts')
      await writeFile(target, 'export const needle = 1\nconst other = 2\n', 'utf8')
      await writeFile(path.join(dir, 'noise.ts'), 'const needle = 999\n', 'utf8')
      const tool = createSearchTool(undefined, dir)

      // cwd is a FILE, not a directory — the old behaviour was ENOTDIR + no recovery.
      const res = await tool.execute('c1', { query: 'needle', cwd: target })
      expect(res.isError).toBeUndefined()
      expect(res.content).toContain('was a file')
      expect(res.content).toContain('needle')
      // Scoped to that one file only — the sibling's match must not appear.
      expect(res.content).not.toContain('999')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('reports a clean no-match (not an error) when the file lacks the query', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'localix-search-cwd2-'))
    try {
      const target = path.join(dir, 'empty.ts')
      await writeFile(target, 'export const a = 1\n', 'utf8')
      const tool = createSearchTool(undefined, dir)
      const res = await tool.execute('c2', { query: 'zzz_absent', cwd: target })
      expect(res.isError).toBeUndefined()
      expect(res.content).toMatch(/No matches for/)
      expect(res.content).not.toMatch(/ENOTDIR|Failed to run search/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('escapeRegExp / searchRetries', () => {
  test('escapeRegExp turns a literal-looking query into a literal regex', () => {
    expect(escapeRegExp('array.map(')).toBe('array\\.map\\(')
    expect(escapeRegExp('config.value')).toBe('config\\.value')
    expect(escapeRegExp('plain_text')).toBe('plain_text')
  })

  test('a globbed search retries without the glob first', () => {
    const r = searchRetries('symbol', '**/*.md')
    expect(r[0]).toEqual({ label: 'without the glob', query: 'symbol' })
  })

  test('a regex-metachar query also retries as a literal, with and without the glob', () => {
    const r = searchRetries('a.map(', 'src/**')
    expect(r.map((x) => x.label)).toEqual([
      'without the glob',
      'as a literal string, keeping the glob',
      'as a literal string, without the glob',
    ])
    expect(r[1].query).toBe('a\\.map\\(')
    expect(r[1].glob).toBe('src/**')
    expect(r[2].glob).toBeUndefined()
  })

  test('a literal, unscoped query has nothing obvious left to try', () => {
    // "No matches" is then the honest answer — don't spend rg runs proving it twice.
    expect(searchRetries('plain_symbol')).toEqual([])
  })
})

describe('createSearchTool — an empty result widens itself instead of costing a turn', () => {
  let tempDir = ''
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'localix-search-'))
    await writeFile(path.join(tempDir, 'code.ts'), 'const x = arr.map((v) => v)\n', 'utf8')
    await writeFile(path.join(tempDir, 'notes.md'), 'nothing here\n', 'utf8')
  })
  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  })

  test('a too-narrow glob is dropped, and the result says which search produced it', async () => {
    const tool = createSearchTool(undefined, tempDir)
    const result = await tool.execute('s1', { query: 'arr', glob: '**/*.md' })
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Retried without the glob')
    expect(result.content).toContain('code.ts')
    expect(result.content).toContain('not from your original query')
  })

  test('context lines come back around each hit, so no read is needed to judge it', async () => {
    await writeFile(path.join(tempDir, 'ctx.ts'), 'before\nNEEDLE\nafter\n', 'utf8')
    const tool = createSearchTool(undefined, tempDir)
    const result = await tool.execute('sc', { query: 'NEEDLE', context: 1 })
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('before')
    expect(result.content).toContain('after')
  })

  test('a widening retry keeps the requested context', async () => {
    await writeFile(path.join(tempDir, 'ctx.ts'), 'before\nNEEDLE\nafter\n', 'utf8')
    const tool = createSearchTool(undefined, tempDir)
    const result = await tool.execute('sc2', { query: 'NEEDLE', glob: '**/*.md', context: 1 })
    expect(result.content).toContain('Retried without the glob')
    expect(result.content).toContain('before')
  })

  test('an unescaped metachar query is retried as a literal string', async () => {
    const tool = createSearchTool(undefined, tempDir)
    const result = await tool.execute('s2', { query: 'arr.map(' })
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('literal string')
    expect(result.content).toContain('code.ts')
  })

  test('a genuinely absent literal string still reports no matches, with no retry noise', async () => {
    const tool = createSearchTool(undefined, tempDir)
    const result = await tool.execute('s3', { query: 'zzz_absent_zzz' })
    expect(result.content).toContain('No matches')
    expect(result.content).not.toContain('Retried')
  })
})

/**
 * End-to-end ripgrep behaviour: cwd scoping, glob filters, the clean no-match, and
 * the invalid-regex retry. (Lived in a second search.test.ts at the feature root,
 * orphaned when the tool moved into tools/file/.)
 */
describe('createSearchTool — ripgrep integration', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  })

  async function createTempDir() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'search-tool-'))
    tempDirs.push(dir)
    return dir
  }

  test('finds matches with ripgrep in the provided cwd', async () => {
    const dir = await createTempDir()
    await writeFile(path.join(dir, 'alpha.ts'), 'const marker = "needle"\n')
    await writeFile(path.join(dir, 'beta.txt'), 'nothing here\n')
    const tool = createSearchTool()

    const result = await tool.execute('call_1', { query: 'needle', cwd: dir })

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('alpha.ts:1:const marker = "needle"')
    expect(result.details).toMatchObject({
      query: 'needle',
      cwd: dir,
      truncated: false,
    })
  })

  test('supports glob filters', async () => {
    const dir = await createTempDir()
    await writeFile(path.join(dir, 'alpha.ts'), 'needle in ts\n')
    await writeFile(path.join(dir, 'alpha.txt'), 'needle in txt\n')
    const tool = createSearchTool()

    const result = await tool.execute('call_1', { query: 'needle', cwd: dir, glob: '*.ts' })

    expect(result.content).toContain('alpha.ts:1:needle in ts')
    expect(result.content).not.toContain('alpha.txt')
    expect(result.details).toMatchObject({
      query: 'needle',
      cwd: dir,
      glob: '*.ts',
    })
  })

  test('returns a non-error result when no matches are found', async () => {
    const dir = await createTempDir()
    await writeFile(path.join(dir, 'alpha.ts'), 'const marker = "present"\n')
    const tool = createSearchTool()

    expect(tool.execute('call_1', { query: 'missing', cwd: dir })).resolves.toMatchObject({
      content: `No matches for "missing" in ${dir}.`,
      details: {
        query: 'missing',
        cwd: dir,
        bytes: 0,
        truncated: false,
        output: '',
      },
    })
  })

  test('an invalid regex is NAMED, then retried as a literal string', async () => {
    const dir = await createTempDir()
    await writeFile(path.join(dir, 'alpha.ts'), 'const marker = "present"\n')
    const tool = createSearchTool()

    // An unbalanced group makes ripgrep exit 2. Escaping it is the only thing the model
    // could do next turn, so the tool does it now — but never hides that the regex was
    // invalid, which is what the plain "No matches" answer used to do.
    const absent = (await tool.execute('call_1', { query: '(unclosed', cwd: dir })) as {
      content: string
      isError?: boolean
    }
    expect(absent.content).toContain('is not a valid regex')
    expect(absent.content).toContain('as a literal string')

    // …and when the literal text IS there, the retry answers the question outright.
    const found = (await tool.execute('call_2', { query: 'marker = "present"(', cwd: dir })) as {
      content: string
      isError?: boolean
    }
    expect(found.isError).toBeUndefined()
    expect(found.content).toContain('is not a valid regex')
  })
})

describe('createSearchTool — repeated searches', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'localix-search-repeat-'))
    await writeFile(path.join(dir, 'a.ts'), 'export const needle = 1\n', 'utf8')
    await writeFile(path.join(dir, 'b.ts'), 'const needle = 2\n', 'utf8')
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('a second identical search returns the full results again', async () => {
    // The agent always gets the real hits: a repeat is never answered with a pointer at an
    // earlier result the model may no longer hold.
    const tool = createSearchTool(undefined, dir)

    const first = await tool.execute('s1', { query: 'needle' })
    const repeat = await tool.execute('s2', { query: 'needle' })
    expect(repeat.isError).toBeUndefined()
    for (const result of [first, repeat]) {
      expect(result.content).toContain('a.ts')
      expect(result.content).toContain('b.ts')
    }
    expect((repeat.details as { output: string }).output).toContain('a.ts')
  })

  test('a repeat whose results CHANGED shows the new hits', async () => {
    const tool = createSearchTool(undefined, dir)
    await tool.execute('s1', { query: 'needle' })

    await writeFile(path.join(dir, 'c.ts'), 'let needle = 3\n', 'utf8')

    const repeat = await tool.execute('s2', { query: 'needle' })
    expect(repeat.content).toContain('c.ts')
  })
})

/**
 * `search` shipped with NO wall-clock ceiling on any of its five ripgrep invocations, and
 * `resolveToolCwd` honours an absolute `cwd` — so `search {glob:'**', cwd:'/'}` walked the whole
 * filesystem with the user's Stop button as the only brake, and the self-widening retry could re-run it
 * three more times inside the same tool call. Cancellation was already wired; the ceiling was missing.
 */
describe('every ripgrep invocation carries a wall-clock ceiling', () => {
  const seenSearch: Array<number | undefined> = []
  const seenExec: Array<number | undefined> = []
  // NOT a spread of `localEnvironment` — it is a class instance, and spreading loses its prototype.
  const recordingEnv = {
    ...({} as Record<string, never>),
    readFile: localEnvironment.readFile.bind(localEnvironment),
    searchFiles: async (_pattern: string, _cwd: string, opts?: { timeoutSeconds?: number }) => {
      seenSearch.push(opts?.timeoutSeconds)
      return 'src/a.ts:1:hit'
    },
    exec: async (_command: string, opts?: { timeout?: number; uncapped?: boolean }) => {
      seenExec.push(opts?.timeout)
      return { stdout: 'a.ts\n', stderr: '', exitCode: 0 }
    },
  } as never

  beforeEach(() => {
    seenSearch.length = 0
    seenExec.length = 0
  })

  test('the content-search path passes it', async () => {
    await createSearchTool(recordingEnv, '/w').execute('t', { query: 'hit' })
    expect(seenSearch.length).toBeGreaterThan(0)
    expect(seenSearch.every((t) => t === SEARCH_TIMEOUT_SECONDS)).toBe(true)
  })

  test('the file-LISTING path passes it too — the one that can walk a whole disk', async () => {
    await createSearchTool(recordingEnv, '/w').execute('t', { glob: '**/*.ts' })
    expect(seenExec).toEqual([SEARCH_TIMEOUT_SECONDS])
  })
})

describe('prepareSearchArguments', () => {
  test('a bare queries string becomes its one-element list on the dispatch path', () => {
    expect(prepareSearchArguments({ queries: 'foo' })).toEqual({ queries: ['foo'] })
    expect(prepareSearchArguments({ queries: '["a","b"]' })).toEqual({ queries: ['a', 'b'] })
  })

  test('LOCALIX-34: context above the cap is read as the cap', () => {
    expect(prepareSearchArguments({ query: 'x', context: 17 })).toEqual({ query: 'x', context: 10 })
    const fine = { query: 'x', context: 3 }
    expect(prepareSearchArguments(fine)).toBe(fine)
  })
})

import { describe, expect, test } from 'bun:test'
import {
  extractEntities,
  extractTextEntities,
  entityKey,
  type EntityRef,
  type EntityKind,
} from './entities'
import { msg, namedTool } from './_test-helpers'

function values(refs: EntityRef[], kind?: EntityKind): string[] {
  return refs.filter((r) => !kind || r.kind === kind).map((r) => r.value)
}

describe('entityKey — path normalization', () => {
  test('a ./-prefixed tool-input path and its plain free-text mention share ONE key', () => {
    // Regression: the dep graph keyed precise tool paths without stripping `./`, so
    // `./src/a.ts` (input) and `src/a.ts` (mention) produced different keys and the
    // edge between the two messages was silently missed. The key is also
    // precise-independent — a precise tool input and an imprecise text mention collapse.
    expect(entityKey({ value: './src/a.ts', kind: 'path', precise: true })).toBe(
      entityKey({ value: 'src/a.ts', kind: 'path', precise: false }),
    )
    expect(entityKey({ value: 'SRC/A.TS', kind: 'path', precise: true })).toBe(
      entityKey({ value: 'src/a.ts', kind: 'path', precise: false }),
    )
  })

  test('non-path entities are case-sensitive and not ./-stripped', () => {
    expect(entityKey({ value: 'myFunc', kind: 'symbol', precise: true })).toBe('myFunc')
  })
})

describe('extractTextEntities — paths', () => {
  test('pulls a slash-bearing path with extension', () => {
    const refs = extractTextEntities('see src/features/foo.ts for the impl')
    expect(values(refs, 'path')).toContain('src/features/foo.ts')
  })

  test('pulls a bare name.ext path', () => {
    const refs = extractTextEntities('edit package.json then run')
    expect(values(refs, 'path')).toContain('package.json')
  })
})

describe('extractTextEntities — urls', () => {
  test('pulls an http(s) URL', () => {
    const refs = extractTextEntities('docs at https://example.com/path?q=1 ok')
    expect(values(refs, 'url')).toContain('https://example.com/path?q=1')
  })
})

describe('extractTextEntities — symbols', () => {
  test('pulls camelCase identifiers', () => {
    const refs = extractTextEntities('call getUserData soon')
    expect(values(refs, 'symbol')).toContain('getUserData')
  })

  test('pulls snake_case identifiers', () => {
    const refs = extractTextEntities('the user_token field')
    expect(values(refs, 'symbol')).toContain('user_token')
  })

  test('pulls backticked symbols', () => {
    const refs = extractTextEntities('the `someHelper` function')
    expect(values(refs, 'symbol')).toContain('someHelper')
  })
})

describe('extractTextEntities — stoplist + length floor', () => {
  test('suppresses stoplisted words like JSON / ERROR', () => {
    const refs = extractTextEntities('return JSON on ERROR and API failure')
    const vals = values(refs)
    expect(vals).not.toContain('JSON')
    expect(vals).not.toContain('ERROR')
    expect(vals).not.toContain('API')
  })

  test('suppresses short symbols below the min-length floor', () => {
    // `fo` and `ab` are camelCase-ish but under MIN_SYMBOL_LEN (4).
    const refs = extractTextEntities('the foBar and xY pair')
    // foBar is >= 4 chars → kept; short ones must not appear
    expect(values(refs, 'symbol')).toContain('foBar')
    expect(values(refs, 'symbol')).not.toContain('xY')
  })
})

describe('extractEntities — dedup', () => {
  test('dedups repeated entities within a single message', () => {
    const m = msg({
      role: 'user',
      content: 'src/a.ts again src/a.ts and getThing then getThing',
    })
    const refs = extractEntities(m)
    const paths = values(refs, 'path').filter((v) => v === 'src/a.ts')
    const syms = values(refs, 'symbol').filter((v) => v === 'getThing')
    expect(paths).toHaveLength(1)
    expect(syms).toHaveLength(1)
  })
})

describe('extractEntities — high-precision tool-input fields', () => {
  test('input.path comes back as a precise path entity', () => {
    const m = msg({ items: [namedTool('read', { path: 'src/precise/file.ts' })] })
    const refs = extractEntities(m)
    const pathRef = refs.find((r) => r.value === 'src/precise/file.ts')
    expect(pathRef).toBeDefined()
    expect(pathRef!.kind).toBe('path')
    expect(pathRef!.precise).toBe(true)
  })

  test('input.url is a precise url, input.query is a precise symbol', () => {
    const m = msg({
      items: [namedTool('search', { url: 'https://x.test/p', query: 'needle' })],
    })
    const refs = extractEntities(m)
    const url = refs.find((r) => r.value === 'https://x.test/p')
    const query = refs.find((r) => r.value === 'needle')
    expect(url).toMatchObject({ kind: 'url', precise: true })
    expect(query).toMatchObject({ kind: 'symbol', precise: true })
  })

  test('input.file and input.file_path also yield precise path entities', () => {
    const m1 = msg({ items: [namedTool('write', { file: 'a/b/c.tsx' })] })
    const m2 = msg({ items: [namedTool('edit', { file_path: 'd/e.css' })] })
    expect(extractEntities(m1).find((r) => r.value === 'a/b/c.tsx')?.precise).toBe(true)
    expect(extractEntities(m2).find((r) => r.value === 'd/e.css')?.precise).toBe(true)
  })

  test('free-text entities are not marked precise', () => {
    const m = msg({ role: 'user', content: 'look at src/loose.ts' })
    const ref = extractEntities(m).find((r) => r.value === 'src/loose.ts')
    expect(ref?.precise).toBe(false)
  })
})

describe('extractEntities — combines content + tool result', () => {
  test('extracts entities from a tool result text too', () => {
    const m = msg({
      items: [
        namedTool('bash', { command: 'ls' }, { resultText: 'found lib/result-only.ts here' }),
      ],
    })
    const refs = extractEntities(m)
    expect(values(refs, 'path')).toContain('lib/result-only.ts')
  })
})

describe('extractEntities — identity memo', () => {
  test('the SAME message object returns the same array; an equal copy re-extracts', () => {
    const m = msg({ role: 'user', content: 'see src/memoized.ts' })
    const first = extractEntities(m)
    // Cross-run reuse: history objects keep identity via the repo parse cache.
    expect(extractEntities(m)).toBe(first)
    // A different object (changed row → fresh parse) must not hit the memo.
    const copy = { ...m }
    expect(extractEntities(copy)).not.toBe(first)
    expect(extractEntities(copy)).toEqual(first)
  })
})

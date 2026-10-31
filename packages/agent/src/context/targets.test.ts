import { describe, expect, test } from 'bun:test'
import { defaultResolveTarget } from './targets'
import { namedTool } from './_test-helpers'

describe('defaultResolveTarget — class mapping', () => {
  test('read/lsp/search/grep map to "read"', () => {
    for (const name of ['Read', 'lsp', 'Search', 'grep']) {
      const t = defaultResolveTarget(namedTool(name, { path: 'src/x.ts' }))
      expect(t?.class).toBe('read')
    }
  })

  test('edit/write map to "mutate" keyed on the changed path', () => {
    const edit = defaultResolveTarget(namedTool('Edit', { path: 'src/Mutated.ts' }))
    const write = defaultResolveTarget(namedTool('Write', { path: 'src/Other.ts' }))
    expect(edit).toMatchObject({ class: 'mutate', keys: ['src/mutated.ts'] })
    expect(write).toMatchObject({ class: 'mutate', keys: ['src/other.ts'] })
  })

  test('a batched edit/write is keyed on every file it names', () => {
    const edit = defaultResolveTarget(
      namedTool('Edit', {
        edits: [{ path: 'src/A.ts' }, { path: 'src/B.ts' }, { path: 'src/A.ts' }],
      }),
    )
    const write = defaultResolveTarget(
      namedTool('Write', {
        files: [
          { path: 'x.md', content: '' },
          { path: 'y.md', content: '' },
        ],
      }),
    )
    expect(edit).toMatchObject({ class: 'mutate', keys: ['src/a.ts', 'src/b.ts'] })
    expect(write).toMatchObject({ class: 'mutate', keys: ['x.md', 'y.md'] })
  })

  test('bash maps to "nonidempotent" with no keys', () => {
    const t = defaultResolveTarget(namedTool('Bash', { command: 'ls' }))
    expect(t).toMatchObject({ class: 'nonidempotent', keys: [] })
  })

  test('unknown tool maps to "none"', () => {
    const t = defaultResolveTarget(namedTool('weird_unknown_tool', { foo: 1 }))
    expect(t).toMatchObject({ class: 'none', keys: [] })
  })

  test('an MCP call maps to "none"', () => {
    const t = defaultResolveTarget({
      id: 'm1',
      type: 'mcp_call',
      status: 'completed',
      toolCallId: 'm1',
      name: 'mcp__db__query',
      server: 'db',
      tool: 'query',
      input: { path: 'src/x.ts' },
    })
    expect(t).toEqual({ class: 'none', keys: [] })
  })
})

describe('defaultResolveTarget — apply_patch', () => {
  test('extracts Update/Add File paths from the patch as mutate keys', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '@@',
      '-old',
      '+new',
      '*** Add File: src/b.ts',
      '+content',
      '*** End Patch',
    ].join('\n')
    const t = defaultResolveTarget(namedTool('apply_patch', { patch }))
    expect(t?.class).toBe('mutate')
    expect(t?.keys).toEqual(['src/a.ts', 'src/b.ts'])
  })

  test('apply_patch with no recognizable markers (no file_change paths) returns undefined', () => {
    const t = defaultResolveTarget(namedTool('apply_patch', { patch: 'nothing useful here' }))
    expect(t).toBeUndefined()
  })
})

describe('defaultResolveTarget — read with query', () => {
  test('read without a path but with a query keys on q:<lowercased>', () => {
    const t = defaultResolveTarget(namedTool('Search', { query: 'Find ME' }))
    expect(t).toMatchObject({ class: 'read', keys: ['q:find me'] })
  })
})

describe('defaultResolveTarget — key normalization', () => {
  test('lowercases and strips leading ./ from paths', () => {
    const t = defaultResolveTarget(namedTool('Read', { path: './SRC/Foo.TS' }))
    expect(t?.keys).toEqual(['src/foo.ts'])
  })
})

describe('defaultResolveTarget — non-terminal items', () => {
  test('pending (non-terminal) items return undefined', () => {
    const t = defaultResolveTarget(
      namedTool('Read', { path: 'src/x.ts' }, { state: 'input-available' }),
    )
    expect(t).toBeUndefined()
  })

  test('failed items still resolve a target', () => {
    const t = defaultResolveTarget(
      namedTool('Edit', { path: 'src/x.ts' }, { state: 'output-error' }),
    )
    expect(t).toMatchObject({ class: 'mutate', keys: ['src/x.ts'] })
  })

  test('edit without a path returns undefined', () => {
    const t = defaultResolveTarget(namedTool('Edit', { content: 'no path' }))
    expect(t).toBeUndefined()
  })
})

describe('defaultResolveTarget — batched reads and searches', () => {
  test('a batched read observes every file it names', () => {
    const t = defaultResolveTarget(
      namedTool('Read', { path: 'src/A.ts', reads: [{ path: './src/b.ts' }, 'src/c.ts'] }),
    )
    expect(t).toEqual({ class: 'read', keys: ['src/a.ts', 'src/b.ts', 'src/c.ts'] })
  })

  test('a batched search observes every pattern', () => {
    const t = defaultResolveTarget(namedTool('Search', { query: 'Foo', queries: ['bar', 'foo'] }))
    expect(t).toEqual({ class: 'read', keys: ['q:foo', 'q:bar'] })
  })
})

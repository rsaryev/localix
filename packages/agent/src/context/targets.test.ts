import { describe, expect, test } from 'bun:test'
import { defaultResolveTarget, resolveTarget } from './targets'
import { namedTool } from './_test-helpers'

describe('defaultResolveTarget — class mapping', () => {
  test('read/lsp/search/grep map to "read"', () => {
    for (const name of ['read', 'lsp', 'search', 'grep']) {
      const t = defaultResolveTarget(namedTool(name, { path: 'src/x.ts' }))
      expect(t?.class).toBe('read')
    }
  })

  test('edit/write map to "mutate" keyed on the changed path', () => {
    const edit = defaultResolveTarget(namedTool('edit', { path: 'src/Mutated.ts' }))
    const write = defaultResolveTarget(namedTool('write', { path: 'src/Other.ts' }))
    expect(edit).toMatchObject({ class: 'mutate', keys: ['src/mutated.ts'] })
    expect(write).toMatchObject({ class: 'mutate', keys: ['src/other.ts'] })
  })

  test('bash maps to "nonidempotent" with no keys', () => {
    const t = defaultResolveTarget(namedTool('bash', { command: 'ls' }))
    expect(t).toMatchObject({ class: 'nonidempotent', keys: [] })
  })

  test('unknown tool maps to "none"', () => {
    const t = defaultResolveTarget(namedTool('weird_unknown_tool', { foo: 1 }))
    expect(t).toMatchObject({ class: 'none', keys: [] })
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
    const t = defaultResolveTarget(namedTool('search', { query: 'Find ME' }))
    expect(t).toMatchObject({ class: 'read', keys: ['q:find me'] })
  })
})

describe('defaultResolveTarget — key normalization', () => {
  test('lowercases and strips leading ./ from paths', () => {
    const t = defaultResolveTarget(namedTool('read', { path: './SRC/Foo.TS' }))
    expect(t?.keys).toEqual(['src/foo.ts'])
  })
})

describe('defaultResolveTarget — non-terminal items', () => {
  test('pending (non-terminal) items return undefined', () => {
    const t = defaultResolveTarget(
      namedTool('read', { path: 'src/x.ts' }, { state: 'input-available' }),
    )
    expect(t).toBeUndefined()
  })

  test('failed items still resolve a target', () => {
    const t = defaultResolveTarget(
      namedTool('edit', { path: 'src/x.ts' }, { state: 'output-error' }),
    )
    expect(t).toMatchObject({ class: 'mutate', keys: ['src/x.ts'] })
  })

  test('edit without a path returns undefined', () => {
    const t = defaultResolveTarget(namedTool('edit', { content: 'no path' }))
    expect(t).toBeUndefined()
  })
})

describe('resolveTarget — override', () => {
  test('prefers an app-supplied override resolver', () => {
    const override = () => ({ class: 'read' as const, keys: ['custom'] })
    const t = resolveTarget(namedTool('bash', { command: 'ls' }), override)
    expect(t).toMatchObject({ class: 'read', keys: ['custom'] })
  })

  test('falls back to default when override returns undefined', () => {
    const override = () => undefined
    const t = resolveTarget(namedTool('read', { path: 'src/x.ts' }), override)
    expect(t?.class).toBe('read')
  })
})

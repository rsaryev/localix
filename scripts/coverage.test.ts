import { describe, expect, test } from 'bun:test'
import { coverageBase, sourceFiles } from './coverage.mjs'

const CODE = 'export const value = 1\n'
const TYPES = 'export type Value = number\n'

describe('sourceFiles', () => {
  test('counts each package’s own files with code, never its tests, helpers or type-only modules', () => {
    const files = [
      'apps/api/src/a.ts',
      'apps/api/src/a.test.ts',
      'apps/api/src/b.dom.test.tsx',
      'apps/api/src/types.ts',
      'apps/api/src/build-stamp.d.mts',
      'apps/api/src/env.d.ts',
      'apps/api/src/testing/fixture.ts',
      'apps/api/src/generated/routes.ts',
      'apps/api/README.md',
      'mini-apps/sample-b/ui/c.tsx',
      'mini-apps/sample-b/ui/c.pw.mjs',
      'docs/x.ts',
    ]
    const read = (file: string) => (file.endsWith('types.ts') ? TYPES : CODE)

    expect(
      sourceFiles(
        ['apps/api', 'mini-apps/sample-b'],
        ['**/testing/**', '**/generated/**'],
        files,
        read,
      ),
    ).toEqual({
      'apps/api': ['apps/api/src/a.ts'],
      'mini-apps/sample-b': ['mini-apps/sample-b/ui/c.tsx'],
    })
  })

  test('a file belongs to the deepest package that contains it', () => {
    const files = ['mini-apps/sample/ui/a.ts', 'mini-apps/sample/kubernetes/ui/b.ts']

    expect(
      sourceFiles(['mini-apps/sample', 'mini-apps/sample/kubernetes'], [], files, () => CODE),
    ).toEqual({
      'mini-apps/sample': ['mini-apps/sample/ui/a.ts'],
      'mini-apps/sample/kubernetes': ['mini-apps/sample/kubernetes/ui/b.ts'],
    })
  })
})

describe('the base a change is measured against', () => {
  test('comes from --base, or from COVERAGE_BASE as CI sets it, and is absent otherwise', () => {
    expect(coverageBase(['--base', 'origin/main'], {})).toBe('origin/main')
    expect(coverageBase([], { COVERAGE_BASE: 'abc123' })).toBe('abc123')
    expect(coverageBase(['--base', 'origin/main'], { COVERAGE_BASE: 'abc123' })).toBe('origin/main')
    expect(coverageBase([], { COVERAGE_BASE: '' })).toBeNull()
    expect(coverageBase([], {})).toBeNull()
  })
})

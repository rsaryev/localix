import { describe, expect, test } from 'bun:test'
import { hasRuntimeCode, mergeCoverage, ownCoverage, parseLcov } from './lcov.mjs'

const record = (file: string, lines: [number, number][]) =>
  [`SF:${file}`, ...lines.map(([line, hits]) => `DA:${line},${hits}`), 'end_of_record'].join('\n')

describe('parseLcov', () => {
  test('resolves each file against the package the run started in, to a repository path', () => {
    const text = [
      record('src/a.ts', [
        [1, 3],
        [2, 0],
      ]),
      record('../shared/b.ts', [[7, 1]]),
    ].join('\n')
    const coverage = parseLcov(text, { repoRoot: '/repo', runDir: '/repo/packages/agent' })

    expect([...coverage.keys()]).toEqual(['packages/agent/src/a.ts', 'packages/shared/b.ts'])
    expect(coverage.get('packages/agent/src/a.ts')).toEqual(
      new Map([
        [1, 3],
        [2, 0],
      ]),
    )
  })

  test('keeps an absolute file path inside the repository and drops one outside it', () => {
    const text = [
      record('/repo/apps/ui/src/x.ts', [[1, 1]]),
      record('/elsewhere/y.ts', [[1, 1]]),
    ].join('\n')
    const coverage = parseLcov(text, { repoRoot: '/repo', runDir: '/repo/apps/ui' })

    expect([...coverage.keys()]).toEqual(['apps/ui/src/x.ts'])
  })
})

describe('mergeCoverage', () => {
  test('a line is covered when any shard ran it', () => {
    const shard1 = new Map([
      [
        'a.ts',
        new Map([
          [1, 0],
          [2, 4],
        ]),
      ],
    ])
    const shard2 = new Map([
      [
        'a.ts',
        new Map([
          [1, 2],
          [3, 0],
        ]),
      ],
      ['b.ts', new Map([[1, 0]])],
    ])

    expect(mergeCoverage([shard1, shard2])).toEqual(
      new Map([
        [
          'a.ts',
          new Map([
            [1, 2],
            [2, 4],
            [3, 0],
          ]),
        ],
        ['b.ts', new Map([[1, 0]])],
      ]),
    )
  })
})

describe('hasRuntimeCode', () => {
  test('a module of types and re-exports has no code to cover', () => {
    const source = `import type { A } from './a'
export type B = A & { b: string }
export interface C { c: number }
export { run } from './run'
export * from './more'
`
    expect(hasRuntimeCode(source, 'index.ts')).toBe(false)
  })

  test('a module with a statement of its own has code to cover', () => {
    expect(hasRuntimeCode(`export const limit = 3\n`, 'limits.ts')).toBe(true)
    expect(hasRuntimeCode(`export function f() { return 1 }\n`, 'f.ts')).toBe(true)
    expect(hasRuntimeCode(`import './side-effect'\n`, 'boot.ts')).toBe(true)
  })

  test('JSX is understood in a .tsx module', () => {
    expect(hasRuntimeCode(`export const A = () => <div />\n`, 'A.tsx')).toBe(true)
  })
})

describe('ownCoverage', () => {
  test('a package is credited only for its own files, even when its tests run another package', () => {
    const report = new Map([
      ['packages/markdown/src/a.ts', new Map([[1, 1]])],
      ['packages/kit/src/button.tsx', new Map([[1, 1]])],
      ['packages/mini-app-sdk/dist/ui.js', new Map([[1, 1]])],
      ['mini-apps/sample/kubernetes/ui/b.ts', new Map([[1, 1]])],
      ['mini-apps/sample/ui/c.ts', new Map([[1, 1]])],
    ])
    const packages = [
      'packages/markdown',
      'packages/kit',
      'mini-apps/sample',
      'mini-apps/sample/kubernetes',
    ]

    expect([...ownCoverage(report, 'packages/markdown', packages).keys()]).toEqual([
      'packages/markdown/src/a.ts',
    ])
    expect([...ownCoverage(report, 'mini-apps/sample', packages).keys()]).toEqual([
      'mini-apps/sample/ui/c.ts',
    ])
  })
})

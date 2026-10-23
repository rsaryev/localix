import { describe, expect, test } from 'bun:test'
import { coverageRuns } from './runs.mjs'

const COVERAGE = (dir: string) => [
  '--coverage',
  '--coverage-reporter=lcov',
  `--coverage-dir=${dir}`,
]

describe('coverageRuns', () => {
  test('a plain `bun test` script runs once, with its own arguments kept', () => {
    expect(
      coverageRuns("bun test --path-ignore-patterns='**/*.integration.test.ts' src", '/out/pkg'),
    ).toEqual([
      ['test', ...COVERAGE('/out/pkg/0'), '--path-ignore-patterns=**/*.integration.test.ts', 'src'],
    ])
  })

  test('a sharded script runs every shard into a directory of its own', () => {
    expect(
      coverageRuns('bun ../../scripts/test-shards.mjs 2 --no-orphans src', '/out/api'),
    ).toEqual([
      ['test', ...COVERAGE('/out/api/0'), '--shard=1/2', '--no-orphans', 'src'],
      ['test', ...COVERAGE('/out/api/1'), '--shard=2/2', '--no-orphans', 'src'],
    ])
  })

  test('a script it cannot run under coverage is reported, not guessed', () => {
    expect(() => coverageRuns('bun scripts/test-all.mjs', '/out/root')).toThrow(
      'cannot measure coverage for test script "bun scripts/test-all.mjs"',
    )
    expect(() => coverageRuns('bun test src && echo done', '/out/x')).toThrow('cannot measure')
  })
})

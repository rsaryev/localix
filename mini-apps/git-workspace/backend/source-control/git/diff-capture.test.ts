import { describe, expect, test } from 'bun:test'
import type { GitResult, GitRunner } from './cli'
import {
  captureRepresentativeTrackedDiff,
  parseNulNumstat,
  selectRepresentativeDiffPaths,
} from './diff-capture'

const ok = (stdout = ''): GitResult => ({ ok: true, stdout, stderr: '', code: 0 })

describe('bounded representative tracked-diff capture', () => {
  test('parses ordinary, binary and rename/copy numstat records', () => {
    expect(
      parseNulNumstat(
        ['10\t2\tsrc/a.ts', '-\t-\tasset.bin', '3\t1\t', 'old.ts', 'src/new.ts', ''].join('\0'),
      ),
    ).toEqual([
      {
        path: 'src/a.ts',
        insertions: 10,
        deletions: 2,
        changedLines: 12,
        index: 0,
        signal: 'source',
      },
      {
        path: 'asset.bin',
        binary: true,
        insertions: 0,
        deletions: 0,
        changedLines: 0,
        index: 1,
        signal: 'source',
      },
      {
        path: 'src/new.ts',
        insertions: 3,
        deletions: 1,
        changedLines: 4,
        index: 2,
        signal: 'source',
      },
    ])
  })

  test('keeps salient and spread source, reserves tests, and leaves generated output last', () => {
    const raw = [
      ...Array.from(
        { length: 20 },
        (_, index) => `${index === 11 ? 500 : 2}\t0\tsrc/f-${index}.ts`,
      ),
      ...Array.from({ length: 8 }, (_, index) => `4\t1\ttests/f-${index}.test.ts`),
      ...Array.from({ length: 8 }, (_, index) => `1000\t0\tgenerated/chunk-${index}.snap`),
      '',
    ].join('\0')
    const selected = selectRepresentativeDiffPaths(parseNulNumstat(raw), 12)
    const paths = selected.map((entry) => entry.path)

    expect(paths).toContain('src/f-11.ts')
    expect(paths[0]).toBe('src/f-11.ts')
    expect(paths).toContain('src/f-0.ts')
    expect(paths).toContain('src/f-19.ts')
    expect(paths.some((path) => path.startsWith('tests/'))).toBe(true)
    expect(paths.filter((path) => path.startsWith('generated/'))).toHaveLength(0)
  })

  test('captures every selected path separately under the per-file ceiling', async () => {
    const calls: Array<{ args: string[]; maxBufferBytes?: number }> = []
    const run: GitRunner = async (args, _env, _timeout, maxBufferBytes) => {
      calls.push({ args, maxBufferBytes })
      const path = args.at(-1)!
      return ok(`diff --git a/${path} b/${path}\n-old\n+new`)
    }
    const output = await captureRepresentativeTrackedDiff(
      run,
      ['diff', '--cached'],
      '5\t5\tsrc/a.ts\0' + '1\t1\ttests/a.test.ts\0',
      { maxFiles: 24, maxBufferBytes: 96_000 },
    )

    expect(calls).toEqual([
      { args: ['diff', '--cached', '--', 'src/a.ts'], maxBufferBytes: 96_000 },
      { args: ['diff', '--cached', '--', 'tests/a.test.ts'], maxBufferBytes: 96_000 },
    ])
    expect(output).toContain('diff --git a/src/a.ts')
    expect(output).toContain('diff --git a/tests/a.test.ts')
  })
})

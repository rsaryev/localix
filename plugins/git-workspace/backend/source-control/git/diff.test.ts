import { describe, expect, test } from 'bun:test'
import { getFileDiff } from './diff'
import type { GitResult, GitRunner } from './cli'

function recordingRunner(stdout = '') {
  const calls: string[][] = []
  const run: GitRunner = async (args) => {
    calls.push(args)
    return { ok: false, stdout, stderr: '', code: 1 } satisfies GitResult
  }
  return { run, calls }
}

const CWD = '/repo/project'

describe('getFileDiff untracked path confinement', () => {
  test('an absolute path outside the repo is refused (no git call, empty diff)', async () => {
    const { run, calls } = recordingRunner('SECRET CONTENTS')
    const res = await getFileDiff(run, CWD, { path: '/etc/passwd', untracked: true })
    expect(res.diff).toBe('')
    expect(calls).toEqual([]) // never reached --no-index → no file read
  })

  test('a ../ traversal path is refused', async () => {
    const { run, calls } = recordingRunner('SECRET')
    const res = await getFileDiff(run, CWD, { path: '../../etc/passwd', untracked: true })
    expect(res.diff).toBe('')
    expect(calls).toEqual([])
  })

  test('an in-repo untracked path stays confined but reaches git as repo-relative', async () => {
    const { run, calls } = recordingRunner('diff text')
    const res = await getFileDiff(run, CWD, { path: 'src/new.ts', untracked: true })
    expect(res.diff).toBe('diff text')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(['diff', '--no-index', '--', '/dev/null', 'src/new.ts'])
  })

  test('tracked diff is unaffected by the untracked guard', async () => {
    const { run, calls } = recordingRunner('tracked diff')
    await getFileDiff(run, CWD, { path: 'src/a.ts', staged: true })
    expect(calls[0]).toEqual(['diff', '--cached', '--', 'src/a.ts'])
  })
})

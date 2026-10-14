import { describe, expect, test } from 'bun:test'
import type { GitResult, GitRunner } from './cli'
import { getWorkingDiff, UI_WORKING_DIFF_LIMITS } from './working-diff'

const ok = (stdout = ''): GitResult => ({ ok: true, stdout, stderr: '', code: 0 })

/** Replies by argv; records calls and the capture ceiling each one asked for. */
function routed(route: (args: string[]) => GitResult) {
  const calls: string[][] = []
  const ceilings: Array<number | undefined> = []
  const run: GitRunner = async (args, _env, _timeout, maxBuffer) => {
    calls.push(args)
    ceilings.push(maxBuffer)
    return route(args)
  }
  return { run, calls, ceilings }
}

const untrackedPatch = (path: string): GitResult => ({
  ok: false,
  code: 1,
  stderr: '',
  stdout: `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+x\n`,
})

describe('getWorkingDiff — the UI route is bounded', () => {
  test('samples untracked files past the cap and says so', async () => {
    const paths = Array.from({ length: 500 }, (_, index) => `n-${index}.ts`)
    const { run, calls, ceilings } = routed((args) => {
      if (args[0] === 'ls-files') return ok(`${paths.join('\0')}\0`)
      if (args[1] === '--no-index') return untrackedPatch(args.at(-1)!)
      return ok('')
    })
    const res = await getWorkingDiff(run, '/repo', true, UI_WORKING_DIFF_LIMITS)
    const noIndex = calls.filter((args) => args[1] === '--no-index')
    expect(noIndex).toHaveLength(200)
    expect(res.truncated).toBe(true)
    for (const [index, args] of calls.entries()) {
      if (args[1] === '--no-index') expect(ceilings[index]).toBe(1_000_000)
    }
  })

  test('a tree within the bounds is whole — no truncated flag', async () => {
    const { run } = routed((args) => {
      if (args[0] === 'ls-files') return ok('a.ts\0')
      if (args[1] === '--no-index') return untrackedPatch('a.ts')
      return ok('')
    })
    const res = await getWorkingDiff(run, '/repo', true, UI_WORKING_DIFF_LIMITS)
    expect(res.truncated).toBeUndefined()
    expect(res.diff).toContain('b/a.ts')
  })

  test('an overflowing tracked diff keeps its complete files and flags truncated', async () => {
    const whole = 'diff --git a/a b/a\n@@ -1 +1 @@\n-a\n+b\n'
    const { run } = routed((args) => {
      if (args.join(' ') === 'diff HEAD') {
        return {
          ok: false,
          code: 1,
          stderr: '',
          stdout: `${whole}diff --git a/b b/b\n+c`,
          truncated: true,
        }
      }
      return ok('')
    })
    const res = await getWorkingDiff(run, '/repo', true, UI_WORKING_DIFF_LIMITS)
    expect(res).toMatchObject({ diff: whole, truncated: true, binary: false })
  })

  test('the tracked read and the untracked listing start together', async () => {
    const started: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const run: GitRunner = async (args) => {
      started.push(args[0]!)
      if (args[0] === 'diff') await gate
      return ok('')
    }
    const pending = getWorkingDiff(run, '/repo', true)
    await Promise.resolve()
    // `ls-files` was issued while `diff HEAD` is still in flight.
    expect(started).toEqual(['diff', 'ls-files'])
    release()
    await pending
  })
})

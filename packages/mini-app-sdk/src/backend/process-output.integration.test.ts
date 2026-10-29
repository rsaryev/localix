/**
 * The wait must outlive nothing.
 *
 * `await Promise.all([...pipes, proc.exited])` — what a bundled mini app's Docker exec and the mini app
 * template both used to do — waits on pipe EOF, which needs EVERY write end closed, not just
 * the child's; anything the command leaves behind (`foo &`, `setsid`, a daemon) keeps the read
 * pending and the WAIT outlives the PROCESS. A timeout that kills the child would not even help:
 * it bounds the process, not the promise.
 *
 * These drive REAL Bun children, because this is precisely the bug a fake exec cannot show: an
 * injected exec returns a resolved string and the pipes never exist. So: a real child, a real
 * grandchild holding stdout, a real clock.
 */
import { describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProcessOutput, readProcessOutputWithTimeout } from './process-output'

/**
 * Wait for the survivor to actually WRITE its witness — don't guess how long it needs. A fixed
 * sleep encoded "600ms of slack is enough", which a loaded suite takes away, and an
 * intermittently red guardrail teaches the next reader to ignore a real one. The cap keeps the
 * failure this test exists for — a survivor we EPIPE'd, so the witness never appears — failing,
 * under bun's 5s per-test budget.
 */
const waitForWitness = async (path: string, capMs = 4_000): Promise<string> => {
  const deadline = Date.now() + capMs
  for (;;) {
    const file = Bun.file(path)
    if ((await file.exists()) && file.size > 0) return await file.text()
    if (Date.now() >= deadline) return ''
    await Bun.sleep(20)
  }
}

/** Exits AT ONCE, but leaves a grandchild holding stdout for 3s (the daemon stand-in). */
const LEAVES_A_SURVIVOR = ['bash', '-c', 'echo hello; sleep 3 &']

// The bound is a backstop well past every test's own deadline; the tests' timeouts still decide.
const spawn = (cmd: string[]) =>
  Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', timeout: 10_000, killSignal: 'SIGKILL' })

describe('readProcessOutput waits for the process, not for pipes someone else holds', () => {
  test('a child that leaves a survivor holding stdout does NOT hold the wait', async () => {
    const started = performance.now()
    const { stdout, exitCode, viaExit } = await readProcessOutput(spawn(LEAVES_A_SURVIVOR))
    // The survivor holds our stdout for 3s; the old wait took all of it (measured: 3006ms).
    expect(performance.now() - started).toBeLessThan(1_500)
    expect(exitCode).toBe(0)
    expect(viaExit).toBe(true) // we stopped on exit + drain, not on EOF
    // …and the child's OWN output still survives: bounding the wait must not truncate.
    expect(stdout).toBe('hello\n')
  })

  test('the survivor is left alive — we drain to nowhere, never EPIPE it', async () => {
    const witness = join(tmpdir(), `localix-sdk-survivor-${Bun.randomUUIDv7()}`)
    try {
      await readProcessOutput(spawn(['bash', '-c', `(sleep 0.6; echo alive > ${witness}) &`]))
      expect(await waitForWitness(witness)).toBe('alive\n')
    } finally {
      rmSync(witness, { force: true })
    }
  })

  test('an ordinary command pays no drain and loses no output', async () => {
    const started = performance.now()
    const { stdout, stderr, exitCode, viaExit } = await readProcessOutput(
      spawn(['bash', '-c', 'echo out; echo err >&2']),
    )
    expect(performance.now() - started).toBeLessThan(200) // nobody holds the pipes → EOF wins
    expect({ stdout, stderr, exitCode, viaExit }).toEqual({
      stdout: 'out\n',
      stderr: 'err\n',
      exitCode: 0,
      viaExit: false,
    })
  })

  test('a large payload is read in full (the drain window never truncates)', async () => {
    const { stdout } = await readProcessOutput(
      spawn(['bash', '-c', 'for i in $(seq 1 50000); do echo "line $i"; done']),
    )
    const lines = stdout.trimEnd().split('\n')
    expect(lines).toHaveLength(50_000)
    expect(lines.at(-1)).toBe('line 50000')
  })

  test('a non-zero exit still carries stderr', async () => {
    const { stderr, exitCode } = await readProcessOutput(
      spawn(['bash', '-c', 'echo boom >&2; exit 7']),
    )
    expect(exitCode).toBe(7)
    expect(stderr).toBe('boom\n')
  })

  test('a process that never exits is killed at the timeout, under the caller’s label', async () => {
    const started = performance.now()
    const failure = await readProcessOutputWithTimeout(spawn(['bash', '-c', 'sleep 30']), 40, {
      label: 'Docker command',
    }).catch((err: unknown) => err)
    expect((failure as Error).message).toBe('Docker command timed out after 40ms')
    expect(performance.now() - started).toBeLessThan(1_000)
    const unlabelled = await readProcessOutputWithTimeout(spawn(['sleep', '30']), 40).catch(
      (err: unknown) => err,
    )
    expect((unlabelled as Error).message).toBe('Command timed out after 40ms')
  })
})

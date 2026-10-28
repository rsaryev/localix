import { afterEach, describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'

import { monitorHarness } from './test-harness'

/**
 * The one test that uses REAL processes.
 *
 * Everything else in this folder injects a fake source, which proves the policy but not the
 * wiring — and the wiring is where this feature can fail invisibly: a monitor that spawns
 * through the wrong shell, never assembles a line, or never resolves its exit simply stays
 * silent, and silence is what a working monitor looks like from the outside.
 *
 * Kept to short commands (well under a second each) so the suite stays fast.
 */
type Harness = Awaited<ReturnType<typeof monitorHarness>>
let h: Harness
afterEach(() => h?.close())

const secret = 'tok-abcdef-123456'
const redact = (_userId: string, text: string) => text.split(secret).join('[vault-secret]')

/** Wait until `predicate` holds, or fail loudly rather than hanging the suite. */
async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('timed out waiting for the monitor')
}
const wakeText = () => h.wakes.map((wake) => wake.content).join('\n')

describe('monitors over real processes', () => {
  test("a watch turns a command's stdout lines into wakes and ends on exit", async () => {
    h = await monitorHarness({ real: true, tuning: { batchWindowMs: 10 } })
    const started = await h.start({
      description: 'three lines',
      cwd: tmpdir(),
      watch: 'printf "one\\ntwo\\nthree\\n"',
      timeoutMs: 10_000,
    })
    expect(started.ok).toBe(true)
    await until(() => wakeText().includes('ended'))
    // Every line arrived, and the exit is reported rather than being silence.
    for (const line of ['one', 'two', 'three', 'the watched command exited'])
      expect(wakeText()).toContain(line)
  })

  test('an `until` wait runs its check for real and fires when the condition holds', async () => {
    h = await monitorHarness({ real: true })
    await h.start({
      description: 'service health',
      cwd: tmpdir(),
      until: {
        check: 'printf "status: ready\\n"',
        everySeconds: 5,
        when: { kind: 'contains', value: 'ready' },
        emit: 'once',
      },
      timeoutMs: 10_000,
    })
    await h.poll()
    await until(() => wakeText().includes('ended'))
    expect(wakeText()).toContain('the condition was met')
    // The predicate's evidence travels with it, not a bare "condition met".
    expect(wakeText()).toContain('ready')
  })

  test('a vault reference reaches the process through its ENVIRONMENT, not its command', async () => {
    // The whole security claim of `secrets.ts`, end to end against a real shell: the check can
    // READ the value (so the wait actually works), while the command we store and show carries
    // only the reference — and a value the check echoes is redacted before it becomes a wake.
    h = await monitorHarness({ real: true, resolveSecret: async () => secret, shield: redact })
    await h.start({
      description: 'authenticated probe',
      cwd: tmpdir(),
      until: {
        // Echoes the credential on purpose — that is what a `curl -v` or a reflecting API does.
        check: 'printf "auth=%s\\n" "${secret:MSGR_TOKEN}"',
        everySeconds: 5,
        when: { kind: 'contains', value: 'auth=' },
        emit: 'once',
      },
      timeoutMs: 10_000,
    })
    await h.poll()
    await until(() => wakeText().includes('ended'))
    // The condition was met, so the shell really did expand the injected env var…
    expect(wakeText()).toContain('the condition was met')
    // …and yet the value appears nowhere the agent or the user can read.
    expect(wakeText()).not.toContain(secret)
    expect(wakeText()).toContain('[vault-secret]')
    const row = await h.db.selectFrom('triggers').select('payload_json').executeTakeFirstOrThrow()
    expect(row.payload_json).toContain('${secret:MSGR_TOKEN}')
    expect(row.payload_json).not.toContain(secret)
  })

  test('a watch that is stopped kills its process without waking the agent', async () => {
    h = await monitorHarness({ real: true })
    await h.start({
      description: 'endless tail',
      cwd: tmpdir(),
      // Prints nothing and never exits: exactly the shape that must be killable.
      watch: 'while true; do sleep 1; done',
      timeoutMs: 10_000,
    })
    expect(h.service.stop('u1', 's1', 'mon-1')).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(h.wakes).toEqual([])
    expect(h.engine.list({ userId: 'u1' })).toEqual([])
  })
})

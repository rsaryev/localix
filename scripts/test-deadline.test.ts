import { expect, test } from 'bun:test'
import { join } from 'node:path'

const preload = join(import.meta.dir, 'test-deadline.ts')

/**
 * The case the deadline exists for: a process whose event loop is BLOCKED, so no in-process timer
 * (bun's own per-test timeout included) can ever fire. The external watchdog still kills it.
 */
test('a process stuck in a synchronous loop is killed at its deadline', async () => {
  const started = Date.now()
  const child = Bun.spawn(
    [
      'bun',
      '--preload',
      preload,
      '-e',
      'const end = Date.now() + 240_000; while (Date.now() < end) {}',
    ],
    {
      env: { ...process.env, LOCALIX_TEST_DEADLINE_S: '5' },
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: 90_000,
      killSignal: 'SIGKILL',
    },
  )
  const code = await child.exited
  const elapsed = Date.now() - started
  expect(code).not.toBe(0)
  // Polled every 5 s: killed on the first poll at or past the limit, long before the loop's
  // 240 s. The bound is wide because a loaded CI runner starves the `sh` watchdog's `sleep`; what
  // it proves is that the loop did not run to its end, not how fast an idle machine reacts.
  expect(elapsed).toBeLessThan(80_000)
  expect(await new Response(child.stderr).text()).toContain('ran past 5s')
}, 100_000)

test('a process that finishes in time exits normally, and the watchdog goes with it', async () => {
  const child = Bun.spawn(['bun', '--preload', preload, '-e', 'console.log("done")'], {
    env: { ...process.env, LOCALIX_TEST_DEADLINE_S: '5' },
    stdout: 'pipe',
    timeout: 20_000,
    killSignal: 'SIGKILL',
  })
  expect(await child.exited).toBe(0)
  expect((await new Response(child.stdout).text()).trim()).toBe('done')
})

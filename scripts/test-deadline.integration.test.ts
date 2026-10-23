import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

const preload = join(import.meta.dir, 'test-deadline.ts')

// `bun --preload … -e` skips the preload, so each case runs a real `bun test` over a one-file
// suite, the way every package runs it.
const suite = tempDirPerTest('test-deadline', {
  'stuck.test.ts': `import { test } from 'bun:test'
test('stuck', () => { const end = Date.now() + 240_000; while (Date.now() < end) {} }, 300_000)
`,
  // Long enough for the watchdog to be up: a process that exits within a few milliseconds is
  // gone before its watchdog starts, and would hide the delay this file pins.
  'quick.test.ts': `import { test } from 'bun:test'
test('quick', async () => { await Bun.sleep(300); console.error('done') })
`,
})

function bunTest(file: string, limitSeconds: number, pipeline = false) {
  const command = `bun test --preload '${preload}' '${join(suite(), file)}' 2>&1`
  return Bun.spawn(['sh', '-c', pipeline ? `${command} | cat` : command], {
    cwd: suite(),
    env: { ...process.env, LOCALIX_TEST_DEADLINE_S: String(limitSeconds) },
    stdout: 'pipe',
    timeout: 120_000,
    killSignal: 'SIGKILL',
  })
}

/**
 * The case the deadline exists for: a process whose event loop is BLOCKED, so no in-process timer
 * (bun's own per-test timeout included) can ever fire. The external watchdog still kills it.
 */
test('a process stuck in a synchronous loop is killed at its deadline', async () => {
  const started = Date.now()
  const child = bunTest('stuck.test.ts', 3)
  const output = await new Response(child.stdout).text()
  const elapsed = Date.now() - started
  // Asserted first with the child's own output attached: a watchdog that never fires on some
  // platform is otherwise indistinguishable from one that fired late.
  expect({ elapsed: Math.round(elapsed / 1000), output }).toMatchObject({
    output: expect.stringContaining('ran past 3s'),
  })
  expect(await child.exited).not.toBe(0)
  // The bound is wide because a loaded CI runner starves the watchdog's `sleep`; what it proves
  // is that the loop did not run to its 240 s end, not how fast an idle machine reacts.
  expect(elapsed).toBeLessThan(80_000)
}, 100_000)

// The watchdog used to inherit the test's stderr and poll every 5 s, so whoever read that stream
// (Turbo, CI, a shard runner) waited up to 5 s after the tests ended: most of a small package's
// `test` time. A shell pipeline waits for a real EOF, as those readers do.
test('a suite that finishes in time exits normally and releases its output at once', async () => {
  const started = Date.now()
  const child = bunTest('quick.test.ts', 900, true)
  const output = await new Response(child.stdout).text()
  expect(output).toContain('done')
  expect(output).not.toContain('test-deadline')
  expect(await child.exited).toBe(0)
  expect(Date.now() - started).toBeLessThan(4_000)
}, 30_000)

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseArgOptions, runArgOptionsScript } from './arg-options'

/**
 * An options menu belongs to the SCRIPT, not to whatever the script left behind.
 *
 * The bug this locks: the run settled only on `'close'`, which fires once every
 * inherited stdio descriptor is closed — including the ones the script handed to a
 * helper it spawned with inherited stdio. Such a script has already WRITTEN its
 * options and exited 0, but `'close'` never arrived: the picker sat on the 8s
 * timeout and then rendered an EMPTY menu (the timeout path discards the captured
 * bytes) for a script that worked perfectly.
 *
 * Measured before the fix: 8.3s → `[]`, for options written and exited in ~5ms.
 */

describe('arg-options: a leftover holding stdout must not empty the menu', () => {
  let dir: string
  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'arg-options-hostage-'))
    // Spawns a helper with INHERITED stdio that outlives it (and leaves our process
    // group), then prints its options and exits 0 — the realistic shape.
    await fs.writeFile(
      join(dir, 'leaks-pipe.ts'),
      `import { spawn } from 'node:child_process'\n` +
        `spawn('perl', ['-e', 'setpgrp; sleep 10'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true }).unref()\n` +
        `process.stdout.write(JSON.stringify([{ value: 'main' }, { value: 'dev' }]))\n`,
    )
    await fs.writeFile(
      join(dir, 'plain.ts'),
      `process.stdout.write(JSON.stringify(['a', 'b', 'c']))\n`,
    )
    await fs.writeFile(join(dir, 'hangs.ts'), `await new Promise(() => {})\n`)
  })
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('returns the options a script wrote before leaving a daemon on the pipe', async () => {
    const started = Date.now()
    const out = await runArgOptionsScript({
      scriptAbsPath: join(dir, 'leaks-pipe.ts'),
      cwd: dir,
      request: { query: '', cwd: dir, argName: 'branch', command: 'c' },
    })
    expect(parseArgOptions(out)).toEqual([
      { value: 'main', label: 'main' },
      { value: 'dev', label: 'dev' },
    ])
    expect(Date.now() - started).toBeLessThan(3_000) // before the fix: 8s, then []
  }, 20_000)

  it('a normal script still settles on close with all of its output', async () => {
    const started = Date.now()
    const out = await runArgOptionsScript({
      scriptAbsPath: join(dir, 'plain.ts'),
      cwd: dir,
      request: { query: '', cwd: dir, argName: 'x', command: 'c' },
    })
    expect(parseArgOptions(out)).toHaveLength(3)
    expect(Date.now() - started).toBeLessThan(2_000)
  }, 20_000)

  it('a genuinely hung script is still killed at the timeout → empty menu', async () => {
    const out = await runArgOptionsScript({
      scriptAbsPath: join(dir, 'hangs.ts'),
      cwd: dir,
      request: { query: '', cwd: dir, argName: 'x', command: 'c' },
      timeoutMs: 300,
    })
    expect(out).toBe('')
  }, 20_000)
})

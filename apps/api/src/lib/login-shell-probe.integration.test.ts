import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseEnvDump, probeShellEnv, probeShellEnvSync } from './login-shell-probe'

let dir = ''
const script = (name: string, body: string): string => {
  const file = join(dir, name)
  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, 0o755)
  return file
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'login-shell-probe-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// The probed "shell" is a POSIX script standing in for a user's zsh/bash.
describe.skipIf(process.platform === 'win32')('login-shell probe', () => {
  // An rc that ignores SIGTERM held boot for the full 5 s timeout — twice, one per flag set —
  // against a desktop shell that kills the start attempt at 12 s.
  test('ONE budget covers both flag sets, and a TERM-ignoring rc is killed inside it', async () => {
    // Short enough that the blocking probe's orphaned `sleep` (it can kill only the shell)
    // does not outlive the suite for long; still far past the budget.
    const stubborn = script('stubborn', "trap '' TERM\nsleep 5")
    for (const probe of [
      () => Promise.resolve(probeShellEnvSync(stubborn, process.env, 400)),
      () => probeShellEnv(stubborn, process.env, 400),
    ]) {
      const started = Date.now()
      expect(await probe()).toBeUndefined()
      expect(Date.now() - started).toBeLessThan(1_500)
    }
  })

  test('the non-blocking probe leaves the event loop serving while the rc runs', async () => {
    const slow = script('slow', 'sleep 0.3\nshift\nexec /bin/sh -c "$1"')
    let ticks = 0
    const ticker = setInterval(() => ticks++, 20)
    const vars = await probeShellEnv(slow, { ...process.env, LOCALIX_PROBE_MARK: 'seen' })
    clearInterval(ticker)
    expect(vars?.LOCALIX_PROBE_MARK).toBe('seen')
    expect(ticks).toBeGreaterThan(5)
  })

  test('falls back to the login-only flags when the interactive probe yields nothing', () => {
    const bailsInteractive = script(
      'bails',
      '[ "$1" = "-ilc" ] && exit 1\nshift\nexec /bin/sh -c "$1"',
    )
    expect(probeShellEnvSync(bailsInteractive, { ...process.env, MARK: 'lc' })?.MARK).toBe('lc')
  })
})

describe('parseEnvDump', () => {
  test('reads only between the sentinels, through prompt escapes', () => {
    const raw = '\x1b[1mbanner\x1b[0m__LOCALIX_ENV_START__A=1\0B=x=y\0__LOCALIX_ENV_END__'
    expect(parseEnvDump(raw)).toEqual({ A: '1', B: 'x=y' })
    expect(parseEnvDump('no sentinels')).toBeUndefined()
  })
})

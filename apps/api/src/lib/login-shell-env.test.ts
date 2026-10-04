import { afterEach, beforeEach, describe, expect, it, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import {
  __resetLoginShellEnvCache,
  childEnv,
  childEnvNonInteractive,
  loadLoginShellEnv,
  loginShellEnvSource,
} from './login-shell-env'

describe('childEnv', () => {
  it('keeps inherited process variables and lets explicit overrides win', () => {
    const key = 'LOCALIX_TEST_CHILD_ENV'
    process.env[key] = 'from-process'
    try {
      expect(childEnv()[key]).toBe('from-process')
      expect(childEnv({ [key]: 'from-override' })[key]).toBe('from-override')
    } finally {
      delete process.env[key]
    }
  })

  it('preserves inherited NODE_OPTIONS', () => {
    process.env.NODE_OPTIONS = '--max-old-space-size=8192'
    try {
      expect(childEnv().NODE_OPTIONS).toBe('--max-old-space-size=8192')
    } finally {
      delete process.env.NODE_OPTIONS
    }
  })
})

describe('childEnv pathPrefix', () => {
  it('prepends dirs while preserving the resolved PATH', () => {
    const before = childEnv().PATH ?? ''
    const env = childEnv(undefined, ['/opt/plugin-a/bin', '/opt/plugin-b/bin'])
    expect(env.PATH!.startsWith(`/opt/plugin-a/bin${delimiter}/opt/plugin-b/bin${delimiter}`)).toBe(
      true,
    )
    if (before) expect(env.PATH!.endsWith(before)).toBe(true)
  })

  it('is a no-op for an empty or absent prefix', () => {
    const base = childEnv().PATH
    expect(childEnv(undefined, []).PATH).toBe(base)
    expect(childEnv(undefined, undefined).PATH).toBe(base)
  })

  it('non-interactive children keep the fail-fast overlay and path prefix', () => {
    const env = childEnvNonInteractive(undefined, ['/opt/plugin-c/bin'])
    expect(env.PATH!.startsWith(`/opt/plugin-c/bin${delimiter}`)).toBe(true)
    expect(env.CI).toBe('1')
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
  })
})

/**
 * The login-shell probe is the single most expensive step of API boot (~310 ms here,
 * seconds with nvm/oh-my-zsh) and it runs BEFORE the HTTP server can bind, so the
 * result is persisted. These cover the two ways a persisted environment goes wrong:
 * it is not actually reused, or it is reused when it should not be.
 *
 * Each case needs a real probe to have succeeded. Where it cannot (a sandbox with no
 * usable login shell) the assertion falls back to the documented degraded contract —
 * `childEnv()` still yields a usable PATH — so neither branch is vacuous.
 */
describe('login-shell env snapshot', () => {
  const scratch = (tag: string) => join(tmpdir(), `localix-shell-env-${process.pid}-${tag}.json`)

  // A probe that SUCCEEDED leaves `vars`; a failed one leaves only `failedAt`.
  const coldProbe = (file: string) => {
    __resetLoginShellEnvCache(file)
    childEnv()
    return existsSync(file) && Boolean(JSON.parse(readFileSync(file, 'utf8')).entries[0]?.vars)
  }

  it('persists the resolved delta and reuses it instead of re-probing', () => {
    const file = scratch('reuse')
    try {
      if (!coldProbe(file)) {
        expect(childEnv().PATH).toBeTruthy()
        return
      }
      const stored = JSON.parse(readFileSync(file, 'utf8'))
      expect(stored.entries).toHaveLength(1)
      // A value only the FILE can supply: if the next resolve returns it, the shell
      // was not spawned again.
      stored.entries[0].vars.LOCALIX_SNAPSHOT_PROOF = 'from-disk'
      writeFileSync(file, JSON.stringify(stored))
      __resetLoginShellEnvCache(file)
      expect(childEnv().LOCALIX_SNAPSHOT_PROOF).toBe('from-disk')
    } finally {
      __resetLoginShellEnvCache()
      rmSync(file, { force: true })
    }
  })

  it('discards a snapshot whose fingerprint no longer matches', () => {
    const file = scratch('stale')
    try {
      if (!coldProbe(file)) {
        expect(childEnv().PATH).toBeTruthy()
        return
      }
      const stored = JSON.parse(readFileSync(file, 'utf8'))
      stored.entries[0].vars.LOCALIX_SNAPSHOT_PROOF = 'from-disk'
      stored.entries[0].key = 'someone-edited-their-zshrc'
      writeFileSync(file, JSON.stringify(stored))
      __resetLoginShellEnvCache(file)
      expect(childEnv().LOCALIX_SNAPSHOT_PROOF).toBeUndefined()
    } finally {
      __resetLoginShellEnvCache()
      rmSync(file, { force: true })
    }
  })

  it('keeps a terminal and a GUI environment side by side instead of evicting', () => {
    const file = scratch('multi')
    const realPath = process.env.PATH
    try {
      if (!coldProbe(file)) {
        expect(childEnv().PATH).toBeTruthy()
        return
      }
      // Stand in for the bare launchd/systemd PATH a GUI launch starts from: a
      // different starting environment resolves differently and must get its own
      // slot, or the two launch modes evict each other and neither ever hits.
      process.env.PATH = '/usr/bin:/bin'
      __resetLoginShellEnvCache(file)
      childEnv()
      expect(JSON.parse(readFileSync(file, 'utf8')).entries).toHaveLength(2)
    } finally {
      process.env.PATH = realPath
      __resetLoginShellEnvCache()
      rmSync(file, { force: true })
    }
  })

  it('never freezes a session value the shell only passed through', () => {
    const file = scratch('passthrough')
    // Stands in for SSH_AUTH_SOCK / TMPDIR: we set it, the shell inherits and echoes
    // it unchanged, so persisting it would pin this run's value onto every later one.
    process.env.LOCALIX_FAKE_SESSION_SOCK = `/tmp/session-${process.pid}`
    try {
      if (!coldProbe(file)) {
        expect(childEnv().PATH).toBeTruthy()
        return
      }
      const stored = JSON.parse(readFileSync(file, 'utf8'))
      expect(stored.entries[0].vars.LOCALIX_FAKE_SESSION_SOCK).toBeUndefined()
      // …and it still reaches children, from the live process env.
      expect(childEnv().LOCALIX_FAKE_SESSION_SOCK).toBe(`/tmp/session-${process.pid}`)
    } finally {
      delete process.env.LOCALIX_FAKE_SESSION_SOCK
      __resetLoginShellEnvCache()
      rmSync(file, { force: true })
    }
  })
})

/**
 * A stand-in login shell: counts its runs in `counter`, then either prints nothing (a probe
 * that fails) or runs the probe script with `LOCALIX_PROBE_PROOF` set.
 */
function fakeShell(dir: string, mode: 'fail' | 'ok'): { shell: string; runs: () => number } {
  const shell = join(dir, `fake-${mode}-sh`)
  const counter = join(dir, `${mode}.runs`)
  const body =
    mode === 'fail'
      ? `echo x >> '${counter}'\nexit 0`
      : `echo x >> '${counter}'\nLOCALIX_PROBE_PROOF=async; export LOCALIX_PROBE_PROOF\nshift\nexec /bin/sh -c "$1"`
  writeFileSync(shell, `#!/bin/sh\n${body}\n`)
  chmodSync(shell, 0o755)
  const runs = () =>
    existsSync(counter) ? readFileSync(counter, 'utf8').split('\n').length - 1 : 0
  return { shell, runs }
}

describe.skipIf(process.platform === 'win32')('login-shell env resolution', () => {
  const realShell = process.env.SHELL
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'login-shell-env-'))
  })
  afterEach(() => {
    process.env.SHELL = realShell
    delete process.env.LOCALIX_PROBE_PROOF
    __resetLoginShellEnvCache()
    rmSync(dir, { recursive: true, force: true })
  })

  // A failed probe was retried on EVERY boot, so an rc that always overruns paid its full
  // timeout on every launch.
  test('a failed probe is remembered for its fingerprint instead of re-run each boot', () => {
    const { shell, runs } = fakeShell(dir, 'fail')
    process.env.SHELL = shell
    const file = join(dir, 'snapshot.json')
    __resetLoginShellEnvCache(file)
    childEnv()
    const afterFirst = runs()
    expect(afterFirst).toBeGreaterThan(0)
    expect(JSON.parse(readFileSync(file, 'utf8')).entries[0].failedAt).toBeNumber()
    __resetLoginShellEnvCache(file)
    childEnv()
    expect(runs()).toBe(afterFirst)
  })

  // The boot path must not block READY on the user's rc files, and the subsystems gated on
  // it must see the repaired env once it settles.
  test('loadLoginShellEnv resolves without blocking and folds the result into process.env', async () => {
    const { shell } = fakeShell(dir, 'ok')
    process.env.SHELL = shell
    __resetLoginShellEnvCache(join(dir, 'snapshot.json'))
    let turned = false
    setTimeout(() => (turned = true), 0)
    const ready = loadLoginShellEnv()
    expect(process.env.LOCALIX_PROBE_PROOF).toBeUndefined()
    await ready
    expect(turned).toBe(true)
    expect(process.env.LOCALIX_PROBE_PROOF).toBe('async')
    expect(loadLoginShellEnv()).toBe(ready)
  })

  // `startup.env_ready` reports this: a slow boot must say whether it paid a probe.
  test('reports a probe as a miss and a snapshot answer as a hit', async () => {
    const { shell, runs } = fakeShell(dir, 'ok')
    process.env.SHELL = shell
    const file = join(dir, 'snapshot.json')
    __resetLoginShellEnvCache(file)
    expect(loginShellEnvSource()).toBeUndefined()
    await loadLoginShellEnv()
    expect(loginShellEnvSource()).toBe('miss')
    const probes = runs()
    __resetLoginShellEnvCache(file)
    await loadLoginShellEnv()
    expect(loginShellEnvSource()).toBe('hit')
    expect(runs()).toBe(probes)
  })

  test('a spawn during the in-flight probe gets the repaired env, not a half one', async () => {
    const { shell } = fakeShell(dir, 'ok')
    process.env.SHELL = shell
    __resetLoginShellEnvCache(join(dir, 'snapshot.json'))
    const ready = loadLoginShellEnv()
    expect(childEnv().LOCALIX_PROBE_PROOF).toBe('async')
    await ready
  })
})

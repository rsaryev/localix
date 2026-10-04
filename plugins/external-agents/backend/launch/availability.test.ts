import { describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { createAgentCliProbe } from './availability'
import type { AgentLauncher } from '../../shared/launch'

const LAUNCHERS: readonly AgentLauncher[] = [
  { provider: 'claude-code', label: 'Claude Code', executable: 'claude' },
  { provider: 'codex', label: 'Codex', executable: 'codex' },
]

/** A probe over a synthetic PATH, so nothing here depends on what the developer has installed. */
function probeOver(
  files: Record<string, boolean>,
  pathValue: string,
  extra?: { now?: () => number },
) {
  const seen: string[] = []
  const probe = createAgentCliProbe({
    pathValue: () => pathValue,
    launchers: LAUNCHERS,
    isExecutable: async (candidate) => {
      seen.push(candidate)
      return Boolean(files[candidate])
    },
    ...(extra?.now ? { now: extra.now } : {}),
  })
  return { probe, seen }
}

describe('agent CLI availability', () => {
  test('reports only what is actually on PATH', async () => {
    const { probe } = probeOver({ '/opt/bin/codex': true }, '/opt/bin')
    expect(await probe.list()).toEqual([
      { provider: 'claude-code', label: 'Claude Code', executable: 'claude', available: false },
      {
        provider: 'codex',
        label: 'Codex',
        executable: 'codex',
        available: true,
        path: '/opt/bin/codex',
      },
    ])
  })

  test('takes the FIRST match, the way the shell resolving the same name would', async () => {
    // A version manager's shim shadows the system copy. Reporting the second one would name a
    // binary the pane is never going to run.
    const { probe } = probeOver(
      { '/home/me/.local/bin/codex': true, '/usr/bin/codex': true },
      ['/home/me/.local/bin', '/usr/bin'].join(delimiter),
    )
    const codex = (await probe.list()).find((row) => row.provider === 'codex')
    expect(codex?.path).toBe('/home/me/.local/bin/codex')
  })

  test('ignores relative and empty PATH entries instead of resolving them against our own cwd', async () => {
    const { probe, seen } = probeOver(
      {},
      ['', '.', 'node_modules/.bin', '/usr/bin'].join(delimiter),
    )
    await probe.list()
    expect(seen.every((candidate) => candidate.startsWith('/usr/bin/'))).toBe(true)
  })

  test('serves a cached reading, and rescans when PATH itself changes', async () => {
    let pathValue = '/a'
    const calls: string[] = []
    const probe = createAgentCliProbe({
      pathValue: () => pathValue,
      launchers: LAUNCHERS,
      isExecutable: async (candidate) => {
        calls.push(candidate)
        return candidate === '/b/codex'
      },
    })

    await probe.list()
    const afterFirst = calls.length
    await probe.list()
    expect(calls.length).toBe(afterFirst) // cache hit — no second pass

    // A PATH change answers a DIFFERENT question, so the TTL must not keep serving the old one.
    pathValue = '/b'
    const rescanned = await probe.list()
    expect(calls.length).toBeGreaterThan(afterFirst)
    expect(rescanned.find((row) => row.provider === 'codex')?.available).toBe(true)
  })

  test('expires on the TTL, and `refresh` does not wait for it', async () => {
    let clock = 0
    let installed = false
    const calls: string[] = []
    const probe = createAgentCliProbe({
      pathValue: () => '/opt/bin',
      launchers: LAUNCHERS,
      now: () => clock,
      ttlMs: 1_000,
      isExecutable: async (candidate) => {
        calls.push(candidate)
        return installed && candidate === '/opt/bin/codex'
      },
    })

    await probe.list()
    const afterFirst = calls.length
    clock = 500
    await probe.list()
    expect(calls.length).toBe(afterFirst)

    // Someone installs the CLI and presses "Check again" — the whole point of the manual path.
    installed = true
    const refreshed = await probe.list({ refresh: true })
    expect(refreshed.find((row) => row.provider === 'codex')?.available).toBe(true)

    clock = 2_000
    const afterRefresh = calls.length
    await probe.list()
    expect(calls.length).toBeGreaterThan(afterRefresh)
  })

  test('concurrent callers share ONE scan', async () => {
    // Three surfaces asking at once (a re-render mid-flight) must not mean three passes over PATH.
    let passes = 0
    const probe = createAgentCliProbe({
      pathValue: () => '/opt/bin',
      launchers: LAUNCHERS,
      isExecutable: async () => {
        passes += 1
        await Promise.resolve()
        return false
      },
    })
    await Promise.all([probe.list(), probe.list(), probe.list()])
    expect(passes).toBe(LAUNCHERS.length)
  })

  test('an unreadable directory is "not here", never a thrown scan', async () => {
    // The real predicate faces EACCES on a directory it may not stat. The menu must still render.
    const probe = createAgentCliProbe({
      pathValue: () => '/root/private-bin',
      launchers: LAUNCHERS,
    })
    expect((await probe.list()).every((row) => !row.available)).toBe(true)
  })

  test('against a REAL directory: the executable bit is what counts', async () => {
    // The default predicate is the one production uses; a fake agreeing with itself proves nothing.
    const dir = mkdtempSync(join(tmpdir(), 'agent-cli-'))
    writeFileSync(join(dir, 'codex'), '#!/bin/sh\n')
    chmodSync(join(dir, 'codex'), 0o755)
    writeFileSync(join(dir, 'claude'), 'not a program\n')
    chmodSync(join(dir, 'claude'), 0o644)

    const probe = createAgentCliProbe({ pathValue: () => dir, launchers: LAUNCHERS })
    const rows = await probe.list()
    expect(rows.find((row) => row.provider === 'codex')?.available).toBe(true)
    // Present but not runnable. Offering it would open a pane that prints "permission denied".
    expect(rows.find((row) => row.provider === 'claude-code')?.available).toBe(
      process.platform === 'win32',
    )
  })
})

import { describe, expect, test } from 'bun:test'

import type { RuntimeEndpoint } from './runtime-endpoint'
import {
  owningShellPid,
  parseProcessFacts,
  type ProcessFacts,
  type ShellOwnerProbe,
} from './runtime-shell-owner'

const RUNTIME = 500
const OTHER_SHELL = 400
const OWN_SHELL = 300
const OWN_SHELL_PARENT = 200

const endpoint = (extra: Partial<RuntimeEndpoint> = {}): RuntimeEndpoint => ({
  pid: RUNTIME,
  baseUrl: 'http://127.0.0.1:4100',
  startedAt: '2026-10-17T00:00:00.000Z',
  protocolVersion: 4,
  ...extra,
})

function probe(processes: Record<number, ProcessFacts>, alive = new Set([OTHER_SHELL])) {
  return {
    describe: (pid) => processes[pid] ?? null,
    isAlive: (pid) => alive.has(pid),
  } satisfies ShellOwnerProbe
}

const ownShell = { [OWN_SHELL]: { ppid: OWN_SHELL_PARENT, command: '/Apps/Localix' } }

describe('owningShellPid', () => {
  test("another live shell's desktop runtime is off limits, with or without a recorded shell", () => {
    const runtime = {
      [RUNTIME]: { ppid: OTHER_SHELL, command: 'bun server.js --desktop-runtime' },
      ...ownShell,
    }
    expect(owningShellPid(endpoint(), OWN_SHELL, probe(runtime))).toBe(OTHER_SHELL)
    expect(owningShellPid(endpoint({ shellPid: OTHER_SHELL }), OWN_SHELL, probe(runtime))).toBe(
      OTHER_SHELL,
    )
  })

  test('a runtime whose shell is gone may be replaced (update relaunch, crashed shell)', () => {
    const orphan = { [RUNTIME]: { ppid: 1, command: 'bun server.js --desktop-runtime' } }
    expect(owningShellPid(endpoint({ shellPid: OTHER_SHELL }), OWN_SHELL, probe(orphan))).toBe(null)
    const deadShell = {
      [RUNTIME]: { ppid: OTHER_SHELL, command: 'bun server.js --desktop-runtime' },
    }
    expect(owningShellPid(endpoint(), OWN_SHELL, probe(deadShell, new Set()))).toBe(null)
  })

  test('a runtime that is not a desktop runtime is not a shell to defer to', () => {
    const daemon = { [RUNTIME]: { ppid: OTHER_SHELL, command: 'bun src/index.ts' } }
    expect(owningShellPid(endpoint(), OWN_SHELL, probe(daemon))).toBe(null)
  })

  test('our own shell, and the shell that restarted into us, are not another copy', () => {
    const mine = { [RUNTIME]: { ppid: OWN_SHELL, command: 'bun --desktop-runtime' } }
    expect(owningShellPid(endpoint(), OWN_SHELL, probe(mine, new Set([OWN_SHELL])))).toBe(null)
    const restarting = {
      [RUNTIME]: { ppid: OWN_SHELL_PARENT, command: 'bun --desktop-runtime' },
      ...ownShell,
    }
    expect(
      owningShellPid(endpoint(), OWN_SHELL, probe(restarting, new Set([OWN_SHELL_PARENT]))),
    ).toBe(null)
  })

  test('a runtime that cannot be described is left to the existing replace path', () => {
    expect(owningShellPid(endpoint(), OWN_SHELL, probe({}))).toBe(null)
  })
})

describe('parseProcessFacts', () => {
  test('reads ps output with padding and spaces in the command', () => {
    expect(
      parseProcessFacts('  4021 /Applications/Localix.app/bun server.js --desktop-runtime\n'),
    ).toEqual({ ppid: 4021, command: '/Applications/Localix.app/bun server.js --desktop-runtime' })
    expect(parseProcessFacts('')).toBe(null)
  })
})

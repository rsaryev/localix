/**
 * "When an event fires, its matching hooks run in parallel" (hooks.md, "Hook handler fields"):
 * one hook never waits for another, and a deny from one does not stop the others from running.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { createCcHooksRuntime } from './run'
import type { CcHookEvent, CcHookHandler } from './contracts'

const dir = tempDirPerTest('cc-parallel-')
const silent = { warn: () => {}, info: () => {} }
const cmd = (command: string): CcHookHandler => ({ source: 'plugin', command, timeoutMs: 5000 })
const marker = (name: string) => join(dir(), name)
/** Waits (inside the hook) for the other hook's marker: only parallel hooks both finish. */
const waitFor = (name: string, then: string) =>
  cmd(
    `cat >/dev/null; for i in $(seq 1 60); do [ -f "${marker(name)}" ] && break; sleep 0.05; done; [ -f "${marker(name)}" ] && ${then}`,
  )
const touch = (name: string, then = 'true') =>
  cmd(`cat >/dev/null; touch "${marker(name)}"; ${then}`)

const make = (event: CcHookEvent, handlers: CcHookHandler[]) =>
  createCcHooksRuntime({
    registry: { [event]: [{ handlers }] },
    sessionId: 's1',
    projectDir: dir(),
    enabled: true,
    logger: silent,
  })

const DENY = `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"saw b"}}'`

describe('matching hooks run in parallel', () => {
  it('PreToolUse: the first hook can see what a later one did while both run', async () => {
    const result = await make('PreToolUse', [waitFor('b', DENY), touch('b')]).runPreToolUse(
      'bash',
      { command: 'ls' },
    )
    expect(result).toMatchObject({ decision: 'deny', reason: 'saw b' })
  })

  it('PreToolUse: a deny does not keep the other hooks from running', async () => {
    await make('PreToolUse', [cmd(`cat >/dev/null; ${DENY}`), touch('logged')]).runPreToolUse(
      'bash',
      { command: 'ls' },
    )
    expect(existsSync(marker('logged'))).toBe(true)
  })

  it('Stop: every hook runs at once', async () => {
    const block = `echo '{"decision":"block","reason":"keep going"}'`
    const result = await make('Stop', [waitFor('b', block), touch('b')]).runStop()
    expect(result).toMatchObject({ blocked: true, reason: 'keep going' })
  })
})

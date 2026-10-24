/**
 * `onFailure: "block"` (hooks.md, "Block the action when a hook fails"): a command or http hook
 * that cannot start, exits with a code other than 0 or 2, times out or prints invalid output does
 * what exit 2 does on its event (a PermissionRequest is denied); without it the action goes ahead.
 * Stop, SubagentStop, TaskCompleted, TeammateIdle and background hooks are unaffected.
 */
import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { parseHooksBlock } from './config'
import { createCcHooksRuntime } from './run'

const dir = tempDirPerTest('cc-on-failure-')
const silent = { warn: () => {}, info: () => {} }

/** A runtime whose `event` has one hook, configured as a plugin's hooks.json writes it. */
function make(event: string, hook: Record<string, unknown>) {
  const registry = parseHooksBlock({ hooks: { [event]: [{ hooks: [hook] }] } }, 'plugin', {
    projectDir: dir(),
    pluginName: 'policy',
  })
  return createCcHooksRuntime({
    registry,
    sessionId: 's1',
    projectDir: dir(),
    enabled: true,
    logger: silent,
  })
}

const missing = (extra: Record<string, unknown> = {}) => ({
  type: 'command',
  command: 'node',
  args: [join(dir(), 'missing.js')],
  ...extra,
})

describe('onFailure: "block"', () => {
  it('a PreToolUse hook that cannot run blocks the call and says why', async () => {
    const result = await make('PreToolUse', missing({ onFailure: 'block' })).runPreToolUse('bash', {
      command: 'ls',
    })
    expect(result.decision).toBe('deny')
    expect(result.reason).toContain('failed; blocking because onFailure is "block"')
  })

  it('without it the call goes ahead', async () => {
    const result = await make('PreToolUse', missing()).runPreToolUse('bash', { command: 'ls' })
    expect(result.decision).toBe('proceed')
  })

  it('an exit code other than 0 or 2 is a failure even when it printed an allow', async () => {
    const hook = {
      type: 'command',
      command: `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'; exit 1`,
      onFailure: 'block',
    }
    expect((await make('PreToolUse', hook).runPreToolUse('bash', { command: 'ls' })).decision).toBe(
      'deny',
    )
  })

  it('a UserPromptSubmit failure blocks the prompt', async () => {
    const result = await make(
      'UserPromptSubmit',
      missing({ onFailure: 'block' }),
    ).runUserPromptSubmit('hi')
    expect(result.blocked).toBe(true)
  })

  it('a PermissionRequest failure denies the request', async () => {
    const result = await make(
      'PermissionRequest',
      missing({ onFailure: 'block' }),
    ).runPermissionRequest('bash', { command: 'rm -rf build' })
    expect(result.behavior).toBe('deny')
  })

  it('has no effect on Stop', async () => {
    const result = await make('Stop', missing({ onFailure: 'block' })).runStop()
    expect(result.blocked).toBe(false)
  })
})

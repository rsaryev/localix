/**
 * The added events about the session around the turn, and the handler-type policy the added
 * events follow: Claude Code's input fields, matchers and folds.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { parseHooksBlock } from './config'
import {
  CC_INERT_HOOK_EVENTS,
  isCcHookEvent,
  type CcHookHandler,
  type CcHookRegistry,
} from './contracts'
import { fileChangedWatchNames, matchesNarrowField } from './matcher'
import { createCcHooksRuntime } from './run'
import { modelMatchNames } from './runtime-session-hooks'

const dir = tempDirPerTest('cc-session-')
const silent = { warn: () => {}, info: () => {} }
const cmd = (command: string, timeoutMs = 5000): CcHookHandler => ({
  source: 'plugin',
  command,
  timeoutMs,
})
const capture = (name: string, then = 'exit 0') => cmd(`cat > "${join(dir(), name)}"; ${then}`)
const input = (name: string) => JSON.parse(readFileSync(join(dir(), name), 'utf8'))
const json = (value: unknown) => `echo '${JSON.stringify(value)}'`
const make = (registry: CcHookRegistry) =>
  createCcHooksRuntime({
    registry,
    sessionId: 's1',
    projectDir: dir(),
    enabled: true,
    logger: silent,
  })
const opus = {
  fromModel: 'claude-sonnet-5',
  toModel: 'anthropic/claude-opus-5-20260101',
  requestedModel: 'opus',
  source: 'command' as const,
}

describe('StopFailure / PostCompact / InstructionsLoaded', () => {
  it('StopFailure matches its error type on the narrow exact set and reports the error', async () => {
    const rt = make({
      StopFailure: [
        { matcher: 'rate_limit|billing_error', handlers: [capture('sf.json')] },
        { matcher: 'server_error', handlers: [capture('never.json')] },
      ],
    })
    await rt.runStopFailure({ error: 'rate_limit', details: '429', message: 'API Error: 429' })
    expect(input('sf.json')).toMatchObject({
      hook_event_name: 'StopFailure',
      error: 'rate_limit',
      error_details: '429',
      last_assistant_message: 'API Error: 429',
    })
    expect(() => input('never.json')).toThrow()
    // A hyphen keeps a StopFailure / FileChanged matcher on the regex path, as in CC.
    expect(matchesNarrowField('rate-limit', 'rate-limit')).toBe(true)
    expect(matchesNarrowField('rate,limit', 'rate')).toBe(false)
  })

  it('PostCompact carries the trigger and the summary', async () => {
    const rt = make({ PostCompact: [{ matcher: 'auto', handlers: [capture('pc.json')] }] })
    await rt.runPostCompact('auto', 'card one\n\ncard two')
    expect(input('pc.json')).toMatchObject({
      hook_event_name: 'PostCompact',
      trigger: 'auto',
      compact_summary: 'card one\n\ncard two',
    })
  })

  it('InstructionsLoaded matches its load reason', async () => {
    const rt = make({
      InstructionsLoaded: [{ matcher: 'compact', handlers: [capture('il.json')] }],
    })
    await rt.runInstructionsLoaded({
      path: '/p/AGENTS.md',
      memoryType: 'Project',
      loadReason: 'session_start',
    })
    expect(() => input('il.json')).toThrow()
    await rt.runInstructionsLoaded({
      path: '/p/AGENTS.md',
      memoryType: 'Project',
      loadReason: 'compact',
    })
    expect(input('il.json')).toMatchObject({
      file_path: '/p/AGENTS.md',
      memory_type: 'Project',
      load_reason: 'compact',
    })
  })
})

describe('ConfigChange / CwdChanged / FileChanged', () => {
  it('ConfigChange blocks, except a managed policy change', async () => {
    const rt = make({ ConfigChange: [{ handlers: [capture('cc.json', 'exit 2')] }] })
    expect(await rt.runConfigChange('project_settings', '/p/x')).toEqual({ blocked: true })
    expect(input('cc.json')).toMatchObject({ source: 'project_settings', file_path: '/p/x' })
    expect(await rt.runConfigChange('policy_settings')).toEqual({ blocked: false })
  })

  it('CwdChanged reports both directories and returns watchPaths', async () => {
    const out = { hookSpecificOutput: { watchPaths: ['/w/.envrc'] } }
    const rt = make({ CwdChanged: [{ handlers: [capture('cwd.json', json(out))] }] })
    expect(await rt.runCwdChanged('/a', '/b')).toEqual({ watchPaths: ['/w/.envrc'] })
    expect(input('cwd.json')).toMatchObject({ old_cwd: '/a', new_cwd: '/b' })
  })

  it('FileChanged matches the basename; its matcher names the watched files', async () => {
    const rt = make({
      FileChanged: [
        { matcher: '.envrc|.env', handlers: [capture('fc.json', json({ watchPaths: [] }))] },
      ],
    })
    expect(await rt.runFileChanged('/p/.envrc', 'change')).toEqual({ watchPaths: [] })
    expect(input('fc.json')).toMatchObject({ file_path: '/p/.envrc', event: 'change' })
    expect(rt.fileChangedWatchNames()).toEqual(['.envrc', '.env'])
    expect(fileChangedWatchNames(undefined)).toEqual([])
  })
})

describe('PreModelSwitch / PostModelSwitch', () => {
  it('matches the canonical name of the target and reports the switch', async () => {
    const rt = make({
      PreModelSwitch: [{ matcher: 'claude-opus-5', handlers: [capture('pm.json')] }],
    })
    expect(await rt.runPreModelSwitch(opus)).toEqual({ decision: 'proceed' })
    expect(input('pm.json')).toMatchObject({
      hook_event_name: 'PreModelSwitch',
      from_model: 'claude-sonnet-5',
      to_model: 'anthropic/claude-opus-5-20260101',
      requested_model: 'opus',
      source: 'command',
    })
    expect(modelMatchNames('claude-opus-4-6[1m]')).toContain('claude-opus-4-6')
  })

  it('deny > ask > allow, and a timed-out hook blocks the switch', async () => {
    const decide = (d: string) =>
      cmd(
        `cat >/dev/null; ${json({ hookSpecificOutput: { permissionDecision: d, permissionDecisionReason: d } })}`,
      )
    expect(
      await make({
        PreModelSwitch: [{ handlers: [decide('allow'), decide('ask')] }],
      }).runPreModelSwitch(opus),
    ).toEqual({ decision: 'ask', reason: 'ask' })
    expect(
      await make({
        PreModelSwitch: [{ handlers: [decide('ask'), decide('deny')] }],
      }).runPreModelSwitch(opus),
    ).toEqual({ decision: 'deny', reason: 'deny' })
    const slow = make({ PreModelSwitch: [{ handlers: [cmd('sleep 5', 100)] }] })
    expect((await slow.runPreModelSwitch(opus)).decision).toBe('deny')
  })

  it('PostModelSwitch adds plain stdout as context', async () => {
    const rt = make({
      PostModelSwitch: [
        { matcher: '.*opus.*', handlers: [cmd('cat >/dev/null; echo "plan on opus"')] },
      ],
    })
    expect(await rt.runPostModelSwitch(opus)).toEqual({ additionalContext: 'plan on opus' })
  })
})

describe('the added events in a hooks file', () => {
  const parse = (hooks: Record<string, unknown>) => {
    const skipped: { event: string; type: string }[] = []
    const registry = parseHooksBlock({ hooks }, 'plugin', { projectDir: '/p' }, skipped as never)
    return { registry, skipped }
  }
  const groups = (type: string, extra: Record<string, unknown> = {}) => [
    { hooks: [{ type, prompt: 'p', url: 'http://h', command: 'c', ...extra }] },
  ]

  it('accepts each handler type only where Claude Code does', () => {
    const { registry, skipped } = parse({
      TaskCreated: groups('prompt'),
      PermissionRequest: [...groups('prompt'), ...groups('agent')],
      PreModelSwitch: groups('prompt'),
      InstructionsLoaded: groups('http'),
    })
    expect(registry.TaskCreated?.[0]?.handlers[0]?.kind).toBe('prompt')
    expect(registry.PermissionRequest?.flatMap((g) => g.handlers.map((h) => h.kind))).toEqual([
      'prompt',
    ])
    expect(registry.InstructionsLoaded?.[0]?.handlers[0]?.kind).toBe('http')
    expect(skipped.map((s) => `${s.event}:${s.type}`).sort()).toEqual([
      'PermissionRequest:agent',
      'PreModelSwitch:prompt',
    ])
  })

  it('lowers the default timeout where CC does', () => {
    const { registry } = parse({ PreModelSwitch: groups('command'), CwdChanged: groups('command') })
    expect(registry.PreModelSwitch?.[0]?.handlers[0]?.timeoutMs).toBe(30_000)
    expect(registry.CwdChanged?.[0]?.handlers[0]?.timeoutMs).toBe(600_000)
  })

  it('an event with no Localix lifecycle point is accepted, never fired, and says why', () => {
    for (const event of Object.keys(CC_INERT_HOOK_EVENTS)) {
      expect(isCcHookEvent(event)).toBe(false)
      expect(parse({ [event]: groups('command') }).registry).toEqual({})
    }
  })
})

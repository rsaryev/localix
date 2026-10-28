/**
 * The added events whose handlers decide something: each fires with Claude Code's input fields,
 * honours its matcher, and folds its handlers by the CC reference's decision control.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { createCcHooksRuntime } from './run'
import type { CcHookHandler, CcHookRegistry } from './contracts'

const dir = tempDirPerTest('cc-gate-')
const silent = { warn: () => {}, info: () => {} }
const cmd = (command: string): CcHookHandler => ({ source: 'plugin', command, timeoutMs: 5000 })
/** A hook that saves its stdin, then runs `then` (an exit, or JSON on stdout). */
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

describe('UserPromptExpansion', () => {
  it('matches the command name and reports the typed command', async () => {
    const rt = make({
      UserPromptExpansion: [
        { matcher: 'deploy', handlers: [capture('deploy.json', 'echo "deploy checklist"')] },
        { matcher: 'other', handlers: [cmd('cat >/dev/null; exit 2')] },
      ],
    })
    const result = await rt.runUserPromptExpansion({
      commandName: 'deploy',
      commandArgs: 'staging',
      commandSource: 'plugin',
      prompt: '/deploy staging',
    })
    // Plain stdout is context on this event, as on UserPromptSubmit.
    expect(result).toEqual({ blocked: false, additionalContext: 'deploy checklist' })
    expect(input('deploy.json')).toMatchObject({
      hook_event_name: 'UserPromptExpansion',
      expansion_type: 'slash_command',
      command_name: 'deploy',
      command_args: 'staging',
      command_source: 'plugin',
      prompt: '/deploy staging',
    })
  })

  it('exit 2 blocks the expansion with stderr as the reason', async () => {
    const rt = make({
      UserPromptExpansion: [{ handlers: [cmd('cat >/dev/null; echo no >&2; exit 2')] }],
    })
    const result = await rt.runUserPromptExpansion({
      commandName: 'x',
      commandArgs: '',
      commandSource: 'Skill',
      prompt: '/x',
    })
    expect(result).toEqual({ blocked: true, reason: 'no' })
  })
})

describe('PermissionRequest', () => {
  it('reads the decision object; a deny from any handler wins over an allow', async () => {
    const allow = {
      hookSpecificOutput: { decision: { behavior: 'allow', updatedInput: { a: 1 } } },
    }
    const deny = {
      hookSpecificOutput: { decision: { behavior: 'deny', message: 'no', interrupt: true } },
    }
    const rt = make({
      PermissionRequest: [
        { matcher: 'Bash', handlers: [capture('pr.json', json(allow))] },
        { matcher: 'Bash', handlers: [cmd(`cat >/dev/null; ${json(deny)}`)] },
      ],
    })
    expect(await rt.runPermissionRequest('Bash', { command: 'ls' })).toEqual({
      behavior: 'deny',
      message: 'no',
      interrupt: true,
    })
    expect(input('pr.json')).toMatchObject({
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    })
    expect(input('pr.json').tool_use_id).toBeUndefined()
  })

  it('an allow carries its rewrite; exit 2 decides nothing', async () => {
    const allow = {
      hookSpecificOutput: { decision: { behavior: 'allow', updatedInput: { a: 1 } } },
    }
    const rt = make({
      PermissionRequest: [
        { handlers: [cmd('cat >/dev/null; exit 2'), cmd(`cat >/dev/null; ${json(allow)}`)] },
      ],
    })
    expect(await rt.runPermissionRequest('Edit', {})).toEqual({
      behavior: 'allow',
      updatedInput: { a: 1 },
    })
    const exitOnly = make({ PermissionRequest: [{ handlers: [cmd('cat >/dev/null; exit 2')] }] })
    expect(await exitOnly.runPermissionRequest('Edit', {})).toEqual({})
  })

  it('hands an allowed rewrite to the call exactly once', () => {
    const rt = make({ PermissionRequest: [{ handlers: [cmd('true')] }] })
    rt.approveWithInput('tc1', { path: 'a' })
    expect(rt.takeApprovedInput('tc1')).toEqual({ input: { path: 'a' } })
    expect(rt.takeApprovedInput('tc1')).toBeUndefined()
  })
})

describe('PermissionDenied', () => {
  it('reports the refusal and reads `retry`', async () => {
    const retry = { hookSpecificOutput: { hookEventName: 'PermissionDenied', retry: true } }
    const rt = make({
      PermissionDenied: [{ matcher: 'Bash', handlers: [capture('pd.json', json(retry))] }],
    })
    expect(await rt.runPermissionDenied('Bash', { command: 'rm x' }, 'tc9', 'Plan mode')).toEqual({
      retry: true,
    })
    expect(input('pd.json')).toMatchObject({
      tool_name: 'Bash',
      tool_use_id: 'tc9',
      reason: 'Plan mode',
    })
    expect(await rt.runPermissionDenied('Edit', {}, 'tc1', 'x')).toEqual({ retry: false })
  })
})

describe('PostToolBatch', () => {
  it('passes every call and joins the context; a block stops with its reason', async () => {
    const context = { hookSpecificOutput: { additionalContext: 'run pytest' } }
    const rt = make({
      PostToolBatch: [{ matcher: 'ignored', handlers: [capture('pb.json', json(context))] }],
    })
    const calls = [
      {
        tool_name: 'Read',
        tool_input: { path: 'a', file_path: 'a' },
        tool_use_id: 't1',
        tool_response: '1 a',
      },
    ]
    expect(await rt.runPostToolBatch(calls)).toEqual({
      stop: false,
      additionalContext: 'run pytest',
    })
    const absolute = { ...calls[0], tool_input: { path: 'a', file_path: join(dir(), 'a') } }
    expect(input('pb.json')).toMatchObject({
      hook_event_name: 'PostToolBatch',
      tool_calls: [absolute],
    })

    const blocking = make({
      PostToolBatch: [
        { handlers: [cmd(`cat >/dev/null; ${json({ decision: 'block', reason: 'lint' })}`)] },
      ],
    })
    expect(await blocking.runPostToolBatch(calls)).toEqual({ stop: true, reason: 'lint' })
  })
})

describe('TaskCreated / TaskCompleted', () => {
  const task = { id: 'LX-1', subject: 'Ship', description: 'all of it' }

  it('TaskCreated: the card fields, and exit 2 or decision:block refuses', async () => {
    const rt = make({ TaskCreated: [{ handlers: [capture('tc.json', 'echo bad >&2; exit 2')] }] })
    expect(await rt.runTaskCreated(task)).toEqual({ blocked: true, reason: 'bad' })
    expect(input('tc.json')).toMatchObject({
      hook_event_name: 'TaskCreated',
      task_id: 'LX-1',
      task_subject: 'Ship',
      task_description: 'all of it',
      team_name: 'session-s1',
    })
    const byJson = make({
      TaskCreated: [
        { handlers: [cmd(`cat >/dev/null; ${json({ decision: 'block', reason: 'r' })}`)] },
      ],
    })
    expect(await byJson.runTaskCreated(task)).toEqual({ blocked: true, reason: 'r' })
  })

  it('TaskCompleted: exit 2 blocks; continue:false is ignored on the tool path', async () => {
    const blocking = make({
      TaskCompleted: [{ handlers: [cmd('cat >/dev/null; echo tests >&2; exit 2')] }],
    })
    expect(await blocking.runTaskCompleted(task)).toEqual({ blocked: true, reason: 'tests' })
    const stopping = make({
      TaskCompleted: [{ handlers: [cmd(`cat >/dev/null; ${json({ continue: false })}`)] }],
    })
    expect(await stopping.runTaskCompleted(task)).toEqual({ blocked: false })
  })
})

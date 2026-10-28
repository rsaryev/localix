/**
 * What a hook reads, against hooks.md: the common input fields (`permission_mode` on the events
 * whose examples carry it, the subagent's `agent_id` / `agent_type`), the Stop and SubagentStop
 * fields, PostToolUse's `tool_use_id` and Bash response, absolute file paths, the environment
 * (`CLAUDE_CODE_SESSION_ID`, `CLAUDE_ENV_FILE`), and a JSON answer under any exit code.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import type { CcHookHandler, CcHookRegistry } from './contracts'
import { createCcHooksRuntime, type CreateCcHooksRuntimeOptions } from './run'
import { ccSessionEnvFiles } from './session-env'

const dir = tempDirPerTest('cc-hook-inputs-')
const silent = { warn: () => {}, info: () => {} }

/** A hook that saves its stdin as `<label>.json` and its environment as `<label>.env`. */
const spy = (label: string, after = ''): CcHookHandler => ({
  source: 'user',
  command: `cat > "${dir()}/${label}.json"; env > "${dir()}/${label}.env"; ${after}`,
  timeoutMs: 5000,
})
const seen = (label: string) => JSON.parse(readFileSync(join(dir(), `${label}.json`), 'utf8'))
const envOf = (label: string) =>
  Object.fromEntries(
    readFileSync(join(dir(), `${label}.env`), 'utf8')
      .split('\n')
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  ) as Record<string, string>

function runtime(
  groups: CcHookRegistry,
  extra: Partial<CreateCcHooksRuntimeOptions> = {},
): ReturnType<typeof createCcHooksRuntime> {
  return createCcHooksRuntime({
    registry: groups,
    sessionId: 'sess-1',
    projectDir: dir(),
    enabled: true,
    logger: silent,
    ...extra,
  })
}

describe('hook inputs', () => {
  it('carries permission_mode on PreToolUse but not on SessionStart', async () => {
    const rt = runtime(
      {
        PreToolUse: [{ handlers: [spy('pre')] }],
        SessionStart: [{ handlers: [spy('start')] }],
      },
      { permissionMode: 'bypassPermissions' },
    )
    await rt.runPreToolUse('Bash', { command: 'ls' }, 'call-1')
    await rt.runSessionStart()
    expect(seen('pre').permission_mode).toBe('bypassPermissions')
    expect('permission_mode' in seen('start')).toBe(false)
  })

  it('names the subagent a tool hook fires in', async () => {
    const rt = runtime(
      { PreToolUse: [{ handlers: [spy('pre')] }] },
      { agent: { id: 'child-1', type: 'plug:helper' } },
    )
    await rt.runPreToolUse('Bash', { command: 'ls' }, 'call-1')
    expect(seen('pre')).toMatchObject({ agent_id: 'child-1', agent_type: 'plug:helper' })
  })

  it('gives Stop stop_hook_active false, the last answer and empty task lists', async () => {
    const rt = runtime({ Stop: [{ handlers: [spy('stop')] }] })
    await rt.runStop({ lastAssistantMessage: 'Final answer.' })
    expect(seen('stop')).toMatchObject({
      stop_hook_active: false,
      last_assistant_message: 'Final answer.',
      background_tasks: [],
      session_crons: [],
    })
  })

  it('gives SubagentStop stop_hook_active false and an agent_transcript_path field', async () => {
    const rt = runtime({ SubagentStop: [{ handlers: [spy('sub')] }] })
    await rt.runSubagentStop('helper', 'child-1', 'Done.')
    const input = seen('sub')
    expect(input.stop_hook_active).toBe(false)
    expect('agent_transcript_path' in input).toBe(true)
  })

  it('gives PostToolUse the call id and Bash output as stdout', async () => {
    const rt = runtime({ PostToolUse: [{ handlers: [spy('post')] }] })
    const details = { command: 'printf hi', cwd: dir(), output: 'hi', isStreaming: false }
    await rt.runPostToolUse('Bash', { command: 'printf hi' }, { content: 'hi\n', details }, 'c-9')
    expect(seen('post')).toMatchObject({
      tool_use_id: 'c-9',
      tool_response: { stdout: 'hi', stderr: '', interrupted: false, isImage: false },
    })
  })

  it('makes a file tool path absolute against the hook cwd', async () => {
    const rt = runtime({ PreToolUse: [{ handlers: [spy('pre')] }] })
    await rt.runPreToolUse('Write', { files: [{ path: 'notes/a.md', content: 'x' }] }, 'w-1')
    expect(seen('pre').tool_input.file_path).toBe(join(dir(), 'notes/a.md'))
  })

  it('fires a capitalised regex matcher on the engine tool', async () => {
    const rt = runtime({ PreToolUse: [{ matcher: '^Bash$', handlers: [spy('pre')] }] })
    await rt.runPreToolUse('Bash', { command: 'ls' }, 'call-1')
    expect(seen('pre').tool_name).toBe('Bash')
  })
})

describe('hook environment', () => {
  it('sets CLAUDE_CODE_SESSION_ID to the input session_id', async () => {
    const rt = runtime({ Stop: [{ handlers: [spy('stop')] }] })
    await rt.runStop()
    expect(envOf('stop').CLAUDE_CODE_SESSION_ID).toBe('sess-1')
  })

  it('gives SessionStart a CLAUDE_ENV_FILE and other events none', async () => {
    const envFiles = ccSessionEnvFiles(join(dir(), 'env'))
    const write = `echo 'export X=1' >> "$CLAUDE_ENV_FILE"`
    const rt = runtime(
      {
        SessionStart: [{ handlers: [spy('start', write)] }],
        Stop: [{ handlers: [spy('stop')] }],
      },
      { envFiles },
    )
    await rt.runSessionStart()
    await rt.runStop()
    expect(envOf('start').CLAUDE_ENV_FILE).toBe(envFiles.sessionStart)
    expect(readFileSync(envFiles.sessionStart, 'utf8')).toBe('export X=1\n')
    expect(envOf('stop').CLAUDE_ENV_FILE).toBeUndefined()
  })

  it('clears what CwdChanged and FileChanged wrote on the next CwdChanged', async () => {
    const envFiles = ccSessionEnvFiles(join(dir(), 'env'))
    const rt = runtime({ CwdChanged: [{ handlers: [spy('cwd')] }] }, { envFiles })
    await rt.runCwdChanged('/a', '/b')
    writeFileSync(envFiles.cwd, 'export OLD=1\n')
    await rt.runCwdChanged('/b', '/c')
    expect(envOf('cwd').CLAUDE_ENV_FILE).toBe(envFiles.cwd)
    expect(readFileSync(envFiles.cwd, 'utf8')).toBe('')
  })
})

describe('exit codes', () => {
  it('lets a JSON answer decide under an exit code other than 0 or 2', async () => {
    const deny = JSON.stringify({
      hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'no' },
    })
    const rt = runtime({ PreToolUse: [{ handlers: [spy('pre', `echo '${deny}'; exit 1`)] }] })
    const result = await rt.runPreToolUse('Bash', { command: 'ls' }, 'call-1')
    expect(result).toMatchObject({ decision: 'deny', reason: 'no' })
  })
})

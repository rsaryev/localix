/**
 * How the runtime folds the tool and session hooks' decisions (hooks.md): PreToolUse precedence,
 * `continue:false`, `additionalContext`, PostToolUse output replacement in the tool's own shape,
 * and `sessionTitle`. Each handler is an `mcp_tool` hook answered in-process.
 */
import { describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'

import type { CcHookEvent, CcHookHandler } from './contracts'
import { foldHookOutput } from './output-parse'
import { createCcHooksRuntime } from './run'

const silent = { warn: () => {}, info: () => {} }

/** One runtime whose `event` handlers answer, in order, with the JSON of each `answers` entry. */
function answering(event: CcHookEvent, answers: Record<string, unknown>) {
  const notices: string[] = []
  const handlers: CcHookHandler[] = Object.keys(answers).map((name) => ({
    source: 'user',
    command: '',
    kind: 'mcp_tool',
    mcpTool: `mcp__hooks__${name}`,
    timeoutMs: 5000,
  }))
  const rt = createCcHooksRuntime({
    registry: { [event]: [{ handlers }] },
    sessionId: 's1',
    projectDir: tmpdir(),
    enabled: true,
    logger: silent,
    callMcpTool: async (name) => ({ text: JSON.stringify(answers[name.split('__').pop()!]) }),
    emitNotice: (message) => notices.push(message),
  })
  return { rt, notices }
}

const pre = (fields: Record<string, unknown>) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', ...fields },
})
const post = (fields: Record<string, unknown>) => ({
  hookSpecificOutput: { hookEventName: 'PostToolUse', ...fields },
})

describe('PreToolUse decisions', () => {
  it('ask beats allow, whichever hook answers first ("deny > defer > ask > allow")', async () => {
    const allow = pre({ permissionDecision: 'allow', permissionDecisionReason: 'fine' })
    const ask = pre({ permissionDecision: 'ask', permissionDecisionReason: 'check this' })
    for (const answers of [
      { a: allow, b: ask },
      { b: ask, a: allow },
    ]) {
      const { rt } = answering('PreToolUse', answers)
      const result = await rt.runPreToolUse('bash', { command: 'ls' })
      expect(result).toMatchObject({ decision: 'ask', reason: 'check this' })
    }
  })

  it('an allow alone is reported as allow', async () => {
    const { rt } = answering('PreToolUse', { a: pre({ permissionDecision: 'allow' }) })
    expect((await rt.runPreToolUse('bash', { command: 'ls' })).decision).toBe('allow')
  })

  it('collects every handler’s additionalContext for the model', async () => {
    const { rt } = answering('PreToolUse', {
      a: pre({ additionalContext: 'env: prod' }),
      b: pre({ permissionDecision: 'allow', additionalContext: 'be careful' }),
    })
    const result = await rt.runPreToolUse('bash', { command: 'ls' })
    expect(result.additionalContext).toBe('env: prod\n\nbe careful')
  })

  it('continue:false refuses the call, asks for the run to stop and shows the stopReason', async () => {
    const { rt, notices } = answering('PreToolUse', {
      a: { continue: false, stopReason: 'Build failed', ...pre({ permissionDecision: 'allow' }) },
    })
    const result = await rt.runPreToolUse('bash', { command: 'ls' })
    expect(result.decision).toBe('deny')
    expect(result.stop).toEqual({ reason: 'Build failed' })
    expect(notices).toEqual(['Build failed'])
    // The run remembers who ended it, so no Stop hook or continuation restarts the agent.
    expect(rt.stoppedBy()).toEqual({ event: 'PreToolUse', reason: 'Build failed' })
  })

  it('a plain deny does not stop the run', async () => {
    const { rt, notices } = answering('PreToolUse', {
      a: pre({ permissionDecision: 'deny', permissionDecisionReason: 'no' }),
    })
    const result = await rt.runPreToolUse('bash', { command: 'ls' })
    expect(result).toMatchObject({ decision: 'deny', reason: 'no' })
    expect(result.stop).toBeUndefined()
    expect(notices).toEqual([])
    expect(rt.stoppedBy()).toBeUndefined()
  })
})

describe('PostToolBatch stop', () => {
  const call = {
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
    tool_use_id: 't1',
    tool_response: 'a.txt',
  }

  it('a block ends the run and is remembered as its stop', async () => {
    const { rt } = answering('PostToolBatch', { a: { decision: 'block', reason: 'lint failed' } })
    expect(await rt.runPostToolBatch([call])).toMatchObject({ stop: true, reason: 'lint failed' })
    expect(rt.stoppedBy()).toEqual({ event: 'PostToolBatch', reason: 'lint failed' })
  })

  it('context alone does not stop the run', async () => {
    const { rt } = answering('PostToolBatch', {
      a: { hookSpecificOutput: { hookEventName: 'PostToolBatch', additionalContext: 'ok' } },
    })
    expect((await rt.runPostToolBatch([call])).stop).toBe(false)
    expect(rt.stoppedBy()).toBeUndefined()
  })
})

describe('PostToolUse output replacement', () => {
  const output = { content: 'secret', details: { exitCode: 0 } }

  it('Bash: an object in Bash’s shape replaces the output with its stdout and stderr', async () => {
    const shape = { stdout: '[redacted]', stderr: 'warn', interrupted: false, isImage: false }
    const { rt } = answering('PostToolUse', { a: post({ updatedToolOutput: shape }) })
    const result = await rt.runPostToolUse('bash', { command: 'cat .env' }, output)
    expect(result.updatedToolOutput).toBe('[redacted]\nwarn')
  })

  it('a built-in whose shape the value does not match keeps its own output', async () => {
    const { rt } = answering('PostToolUse', { a: post({ updatedToolOutput: { stdout: 'x' } }) })
    const result = await rt.runPostToolUse('read', { path: 'a' }, output)
    expect(result.updatedToolOutput).toBeUndefined()
  })

  it('MCP: updatedMCPToolOutput replaces an MCP tool’s output, unvalidated', async () => {
    const { rt } = answering('PostToolUse', {
      a: post({ updatedMCPToolOutput: [{ type: 'text', text: 'REDACTED' }] }),
    })
    const result = await rt.runPostToolUse('mcp_echo_echo', { text: 'secret' }, output)
    expect(result.updatedToolOutput).toBe('REDACTED')
  })

  it('updatedMCPToolOutput is ignored for a tool that is not an MCP tool', async () => {
    const { rt } = answering('PostToolUse', { a: post({ updatedMCPToolOutput: 'REDACTED' }) })
    const result = await rt.runPostToolUse('bash', { command: 'ls' }, output)
    expect(result.updatedToolOutput).toBeUndefined()
  })
})

describe('sessionTitle', () => {
  it('is read from hookSpecificOutput', () => {
    const text = JSON.stringify({ hookSpecificOutput: { sessionTitle: '  auth-refactor ' } })
    expect(foldHookOutput(text, true).sessionTitle).toBe('auth-refactor')
  })

  it('SessionStart names the session on startup, not after a clear or a compaction', async () => {
    const { rt } = answering('SessionStart', {
      a: { hookSpecificOutput: { hookEventName: 'SessionStart', sessionTitle: 'CCS-T' } },
    })
    expect((await rt.runSessionStart('startup')).sessionTitle).toBe('CCS-T')
    expect((await rt.runSessionStart('clear')).sessionTitle).toBeUndefined()
  })

  it('UserPromptSubmit names the session from the prompt', async () => {
    const { rt } = answering('UserPromptSubmit', {
      a: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', sessionTitle: 'Deploy' } },
    })
    expect(await rt.runUserPromptSubmit('deploy it')).toMatchObject({
      blocked: false,
      sessionTitle: 'Deploy',
    })
  })
})

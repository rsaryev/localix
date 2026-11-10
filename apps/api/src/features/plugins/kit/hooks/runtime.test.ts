/**
 * The run's hooks on the kit session: a settings hook's answer, as the chat runtime applies it.
 * The kit selects, runs and merges (its own tests); these hold the Localix side of each answer.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HooksSettings } from '@rsaryev/llx-plugin'
import { tempDirPerTest } from '@localixai/testing'
import { hookTestSession } from '../testing'
import { createKitHooksRuntime } from './runtime'

const dir = tempDirPerTest('kit-hooks-runtime-')
const log = () => join(dir(), 'calls.jsonl')

const on = (event: string, command: string, matcher?: string): HooksSettings =>
  ({
    [event]: [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] }],
  }) as HooksSettings

const answer = (json: object) => `echo '${JSON.stringify(json)}'`
/** Append each call's stdin to the log, then run `then`. */
const logging = (then = 'exit 0') => `cat >> "${log()}"; echo >> "${log()}"; ${then}`
const calls = () =>
  readFileSync(log(), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))

function runtime(hooks: HooksSettings, notices: string[] = []) {
  const session = hookTestSession(dir(), dir(), hooks)
  return createKitHooksRuntime(session, {
    cwd: dir(),
    emitNotice: (message) => void notices.push(message),
  })
}

const twoEdits = {
  edits: [
    { path: '/p/a.ts', old_string: 'a', new_string: 'b' },
    { path: '/p/.env', old_string: 'x', new_string: 'y' },
  ],
}

const pre = (permissionDecision: string, more: object = {}) =>
  answer({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, ...more },
  })

describe('PreToolUse', () => {
  it('no hook listens: the call proceeds and nothing runs', async () => {
    const rt = runtime({})
    expect(rt.hasHooks('PreToolUse')).toBe(false)
    expect(await rt.runPreToolUse('Bash', { command: 'ls' })).toEqual({
      decision: 'proceed',
      didRewrite: false,
    })
  })

  it("a deny refuses the call with the hook's reason", async () => {
    const rt = runtime(on('PreToolUse', pre('deny', { permissionDecisionReason: 'no rm' }), 'Bash'))
    expect(await rt.runPreToolUse('Bash', { command: 'rm -rf /' }, 'tc1')).toMatchObject({
      decision: 'deny',
      reason: 'no rm',
    })
  })

  it('exit 2 refuses the call with its stderr', async () => {
    const rt = runtime(on('PreToolUse', 'echo "blocked by policy" >&2; exit 2'))
    expect(await rt.runPreToolUse('Bash', { command: 'ls' })).toMatchObject({
      decision: 'deny',
      reason: expect.stringContaining('blocked by policy'),
    })
  })

  it("a rewrite of Claude Code's fields lands on Localix's input", async () => {
    const rt = runtime(on('PreToolUse', pre('allow', { updatedInput: { command: 'ls -la' } })))
    const result = await rt.runPreToolUse('Bash', { command: 'ls' })
    expect(result).toMatchObject({ decision: 'allow', didRewrite: true })
    expect(result.updatedInput).toMatchObject({ command: 'ls -la' })
  })

  it('continue:false denies the call and stops the run', async () => {
    const notices: string[] = []
    const rt = runtime(on('PreToolUse', answer({ continue: false, stopReason: 'halt' })), notices)
    expect(await rt.runPreToolUse('Bash', { command: 'ls' })).toMatchObject({
      decision: 'deny',
      stop: { reason: 'halt' },
    })
    expect(rt.stoppedBy()).toEqual({ event: 'PreToolUse', reason: 'halt' })
    expect(notices).toContain('halt')
  })
})

describe('a call that names several files', () => {
  it('PreToolUse sees one Edit per file, each with its file_path and old_string', async () => {
    await runtime(on('PreToolUse', logging(), 'Edit')).runPreToolUse('Edit', twoEdits)
    expect(
      calls().map((c) => [c.tool_name, c.tool_input.file_path, c.tool_input.old_string]),
    ).toEqual([
      ['Edit', '/p/a.ts', 'a'],
      ['Edit', '/p/.env', 'x'],
    ])
  })

  it('a deny of one file refuses the whole call', async () => {
    const deny = `grep -q '"file_path":"/p/.env"' && ${pre('deny', { permissionDecisionReason: 'no .env' })} || true`
    expect(
      await runtime(on('PreToolUse', deny, 'Edit')).runPreToolUse('Edit', twoEdits),
    ).toMatchObject({ decision: 'deny', reason: 'no .env' })
  })

  it('an allow approves the call only when every file is allowed', async () => {
    const allowOne = `grep -q '"file_path":"/p/a.ts"' && ${pre('allow')} || true`
    expect(
      (await runtime(on('PreToolUse', allowOne, 'Edit')).runPreToolUse('Edit', twoEdits)).decision,
    ).toBe('proceed')
    expect(
      (await runtime(on('PreToolUse', pre('allow'), 'Edit')).runPreToolUse('Edit', twoEdits))
        .decision,
    ).toBe('allow')
  })
  it("a rewrite of one file's input lands on that file's entry", async () => {
    const rewrite = `grep -q '"file_path":"/p/a.ts"' && ${pre('allow', {
      updatedInput: { file_path: '/p/a.ts', old_string: 'a', new_string: 'B' },
    })} || true`
    const result = await runtime(on('PreToolUse', rewrite, 'Edit')).runPreToolUse('Edit', twoEdits)
    expect(result.didRewrite).toBe(true)
    expect(result.updatedInput).toMatchObject({
      edits: [
        { path: '/p/a.ts', old_string: 'a', new_string: 'B' },
        { path: '/p/.env', old_string: 'x', new_string: 'y' },
      ],
    })
  })

  it('PostToolUse sees one Write per file', async () => {
    const input = {
      files: [
        { path: '/p/a.md', content: 'A' },
        { path: '/p/b.md', content: 'B' },
      ],
    }
    await runtime(on('PostToolUse', logging())).runPostToolUse('Write', input, { content: 'saved' })
    expect(calls().map((c) => [c.tool_name, c.tool_input.file_path])).toEqual([
      ['Write', '/p/a.md'],
      ['Write', '/p/b.md'],
    ])
  })

  it('a batched read is one Read per file', async () => {
    const input = { reads: [{ path: '/p/a.md' }, { path: '/p/b.md' }] }
    await runtime(on('PreToolUse', logging())).runPreToolUse('Read', input)
    expect(calls().map((c) => c.tool_input.file_path)).toEqual(['/p/a.md', '/p/b.md'])
  })
})

describe('a plugin MCP tool', () => {
  // A plugin `lin-mcp` with an `echo` server: Localix's engine name and Claude Code's.
  const tool = {
    name: 'mcp_lin_mcp_echo_echo',
    aliases: ['mcp__plugin_lin-mcp_echo__echo'],
    mcpServer: { name: 'plugin:lin-mcp:echo', source: 'plugin' },
  }

  it("reaches a hook under Claude Code's tool_name, with its mcp_server", async () => {
    await runtime(on('PreToolUse', logging(), 'mcp__plugin_lin-mcp_echo__.*')).runPreToolUse(
      tool,
      { text: 'ping' },
      'call-1',
    )
    expect(calls()).toEqual([
      expect.objectContaining({
        tool_name: 'mcp__plugin_lin-mcp_echo__echo',
        tool_input: { text: 'ping' },
        mcp_server: { name: 'plugin:lin-mcp:echo', source: 'plugin' },
      }),
    ])
  })

  it('a tool that is not an MCP tool sends no mcp_server', async () => {
    await runtime(on('PreToolUse', logging(), 'custom_tool')).runPreToolUse('custom_tool', {})
    expect(calls()[0]).not.toHaveProperty('mcp_server')
  })
})

describe('PostToolUse', () => {
  it("gives Claude the hook's context and its stderr on exit 2", async () => {
    const rt = runtime(on('PostToolUse', 'echo "lint failed" >&2; exit 2'))
    const post = await rt.runPostToolUse('Bash', { command: 'ls' }, { content: 'ok' }, 'tc1', 3)
    expect(post.additionalContext).toContain('lint failed')
  })

  // The kit takes a built-in tool's replacement only in that tool's output shape.
  it("replaces the tool's output with updatedToolOutput in the tool's shape", async () => {
    const rt = runtime(
      on(
        'PostToolUse',
        answer({
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            updatedToolOutput: { stdout: 'redacted', stderr: '', interrupted: false },
          },
        }),
      ),
    )
    const post = await rt.runPostToolUse('Bash', { command: 'cat .env' }, { content: 'SECRET=1' })
    expect(post.updatedToolOutput).toBe('redacted')
  })
})

describe('Stop', () => {
  it('a block keeps the turn going with its reason', async () => {
    const rt = runtime(on('Stop', answer({ decision: 'block', reason: 'tests are red' })))
    expect(await rt.runStop({ lastAssistantMessage: 'done' })).toMatchObject({
      blocked: true,
      reason: 'tests are red',
    })
  })

  it('no answer lets the turn end', async () => {
    const rt = runtime(on('Stop', 'exit 0'))
    expect((await rt.runStop({ lastAssistantMessage: 'done' })).blocked).toBe(false)
  })
})

describe('UserPromptSubmit', () => {
  it('a block refuses the prompt with its reason', async () => {
    const rt = runtime(on('UserPromptSubmit', answer({ decision: 'block', reason: 'no secrets' })))
    expect(await rt.runUserPromptSubmit('my password is hunter2')).toMatchObject({
      blocked: true,
      reason: 'no secrets',
    })
  })

  it("plain stdout is Claude's context", async () => {
    const rt = runtime(on('UserPromptSubmit', 'echo "branch: main"'))
    expect((await rt.runUserPromptSubmit('hi')).additionalContext).toContain('branch: main')
  })
})

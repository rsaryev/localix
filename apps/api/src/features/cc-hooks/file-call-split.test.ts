/**
 * A Localix edit, write or read may name several files in one call; Claude Code's `Edit`, `Write`
 * and `Read` name one (hooks.md: "`tool_input.file_path` is always absolute"). A hook therefore
 * runs once per file, as if each were its own Claude Code call, and a deny of any file refuses the
 * call.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { createCcHooksRuntime } from './run'
import type { CcHookEvent, CcHookHandler } from './contracts'

const dir = tempDirPerTest('cc-file-split-')
const silent = { warn: () => {}, info: () => {} }
const log = () => join(dir(), 'calls.jsonl')
const cmd = (command: string): CcHookHandler => ({ source: 'plugin', command, timeoutMs: 5000 })
/** Append each call's stdin to the log, then run `then`. */
const logging = (then = 'exit 0') => cmd(`cat >> "${log()}"; echo >> "${log()}"; ${then}`)
const calls = () =>
  readFileSync(log(), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))

const make = (event: CcHookEvent, handler: CcHookHandler) =>
  createCcHooksRuntime({
    registry: { [event]: [{ matcher: 'Edit|Write|Read', handlers: [handler] }] },
    sessionId: 's1',
    projectDir: dir(),
    enabled: true,
    logger: silent,
  })

const twoEdits = {
  edits: [
    { path: '/p/a.ts', old_string: 'a', new_string: 'b' },
    { path: '/p/.env', old_string: 'x', new_string: 'y' },
  ],
}

describe('a call that names several files', () => {
  it('PreToolUse sees one Edit per file, each with its file_path and old_string', async () => {
    await make('PreToolUse', logging()).runPreToolUse('edit', twoEdits)
    expect(
      calls().map((c) => [c.tool_name, c.tool_input.file_path, c.tool_input.old_string]),
    ).toEqual([
      ['Edit', '/p/a.ts', 'a'],
      ['Edit', '/p/.env', 'x'],
    ])
  })

  it('a deny of one file refuses the whole call', async () => {
    const deny = cmd(
      `grep -q '"file_path":"/p/.env"' && echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"no .env"}}' || true`,
    )
    const result = await make('PreToolUse', deny).runPreToolUse('edit', twoEdits)
    expect(result).toMatchObject({ decision: 'deny', reason: 'no .env' })
  })

  it("a rewrite of one file's input lands on that file's entry", async () => {
    const rewrite = cmd(
      `grep -q '"file_path":"/p/a.ts"' && echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"file_path":"/p/a.ts","old_string":"a","new_string":"B"}}}' || true`,
    )
    const result = await make('PreToolUse', rewrite).runPreToolUse('edit', twoEdits)
    expect(result.didRewrite).toBe(true)
    expect(result.updatedInput).toEqual({
      edits: [
        { path: '/p/a.ts', old_string: 'a', new_string: 'B' },
        { path: '/p/.env', old_string: 'x', new_string: 'y' },
      ],
    })
  })

  it('allow approves the call only when every file is allowed', async () => {
    const allowOne = cmd(
      `grep -q '"file_path":"/p/a.ts"' && echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}' || true`,
    )
    const result = await make('PreToolUse', allowOne).runPreToolUse('edit', twoEdits)
    expect(result.decision).toBe('proceed')
  })

  it('PostToolUse sees one Write per file', async () => {
    const input = {
      files: [
        { path: '/p/a.md', content: 'A' },
        { path: '/p/b.md', content: 'B' },
      ],
    }
    await make('PostToolUse', logging()).runPostToolUse('write', input, { content: 'saved' })
    expect(calls().map((c) => [c.tool_name, c.tool_input.file_path])).toEqual([
      ['Write', '/p/a.md'],
      ['Write', '/p/b.md'],
    ])
  })

  it('a batched read is one Read per file', async () => {
    const input = { reads: [{ path: '/p/a.md' }, { path: '/p/b.md' }] }
    await make('PreToolUse', logging()).runPreToolUse('read', input)
    expect(calls().map((c) => c.tool_input.file_path)).toEqual(['/p/a.md', '/p/b.md'])
  })
})

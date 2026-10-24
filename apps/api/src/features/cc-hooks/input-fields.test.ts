/**
 * Common and per-event input fields a hook reads (hooks.md, "Common input fields" and each
 * event's input): `prompt_id`, `effort.level` and `CLAUDE_EFFORT`, SessionStart's `model`,
 * PostToolUse's `duration_ms`, PostToolUseFailure's `tool_use_id`, and SubagentStop's
 * `background_tasks` and `session_crons`.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { createCcHooksRuntime } from './run'
import type { CcHookEvent } from './contracts'
import type { CreateCcHooksRuntimeOptions } from './run'

const dir = tempDirPerTest('cc-input-fields-')
const silent = { warn: () => {}, info: () => {} }
const saved = () => JSON.parse(readFileSync(join(dir(), 'in.json'), 'utf8'))
const env = () => readFileSync(join(dir(), 'env.txt'), 'utf8').trim()

function make(event: CcHookEvent, extra: Partial<CreateCcHooksRuntimeOptions> = {}) {
  const command = `cat > "${join(dir(), 'in.json')}"; printf '%s' "$CLAUDE_EFFORT" > "${join(dir(), 'env.txt')}"`
  return createCcHooksRuntime({
    registry: { [event]: [{ handlers: [{ source: 'plugin', command, timeoutMs: 5000 }] }] },
    sessionId: 's1',
    projectDir: dir(),
    enabled: true,
    logger: silent,
    ...extra,
  })
}

describe('hook input fields', () => {
  it('prompt_id and effort ride every event, and CLAUDE_EFFORT reaches the hook process', async () => {
    await make('PreToolUse', { promptId: 'msg-1', effort: 'high' }).runPreToolUse('bash', {
      command: 'ls',
    })
    expect(saved()).toMatchObject({ prompt_id: 'msg-1', effort: { level: 'high' } })
    expect(env()).toBe('high')
  })

  it('SessionStart carries the model', async () => {
    await make('SessionStart', { model: 'claude-opus-5-5' }).runSessionStart('startup')
    expect(saved().model).toBe('claude-opus-5-5')
  })

  it('PostToolUse carries how long the tool ran', async () => {
    await make('PostToolUse').runPostToolUse(
      'bash',
      { command: 'ls' },
      { content: 'x', durationMs: 42 },
      'call-1',
    )
    expect(saved().duration_ms).toBe(42)
  })

  it('PostToolUseFailure carries the tool_use_id', async () => {
    await make('PostToolUseFailure').runPostToolUseFailure(
      'bash',
      { command: 'false' },
      { error: 'exit 1', isInterrupt: false },
      'call-2',
    )
    expect(saved().tool_use_id).toBe('call-2')
  })

  it('SubagentStop carries background_tasks and session_crons', async () => {
    await make('SubagentStop').runSubagentStop('reviewer', 'a1', 'done')
    expect(saved()).toMatchObject({ background_tasks: [], session_crons: [] })
  })
})

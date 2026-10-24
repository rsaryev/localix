/**
 * What a PostToolUse / PostToolUseFailure hook says back after the tool ran (hooks.md, "Exit code
 * 2 behavior per event" and "JSON output"): `exit 2` shows its stderr to Claude, and
 * `continue:false` stops the run with its `stopReason` shown to the person.
 */
import { describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'

import { createCcHooksRuntime } from './run'
import type { CcHookEvent, CcHookHandler } from './contracts'

const silent = { warn: () => {}, info: () => {} }
const cmd = (command: string): CcHookHandler => ({ source: 'plugin', command, timeoutMs: 5000 })

function make(event: CcHookEvent, command: string) {
  const notices: string[] = []
  const rt = createCcHooksRuntime({
    registry: { [event]: [{ matcher: 'Write|Edit|Bash', handlers: [cmd(command)] }] },
    sessionId: 's1',
    projectDir: tmpdir(),
    enabled: true,
    logger: silent,
    emitNotice: (message) => notices.push(message),
  })
  return { rt, notices }
}

describe('PostToolUse', () => {
  it('exit 2 hands the stderr to the model (a linter reporting what it found)', async () => {
    const { rt } = make('PostToolUse', 'cat >/dev/null; echo "lint: missing semicolon" >&2; exit 2')
    const result = await rt.runPostToolUse('write', { file_path: '/x.ts' }, { content: 'done' })
    expect(result.additionalContext).toContain('lint: missing semicolon')
  })

  it('continue:false stops the run and shows the stopReason', async () => {
    const { rt, notices } = make(
      'PostToolUse',
      `cat >/dev/null; echo '{"continue":false,"stopReason":"Build broke, stopping"}'`,
    )
    await rt.runPostToolUse('bash', { command: 'make' }, { content: 'error' })
    expect(rt.stoppedBy()).toEqual({ event: 'PostToolUse', reason: 'Build broke, stopping' })
    expect(notices).toContain('Build broke, stopping')
  })
})

describe('PostToolUseFailure', () => {
  it('exit 2 hands the stderr to the model', async () => {
    const { rt } = make('PostToolUseFailure', 'cat >/dev/null; echo "try --force" >&2; exit 2')
    const result = await rt.runPostToolUseFailure(
      'bash',
      { command: 'git push' },
      { error: 'rejected', isInterrupt: false },
    )
    expect(result.additionalContext).toContain('try --force')
  })
})

/**
 * hooks.md, "Exit code output": a non-blocking error shows a `<hook name> hook error` notice in
 * the transcript, and on SessionStart, SubagentStart and the other observe-only events exit 2
 * "shows stderr to user only".
 */
import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'

import { createCcHooksRuntime } from './run'
import type { CcHookEvent, CcHookHandler } from './contracts'

const silent = { warn: () => {}, info: () => {} }

function make(event: CcHookEvent, command: string, matcher?: string) {
  const notices: string[] = []
  const handler: CcHookHandler = { source: 'user', command, timeoutMs: 5000 }
  const rt = createCcHooksRuntime({
    registry: { [event]: [{ ...(matcher ? { matcher } : {}), handlers: [handler] }] },
    sessionId: 's1',
    projectDir: tmpdir(),
    enabled: true,
    logger: silent,
    emitNotice: (message) => notices.push(message),
  })
  return { rt, notices }
}

describe('hook error notices', () => {
  test('an exit 1 on PreToolUse names the event, the tool and the first stderr line', async () => {
    const command = 'cat >/dev/null; echo "something broke" >&2; exit 1'
    const { rt, notices } = make('PreToolUse', command, 'Bash')
    await rt.runPreToolUse('bash', { command: 'ls' })
    expect(notices).toEqual([
      `PreToolUse:Bash hook error: [${command}]: Failed with non-blocking status code: something broke`,
    ])
  })

  test('SessionStart exit 2 shows its stderr to the person', async () => {
    const command = 'cat >/dev/null; echo "env not set up" >&2; exit 2'
    const { rt, notices } = make('SessionStart', command)
    await rt.runSessionStart('startup')
    expect(notices).toEqual([`SessionStart hook error: [${command}]: env not set up`])
  })

  test('a hook that succeeds shows nothing', async () => {
    const { rt, notices } = make('SessionStart', 'cat >/dev/null; exit 0')
    await rt.runSessionStart('startup')
    expect(notices).toEqual([])
  })
})

/**
 * hooks.md, SessionStart decision control: `initialUserMessage` (the session's first user message
 * in non-interactive mode) and `reloadSkills` (scan the skill folders again after the hooks).
 */
import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'

import { createCcHooksRuntime } from './run'
import type { CcHookHandler } from './contracts'

const silent = { warn: () => {}, info: () => {} }
const cmd = (json: unknown): CcHookHandler => ({
  source: 'user',
  command: `cat >/dev/null; echo '${JSON.stringify(json)}'`,
  timeoutMs: 5000,
})
const start = (...answers: unknown[]) =>
  createCcHooksRuntime({
    registry: { SessionStart: [{ handlers: answers.map(cmd) }] },
    sessionId: 's1',
    projectDir: tmpdir(),
    enabled: true,
    logger: silent,
  }).runSessionStart('startup')

const out = (fields: Record<string, unknown>) => ({
  hookSpecificOutput: { hookEventName: 'SessionStart', ...fields },
})

describe('SessionStart output', () => {
  test('initialUserMessage and reloadSkills come back to the run', async () => {
    const result = await start(
      out({ initialUserMessage: 'Triage the open issues' }),
      out({ reloadSkills: true }),
    )
    expect(result).toMatchObject({
      initialUserMessage: 'Triage the open issues',
      reloadSkills: true,
    })
  })

  test('neither is set when no hook names them', async () => {
    const result = await start(out({ additionalContext: 'ctx' }))
    expect(result.initialUserMessage).toBeUndefined()
    expect(result.reloadSkills).toBeUndefined()
  })
})

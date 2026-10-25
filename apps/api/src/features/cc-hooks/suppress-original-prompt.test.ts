/**
 * hooks.md, UserPromptSubmit: `hookSpecificOutput.suppressOriginalPrompt: true` leaves the prompt
 * text out of the block message, whether the hook blocks with `decision: "block"` or by exiting 2;
 * the types list it for UserPromptExpansion as well. It changes nothing else.
 */
import { describe, expect, it } from 'bun:test'
import { tempDirPerTest } from '@localixai/testing'

import { foldHookOutput } from './output-parse'
import { createCcHooksRuntime } from './run'
import type { CcHookEvent } from './contracts'

const dir = tempDirPerTest('cc-suppress-prompt-')
const silent = { warn: () => {}, info: () => {} }

const make = (event: CcHookEvent, command: string) =>
  createCcHooksRuntime({
    registry: { [event]: [{ handlers: [{ source: 'user', command, timeoutMs: 5000 }] }] },
    sessionId: 's1',
    projectDir: dir(),
    enabled: true,
    logger: silent,
  })

const json = (event: string, extra: Record<string, unknown>) =>
  JSON.stringify({
    decision: 'block',
    reason: 'no secrets',
    hookSpecificOutput: { hookEventName: event, ...extra },
  })

describe('suppressOriginalPrompt', () => {
  it('is read from hookSpecificOutput, and only when it is true', () => {
    const hso = (value: unknown) =>
      foldHookOutput(
        JSON.stringify({ hookSpecificOutput: { suppressOriginalPrompt: value } }),
        true,
      )
    expect(hso(true).suppressOriginalPrompt).toBe(true)
    expect(hso('true').suppressOriginalPrompt).toBeUndefined()
    expect(hso(false).suppressOriginalPrompt).toBeUndefined()
  })

  it('a UserPromptSubmit block by decision carries it to the caller', async () => {
    const out = json('UserPromptSubmit', { suppressOriginalPrompt: true })
    const result = await make(
      'UserPromptSubmit',
      `cat >/dev/null; echo '${out}'`,
    ).runUserPromptSubmit('my password is hunter2')
    expect(result).toMatchObject({
      blocked: true,
      reason: 'no secrets',
      suppressOriginalPrompt: true,
    })
  })

  it('a block by exit 2 still reads it from the JSON on stdout', async () => {
    const out = json('UserPromptSubmit', { suppressOriginalPrompt: true })
    const result = await make(
      'UserPromptSubmit',
      `cat >/dev/null; echo '${out}'; echo 'stderr' >&2; exit 2`,
    ).runUserPromptSubmit('my password is hunter2')
    expect(result).toMatchObject({ blocked: true, suppressOriginalPrompt: true })
  })

  it('without it a block leaves the flag off', async () => {
    const out = json('UserPromptSubmit', {})
    const result = await make(
      'UserPromptSubmit',
      `cat >/dev/null; echo '${out}'`,
    ).runUserPromptSubmit('hi')
    expect(result.blocked).toBe(true)
    expect(result.suppressOriginalPrompt).toBeUndefined()
  })

  it('a UserPromptExpansion block carries it too', async () => {
    const out = json('UserPromptExpansion', { suppressOriginalPrompt: true })
    const result = await make(
      'UserPromptExpansion',
      `cat >/dev/null; echo '${out}'`,
    ).runUserPromptExpansion({
      commandName: 'deploy',
      commandArgs: 'prod',
      commandSource: 'plugin',
      prompt: '/deploy prod',
    })
    expect(result).toMatchObject({ blocked: true, suppressOriginalPrompt: true })
  })
})

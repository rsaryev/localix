/**
 * How a hook's stdout and exit code combine (hooks.md, "Exit code output" and "Exit code 0"):
 * text that starts with `{` and ends with `}` but is no JSON is a parse failure, never context;
 * exit 2 still reads the JSON and uses its deny reason over stderr; a missing script on Stop-like
 * events is a non-blocking error; and an HTTP hook's 2xx plain-text body is an error.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { tempDirPerTest } from '@localixai/testing'

import { parseHooksBlock } from './config'
import { foldHookOutput } from './output-parse'
import { createCcHooksRuntime } from './run'
import type { CcHookEvent, CcHookHandler } from './contracts'

const dir = tempDirPerTest('cc-output-semantics-')
const silent = { warn: () => {}, info: () => {} }

const make = (event: CcHookEvent, command: string, source: CcHookHandler['source'] = 'plugin') =>
  createCcHooksRuntime({
    registry: { [event]: [{ handlers: [{ source, command, timeoutMs: 5000 }] }] },
    sessionId: 's1',
    projectDir: dir(),
    enabled: true,
    logger: silent,
  })

describe('stdout', () => {
  it('text that starts with { and ends with } but is no JSON is a parse failure, not context', async () => {
    const result = await make('UserPromptSubmit', `echo '{ not json }'`).runUserPromptSubmit('hi')
    expect(result.additionalContext).toBeUndefined()
    expect(foldHookOutput('{ not json }', true)).toMatchObject({ failed: 'error' })
  })

  it('text that starts with { but does not end with } is plain text', () => {
    expect(foldHookOutput('{curly} intro', true)).toEqual({ additionalContext: '{curly} intro' })
  })

  it('several JSON lines that set no output field are plain text', () => {
    expect(foldHookOutput('{"a":1}\n{"b":2}', true)).toEqual({
      additionalContext: '{"a":1}\n{"b":2}',
    })
    expect(foldHookOutput('{"a":1}\n{"continue":false}', true)).toMatchObject({ failed: 'error' })
  })
})

describe('exit 2', () => {
  it('reads the JSON and blocks with its deny reason over stderr', async () => {
    const json = `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"use rg"}}`
    const result = await make(
      'PreToolUse',
      `cat >/dev/null; echo '${json}'; echo 'stderr text' >&2; exit 2`,
    ).runPreToolUse('bash', { command: 'grep x' })
    expect(result).toMatchObject({ decision: 'deny', reason: 'use rg' })
  })

  it('on Stop, a missing script with nothing on stdout is a non-blocking error', async () => {
    const result = await make(
      'Stop',
      `cat >/dev/null; echo 'python3: cannot open file x.py: [Errno 2] No such file or directory' >&2; exit 2`,
    ).runStop()
    expect(result.blocked).toBe(false)
  })

  it("on a plugin's UserPromptSubmit too, but a user's hook still blocks", async () => {
    const missing = `cat >/dev/null; echo 'No such file or directory' >&2; exit 2`
    expect((await make('UserPromptSubmit', missing).runUserPromptSubmit('hi')).blocked).toBe(false)
    expect(
      (await make('UserPromptSubmit', missing, 'user').runUserPromptSubmit('hi')).blocked,
    ).toBe(true)
  })
})

describe('an http hook’s 2xx body', () => {
  let server: ReturnType<typeof Bun.serve> | null = null
  afterEach(async () => {
    await server?.stop(true)
    server = null
  })

  const httpHook = (body: string, extra: Record<string, unknown> = {}) => {
    server = Bun.serve({ port: 0, fetch: () => new Response(body, { status: 200 }) })
    const registry = parseHooksBlock(
      {
        UserPromptSubmit: [
          { hooks: [{ type: 'http', url: `http://localhost:${server.port}`, ...extra }] },
        ],
      },
      'plugin',
      { projectDir: dir(), pluginName: 'p' },
    )
    return createCcHooksRuntime({
      registry,
      sessionId: 's1',
      projectDir: dir(),
      enabled: true,
      logger: silent,
    })
  }

  it('that is plain text is an error, not context', async () => {
    const result = await httpHook('remember the tests').runUserPromptSubmit('hi')
    expect(result.additionalContext).toBeUndefined()
  })

  it('that is plain text blocks a hook with onFailure "block"', async () => {
    const result = await httpHook('oops', { onFailure: 'block' }).runUserPromptSubmit('hi')
    expect(result.blocked).toBe(true)
  })
})

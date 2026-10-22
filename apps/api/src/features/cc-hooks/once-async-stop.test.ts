/**
 * Three hooks.md rules that decide what a hook leaves behind it:
 *
 *  - `once` is "Only honored for hooks declared in skill frontmatter", and is spent by the first
 *    SUCCESSFUL run: "A run that fails, blocks with exit code 2, or times out leaves the hook in
 *    place".
 *  - An async hook's `additionalContext` and `systemMessage` reach Claude "on the next
 *    conversation turn".
 *  - A Stop hook's `additionalContext` is "Non-error feedback for Claude. The conversation
 *    continues so Claude can act on it".
 */
import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'

import type { CcHookHandler, CcHookRegistry } from './contracts'
import { asyncHookContext } from './output-parse'
import { createCcHooksRuntime } from './run'

const logger = { warn: () => {} }
const cmd = (command: string, extra: Partial<CcHookHandler> = {}): CcHookHandler => ({
  source: 'skill',
  command,
  timeoutMs: 5000,
  ...extra,
})
const make = (
  registry: CcHookRegistry,
  extra: Partial<Parameters<typeof createCcHooksRuntime>[0]> = {},
) =>
  createCcHooksRuntime({
    registry,
    sessionId: 's1',
    projectDir: tmpdir(),
    enabled: true,
    logger,
    ...extra,
  })

describe('once', () => {
  const counted = (source: CcHookHandler['source']) => {
    let calls = 0
    const runtime = make(
      {
        UserPromptSubmit: [
          {
            handlers: [
              { source, kind: 'prompt', command: '', prompt: 'p', timeoutMs: 1000, once: true },
            ],
          },
        ],
      },
      {
        onceKeys: new Set(),
        evaluatePromptHook: async () => {
          calls++
          return { ok: true }
        },
      },
    )
    return { runtime, calls: () => calls }
  }

  test("a skill's once hook runs once; a plugin's or an agent's runs every time", async () => {
    for (const [source, expected] of [
      ['skill', 1],
      ['plugin', 3],
      ['agent', 3],
    ] as const) {
      const { runtime, calls } = counted(source)
      for (let i = 0; i < 3; i++) await runtime.runUserPromptSubmit('hi')
      expect(`${source} ${calls()}`).toBe(`${source} ${expected}`)
    }
  })

  test('a run that blocks with exit 2 or fails leaves the hook in place', async () => {
    for (const exit of [2, 1]) {
      const onceKeys = new Set<string>()
      const runtime = make(
        { UserPromptSubmit: [{ handlers: [cmd(`cat >/dev/null; exit ${exit}`, { once: true })] }] },
        { onceKeys },
      )
      await runtime.runUserPromptSubmit('hi')
      expect(onceKeys.size).toBe(0)
    }
  })

  test('an async once hook is spent when it exits 0', async () => {
    const onceKeys = new Set<string>()
    let said!: (text: string) => void
    const heard = new Promise<string>((resolve) => (said = resolve))
    const out = JSON.stringify({ hookSpecificOutput: { additionalContext: 'tests passed' } })
    const runtime = make(
      {
        PostToolUse: [
          { handlers: [cmd(`cat >/dev/null; echo '${out}'`, { once: true, async: true })] },
        ],
      },
      { onceKeys, onAsyncContext: (text) => said(text) },
    )
    await runtime.runPostToolUse('bash', {}, { content: '' })
    expect(await heard).toBe('tests passed')
    expect(onceKeys.size).toBe(1)
  })
})

describe('an async hook speaks on the next turn', () => {
  test('its JSON alone, or on a line of its own, carries additionalContext and systemMessage', () => {
    const pretty = JSON.stringify(
      { systemMessage: 'lint clean', hookSpecificOutput: { additionalContext: 'all good' } },
      null,
      2,
    )
    expect(asyncHookContext(pretty)).toBe('all good\n\nlint clean')
    expect(asyncHookContext(`running tests\n{"systemMessage":"3 failed"}\ndone`)).toBe('3 failed')
    expect(asyncHookContext('just text')).toBeUndefined()
  })
})

describe('Stop additionalContext', () => {
  const stop = (...outputs: object[]) =>
    make({
      Stop: [{ handlers: outputs.map((o) => cmd(`cat >/dev/null; echo '${JSON.stringify(o)}'`)) }],
    }).runStop()

  test('keeps the agent working as feedback, not as a block', async () => {
    expect(
      await stop({ hookSpecificOutput: { additionalContext: 'run the tests first' } }),
    ).toEqual({
      blocked: true,
      reason: 'run the tests first',
      feedback: true,
    })
  })

  test('a block still wins with its own reason', async () => {
    expect(
      await stop(
        { hookSpecificOutput: { additionalContext: 'note' } },
        { decision: 'block', reason: 'fix the build' },
      ),
    ).toEqual({ blocked: true, reason: 'fix the build' })
  })
})

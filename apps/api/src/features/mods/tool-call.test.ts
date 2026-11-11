import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import { createModRunScope } from './run-scope'
import { hostWithMod } from './testing/testing-host'

/** `tool.call` as a mod meets it around Localix's tools. */

function bash(run: () => { content: string; isError?: boolean } = () => ({ content: 'hi\n' })) {
  return defineAgentTool({
    name: 'Bash',
    description: 'bash',
    activeVerb: 'Running',
    inputSchema: z.object({ command: z.string() }),
    execute: async () => run(),
  }) as AgentTool
}

describe('tool.call', () => {
  test('a deny after the tool ran says the tool ran and a plugin withheld its result', async () => {
    let ran = 0
    const { scope } = await hostWithMod((on) => {
      on('tool.call', async (_$, e, next) => {
        await next(e)
        return { deny: 'secrets in the output' }
      })
    })
    const [tool] = scope.wrapTools([bash(() => (ran++, { content: 'TOKEN=1' }))])
    const read = await tool!.execute('t1', { command: 'env' }, new AbortController().signal).then(
      () => 'answered',
      (error: Error) => error.message,
    )
    expect(ran).toBe(1)
    expect(read).toBe('Bash ran, and a plugin withheld its result: secrets in the output')
  })

  test('a deny before the tool runs, or after it failed, is the reason alone', async () => {
    const { scope } = await hostWithMod((on) => {
      on('tool.call', async (_$, e, next) => {
        if ((e as { command?: string }).command === 'rm') return { deny: 'no rm' }
        await next(e)
        return { deny: 'it failed anyway' }
      })
    })
    const [tool] = scope.wrapTools([bash(() => ({ content: 'boom', isError: true }))])
    const reason = (command: string) =>
      tool!.execute('t1', { command }, new AbortController().signal).then(
        () => 'answered',
        (error: Error) => error.message,
      )
    expect(await reason('rm')).toBe('no rm')
    expect(await reason('make')).toBe('it failed anyway')
  })

  test('next.signal aborts when the run stops the call, so a held call lets go', async () => {
    const { scope } = await hostWithMod((on) => {
      on('tool.call', async (_$, _e, next) => {
        if (!next.signal.aborted)
          await new Promise((resolve) => next.signal.addEventListener('abort', resolve))
        return { deny: 'held, then the turn was interrupted' }
      })
    })
    const [tool] = scope.wrapTools([bash()])
    const stop = new AbortController()
    const running = tool!.execute('t1', { command: 'rm -rf build' }, stop.signal)
    stop.abort()
    // The call is abandoned with the turn: it rejects, and the tool never runs.
    const outcome = await running.then(
      () => 'ran',
      () => 'abandoned',
    )
    expect(outcome).toBe('abandoned')
  })

  test('a tool without a path gets the input it was called with, nothing added', async () => {
    const { scope } = await hostWithMod((on) => {
      on('tool.call', async (_$, _e, next) => next())
    })
    let got: unknown
    const store = defineAgentTool({
      name: 'Store',
      description: 'store',
      activeVerb: 'Searching',
      inputSchema: z.object({ action: z.string() }).strict(),
      execute: async (_id, input) => {
        got = input
        return { content: 'ok' }
      },
    }) as AgentTool
    const [tool] = scope.wrapTools([store])
    await tool!.execute('t1', { action: 'search' }, new AbortController().signal)
    expect(Object.keys(got as object)).toEqual(['action'])
  })

  test('a subagent’s call reaches its tool without the agent id the mod was shown', async () => {
    const { host, scene } = await hostWithMod((on) => {
      on('tool.call', async (_$, _e, next) => next())
    })
    const scope = await createModRunScope(host, scene, new Set(['m']), {
      model: 'model-a',
      agentId: 'LOCALIX-9',
    })
    let got: unknown
    const store = defineAgentTool({
      name: 'Store',
      description: 'store',
      activeVerb: 'Searching',
      inputSchema: z.object({ action: z.string() }).strict(),
      execute: async (_id, input) => {
        got = input
        return { content: 'ok' }
      },
    }) as AgentTool
    const [tool] = scope.wrapTools([store])
    await tool!.execute('t1', { action: 'search' }, new AbortController().signal)
    expect(got).toEqual({ action: 'search' })
  })
})

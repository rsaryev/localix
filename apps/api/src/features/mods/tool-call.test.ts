import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import { hostWithMod } from './testing/testing-host'

/** `tool.call` as a mod meets it around Localix's tools. */

function bash(run: () => { content: string; isError?: boolean } = () => ({ content: 'hi\n' })) {
  return defineAgentTool({
    name: 'bash',
    description: 'bash',
    activeVerb: 'Running',
    inputSchema: z.object({ command: z.string() }),
    execute: async () => run(),
  }) as AgentTool
}

describe('tool.call', () => {
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
      name: 'store',
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
})

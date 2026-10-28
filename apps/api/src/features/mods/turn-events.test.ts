import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import { createModRunScope } from './run-scope'
import { hostWithMod } from './testing/testing-host'

/** A turn's events as a mod hears them: whose turn it is, and how it ended. */

const read = defineAgentTool({
  name: 'Read',
  description: 'read',
  activeVerb: 'Reading',
  inputSchema: z.object({ path: z.string() }),
  execute: async () => ({ content: 'text' }),
}) as AgentTool

describe('turn events', () => {
  test('a delegated child’s turn names it as agentId on every event; the main turn does not', async () => {
    const seen: Record<string, unknown>[] = []
    const record = (event: string) => (_$: unknown, e: unknown, next: (e: unknown) => unknown) => {
      seen.push({ event, agentId: (e as { agentId?: unknown }).agentId })
      return next(e)
    }
    const { host, scene, scope } = await hostWithMod((on) => {
      for (const event of ['turn.start', 'turn.complete', 'tool.call']) on(event, record(event))
    })
    const child = await createModRunScope(
      host,
      { ...scene, sessionId: 'child-1' },
      new Set(['m']),
      { model: 'model-a', agentId: 'child-1' },
    )
    for (const run of [scope, child]) {
      await run.turnStart('go', 't')
      await run.wrapTools([read])[0]!.execute('c1', { path: 'a' })
      await run.turnComplete({ answer: 'done', turnId: 't', durationMs: 1, reason: 'answer' })
    }
    expect(seen).toEqual([
      { event: 'turn.start', agentId: undefined },
      { event: 'tool.call', agentId: undefined },
      { event: 'turn.complete', agentId: undefined },
      { event: 'turn.start', agentId: 'child-1' },
      { event: 'tool.call', agentId: 'child-1' },
      { event: 'turn.complete', agentId: 'child-1' },
    ])
  })

  test('turn.complete says how the turn ended and what it cost, from the failure path too', async () => {
    const heard: Record<string, unknown>[] = []
    const answers: unknown[] = []
    const { scope } = await hostWithMod((on) => {
      on('turn.complete', async (_$, e, next) => {
        heard.push(e as Record<string, unknown>)
        answers.push(await next(e))
        return undefined
      })
    })
    const usage = {
      input_tokens: 10,
      output_tokens: 2,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      model: 'model-a',
    }
    await scope.turnStart('go', 't1')
    await scope.turnComplete({
      answer: 'partial',
      turnId: 't1',
      durationMs: 5,
      reason: 'aborted',
      usage,
    })
    // Once a turn was heard to end, the failure path that follows says nothing more.
    await scope.turnFailed({ reason: 'error', durationMs: 6 })
    await scope.turnStart('again', 't2')
    await scope.turnFailed({ reason: 'error', durationMs: 7 })
    expect(heard).toEqual([
      { answer: 'partial', turnId: 't1', durationMs: 5, reason: 'aborted', isAborted: true, usage },
      { answer: '', turnId: 't2', durationMs: 7, reason: 'error', isAborted: false },
    ])
    expect(answers[0]).toEqual({ text: 'partial', usage })
  })
})

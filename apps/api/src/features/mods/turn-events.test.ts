import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import { createModRunScope } from './run-scope'
import { hostWithMod } from './testing/testing-host'

/** A turn's events as a mod hears them: whose turn it is, and how it ended. */

const read = defineAgentTool({
  name: 'read',
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
})

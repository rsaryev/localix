/**
 * The last no-tools turn a spent turn budget gets: best effort, honest events, and never paid for
 * when a host stop or a waiting message already ends the run.
 */
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentEvent, type AgentTool } from '@localixai/agent/agents'

import {
  call,
  collect,
  last,
  say,
  scriptedSession,
  type ScriptStep,
} from './__fixtures__/scripted-session'
import { runAgentLoop } from './index'
import type { LoopInput } from './loop'

const echo = defineAgentTool({
  name: 'echo',
  description: 'Echo the text back.',
  activeVerb: 'Echoing',
  inputSchema: z.object({ text: z.string() }),
  execute: async (_id, input) => ({ content: `echo:${input.text}` }),
}) as AgentTool

function start(steps: readonly ScriptStep[], input: Partial<LoopInput> = {}) {
  const { session, requests } = scriptedSession(steps)
  const run = runAgentLoop({
    sessionId: 's1',
    systemPrompt: 'be brief',
    messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
    tools: [echo],
    session,
    maxTurns: 1,
    ...input,
  })
  return { run, requests }
}

const ends = (events: readonly AgentEvent[]) => events.filter((e) => e.type === 'agent_end')

describe('the last turn of a spent budget', () => {
  test('a provider failure in it leaves a max_turns stop with one agent_end', async () => {
    const { run } = start([call('echo', { text: 'a' }), { error: 'overloaded' }])
    const { events, result } = await collect(run)
    expect(result).toMatchObject({ terminal: 'completed', stoppedBy: 'turnBudget' })
    expect((result as { error?: unknown }).error).toBeUndefined()
    expect(ends(events)).toHaveLength(1)
    expect(last(events)).toMatchObject({ type: 'agent_end', stopReason: 'max_turns' })
  })

  test('a stop by the person during it ends the run as aborted, once', async () => {
    const { run } = start([call('echo', { text: 'a' }), { hold: true }])
    const events: AgentEvent[] = []
    for await (const event of run) {
      events.push(event)
      if (event.type === 'turn_start' && event.turnIndex === 1) run.abort('stop')
    }
    expect(await run.result).toMatchObject({ terminal: 'aborted' })
    expect(ends(events)).toHaveLength(1)
    expect(last(events)).toMatchObject({ type: 'agent_end', stopReason: 'aborted' })
  })

  test('a tool call it makes anyway never reaches the host', async () => {
    const { run } = start([call('echo', { text: 'a' }), call('echo', { text: 'b' }, 'late')])
    const { events } = await collect(run)
    const json = JSON.stringify(events.slice(events.findIndex((e) => e.type === 'turn_end') + 1))
    expect(json).not.toContain('late')
    const final = events.filter((e) => e.type === 'message_end' && e.message.role === 'assistant')
    expect(JSON.stringify(last(final))).not.toContain('tool_call')
  })

  test('a host stop rule that fires with the budget wins, with no extra turn', async () => {
    const { run, requests } = start([call('echo', { text: 'a' }), say('never')], {
      stopWhen: [{ name: 'enough', shouldStop: () => true }],
    })
    const { result } = await collect(run)
    expect(requests).toHaveLength(1)
    expect(result).toMatchObject({ stoppedBy: 'enough' })
  })

  test('an after-batch stop that lands with the budget wins, with no extra turn', async () => {
    const { run, requests } = start([call('echo', { text: 'a' }), say('never')], {
      afterToolBatch: async () => ({ stop: 'hook' }),
    })
    const { result } = await collect(run)
    expect(requests).toHaveLength(1)
    expect(result).toMatchObject({ stoppedBy: 'hook' })
  })

  test('a message that waits for the model skips it', async () => {
    const { run, requests } = start([call('echo', { text: 'a' }), say('never')], {
      shouldDeferToolCalls: () => true,
    })
    const { result } = await collect(run)
    expect(requests).toHaveLength(1)
    expect(result).toMatchObject({ stoppedBy: 'turnBudget' })
  })
})

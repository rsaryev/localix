/**
 * Once a call that may have changed state fails, the calls of the same response that have not
 * started come back as "Not run" naming it, so the model decides again; a failed read does not.
 */
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'

import { collect, scriptedSession, say, types } from './__fixtures__/scripted-session'
import { runAgentLoop } from './index'
import type { LoopInput } from './loop'

function tool(name: string, mutates: boolean, fail: boolean, ran: string[]): AgentTool {
  return defineAgentTool({
    name,
    description: name,
    activeVerb: name,
    inputSchema: z.object({}),
    mutates,
    // Sequential, so "later" means "has not started" without any timing.
    executionMode: 'sequential',
    async execute() {
      ran.push(name)
      if (fail) throw new Error(`${name} broke`)
      return { content: `${name} ok` }
    },
  }) as AgentTool
}

async function runCalls(names: string[], tools: AgentTool[], extra: Partial<LoopInput> = {}) {
  const { session, requests } = scriptedSession([
    { calls: names.map((name) => ({ name })) },
    say('done'),
  ])
  const run = runAgentLoop({
    sessionId: 's',
    systemPrompt: 'p',
    messages: [{ role: 'user', content: 'go', timestamp: 0 }],
    session,
    tools,
    ...extra,
  })
  const { events } = await collect(run)
  return { events, followUp: JSON.stringify(requests[1]!.messages) }
}

describe('calls after a failed writer', () => {
  test('are not run, and say which call failed', async () => {
    const ran: string[] = []
    const { events, followUp } = await runCalls(
      ['edit', 'publish'],
      [tool('edit', true, true, ran), tool('publish', true, false, ran)],
    )
    expect(ran).toEqual(['edit'])
    expect(followUp).toContain('Not run: edit failed earlier in this response')
    // Every call still has its start and end, in source order.
    expect(types(events).filter((t) => t.startsWith('tool_execution'))).toEqual([
      'tool_execution_start',
      'tool_execution_end',
      'tool_execution_start',
      'tool_execution_end',
    ])
  })

  test('include a read planned after it', async () => {
    const ran: string[] = []
    await runCalls(
      ['edit', 'look'],
      [tool('edit', true, true, ran), tool('look', false, false, ran)],
    )
    expect(ran).toEqual(['edit'])
  })

  test('a person-denied writer stops the rest as well', async () => {
    const ran: string[] = []
    const { followUp } = await runCalls(
      ['edit', 'publish'],
      [tool('edit', true, false, ran), tool('publish', true, false, ran)],
      {
        beforeToolCall: async (ctx) =>
          ctx.toolName === 'edit' ? { block: true, blockedMessage: 'denied' } : undefined,
      },
    )
    expect(ran).toEqual([])
    expect(followUp).toContain('Not run: edit failed earlier in this response')
  })
})

describe('calls after a failed read', () => {
  test('still run', async () => {
    const ran: string[] = []
    await runCalls(
      ['look', 'edit'],
      [tool('look', false, true, ran), tool('edit', true, false, ran)],
    )
    expect(ran).toEqual(['look', 'edit'])
  })

  test('a denied read does not stop the rest', async () => {
    const ran: string[] = []
    await runCalls(
      ['look', 'edit'],
      [tool('look', false, false, ran), tool('edit', true, false, ran)],
      {
        beforeToolCall: async (ctx) =>
          ctx.toolName === 'look' ? { block: true, blockedMessage: 'denied' } : undefined,
      },
    )
    expect(ran).toEqual(['edit'])
  })
})

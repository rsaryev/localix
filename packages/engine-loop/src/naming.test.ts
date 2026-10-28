/**
 * A tool offered under a model name (`AgentTool.modelName`): the model sees and calls that name,
 * and everything else in the run — events, transcript, gate, hooks, nested calls — sees the tool's
 * own name. History goes back to the model under the name it was offered.
 */
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { AssistantMessage, ToolResultMessage } from '@localixai/agent'
import { defineAgentTool, type AgentMessage, type AgentTool } from '@localixai/agent/agents'

import { call, collect, last, say, scriptedSession } from './__fixtures__/scripted-session'
import { runAgentLoop } from './index'
import type { LoopInput } from './loop'

const INTERNAL = 'mcp_kit_db_query'
const WIRE = 'mcp__plugin_kit_db__query'

function tool(name: string, extra: Partial<AgentTool> = {}): AgentTool {
  return defineAgentTool({
    name,
    description: name,
    activeVerb: 'Running',
    inputSchema: z.object({ q: z.string() }),
    execute: async (_id, input) => ({ content: `ran:${(input as { q: string }).q}` }),
    ...extra,
  }) as AgentTool
}
const query = tool(INTERNAL, { modelName: WIRE })

function start(steps: Parameters<typeof scriptedSession>[0], input: Partial<LoopInput> = {}) {
  const { session, requests } = scriptedSession(steps)
  const gated: string[] = []
  const after: string[] = []
  const run = runAgentLoop({
    sessionId: 's',
    systemPrompt: 'p',
    messages: [{ role: 'user', content: 'go', timestamp: 0 }],
    tools: [query],
    session,
    beforeToolCall: async (ctx) => (gated.push(ctx.toolName), undefined),
    afterToolCall: async (ctx) => (after.push(ctx.toolName), undefined),
    ...input,
  })
  return { run, requests, gated, after }
}

const callNames = (messages: readonly AgentMessage[]) =>
  messages.flatMap((message) =>
    message.role === 'assistant'
      ? (message as AssistantMessage).content.flatMap((part) =>
          part.type === 'tool_call' ? [part.name] : [],
        )
      : [],
  )
const resultNames = (messages: readonly AgentMessage[]) =>
  messages.flatMap((message) =>
    message.role === 'tool' ? (message as ToolResultMessage).results.map((r) => r.toolName) : [],
  )

describe('a tool with a model name', () => {
  test('is declared under it, and a call by it runs under the own name everywhere', async () => {
    const { run, requests, gated, after } = start([call(WIRE, { q: 'x' }, 'c1'), say('done')])
    const { events, result } = await collect(run)

    expect(requests[0]!.tools.map((declared) => declared.name)).toEqual([WIRE])
    // Every event names the tool by its own name, the streamed delta included.
    const named = events.flatMap((event) => {
      if (event.type === 'message_update' && event.delta.kind === 'tool_call')
        return [event.delta.name]
      if (event.type === 'message_end') return callNames([event.message])
      if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end')
        return [event.toolName]
      return []
    })
    expect(named.length).toBeGreaterThan(3)
    expect(new Set(named)).toEqual(new Set([INTERNAL]))
    expect(gated).toEqual([INTERNAL])
    expect(after).toEqual([INTERNAL])
    const transcript = (result as { messages: AgentMessage[] }).messages
    expect(callNames(transcript)).toEqual([INTERNAL])
    expect(resultNames(transcript)).toEqual([INTERNAL])
    expect(JSON.stringify(last(transcript))).not.toContain(WIRE)

    // The next request reads the call and its result under the name the model was offered.
    expect(callNames(requests[1]!.messages)).toEqual([WIRE])
    expect(resultNames(requests[1]!.messages)).toEqual([WIRE])
    expect(JSON.stringify(requests[1]!.messages)).toContain('ran:x')
  })

  test('history stored under the own name is sent under the model name', async () => {
    const stored: AgentMessage[] = [
      { role: 'user', content: 'go', timestamp: 0 },
      {
        role: 'assistant',
        content: [{ type: 'tool_call', id: 'old', name: INTERNAL, arguments: { q: 'a' } }],
        model: 'm',
        stopReason: 'tool_use',
        timestamp: 0,
      } as AgentMessage,
      {
        role: 'tool',
        results: [{ type: 'tool_result', toolCallId: 'old', toolName: INTERNAL, content: 'r' }],
        timestamp: 0,
      },
    ]
    const { run, requests } = start([say('ok')], { messages: stored })
    await collect(run)
    expect(callNames(requests[0]!.messages)).toEqual([WIRE])
    expect(resultNames(requests[0]!.messages)).toEqual([WIRE])
  })

  test('a deny keyed on the own name refuses a call made by the model name', async () => {
    let ran = false
    const guarded = tool(INTERNAL, {
      modelName: WIRE,
      execute: async () => ((ran = true), { content: 'ran' }),
    })
    const { run } = start([call(WIRE, { q: 'z' }), say('done')], {
      tools: [guarded],
      beforeToolCall: async (ctx) =>
        ctx.toolName === INTERNAL ? { block: true, blockedMessage: 'denied by rule' } : undefined,
    })
    const { events } = await collect(run)
    expect(ran).toBe(false)
    const end = events.find((event) => event.type === 'tool_execution_end')
    expect(end).toMatchObject({ toolName: INTERNAL, result: { isError: true } })
  })

  test('a call by the own name is still accepted', async () => {
    const { run, gated } = start([call(INTERNAL, { q: 'y' }), say('done')])
    const { events } = await collect(run)
    const end = events.find((event) => event.type === 'tool_execution_end')
    expect(end).toMatchObject({ toolName: INTERNAL, result: { content: 'ran:y' } })
    expect(gated).toEqual([INTERNAL])
  })

  test('an activated tool joins the roster under its model name', async () => {
    const activate = tool('activate', {
      inputSchema: z.object({}),
      activatesTools: true,
      execute: async () => ({ content: 'on', details: { activated: [INTERNAL] } }),
    })
    const { run, requests } = start([call('activate'), say('done')], {
      tools: [activate],
      dispatchTools: [activate, query],
    })
    await collect(run)
    expect(requests[0]!.tools.map((declared) => declared.name)).toEqual(['activate'])
    expect(requests[1]!.tools.map((declared) => declared.name)).toEqual(['activate', WIRE])
  })

  test('a model name another tool answers to fails the run before any request', async () => {
    const clash = tool('other', { modelName: INTERNAL })
    const { run, requests } = start([say('never')], { tools: [query, clash] })
    const { result } = await collect(run).catch((error: unknown) => ({ result: error }))
    expect(requests).toHaveLength(0)
    expect(String((result as { error?: unknown }).error ?? result)).toContain(INTERNAL)
  })
})

import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import {
  defineAgentTool,
  type AgentTool,
  type NestedToolCallOutcome,
} from '@localixai/agent/agents'

import { collect, scripted, scriptedBaseInput } from './__fixtures__/scripted-run'

/**
 * A tool calling other tools through `context.callTool` gets exactly what a model-issued call gets
 * — the gate and the hooks — and the calls a script races with `Promise.all` run together.
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function timeline() {
  const spans: { name: string; start: number; end: number }[] = []
  const timed = (name: string, mutates: boolean): AgentTool =>
    defineAgentTool({
      name,
      description: name,
      activeVerb: name,
      mutates,
      inputSchema: z.object({ text: z.string() }),
      execute: async (_id, input) => {
        const start = performance.now()
        await sleep(30)
        spans.push({ name, start, end: performance.now() })
        return { content: `${name}:${input.text}`, details: { by: name } }
      },
    })
  return { spans, read: timed('peek', false) }
}

type Context = NonNullable<Parameters<AgentTool['execute']>[4]>

async function runParent(
  body: (callTool: Context['callTool']) => Promise<string>,
  tools: readonly AgentTool[],
  hooks: Record<string, unknown> = {},
) {
  const parent = defineAgentTool({
    name: 'parent',
    description: 'calls other tools',
    activeVerb: 'Calling',
    inputSchema: z.object({}),
    execute: async (_id, _input, _signal, _update, context) => ({
      content: await body(context?.callTool),
    }),
  })
  const script = scripted([
    fauxAssistantMessage([fauxToolCall('parent', {}, { id: 'p1' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxText('done')]),
  ])
  const all = [parent, ...tools]
  const { result } = await collect({
    ...scriptedBaseInput,
    tools: [parent],
    dispatchTools: all,
    middleware: script.middleware,
    ...hooks,
  })
  return { result, modelCalls: script.callCount() }
}

describe('nested tool calls', () => {
  test('go through the gate and the after-hook with an id of their own, in one model turn', async () => {
    const { read } = timeline()
    const gated: string[] = []
    const after: string[] = []
    const outcomes: NestedToolCallOutcome[] = []
    const { modelCalls } = await runParent(
      async (callTool) => {
        outcomes.push(await callTool!('peek', { text: 'allowed' }))
        outcomes.push(await callTool!('peek', { text: 'refused' }))
        outcomes.push(await callTool!('peek', { wrong: 1 }))
        outcomes.push(await callTool!('missing', {}))
        return 'ran'
      },
      [read],
      {
        beforeToolCall: async (ctx: { toolCallId: string; input: { text?: string } }) => {
          gated.push(ctx.toolCallId)
          return ctx.input.text === 'refused'
            ? { block: true, blockedMessage: 'The person declined this.' }
            : undefined
        },
        afterToolCall: async (ctx: { toolCallId: string }) => {
          after.push(ctx.toolCallId)
          return undefined
        },
      },
    )
    // Two samples: the parent's call and the answer. Four nested calls cost no model turn.
    expect(modelCalls).toBe(2)
    // The host's own record of the call: its content and details, as the after-hook left them.
    expect(outcomes[0]).toMatchObject({
      result: { content: 'peek:allowed', details: { by: 'peek' } },
      isError: false,
    })
    expect(outcomes[1]!.isError).toBe(true)
    expect(outcomes[1]!.result.content).toContain('The person declined this.')
    expect(outcomes[2]!.isError).toBe(true)
    expect(outcomes[3]).toMatchObject({ isError: true })
    expect(outcomes[3]!.result.content).toContain('missing')
    // The gate saw every call that validated, under the parent's id; the after-hook only those
    // that ran. The parent's own call is gated too.
    expect(gated).toEqual(['p1', 'p1/1', 'p1/2'])
    expect(after).toEqual(['p1/1', 'p1'])
  })

  test('an approval a stopped call waits on is withdrawn with it, and the call never runs', async () => {
    const { spans, read } = timeline()
    let withdrawn = false
    let outcome: NestedToolCallOutcome | undefined
    await runParent(
      async (callTool) => {
        const stop = new AbortController()
        setTimeout(() => stop.abort(), 30)
        outcome = await callTool!('peek', { text: 'awaiting approval' }, stop.signal)
        return 'ran'
      },
      [read],
      {
        // A person who never answers: the gate waits until its signal says the call is gone.
        beforeToolCall: (ctx: { toolCallId: string }, signal: AbortSignal) =>
          ctx.toolCallId === 'p1'
            ? Promise.resolve(undefined)
            : new Promise((resolve) =>
                signal.addEventListener('abort', () => {
                  withdrawn = true
                  resolve(undefined)
                }),
              ),
      },
    )
    expect(withdrawn).toBe(true)
    expect(outcome!.isError).toBe(true)
    expect(spans).toEqual([])
  })

  test('raced calls run together', async () => {
    const { spans, read } = timeline()
    await runParent(
      async (callTool) => {
        await Promise.all([callTool!('peek', { text: 'a' }), callTool!('peek', { text: 'b' })])
        return 'ran'
      },
      [read],
    )
    const [peekA, peekB] = spans.filter((span) => span.name === 'peek')
    expect(peekB!.start).toBeLessThan(peekA!.end)
  })
})

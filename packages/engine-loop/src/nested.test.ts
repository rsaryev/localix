/**
 * Calls a tool makes on its own behalf (`callTool`, what codemode's scripts use): the same gate
 * and validation as a model's call, announced under their parent, and a raw result back — what
 * is only for the model (the gate's note, the after-hook's externalization and reminders) stays
 * out of it.
 */
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  defineAgentTool,
  type AgentEvent,
  type AgentTool,
  type HumanInLoopController,
} from '@localixai/agent/agents'

import { collect, say, scriptedSession, types } from './__fixtures__/scripted-session'
import { runAgentLoop } from './index'
import type { LoopInput } from './loop'

function probe(name: string, extra: Partial<AgentTool> = {}): AgentTool {
  return defineAgentTool({
    name,
    description: name,
    activeVerb: 'Probing',
    inputSchema: z.object({ id: z.string() }),
    execute: async (_id, input) => ({ content: (input as { id: string }).id }),
    ...extra,
  }) as AgentTool
}
const read = probe('read')

async function runCalls(
  calls: Array<{ name: string; arguments: unknown; id?: string }>,
  input: Partial<LoopInput> = {},
) {
  const { session } = scriptedSession([{ calls }, say('done')])
  return collect(
    runAgentLoop({
      sessionId: 's',
      systemPrompt: 'p',
      messages: [{ role: 'user', content: 'go', timestamp: 0 }],
      tools: [read],
      session,
      ...input,
    }),
  )
}
const ends = (events: AgentEvent[]) =>
  events.flatMap((event) => (event.type === 'tool_execution_end' ? [event] : []))

describe('a nested call', () => {
  test('a nested call is gated under its parent and gets its raw result back', async () => {
    const gated: string[] = []
    const after: string[] = []
    const outer = probe('outer', {
      execute: async (_id, _input, _signal, _update, context) => {
        const allowed = await context!.callTool!('read', { id: 'inner' })
        const refused = await context!.callTool!('read', { id: 'refused' })
        const invalid = await context!.callTool!('read', { wrong: 1 })
        // The raw result: the gate's note and the after-hook are for the model, not the script.
        return {
          content: JSON.stringify([allowed.result.content, refused.isError, invalid.isError]),
        }
      },
    })
    const { events } = await runCalls([{ name: 'outer', arguments: { id: 'o' }, id: 'p1' }], {
      tools: [outer, read],
      beforeToolCall: async (context) => {
        gated.push(`${context.toolCallId}<${context.parentToolCallId ?? ''}`)
        return (context.input as { id?: string }).id === 'refused'
          ? { block: true, blockedMessage: 'no' }
          : { note: 'The person approved this.' }
      },
      afterToolCall: async (context) => (after.push(context.toolCallId), undefined),
    })
    expect(ends(events)[0]!.result.content).toBe('The person approved this.\n\n["inner",true,true]')
    expect(gated).toEqual(['p1<', 'p1/1<p1', 'p1/2<p1'])
    expect(after).toEqual(['p1'])
    // Nested calls make no events of their own: the parent's card tells their story.
    expect(ends(events).map((event) => event.toolCallId)).toEqual(['p1'])
  })

  test("a question a nested call's tool asks is announced under the parent", async () => {
    const controller = {
      request: async () => ({ id: 'q', approved: true }),
    } as unknown as HumanInLoopController
    const asking = probe('ask', {
      execute: async (_id, _input, _signal, _update, context) => {
        await context!.humanInLoop!.request({ id: 'q', kind: 'confirm', title: 'ok?' } as never)
        return { content: 'asked' }
      },
    })
    const outer = probe('outer', {
      execute: async (_id, _input, _signal, _update, context) =>
        (await context!.callTool!('ask', { id: 'inner' })).result,
    })
    const { events } = await runCalls([{ name: 'outer', arguments: { id: 'o' }, id: 'p2' }], {
      tools: [outer, asking],
      toolExecutionContext: { humanInLoop: controller },
    })
    const hitl = events.filter((event) => event.type.startsWith('human_in_loop'))
    expect(types(hitl)).toEqual(['human_in_loop_request', 'human_in_loop_response'])
    expect(hitl.map((event) => (event as { toolCallId: string }).toolCallId)).toEqual(['p2', 'p2'])
  })

  test('a message the person sends mid-script leaves the calls after it unrun', async () => {
    let waiting = false
    const ran: string[] = []
    const tracked = probe('read', {
      execute: async (_id, input) => {
        ran.push((input as { id: string }).id)
        return { content: 'ok' }
      },
    })
    const outer = probe('outer', {
      execute: async (_id, _input, _signal, _update, context) => {
        const first = await context!.callTool!('read', { id: 'before' })
        waiting = true
        const second = await context!.callTool!('read', { id: 'after' })
        return { content: JSON.stringify([first.isError, second.isError, second.result.content]) }
      },
    })
    const { result } = await runCalls([{ name: 'outer', arguments: { id: 'o' }, id: 'p3' }], {
      tools: [outer, tracked],
      shouldDeferToolCalls: () => waiting,
    })
    expect(ran).toEqual(['before'])
    const toolMessage = (result as { messages: Array<{ role: string }> }).messages.find(
      (message) => message.role === 'tool',
    )
    expect(JSON.stringify(toolMessage)).toContain('Not run: the user sent a message')
    expect(JSON.stringify(toolMessage)).toContain('[false,true,')
  })
})

import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai'
import { defineAgentTool, type AgentEvent } from '@localixai/agent/agents'

import { collect, scripted, scriptedBaseInput } from './__fixtures__/scripted-run'
import { createPiAgentRuntime } from './runtime'
import type { PiModelMiddleware } from './middleware'

/**
 * One end-to-end run of the assembled runtime, driven by a SCRIPT instead of a provider.
 *
 * Every other test here exercises a failure the runtime can detect before it streams
 * (duplicate dispatch tools, a bad buffer size) or one seam in isolation. Nothing drove the
 * whole thing — sample, dispatch a tool, feed the result back, sample again — so the path
 * every real turn takes had no test at all, and the seams verified individually had never
 * been verified composed.
 *
 * The script runs through `__fixtures__/scripted-run.ts`, the keyless seam other suites share.
 */

const echo = defineAgentTool({
  name: 'echo',
  description: 'echo',
  activeVerb: 'Echoing',
  inputSchema: z.object({ text: z.string().optional() }),
  execute: async (_id, input) => ({ content: `echoed:${input.text ?? ''}` }),
})

const baseInput = { ...scriptedBaseInput, tools: [echo], dispatchTools: [echo] }

describe('a scripted end-to-end run', () => {
  test('a later middleware failure retains the completed tool turn in the result', async () => {
    const script = scripted([
      fauxAssistantMessage([fauxToolCall('echo', { text: 'durable' }, { id: 'saved' })], {
        stopReason: 'toolUse',
      }),
    ])
    let requests = 0
    const failLater: PiModelMiddleware = {
      wrapStreamSimple: async ({ params, doStreamSimple }) => {
        if (++requests === 2) throw new Error('later request failed')
        return doStreamSimple(params)
      },
    }
    const run = createPiAgentRuntime().run({
      ...baseInput,
      middleware: [failLater, script.middleware],
    } as never)
    try {
      for await (const _event of run) {
        /* drain through the failure */
      }
    } catch {
      /* the result also exposes the failure */
    }
    const result = await run.result
    expect(result.terminal).toBe('failed')
    expect(result.messages.map((message) => message.role)).toEqual(['assistant', 'tool'])
    expect(JSON.stringify(result.messages)).toContain('echoed:durable')
  })

  test('Stop settles a run while an attached consumer is paused on a full queue', async () => {
    const script = scripted([fauxAssistantMessage('answer')])
    const run = createPiAgentRuntime({ maxBufferedEvents: 1 }).run({
      ...baseInput,
      middleware: [script.middleware],
    } as never)
    const iterator = run[Symbol.asyncIterator]()
    await iterator.next()
    await Bun.sleep(10)
    run.abort('stop')
    expect((await run.result).terminal).toBe('aborted')
    await iterator.return?.()
  })

  test('samples, dispatches the tool, feeds the result back, and answers', async () => {
    // The second response is a FACTORY so it can capture the context it was handed. Asserting
    // on the tool_execution_end event alone proves the tool ran, not that the MODEL saw its
    // output — those are different paths, and a mutation that redacted what the model sees
    // left an event-only assertion green.
    let secondSample: unknown
    const script = scripted([
      fauxAssistantMessage([fauxToolCall('echo', { text: 'hi' }, { id: 'call-1' })], {
        stopReason: 'toolUse',
      }),
      (context) => {
        secondSample = context.messages
        return fauxAssistantMessage('all done')
      },
    ])

    const { events, result } = await collect({ ...baseInput, middleware: script.middleware })

    expect(result.terminal).toBe('completed')
    // Two samples: the model had to see the tool result to write the answer.
    expect(script.callCount()).toBe(2)
    const kinds = events.map((event) => event.type)
    expect(kinds).toContain('tool_execution_start')
    expect(kinds).toContain('tool_execution_end')
    expect(kinds).toContain('agent_end')
    // The tool actually ran, and its content is what came back — not a placeholder.
    const end = events.find(
      (event): event is Extract<AgentEvent, { type: 'tool_execution_end' }> =>
        event.type === 'tool_execution_end',
    )
    expect(end?.result.content).toBe('echoed:hi')
    // The model's own next request carried the tool's output — this is what "feeds the result
    // back" means, and the only assertion here that a redaction between the two cannot pass.
    expect(JSON.stringify(secondSample)).toContain('echoed:hi')
    // And the final assistant text reached the agnostic result.
    expect(JSON.stringify(result.messages)).toContain('all done')
  })

  /**
   * The prompt and the tool roster travel IN the transcript.
   *
   * pi stopped carrying either as a request field: the run's instructions are the leading
   * system message, and the tools the model may call are declared on system messages as a
   * delta. Nothing in the host changed, so nothing in the host would have failed — the
   * prompt would simply have stopped reaching the provider, silently, on every run. This is
   * the assertion that would have caught it.
   */
  test('the system prompt and the tool roster reach the model as transcript messages', async () => {
    let sample: Array<{ role: string; content?: unknown; toolsAdded?: Array<{ name: string }> }> =
      []
    const script = scripted([
      (context) => {
        sample = context.messages as typeof sample
        return fauxAssistantMessage('read it')
      },
    ])

    const { result } = await collect({ ...baseInput, middleware: script.middleware })

    expect(result.terminal).toBe('completed')
    const system = sample.filter((message) => message.role === 'system')
    expect(JSON.stringify(system)).toContain('be brief')
    expect(system.flatMap((message) => message.toolsAdded ?? []).map((tool) => tool.name)).toEqual([
      'echo',
    ])
  })

  test('a turn with no tool call ends the run on one sample', async () => {
    const script = scripted([fauxAssistantMessage('nothing to do')])
    const { events, result } = await collect({ ...baseInput, middleware: script.middleware })

    expect(result.terminal).toBe('completed')
    expect(script.callCount()).toBe(1)
    expect(events.map((event) => event.type)).not.toContain('tool_execution_start')
  })

  test('the turn budget stops the loop rather than sampling forever', async () => {
    // A script that never stops asking for tools — the budget is what ends it, and this is
    // the composed version of what stop-conditions.test.ts checks in isolation.
    const script = scripted(
      Array.from({ length: 6 }, () =>
        fauxAssistantMessage([fauxToolCall('echo', {}, { id: 'loop' })], { stopReason: 'toolUse' }),
      ),
    )
    const { result } = await collect({ ...baseInput, maxTurns: 2, middleware: script.middleware })

    expect(result.terminal).toBe('completed')
    expect(result.stoppedBy).toBe('turnBudget')
    expect(script.callCount()).toBe(2)
  })
})

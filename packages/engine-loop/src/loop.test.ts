import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentMessage, type AgentTool } from '@localixai/agent/agents'
import type { ToolResultMessage } from '@localixai/agent'

import {
  call,
  collect,
  say,
  scriptedSession,
  types,
  last,
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

const stop = defineAgentTool({
  name: 'stop',
  description: 'End the turn.',
  activeVerb: 'Stopping',
  inputSchema: z.object({}),
  execute: async () => ({ content: 'stopped', terminate: true }),
}) as AgentTool

function start(steps: readonly ScriptStep[], input: Partial<LoopInput> = {}) {
  const { session, requests } = scriptedSession(steps)
  const run = runAgentLoop({
    sessionId: 's1',
    systemPrompt: 'be brief',
    messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
    tools: [echo, stop],
    session,
    ...input,
  })
  return { run, requests }
}

describe('a run of the loop', () => {
  test('samples, runs the tool, feeds its result back, and answers', async () => {
    const { run, requests } = start([call('echo', { text: 'x' }, 'c1'), say('done')])
    const { events, result } = await collect(run)

    expect(result).toMatchObject({ terminal: 'completed' })
    expect(types(events)).toEqual([
      'agent_start',
      'turn_start',
      'message_start',
      'message_update',
      'message_end',
      'tool_execution_start',
      'tool_execution_end',
      'message_start',
      'message_end',
      'turn_end',
      'turn_start',
      'message_start',
      'message_update',
      'message_end',
      'turn_end',
      'agent_end',
    ])
    expect(requests).toHaveLength(2)
    expect(requests[0]!.systemPrompt).toBe('be brief')
    expect(requests[0]!.tools.map((tool) => tool.name)).toEqual(['echo', 'stop'])
    const fed = last(requests[1]!.messages) as ToolResultMessage
    expect(fed.role).toBe('tool')
    expect(fed.results[0]).toMatchObject({ toolCallId: 'c1', toolName: 'echo' })
    expect(JSON.stringify(fed.results[0]!.content)).toContain('echo:x')
    // The result is everything the run added, in order: answer, result, answer.
    expect(
      (result as { messages: AgentMessage[] }).messages.map((message) => message.role),
    ).toEqual(['assistant', 'tool', 'assistant'])
    expect(last(events)).toMatchObject({ type: 'agent_end', stopReason: 'completed' })
  })

  test('a response with no tool call ends the run on one request', async () => {
    const { run, requests } = start([say('hello')])
    const { result } = await collect(run)
    expect(requests).toHaveLength(1)
    expect(result).toMatchObject({ terminal: 'completed' })
  })

  test('the turn budget stops a run that would need another request to read its tools', async () => {
    const { run, requests } = start([call('echo', { text: 'a' }), call('echo', { text: 'b' })], {
      maxTurns: 1,
    })
    const { events, result } = await collect(run)
    expect(requests).toHaveLength(1)
    expect(result).toMatchObject({ terminal: 'completed', stoppedBy: 'turnBudget' })
    expect(last(events)).toMatchObject({ type: 'agent_end', stopReason: 'max_turns' })
  })

  test('a final answer exactly at the budget is a natural end, not max_turns', async () => {
    const { run } = start([say('done')], { maxTurns: 1 })
    const { events, result } = await collect(run)
    expect(result).not.toHaveProperty('stoppedBy')
    expect(last(events)).toMatchObject({ stopReason: 'completed' })
  })

  test('only a batch whose every call terminates ends the run', async () => {
    const all = start([{ calls: [{ name: 'stop' }, { name: 'stop' }] }, say('never')])
    const ended = await collect(all.run)
    expect(all.requests).toHaveLength(1)
    expect(last(ended.events)).toMatchObject({ stopReason: 'tool_terminate' })

    const mixed = start([
      { calls: [{ name: 'stop' }, { name: 'echo', arguments: { text: 'x' } }] },
      say('read it'),
    ])
    const continued = await collect(mixed.run)
    expect(mixed.requests).toHaveLength(2)
    expect(last(continued.events)).toMatchObject({ stopReason: 'completed' })
  })

  test('host stop rules fire in order, and the first names the stop', async () => {
    const order: string[] = []
    const { run } = start([call('echo', { text: 'x' }), say('never')], {
      stopWhen: [
        { name: 'first', shouldStop: () => (order.push('first'), true) },
        { name: 'second', shouldStop: () => (order.push('second'), true) },
      ],
    })
    const { result } = await collect(run)
    expect(result).toMatchObject({ stoppedBy: 'first' })
    expect(order).toEqual(['first'])
  })

  test('calls of a response cut off by the output limit are refused, not run', async () => {
    let ran = false
    const guarded = defineAgentTool({
      ...echo,
      execute: async () => ((ran = true), { content: 'ran' }),
    }) as AgentTool
    const { run, requests } = start(
      [
        { calls: [{ name: 'echo', arguments: { text: 'x' } }], stopReason: 'max_tokens' },
        say('again'),
      ],
      { tools: [guarded] },
    )
    await collect(run)
    expect(ran).toBe(false)
    const fed = last(requests[1]!.messages) as ToolResultMessage
    expect(fed.results[0]!.isError).toBe(true)
    expect(JSON.stringify(fed.results[0]!.content)).toContain('output token limit')
  })

  test('a failed response fails the run with the provider error, keeping what came before', async () => {
    const { run } = start([call('echo', { text: 'x' }), { error: 'rate limited' }])
    const { events, result } = await collect(run)
    expect(result).toMatchObject({ terminal: 'failed' })
    expect((result as { error: Error }).error.message).toBe('rate limited')
    expect(last(events)).toMatchObject({ type: 'agent_end', stopReason: 'stream_error' })
    expect(
      (result as { messages: AgentMessage[] }).messages.map((message) => message.role),
    ).toEqual(['assistant', 'tool', 'assistant'])
  })

  test('stopping the run cancels the response in flight and settles as aborted', async () => {
    let inFlight!: () => void
    const reached = new Promise<void>((resolve) => (inFlight = resolve))
    const { run } = start([
      () => {
        inFlight()
        return { hold: true }
      },
    ])
    void reached.then(() => run.abort('stop'))
    const { result } = await collect(run)
    expect(result).toMatchObject({ terminal: 'aborted' })
  })

  test('stopping during a tool cancels the call, closes it with a result, and ends without sampling again', async () => {
    let toolSignal: AbortSignal | undefined
    let inTool!: () => void
    const toolStarted = new Promise<void>((resolve) => (inTool = resolve))
    const slow = defineAgentTool({
      name: 'slow',
      description: 'Takes its time.',
      activeVerb: 'Waiting',
      inputSchema: z.object({}),
      execute: (_id, _input, signal) =>
        new Promise((resolve) => {
          toolSignal = signal
          inTool()
          signal?.addEventListener('abort', () => resolve({ content: 'killed', isError: true }), {
            once: true,
          })
        }),
    }) as AgentTool
    const { run, requests } = start([call('slow', {}, 'c1'), say('never')], { tools: [slow] })
    void toolStarted.then(() => run.abort('stop'))
    const { events, result } = await collect(run)
    expect(toolSignal?.aborted).toBe(true)
    expect(result).toMatchObject({ terminal: 'aborted' })
    // The tool's own words stay; the call is marked cancelled, not done.
    expect(events.filter((event) => event.type === 'tool_execution_end')).toEqual([
      expect.objectContaining({
        result: expect.objectContaining({
          content: 'killed',
          isError: true,
          error: expect.objectContaining({ kind: 'aborted' }),
        }),
      }),
    ])
    expect(last(events)).toMatchObject({ type: 'agent_end', stopReason: 'aborted' })
    expect(requests).toHaveLength(1)
  })

  test('a tool that ignores the stop still leaves no call open', async () => {
    let inTool!: () => void
    const toolStarted = new Promise<void>((resolve) => (inTool = resolve))
    const stubborn = defineAgentTool({
      name: 'stubborn',
      description: 'Never returns.',
      activeVerb: 'Hanging',
      inputSchema: z.object({}),
      execute: () => {
        inTool()
        return new Promise(() => {})
      },
    }) as AgentTool
    const { run } = start([call('stubborn', {}, 'c1')], {
      tools: [stubborn],
      stopGraceMs: 20,
    })
    void toolStarted.then(() => run.abort('stop'))
    const { events, result } = await collect(run)
    expect(result).toMatchObject({ terminal: 'aborted' })
    expect(events.filter((event) => event.type === 'tool_execution_end')).toEqual([
      expect.objectContaining({
        toolCallId: 'c1',
        result: expect.objectContaining({
          isError: true,
          content: 'Cancelled: the run was stopped',
        }),
      }),
    ])
  })

  test('an activation reveals its tools to the next request; all stay callable throughout', async () => {
    const activate = defineAgentTool({
      name: 'activate',
      description: 'Activate tools.',
      activeVerb: 'Activating',
      inputSchema: z.object({}),
      activatesTools: true,
      execute: async () => ({ content: 'ok', details: { activated: ['echo', 'missing'] } }),
    }) as AgentTool
    const { run, requests } = start([call('activate'), say('done')], {
      tools: [activate],
      dispatchTools: [activate, echo],
    })
    await collect(run)
    expect(requests[0]!.tools.map((tool) => tool.name)).toEqual(['activate'])
    expect(requests[1]!.tools.map((tool) => tool.name)).toEqual(['activate', 'echo'])
  })

  test('the context policy shapes what the model reads, never what the run records', async () => {
    const { run, requests } = start([say('ok')], {
      contextPolicy: {
        transform: async (messages) => [
          ...messages,
          { role: 'user', content: 'reminder', timestamp: 1 },
        ],
      },
    })
    const { result } = await collect(run)
    expect(requests[0]!.messages.map((message) => message.role)).toEqual(['user', 'user'])
    expect((result as { messages: AgentMessage[] }).messages).toHaveLength(1)
  })

  test('history with an orphaned tool result is repaired before it reaches the model', async () => {
    const { run, requests } = start([say('ok')], {
      messages: [
        { role: 'user', content: 'hi', timestamp: 0 },
        {
          role: 'tool',
          results: [{ type: 'tool_result', toolCallId: 'ghost', toolName: 'echo', content: 'x' }],
          timestamp: 0,
        },
      ],
    })
    await collect(run)
    expect(requests[0]!.messages.map((message) => message.role)).toEqual(['user'])
  })

  test('duplicate tool names fail the run instead of dispatching an arbitrary one', async () => {
    const { run } = start([say('never')], { tools: [echo, echo] })
    const { events, result } = await collect(run)
    expect(result).toMatchObject({ terminal: 'failed' })
    expect(types(events)).toContain('error')
  })
})

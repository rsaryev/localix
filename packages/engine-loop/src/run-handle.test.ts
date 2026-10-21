import { describe, expect, test } from 'bun:test'
import type { AgentEvent } from '@localixai/agent/agents'

import { last } from './__fixtures__/scripted-session'
import { startRun } from './run-handle'

const update = (n: number): AgentEvent => ({
  type: 'tool_execution_update',
  toolCallId: 'c',
  details: { n },
})

describe('a run handle', () => {
  test('settles through its result, never by throwing from run(), on a bad buffer size', async () => {
    const run = startRun({ maxBufferedEvents: 0 }, async () => ({
      messages: [],
      terminal: 'completed',
    }))
    const result = await run.result
    expect(result.terminal).toBe('failed')
    expect(result.error?.message).toContain('maxBufferedEvents')
  })

  test('a run nobody watches still finishes: the oldest events give way', async () => {
    const run = startRun({ maxBufferedEvents: 2 }, async ({ emit }) => {
      for (let n = 0; n < 50; n++) await emit({ type: 'turn_start', turnIndex: n })
      return { messages: [], terminal: 'completed' }
    })
    expect((await run.result).terminal).toBe('completed')
  })

  test('stop settles the run while an attached consumer is paused on a full queue', async () => {
    let reached = 0
    const run = startRun({ maxBufferedEvents: 1 }, async ({ emit, signal }) => {
      while (!signal.aborted) {
        await emit({ type: 'turn_start', turnIndex: reached++ })
      }
      return { messages: [], terminal: 'aborted' }
    })
    const iterator = run[Symbol.asyncIterator]()
    await iterator.next()
    await Bun.sleep(10)
    run.abort('stop')
    expect((await run.result).terminal).toBe('aborted')
  })

  test('progress snapshots for one call coalesce; lifecycle events are never dropped', async () => {
    const run = startRun({ maxBufferedEvents: 4 }, async ({ emit }) => {
      await emit({ type: 'tool_execution_start', toolCallId: 'c', toolName: 't', input: {} })
      for (let n = 0; n < 100; n++) void emit(update(n))
      await emit({
        type: 'tool_execution_end',
        toolCallId: 'c',
        toolName: 't',
        result: { content: 'ok' },
      })
      return { messages: [], terminal: 'completed' }
    })
    const events: AgentEvent[] = []
    for await (const event of run) {
      events.push(event)
      await Bun.sleep(1)
    }
    expect(events[0]!.type).toBe('tool_execution_start')
    expect(last(events)!.type).toBe('tool_execution_end')
    const updates = events.filter((event) => event.type === 'tool_execution_update')
    expect(updates.length).toBeLessThan(10)
    expect(last(updates)).toMatchObject({ details: { n: 99 } })
  })

  test('a body that throws becomes an error event and a failed result with only settled messages', async () => {
    const run = startRun({}, async ({ transcript }) => {
      transcript.messages.push({ role: 'user', content: 'kept', timestamp: 0 })
      transcript.settled = 1
      transcript.messages.push({ role: 'user', content: 'dropped', timestamp: 0 })
      throw new Error('boom')
    })
    const events: AgentEvent[] = []
    await expect(
      (async () => {
        for await (const event of run) events.push(event)
      })(),
    ).rejects.toThrow('boom')
    const result = await run.result
    expect(result).toMatchObject({ terminal: 'failed', messages: [{ content: 'kept' }] })
    expect(events.map((event) => event.type)).toEqual(['error'])
  })

  test('a body that throws stops what it left running', async () => {
    let sibling: AbortSignal | undefined
    const run = startRun({}, async ({ signal }) => {
      sibling = signal
      throw new Error('contextPolicy failed')
    })
    const result = await run.result
    expect(result.terminal).toBe('failed')
    expect(sibling?.aborted).toBe(true)
    await expect(
      (async () => {
        for await (const _event of run) {
          // drain
        }
      })(),
    ).rejects.toThrow('contextPolicy failed')
  })
})

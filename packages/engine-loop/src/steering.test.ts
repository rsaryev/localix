/**
 * Steering and follow-ups: what a host hands the loop mid-run reaches the model in the NEXT
 * request of the same run, after the tool pair it interrupts, and only once the host has handled
 * every event before it.
 */
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentMessage, type AgentTool } from '@localixai/agent/agents'
import type { SteeringBoundary } from '@localixai/agent/runtime'

import {
  call,
  collect,
  say,
  scriptedSession,
  last,
  type ScriptStep,
} from './__fixtures__/scripted-session'
import { runAgentLoop } from './index'
import type { LoopInput } from './loop'

const steer = (content: string): AgentMessage => ({ role: 'user', content, timestamp: 0 })

function work(onRun: () => void = () => {}) {
  return defineAgentTool({
    name: 'work',
    description: 'work',
    activeVerb: 'Working',
    inputSchema: z.object({}),
    execute: async () => (onRun(), { content: 'work done' }),
  }) as AgentTool
}

function start(steps: readonly ScriptStep[], input: Partial<LoopInput>) {
  const { session, requests } = scriptedSession(steps)
  const run = runAgentLoop({
    sessionId: 's',
    systemPrompt: 'p',
    messages: [{ role: 'user', content: 'start work', timestamp: 0 }],
    tools: [work()],
    session,
    ...input,
  })
  return { run, requests }
}

describe('takeSteering reaches the model inside the same run', () => {
  test('a steer that appears during a tool call is the last message of the next request', async () => {
    let pending: string | undefined
    const { run, requests } = start([call('work'), say('acknowledged')], {
      tools: [work(() => (pending = 'focus on the invariant'))],
      takeSteering: () => {
        const next = pending
        pending = undefined
        return next ? [steer(next)] : []
      },
    })
    const { result } = await collect(run)
    expect(result).toMatchObject({ terminal: 'completed' })
    expect(requests[1]!.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'user',
    ])
    expect(JSON.stringify(last(requests[1]!.messages))).toContain('focus on the invariant')
  })

  test('the loop asks before the first request, and keeps going while a taker answers', async () => {
    let asks = 0
    const { run, requests } = start([say('done'), say('done again')], {
      takeSteering: () => (++asks === 1 ? [steer('first')] : asks === 2 ? [steer('second')] : []),
    })
    await collect(run)
    expect(JSON.stringify(last(requests[0]!.messages))).toContain('first')
    expect(JSON.stringify(last(requests[1]!.messages))).toContain('second')
    expect(requests).toHaveLength(2)
  })

  test('the boundary names the last settled turn, and its tool turn only after a tool batch', async () => {
    const seen: SteeringBoundary[] = []
    const { run } = start([call('work'), say('done')], {
      takeSteering: (boundary) => (seen.push({ ...boundary }), []),
    })
    await collect(run)
    expect(seen[0]).toEqual({})
    expect(seen[1]).toEqual({ completedTurnIndex: 0, completedToolTurnIndex: 0 })
    expect(last(seen)).toEqual({ completedTurnIndex: 1, completedToolTurnIndex: undefined })
  })

  test('the taker runs only once the host has handled every event before it', async () => {
    let handledTurnEnds = 0
    const observed: number[] = []
    const { run } = start([call('work'), say('done')], {
      takeSteering: () => (observed.push(handledTurnEnds), []),
    })
    // A slow consumer: each event takes time to handle, as persistence does in the host.
    for await (const event of run) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (event.type === 'turn_end') handledTurnEnds += 1
    }
    // Asked before the first request and once after each turn's end — never twice at one
    // boundary — and every time the host had already handled each turn_end emitted so far.
    expect(observed).toEqual([0, 1, 2])
  })

  test('waits for a host however slow it is, and not at all once the run is stopped', async () => {
    const observed: number[] = []
    let handledTurnEnds = 0
    let release: () => void = () => {}
    const { run } = start([call('work'), say('done')], {
      takeSteering: () => (observed.push(handledTurnEnds), []),
    })
    const consumed = (async () => {
      for await (const event of run) {
        if (event.type !== 'turn_end') continue
        // The host holds this event until the test lets it go: no timer of the loop's ends it.
        await new Promise<void>((resolve) => (release = resolve))
        handledTurnEnds += 1
      }
    })()
    for (const expected of [[0], [0, 1]]) {
      await Bun.sleep(60)
      expect(observed).toEqual(expected)
      release()
    }
    await consumed
    expect(observed).toEqual([0, 1, 2])

    const asked: number[] = []
    const stopped = start([call('work'), say('done')], { takeSteering: () => (asked.push(1), []) })
    setTimeout(() => stopped.run.abort('stop'), 5)
    for await (const event of stopped.run) {
      if (event.type === 'turn_end') await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect((await stopped.run.result).terminal).toBe('aborted')
    expect(asked.length).toBeLessThanOrEqual(1)
  })

  test('a waiting message defers the calls that have not started', async () => {
    let ran = 0
    let waiting = false
    const tool = work(() => {
      ran += 1
      waiting = true
    })
    const { run, requests } = start(
      [{ calls: [{ name: 'work' }, { name: 'work' }] }, say('read it')],
      {
        tools: [tool],
        shouldDeferToolCalls: () => waiting,
        takeSteering: () => (waiting ? ((waiting = false), [steer('stop that')]) : []),
      },
    )
    await collect(run)
    expect(ran).toBe(1)
    const second = requests[1]!.messages
    expect(JSON.stringify(second)).toContain('Not run: the user sent a message')
    expect(JSON.stringify(last(second))).toContain('stop that')
  })
})

describe('takeFollowUp reaches the model before the run can finish', () => {
  test('a follow-up opens one more request, and the run ends when the taker runs dry', async () => {
    let followUps = 1
    const { run, requests } = start([say('first answer'), say('repaired')], {
      takeFollowUp: () => (followUps-- > 0 ? [steer('answer in the protocol')] : []),
    })
    const { result } = await collect(run)
    expect(requests).toHaveLength(2)
    expect(JSON.stringify(last(requests[1]!.messages))).toContain('answer in the protocol')
    expect(result).toMatchObject({ terminal: 'completed' })
  })
})

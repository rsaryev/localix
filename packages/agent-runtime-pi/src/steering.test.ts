/**
 * THE STEERING SEAM, proven where it actually lives.
 *
 * `AgentRuntimeRunInput.takeSteering` is a host promise with a provider-side meaning: whatever
 * it returns must reach the model as its own message in the NEXT request of the same run —
 * not the next run. That is what lets a user interject mid-turn without the queue starting a
 * second run, and it is the only reason the wake queue's steerable band exists.
 *
 * The host cannot prove it. The host can only prove that it hands the text over; whether the
 * loop asks at a turn boundary and whether the answer is placed before the next sample are
 * facts about the ADAPTER, so the assertion belongs here — driven by a script rather than a
 * provider (`runtime-scripted.test.ts` explains that seam), through the public port.
 *
 * The durable half — the queued row, its lease, the compact barrier behind it — is
 * `apps/api/.../run/steering-durable-queue.test.ts`, which drives this same port with a fake
 * runtime. Together the two cover the path; neither needs the other's dependencies.
 */
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai'
import { defineAgentTool, type AgentEvent, type AgentMessage } from '@localixai/agent/agents'
import type { SteeringBoundary } from '@localixai/agent'

import { createPiAgentRuntime } from './runtime'
import type { PiModelMiddleware } from './middleware'

function scripted(responses: Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0]) {
  const faux = fauxProvider()
  faux.setResponses(responses)
  const middleware: PiModelMiddleware = {
    wrapStreamSimple: async ({ params }) =>
      faux.provider.streamSimple(faux.getModel(), params.context, params.options),
  }
  return { middleware, callCount: () => faux.state.callCount }
}

/**
 * The CONVERSATIONAL roles of one sampled request.
 *
 * pi writes system messages of its own into the transcript — the run's prompt, and a tool
 * declaration whenever the roster changes — so a raw role list pins pi's bookkeeping rather
 * than the thing these cases are about: where a steer lands relative to the tool pair. The
 * declarations are asserted once, in `runtime-scripted.test.ts`, where they are the subject.
 */
function conversationalRoles(sample: unknown): string[] {
  return (sample as Array<{ role: string }>)
    .map((message) => message.role)
    .filter((role) => role !== 'system')
}

/** The tool stands in for the real one: work that makes a steer available while it runs. */
function workTool(onRun: () => void) {
  return defineAgentTool({
    name: 'work',
    description: 'work',
    activeVerb: 'Working',
    inputSchema: z.object({}),
    execute: async () => {
      onRun()
      return { content: 'work done' }
    },
  })
}

function baseInput(tool: ReturnType<typeof workTool>) {
  return {
    sessionId: 'steering-run',
    systemPrompt: 'be brief',
    messages: [{ role: 'user' as const, content: 'start work' }],
    model: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
    credential: { type: 'api-key' as const, key: 'unused' },
    tools: [tool],
    dispatchTools: [tool],
  }
}

async function collect(input: Record<string, unknown> & { middleware: PiModelMiddleware }) {
  const { middleware, ...rest } = input
  const run = createPiAgentRuntime().run({ ...rest, middleware: [middleware] } as never)
  const events: AgentEvent[] = []
  for await (const event of run) events.push(event)
  return { events, result: await run.result }
}

const steer = (content: string): AgentMessage =>
  ({ role: 'user', content, timestamp: 0 }) as AgentMessage

describe('takeSteering reaches the model inside the same run', () => {
  test('a steer that appears DURING the tool call is the last message of the next request', async () => {
    let secondSample: unknown
    const script = scripted([
      fauxAssistantMessage([fauxToolCall('work', {}, { id: 'call-1' })], { stopReason: 'toolUse' }),
      (context) => {
        secondSample = context.messages
        return fauxAssistantMessage('acknowledged')
      },
    ])
    // The steer exists only once the tool has run — exactly the host's shape, where the row is
    // enqueued mid-turn and the taker has nothing to hand over before that.
    let pending: string | undefined
    const tool = workTool(() => {
      pending = 'focus on the queue invariant'
    })
    const { result } = await collect({
      ...baseInput(tool),
      middleware: script.middleware,
      takeSteering: () => {
        const next = pending
        pending = undefined
        return next ? [steer(next)] : []
      },
    })

    expect(result.terminal).toBe('completed')
    expect(script.callCount()).toBe(2)

    const roles = conversationalRoles(secondSample)
    // The tool pair is intact and the steer sits AFTER it: the model reads the interjection as
    // the newest thing said, not as something that predates its own work.
    expect(roles).toEqual(['user', 'assistant', 'toolResult', 'user'])
    const messages = secondSample as unknown[]
    expect(JSON.stringify(messages[messages.length - 1])).toContain('focus on the queue invariant')
  })

  test('the loop asks BEFORE the first sample, and keeps going while a taker answers', async () => {
    // Measured, not assumed. Two facts a host taker has to be built for:
    //   1. the first ask happens before the model has said anything, so a taker that answered
    //      unconditionally would inject a message ahead of the run's own opening turn;
    //   2. a pending steer makes the loop repeat, so a taker that never runs dry never lets the
    //      run finish — it exhausts the provider instead.
    // The host's taker is queue-backed and returns nothing when the queue is empty, which is
    // what makes it safe; this pins the adapter behaviour that requires it.
    let firstSample: unknown
    const script = scripted([
      (context) => {
        firstSample = context.messages
        return fauxAssistantMessage('done')
      },
      fauxAssistantMessage('done again'),
    ])
    let asked = 0
    const { result } = await collect({
      ...baseInput(workTool(() => {})),
      middleware: script.middleware,
      // Answers twice, then runs dry — an unbounded taker would outlive the script.
      takeSteering: () => (++asked <= 2 ? [steer('always talking')] : []),
    })

    expect(result.terminal).toBe('completed')
    expect(asked).toBeGreaterThan(2)
    // The taker's message landed before the model's first turn.
    expect(conversationalRoles(firstSample)).toEqual(['user', 'user'])
    // And each answered ask cost another sample: steering keeps the SAME run alive.
    expect(script.callCount()).toBe(2)
  })

  test('a taker that returns nothing changes neither the request nor the turn count', async () => {
    let secondSample: unknown
    const script = scripted([
      fauxAssistantMessage([fauxToolCall('work', {}, { id: 'call-1' })], { stopReason: 'toolUse' }),
      (context) => {
        secondSample = context.messages
        return fauxAssistantMessage('done')
      },
    ])
    const { result } = await collect({
      ...baseInput(workTool(() => {})),
      middleware: script.middleware,
      takeSteering: () => [],
    })

    expect(result.terminal).toBe('completed')
    expect(conversationalRoles(secondSample)).toEqual(['user', 'assistant', 'toolResult'])
  })

  test('reports a completed tool seam only after the tool batch, never before the first sample', async () => {
    const boundaries: Array<number | undefined> = []
    const completedTurns: Array<number | undefined> = []
    const script = scripted([
      fauxAssistantMessage([fauxToolCall('work', {}, { id: 'call-1' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('done'),
    ])
    const { result } = await collect({
      ...baseInput(workTool(() => {})),
      middleware: script.middleware,
      takeSteering: (boundary?: SteeringBoundary) => {
        boundaries.push(boundary?.completedToolTurnIndex)
        completedTurns.push(boundary?.completedTurnIndex)
        return []
      },
    })

    expect(result.terminal).toBe('completed')
    expect(boundaries[0]).toBeUndefined()
    expect(boundaries).toContain(0)
    expect(completedTurns).toContain(1)
    expect(completedTurns[0]).toBeUndefined()
  })

  test('without a taker the run is byte-identical — steering is opt-in', async () => {
    let sample: unknown
    const script = scripted([
      fauxAssistantMessage([fauxToolCall('work', {}, { id: 'call-1' })], { stopReason: 'toolUse' }),
      (context) => {
        sample = context.messages
        return fauxAssistantMessage('done')
      },
    ])
    const { result } = await collect({
      ...baseInput(workTool(() => {})),
      middleware: script.middleware,
    })

    expect(result.terminal).toBe('completed')
    expect(conversationalRoles(sample)).toEqual(['user', 'assistant', 'toolResult'])
  })
})

describe('takeFollowUp reaches the model before the run can finish', () => {
  test('a protocol repair opens one more sample and then stops when the taker runs dry', async () => {
    let secondSample: unknown
    const script = scripted([
      fauxAssistantMessage('public answer without the terminal tool'),
      (context) => {
        secondSample = context.messages
        return fauxAssistantMessage('protocol repaired')
      },
    ])
    let asked = 0
    const { result } = await collect({
      ...baseInput(workTool(() => {})),
      middleware: script.middleware,
      takeFollowUp: () => (++asked === 1 ? [steer('call acknowledge now')] : []),
    })

    expect(result.terminal).toBe('completed')
    expect(script.callCount()).toBe(2)
    expect(conversationalRoles(secondSample)).toEqual(['user', 'assistant', 'user'])
    expect(JSON.stringify(secondSample)).toContain('call acknowledge now')
  })
})

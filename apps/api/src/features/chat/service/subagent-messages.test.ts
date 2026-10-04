import { afterEach, describe, expect, test } from 'bun:test'

import { ApiError } from '../../../lib/errors'
import { sessionFixture } from '../../../testing/session-fixture'
import { __resetDelegationLanes, releaseLane, requestLane } from '../../agent-core/delegation-lanes'
import { __resetExpectedReports, takeExpectedReport } from '../../agent-core/delegation-awaits'
import {
  __resetWaitingMessages,
  discardWaitingMessages,
  flushWaitingMessages,
  messageSubagent,
} from './subagent-messages'

afterEach(() => {
  __resetDelegationLanes()
  __resetWaitingMessages()
  __resetExpectedReports()
})

const child = sessionFixture({
  id: 'child',
  sessionKind: 'subagent',
  parentSessionId: 'root',
  provenance: { kind: 'task-delegation', parentSessionId: 'root', toolCallId: 'tc' },
})

function host(
  opts: {
    busy?: boolean | (() => boolean)
    session?: typeof child | 'missing'
    onStop?: () => void
  } = {},
) {
  const woken: Array<{ content: string; source?: string; internal?: boolean }> = []
  const stopped: string[] = []
  const patches: unknown[] = []
  const ctx = {
    requireSession: async () => {
      if (opts.session === 'missing') throw new ApiError(404, 'session_not_found', 'gone')
      return opts.session ?? child
    },
    runner: {
      isBusy: () => (typeof opts.busy === 'function' ? opts.busy() : (opts.busy ?? false)),
      wake: async (params: { content: string }) => void woken.push(params),
      stop: async () => {
        stopped.push('child')
        opts.onStop?.()
        return true
      },
    },
    repo: {
      updateSession: async (_u: string, _id: string, patch: { provenance?: unknown }) =>
        void patches.push(patch.provenance),
    },
  }
  return { ctx: ctx as never, woken, stopped, patches }
}

/** Three other children of the same parent hold every lane. */
const fillLanes = () => {
  for (const sibling of ['s1', 's2', 's3']) requestLane('root', sibling, () => {})
}

describe('a delegator message to its child', () => {
  test('joins a running child at its next step — it already holds a lane', async () => {
    const h = host({ busy: true })
    expect(await messageSubagent(h.ctx, 'u', 'child', 'use /v2')).toEqual({
      delivered: true,
      state: 'running',
    })
    expect(h.woken).toMatchObject([{ source: 'delegator', internal: true }])
    // Framed once where queued: the same text may open a run instead, and must read the same.
    expect(h.woken[0]!.content).toContain('<delegator_message>use /v2</delegator_message>')
  })

  test('starts a finished child at once when a lane is free', async () => {
    const h = host()
    expect(await messageSubagent(h.ctx, 'u', 'child', 'now add tests')).toEqual({
      delivered: true,
      state: 'started',
    })
    expect(h.woken).toHaveLength(1)
  })

  test('waits its turn when every lane is taken, and runs when one frees — no error', async () => {
    const h = host()
    fillLanes()
    expect(await messageSubagent(h.ctx, 'u', 'child', 'now add tests')).toEqual({
      delivered: true,
      state: 'queued',
      position: 1,
    })
    expect(h.woken).toEqual([])
    releaseLane('s2')
    expect(h.woken).toHaveLength(1)
  })

  test('several messages that waited together open ONE run, in the order they were sent', async () => {
    const h = host()
    fillLanes()
    await messageSubagent(h.ctx, 'u', 'child', 'first')
    await messageSubagent(h.ctx, 'u', 'child', 'second')
    releaseLane('s1')
    expect(h.woken).toHaveLength(1)
    const content = h.woken[0]!.content
    expect(content.indexOf('first')).toBeLessThan(content.indexOf('second'))
  })

  test('messages sent while its lane is granted but its run not yet started wait for that run to end', async () => {
    // Waking the queue then would start a second run beside the one about to begin.
    const h = host()
    requestLane('root', 'child', () => {})
    expect(await messageSubagent(h.ctx, 'u', 'child', 'late brief')).toMatchObject({
      state: 'queued',
    })
    expect(h.woken).toEqual([])
    releaseLane('child')
    await flushWaitingMessages(h.ctx, 'u', 'child')
    expect(h.woken).toHaveLength(1)
  })

  test('a closed child is refused, and anything it was waiting to read is dropped', async () => {
    const h = host({ session: { ...child, closedAt: '2026-10-01T00:00:00.000Z' } })
    expect(await messageSubagent(h.ctx, 'u', 'child', 'hello?')).toEqual({
      delivered: false,
      reason: 'closed',
    })
    const open = host()
    fillLanes()
    await messageSubagent(open.ctx, 'u', 'child', 'never read')
    expect(discardWaitingMessages('child')).toBe(1)
  })

  test('is refused for anything that is not a sub-agent, and answers gone for a missing one', async () => {
    expect(
      await messageSubagent(
        host({ session: sessionFixture({ id: 'chat' }) }).ctx,
        'u',
        'chat',
        'x',
      ),
    ).toEqual({ delivered: false, reason: 'not-subagent' })
    expect(await messageSubagent(host({ session: 'missing' }).ctx, 'u', 'child', 'x')).toEqual({
      delivered: false,
      reason: 'gone',
    })
  })
})

describe('priority and interrupt', () => {
  const urgentChild = {
    ...child,
    provenance: { ...child.provenance, priority: 'low' as const },
  } as typeof child

  test('a waiting message queues at the priority the task was delegated with', async () => {
    fillLanes()
    requestLane('root', 'normal-sibling', () => {}, 'normal')
    const h = host({ session: urgentChild })
    expect(await messageSubagent(h.ctx, 'u', 'child', 'later')).toMatchObject({
      state: 'queued',
      position: 2,
    })
    expect(h.patches).toEqual([])
  })

  test('a message that names a priority replaces the task priority and requeues by it', async () => {
    fillLanes()
    requestLane('root', 'normal-sibling', () => {}, 'normal')
    const h = host({ session: urgentChild })
    expect(await messageSubagent(h.ctx, 'u', 'child', 'now', 'high')).toMatchObject({
      state: 'queued',
      position: 1,
    })
    // Kept for the child's later runs too — the delegator restated how urgent the work is.
    expect(h.patches).toMatchObject([{ kind: 'task-delegation', priority: 'high' }])
  })

  test('interrupt stops the running child and holds the message for the run that follows', async () => {
    const h = host({ busy: true })
    expect(await messageSubagent(h.ctx, 'u', 'child', 'wrong file', undefined, true)).toEqual({
      delivered: true,
      state: 'interrupted',
    })
    expect(h.stopped).toEqual(['child'])
    // Not injected into the run being stopped: it opens the next one, from the run's end.
    expect(h.woken).toEqual([])
    expect(discardWaitingMessages('child')).toBe(1)
  })

  test('a run that ended on its own just before the interrupt: the message starts the next run anyway', async () => {
    // Its end passed the seam before the mark existed, so nothing else would ever consume the mark
    // (it would swallow the next run's report) or start the held message.
    let busy = true
    const h = host({
      busy: () => busy,
      onStop: () => {
        busy = false
      },
    })
    await messageSubagent(h.ctx, 'u', 'child', 'redirect', undefined, true)
    expect(h.woken).toHaveLength(1)
    // A second flush — the run's own end arriving late — finds nothing left to start.
    await flushWaitingMessages(h.ctx, 'u', 'child')
    expect(h.woken).toHaveLength(1)
  })

  test('every delivered message makes the delegator wait for the run that answers it', async () => {
    // Even a run a person started: the delegator asked something, and that run owes the answer.
    for (const busy of [true, false]) {
      const h = host({ busy })
      await messageSubagent(h.ctx, 'u', 'child', 'and the tests?')
      expect(takeExpectedReport('child')).toBe(true)
    }
    // Refused messages ask nothing.
    await messageSubagent(host({ session: { ...child, closedAt: 'x' } }).ctx, 'u', 'child', 'hi')
    expect(takeExpectedReport('child')).toBe(false)
  })

  test('interrupt on an idle child is just a message — there is nothing to stop', async () => {
    const h = host({ busy: false })
    expect(await messageSubagent(h.ctx, 'u', 'child', 'go', undefined, true)).toEqual({
      delivered: true,
      state: 'started',
    })
    expect(h.stopped).toEqual([])
  })
})

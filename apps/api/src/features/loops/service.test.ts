import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { flush, triggerHarness } from '../triggers/test-harness'
import { sessionCooldownUntil } from '../chat/runtime/session-route-cooldown'
import { createRouteCooldowns, type RouteCooldowns } from '../chat/runtime/route-cooldowns'
import { createLoopAction, type LoopActionDeps } from './action'
import type { LoopFireOutcome, SessionLoop } from './contracts'
import { createLoopService } from './service'

type Harness = Awaited<ReturnType<typeof triggerHarness>>
let h: Harness

/**
 * A conversation gated through the runner's own composition (`sessionCooldownUntil` over
 * `createRouteCooldowns`) rather than a stub — so a gate that asked about the wrong route would
 * go red here.
 */
const ROUTE_LEAD = { providerConnectionId: 'conn-anthropic', modelId: 'anthropic/claude' }
const ROUTE_OTHER = { providerConnectionId: 'conn-openai', modelId: 'openai/gpt-5' }
const sessionOn = (route: typeof ROUTE_LEAD) => ({
  agent: { agentId: 'lead', name: 'lead', reasoningEffort: 'medium' as const, ...route },
})
const routeGate =
  (cooldowns: RouteCooldowns, route = ROUTE_LEAD) =>
  async () =>
    sessionCooldownUntil(sessionOn(route), (r) => cooldowns.until(r, h.clock.ms))

/** A loop service on the real trigger engine; deliveries are recorded and settled by hand. */
function loopHarness(
  opts: {
    busy?: boolean
    rateLimitedUntilMs?: LoopActionDeps['rateLimitedUntilMs']
  } = {},
) {
  const woken: Array<{
    loop: SessionLoop
    deliveryKey: string
    settle: (o: LoopFireOutcome) => void
  }> = []
  const withdrawn: string[] = []
  const action = createLoopAction({
    isSessionBusy: () => opts.busy === true,
    rateLimitedUntilMs: opts.rateLimitedUntilMs ?? (async () => null),
    now: () => h.clock.ms,
    wakeSession: (loop, wake) =>
      new Promise((settle) => woken.push({ loop, deliveryKey: wake.deliveryKey, settle })),
    runSubsession: async () => ({ ok: true }),
  })
  const engine = h.engine({ actions: [action] })
  const loops = createLoopService({
    triggers: engine,
    cancelWake: async (_user, _session, deliveryKey) => {
      withdrawn.push(deliveryKey)
    },
  })
  return { engine, loops, woken, withdrawn }
}

const created = (result: SessionLoop | { error: string }) => {
  if ('error' in result) throw new Error(result.error)
  return result
}

beforeEach(async () => {
  h = await triggerHarness()
})
afterEach(() => h.close())

describe('loops on triggers', () => {
  test('cancelling a firing loop withdraws ITS wake — and a quiet loop withdraws nothing', async () => {
    // It used to stop the whole session: every agent's queued turns, and sub-agents the
    // loop had nothing to do with.
    const { engine, loops, withdrawn } = loopHarness()
    const quiet = created(
      await loops.create({ userId: 'u1', sessionId: 's1', cron: '0 * * * *', prompt: 'a' }),
    )
    const busy = created(
      await loops.create({ userId: 'u1', sessionId: 's1', cron: '*/5 * * * *', prompt: 'b' }),
    )
    await h.advanceTo('2026-09-23T10:05:00.000Z', engine)

    expect(await loops.cancel(quiet.id, 'u1')).toBe(true)
    expect(await loops.cancel(busy.id, 'u1')).toBe(true)
    expect(withdrawn).toEqual([`trg:${busy.id}:1`])
    expect(loops.list('u1', 's1')).toEqual([])
  })

  test("a fire is addressed to the agent that armed it, with the fire's delivery key", async () => {
    const { engine, loops, woken } = loopHarness()
    const loop = created(
      await loops.create({
        userId: 'u1',
        sessionId: 's1',
        cron: '*/5 * * * *',
        prompt: 'review',
        ownerAgentId: 'qa',
      }),
    )
    await h.advanceTo('2026-09-23T10:05:00.000Z', engine)
    expect(woken.map((wake) => [wake.loop.ownerAgentId, wake.deliveryKey])).toEqual([
      ['qa', `trg:${loop.id}:1`],
    ])
  })

  test('a dynamic loop starts armed at the longest delay and is paced by reschedule', async () => {
    const { loops } = loopHarness()
    const loop = created(
      await loops.createDynamic({ userId: 'u1', sessionId: 's1', prompt: 'poll' }),
    )
    expect(loop.nextRunAt).toBe('2026-09-23T11:00:00.000Z')
    const paced = await loops.reschedule(loop.id, 'u1', 5)
    expect(paced).toMatchObject({
      appliedSeconds: 60,
      loop: { nextRunAt: '2026-09-23T10:01:00.000Z' },
    })
  })

  test('the shape rules hold: a fixed loop is not rescheduled, a dynamic one cannot move to a subsession', async () => {
    const { loops } = loopHarness()
    const fixed = created(
      await loops.create({ userId: 'u1', sessionId: 's1', cron: '0 9 * * *', prompt: 'a' }),
    )
    const dynamic = created(
      await loops.createDynamic({ userId: 'u1', sessionId: 's1', prompt: 'b' }),
    )
    expect(await loops.reschedule(fixed.id, 'u1', 300)).toEqual({
      error: `Loop ${fixed.id} is a fixed loop — it cannot be rescheduled.`,
    })
    expect(await loops.update(dynamic.id, 'u1', { target: 'subsession' })).toMatchObject({
      error: expect.stringContaining('give it a cron cadence'),
    })
    // A cadence converts it, and then the move is allowed.
    expect(
      created(await loops.update(dynamic.id, 'u1', { cron: '*/10 * * * *', target: 'subsession' })),
    ).toMatchObject({ kind: 'fixed', target: 'subsession', cron: '*/10 * * * *' })
  })

  test("another user's loop is invisible and untouchable", async () => {
    const { loops } = loopHarness()
    const loop = created(
      await loops.create({ userId: 'u1', sessionId: 's1', cron: '0 9 * * *', prompt: 'a' }),
    )
    expect(loops.get(loop.id, 'u2')).toBeUndefined()
    expect(await loops.cancel(loop.id, 'u2')).toBe(false)
    expect(loops.list('u2')).toEqual([])
  })

  test('a busy session gives up a fixed slot but holds a dynamic fire until it frees up', async () => {
    const { engine, loops, woken } = loopHarness({ busy: true })
    created(
      await loops.create({ userId: 'u1', sessionId: 's1', cron: '*/5 * * * *', prompt: 'fixed' }),
    )
    const dynamic = created(
      await loops.createDynamic({ userId: 'u1', sessionId: 's1', prompt: 'dyn' }),
    )
    await loops.reschedule(dynamic.id, 'u1', 60)
    await h.advanceTo('2026-09-23T10:05:00.000Z', engine)
    expect(woken).toEqual([])
    expect(engine.get(dynamic.id)).toMatchObject({ state: 'held', holdReason: 'busy' })
    await flush()
  })
})

describe('a rate-limit hold follows the agent’s route', () => {
  const HELD_UNTIL = '2026-09-23T10:30:00.000Z'
  const exhaustLead = () => {
    const cooldowns = createRouteCooldowns()
    cooldowns.hold(ROUTE_LEAD, 'route', Date.parse(HELD_UNTIL))
    return cooldowns
  }
  const pacedLoop = async (loops: ReturnType<typeof loopHarness>['loops']) => {
    const loop = created(
      await loops.createDynamic({ userId: 'u1', sessionId: 's1', prompt: 'poll' }),
    )
    await loops.reschedule(loop.id, 'u1', 60)
    return loop
  }

  test('a 429 on another route does not hold the fire', async () => {
    const { engine, loops, woken } = loopHarness({
      rateLimitedUntilMs: routeGate(exhaustLead(), ROUTE_OTHER),
    })
    const loop = await pacedLoop(loops)
    await h.advanceTo('2026-09-23T10:01:00.000Z', engine)
    expect(woken.map((wake) => wake.loop.id)).toEqual([loop.id])
  })

  test('a fire on the exhausted route is held until it recovers', async () => {
    const { engine, loops, woken } = loopHarness({ rateLimitedUntilMs: routeGate(exhaustLead()) })
    const lead = await pacedLoop(loops)
    await h.advanceTo('2026-09-23T10:01:00.000Z', engine)
    expect(woken).toEqual([])
    expect(engine.get(lead.id)).toMatchObject({
      state: 'held',
      holdReason: 'rate-limited',
      nextDueAt: HELD_UNTIL,
    })
    // What the strip shows is the hold the gate placed, not a session-wide guess.
    expect(loops.get(lead.id, 'u1')?.heldUntil).toBe(HELD_UNTIL)
  })

  test('the hold survives a restart that forgot every cooldown, and lapses on time', async () => {
    const first = loopHarness({ rateLimitedUntilMs: routeGate(exhaustLead()) })
    const lead = await pacedLoop(first.loops)
    await h.advanceTo('2026-09-23T10:01:00.000Z', first.engine)

    // A new process: the in-memory cooldowns are gone, the persisted hold is not.
    h.deadlines.clear()
    const second = loopHarness({ rateLimitedUntilMs: routeGate(createRouteCooldowns()) })
    await second.engine.hydrate()
    await second.engine.start()
    expect(second.loops.get(lead.id, 'u1')?.heldUntil).toBe(HELD_UNTIL)
    await h.advanceTo('2026-09-23T10:10:00.000Z', second.engine)
    expect(second.woken).toEqual([])
    await h.advanceTo(HELD_UNTIL, second.engine)
    expect(second.woken.map((wake) => wake.loop.id)).toEqual([lead.id])
  })
})

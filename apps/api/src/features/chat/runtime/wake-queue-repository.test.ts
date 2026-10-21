import { sessionFixture } from '../../../testing/session-fixture'
import { afterEach, describe, expect, test } from 'bun:test'

import { createDatabase } from '../../../db/connection'
import type { AppDatabase } from '../../../db/types'
import { createDatabaseWakeQueueStore, queueDeliveryMessageIds } from './wake-queue-repository'
import { createWakeQueue } from './wake-queue'
import { insertInternalTurn } from './message-persistence'
import type { SessionRecord } from '../repository'
import { createRunCompletion } from './run-outcome'
import { DEFAULT_AGENT_PARTICIPANT } from '../../../db'
import { rootExecutionContext } from './execution-context'

const dbs: Array<ReturnType<typeof createDatabase>> = []
const wakeQueues: Array<ReturnType<typeof createWakeQueue>> = []

const trackWakeQueue = <T extends ReturnType<typeof createWakeQueue>>(queue: T): T => {
  wakeQueues.push(queue)
  return queue
}

async function store() {
  const db = createDatabase()
  dbs.push(db)
  await db.schema
    .createTable('agent_queue_items')
    .addColumn('sequence', 'integer', (c) => c.primaryKey().autoIncrement())
    .addColumn('id', 'text', (c) => c.notNull().unique())
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('session_id', 'text', (c) => c.notNull())
    .addColumn('priority', 'integer', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('payload_json', 'text', (c) => c.notNull())
    .addColumn('state', 'text', (c) => c.notNull().defaultTo('pending'))
    .addColumn('lease_owner', 'text')
    .addColumn('lease_expires_at', 'text')
    .addColumn('delivery_key', 'text', (c) => c.notNull().unique())
    .addColumn('queued_at', 'text', (c) => c.notNull())
    .addColumn('batch_id', 'text')
    .execute()
  return { db, queue: createDatabaseWakeQueueStore<{ content: string }>(db) }
}

afterEach(async () => {
  await Promise.all(wakeQueues.splice(0).map((queue) => queue.close()))
  await Promise.all(dbs.splice(0).map((db) => db.destroy()))
})

const queued = (id: string, kind: 'user' | 'wake', priority = 0) => ({
  id,
  userId: 'u',
  sessionId: 's',
  priority,
  kind,
  payload: { content: id },
  deliveryKey: `delivery-${id}`,
  queuedAt: '2026-07-22T10:00:00.000Z',
})

describe('database wake queue store', () => {
  test('a band claimed together keeps its name through a release and an expired lease', async () => {
    const { queue } = await store()
    for (const id of ['a', 'b', 'c']) await queue.enqueue(queued(id, 'wake', 10))
    const at = '2026-07-22T10:00:00.000Z'
    const expires = '2026-07-22T10:01:00.000Z'
    expect(await queue.claim('u', 's', ['a', 'b'], 'owner-1', at, expires, 'a')).toBe(true)
    await queue.release('u', 's', ['a', 'b'], 'owner-1')
    const named = (rows: Awaited<ReturnType<typeof queue.listSession>>) =>
      rows.map((row) => [row.id, row.batchId ?? null])
    expect(named(await queue.listSession('u', 's'))).toEqual([
      ['a', 'a'],
      ['b', 'a'],
      ['c', null],
    ])
    // A lease that expired with its process: the band is still the band.
    expect(await queue.claim('u', 's', ['a', 'b'], 'owner-2', at, expires)).toBe(true)
    expect(await queue.recoverExpired('2026-07-22T10:02:00.000Z')).toBe(2)
    expect(named(await queue.listAll())).toEqual([
      ['a', 'a'],
      ['b', 'a'],
      ['c', null],
    ])
    expect(await queue.claim('u', 's', ['a', 'b'], 'owner-3', at, '2026-07-22T10:09:00.000Z')).toBe(
      true,
    )
    expect(await queue.ack('u', 's', ['a', 'b'], 'owner-3')).toBe(true)
    expect(named(await queue.listSession('u', 's'))).toEqual([['c', null]])
  })

  test('duplicate deterministic delivery is an idempotent insert', async () => {
    const { queue } = await store()
    const item = queued('trg:t1:1', 'wake', 20)
    await Promise.all([queue.enqueue(item), queue.enqueue(item)])
    expect(await queue.listSession('u', 's')).toHaveLength(1)
  })

  test('a new adapter recovers queued items in priority/FIFO order', async () => {
    const { db, queue: beforeRestart } = await store()
    await beforeRestart.enqueue(queued('wake', 'wake', 10))
    await beforeRestart.enqueue(queued('user-a', 'user'))
    await beforeRestart.enqueue(queued('user-b', 'user'))

    // New manager instance, same database: process memory is intentionally gone.
    const afterRestart = createDatabaseWakeQueueStore<{ content: string }>(db)
    const recovered = await afterRestart.listSession('u', 's')
    expect(recovered.map((item) => item.id)).toEqual(['user-a', 'user-b', 'wake'])
    expect(recovered.map((item) => item.sequence)).toEqual([2, 3, 1])
    expect(recovered.map((item) => item.kind)).toEqual(['user', 'user', 'wake'])
  })

  test('a malformed legacy payload does not block hydration of healthy queue rows', async () => {
    const { db, queue } = await store()
    await queue.enqueue(queued('healthy', 'user'))
    await db
      .insertInto('agent_queue_items')
      .values({
        id: 'corrupt',
        user_id: 'u',
        session_id: 's',
        priority: 0,
        kind: 'user',
        payload_json: '{not-json',
        delivery_key: 'delivery-corrupt',
        queued_at: '2026-07-22T10:00:00.000Z',
        state: 'pending',
        lease_owner: null,
        lease_expires_at: null,
      })
      .execute()

    const restarted = createDatabaseWakeQueueStore<{ content: string }>(db)
    expect((await restarted.listAll()).map((item) => item.id)).toEqual(['healthy'])
    expect((await restarted.listSession('u', 's')).map((item) => item.id)).toEqual(['healthy'])
  })

  test('expired leases recover after restart; ack is owner-scoped and all-or-nothing', async () => {
    const { db, queue } = await store()
    await queue.enqueue(queued('a', 'user'))
    await queue.enqueue(queued('b', 'user'))
    expect(
      await queue.claim(
        'u',
        's',
        ['a', 'b'],
        'process-1',
        '2026-07-22T10:00:00.000Z',
        '2026-07-22T10:01:00.000Z',
      ),
    ).toBe(true)

    const restarted = createDatabaseWakeQueueStore<{ content: string }>(db)
    expect(await restarted.ack('u', 's', ['a', 'b'], 'process-2')).toBe(false)
    expect(await restarted.recoverExpired('2026-07-22T10:02:00.000Z')).toBe(2)
    expect(
      await restarted.claim(
        'u',
        's',
        ['a', 'b'],
        'process-2',
        '2026-07-22T10:02:00.000Z',
        '2026-07-22T10:03:00.000Z',
      ),
    ).toBe(true)
    expect(await restarted.ack('u', 's', ['a', 'b'], 'process-2')).toBe(true)
    expect(await restarted.listSession('u', 's')).toEqual([])
  })

  test('an unexpired lease cannot be overwritten by a competing owner', async () => {
    const { queue } = await store()
    await queue.enqueue(queued('a', 'user'))
    expect(
      await queue.claim(
        'u',
        's',
        ['a'],
        'process-1',
        '2026-07-22T10:00:00.000Z',
        '2026-07-22T10:01:00.000Z',
      ),
    ).toBe(true)
    expect(
      await queue.claim(
        'u',
        's',
        ['a'],
        'process-2',
        '2026-07-22T10:00:30.000Z',
        '2026-07-22T10:01:30.000Z',
      ),
    ).toBe(false)
    expect(await queue.ack('u', 's', ['a'], 'process-1')).toBe(true)
  })

  test('delivery ids stay stable across retries so transcript inserts can be idempotent', () => {
    expect(queueDeliveryMessageIds('delivery-a')).toEqual(queueDeliveryMessageIds('delivery-a'))
    expect(queueDeliveryMessageIds('delivery-a')).not.toEqual(queueDeliveryMessageIds('delivery-b'))
  })

  test('replaying after transcript insert but before queue ack does not duplicate the turn', async () => {
    const rows = new Map<string, never>()
    const published: string[] = []
    const ids = queueDeliveryMessageIds('stable-delivery')
    const repo = {
      getMessage: async (_userId: string, _sessionId: string, id: string) => rows.get(id) ?? null,
      insertMessages: async (messages: Array<{ id: string }>) => {
        for (const message of messages) rows.set(message.id, message as never)
      },
    }
    const params = {
      repo: repo as never,
      streamRegistry: {
        publish: (_userId: string, _sessionId: string, event: { message?: { id: string } }) => {
          if (event.message) published.push(event.message.id)
        },
      } as never,
      now: () => '2026-07-22T10:00:00.000Z',
      userId: 'u',
      sessionId: 's',
      agent: DEFAULT_AGENT_PARTICIPANT,
      content: 'once',
      internal: false,
      messageIds: ids,
    }

    await insertInternalTurn(params)
    await insertInternalTurn(params)
    expect([...rows.keys()]).toEqual([ids.userMessageId, ids.assistantMessageId])
    expect(published).toEqual([ids.userMessageId, ids.assistantMessageId])
  })

  test('a crashed steering lease is recovered by a new live queue without changing delivery id', async () => {
    const { db } = await store()
    let clock = '2026-07-22T10:00:00.000Z'
    const session = {
      ...sessionFixture(),
      id: 's',
      userId: 'u',
      sessionKind: 'chat',
      provenance: { kind: 'root' },
    } as SessionRecord
    const state1 = {
      activeRuns: new Map([['s', new AbortController()]]),
      drainingSessions: new Set<string>(),
      sessionRunIdentity: new Map(),
    }
    const context = (state: typeof state1) => ({
      repo: {} as never,
      streamRegistry: { publish: () => {} } as never,
      now: () => clock,
      state,
      run: async () => ({ status: 'completed' as const }),
      store: createDatabaseWakeQueueStore(db) as NonNullable<
        Parameters<typeof createWakeQueue>[0]['store']
      >,
    })

    const beforeCrash = trackWakeQueue(createWakeQueue(context(state1)))
    await beforeCrash.wake({
      userId: 'u',
      session,
      content: 'persist me',
      internal: false,
    })
    const [leased] = await beforeCrash.reserveSteerable('s')
    expect(leased?.content).toBe('persist me')

    // New process identity, same DB. Its startup recovery owns only expired leases.
    clock = '2026-07-22T10:02:00.000Z'
    const state2 = {
      activeRuns: new Map([['s', new AbortController()]]),
      drainingSessions: new Set<string>(),
      sessionRunIdentity: new Map(),
    }
    const afterCrash = trackWakeQueue(createWakeQueue(context(state2)))
    await afterCrash.ready()
    expect((await afterCrash.list('s')).map((item) => item.id)).toEqual([leased!.id])
    const [retried] = await afterCrash.reserveSteerable('s')
    expect(retried?.id).toBe(leased?.id)
    expect(await afterCrash.ackSteerable('u', 's', retried!.id)).toBe(true)
    expect(await afterCrash.list('s')).toEqual([])
  })

  test('startup hydration retries a transient database failure without losing durable work', async () => {
    const { queue: durable } = await store()
    await durable.enqueue(queued('survivor', 'user'))
    let recoverAttempts = 0
    const flaky = {
      ...durable,
      async recoverExpired(now: string) {
        recoverAttempts += 1
        if (recoverAttempts === 1) throw new Error('SQLITE_BUSY: injected')
        return durable.recoverExpired(now)
      },
    }
    const restored = trackWakeQueue(
      createWakeQueue({
        repo: {} as never,
        streamRegistry: { publish: () => {} } as never,
        now: () => '2026-07-22T10:00:00.000Z',
        state: {
          activeRuns: new Map([['s', new AbortController()]]),
          drainingSessions: new Set<string>(),
          sessionRunIdentity: new Map(),
        },
        run: async () => ({ status: 'completed' as const }),
        store: flaky as unknown as NonNullable<Parameters<typeof createWakeQueue>[0]['store']>,
      }),
    )

    await restored.ready()
    expect(recoverAttempts).toBe(2)
    expect((await restored.list('s')).map((item) => item.id)).toEqual(['survivor'])
  })

  test('a transient durable claim failure keeps the waiter pending until retry completes', async () => {
    const { db } = await store()
    const durable = createDatabaseWakeQueueStore(db) as NonNullable<
      Parameters<typeof createWakeQueue>[0]['store']
    >
    let claimAttempts = 0
    const flaky = {
      ...durable,
      async claim(...args: Parameters<typeof durable.claim>) {
        claimAttempts += 1
        if (claimAttempts === 1) throw new Error('SQLITE_BUSY: injected claim failure')
        return durable.claim(...args)
      },
    } satisfies typeof durable
    const session = {
      ...sessionFixture(),
      id: 's',
      userId: 'u',
      sessionKind: 'chat',
      provenance: { kind: 'root' },
    } as SessionRecord
    const messages = new Map<string, never>()
    const runs: string[] = []
    const errors: unknown[] = []
    const queue = trackWakeQueue(
      createWakeQueue({
        repo: {
          getSession: async () => session,
          getMessage: async (_userId: string, _sessionId: string, id: string) =>
            messages.get(id) ?? null,
          insertMessages: async (batch: Array<{ id: string; payload: { content?: unknown } }>) => {
            for (const message of batch) messages.set(message.id, message as never)
          },
          listMessages: async () => [...messages.values()],
        } as never,
        streamRegistry: { publish: () => {} } as never,
        now: () => '2026-07-22T10:00:00.000Z',
        state: {
          activeRuns: new Map(),
          drainingSessions: new Set<string>(),
          sessionRunIdentity: new Map(),
        },
        run: async ({ historyMessages }) => {
          const user = [...historyMessages]
            .reverse()
            .find((message) => message.payload.role === 'user')
          runs.push(String(user?.payload.content ?? ''))
          return { status: 'completed' as const }
        },
        store: flaky,
        onError: (error) => errors.push(error),
      }),
    )
    let waiterSettled = false
    const waiter = queue
      .wake(
        {
          userId: 'u',
          session,
          content: 'retry durable claim',
          internal: false,
        },
        { waitForCompletion: true },
      )
      .then((outcome) => {
        waiterSettled = true
        return outcome
      })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(errors).toHaveLength(1)
    expect(waiterSettled).toBe(false)
    expect((await queue.list('s')).map((item) => item.preview)).toEqual(['retry durable claim'])

    await new Promise((resolve) => setTimeout(resolve, 75))
    expect(waiterSettled).toBe(true)
    expect(await waiter).toEqual({ status: 'completed' })
    // The first delivery claim is retried, then the resulting addressed agent ticket is
    // claimed independently. Persisting both boundaries is what makes recovery exact.
    expect(claimAttempts).toBe(3)
    expect(runs).toEqual(['retry durable claim'])
    expect(await durable.listSession('u', 's')).toEqual([])
  })

  test('a foreign durable claim resolves as delegated rather than successful work', async () => {
    const { db } = await store()
    const durable = createDatabaseWakeQueueStore(db) as NonNullable<
      Parameters<typeof createWakeQueue>[0]['store']
    >
    const now = '2026-07-22T10:00:00.000Z'
    const foreignStore = {
      ...durable,
      async enqueue(item: Parameters<typeof durable.enqueue>[0]) {
        await durable.enqueue(item)
        expect(
          await durable.claim(
            item.userId,
            item.sessionId,
            [item.id],
            'foreign-runtime',
            now,
            '2026-07-22T10:01:00.000Z',
          ),
        ).toBe(true)
      },
    } satisfies typeof durable
    const session = {
      ...sessionFixture(),
      id: 's',
      userId: 'u',
      sessionKind: 'chat',
      provenance: { kind: 'root' },
    } as SessionRecord
    let runCalls = 0
    const queue = trackWakeQueue(
      createWakeQueue({
        repo: {} as never,
        streamRegistry: { publish: () => {} } as never,
        now: () => now,
        state: {
          activeRuns: new Map(),
          drainingSessions: new Set<string>(),
          sessionRunIdentity: new Map(),
        },
        run: async () => {
          runCalls += 1
          return { status: 'completed' as const }
        },
        store: foreignStore,
      }),
    )

    const outcome = await queue.wake(
      {
        userId: 'u',
        session,
        content: 'owned elsewhere',
        internal: false,
      },
      { waitForCompletion: true },
    )

    expect(outcome).toEqual({
      status: 'delegated',
      message: 'Queued work is owned by another runtime process.',
    })
    expect(outcome?.status).not.toBe('completed')
    expect(runCalls).toBe(0)
    expect(await durable.listSession('u', 's')).toEqual([
      expect.objectContaining({ state: 'leased', leaseOwner: 'foreign-runtime' }),
    ])
  })

  test('logical continuation control state is never serialized into a durable row', async () => {
    const { db } = await store()
    const durable = createDatabaseWakeQueueStore(db) as NonNullable<
      Parameters<typeof createWakeQueue>[0]['store']
    >
    const session = {
      ...sessionFixture(),
      id: 's',
      userId: 'u',
      sessionKind: 'chat',
      provenance: { kind: 'root' },
    } as SessionRecord
    const queue = trackWakeQueue(
      createWakeQueue({
        repo: {} as never,
        streamRegistry: { publish: () => {} } as never,
        now: () => '2026-07-22T10:00:00.000Z',
        state: {
          activeRuns: new Map([['s', new AbortController()]]),
          drainingSessions: new Set<string>(),
          sessionRunIdentity: new Map(),
        },
        run: async () => ({ status: 'completed' as const }),
        store: durable,
      }),
    )

    await queue.wake(
      {
        userId: 'u',
        session,
        content: 'process-local continuation',
        source: 'loop',
        executionContext: {
          invocation: { kind: 'channel', source: 'loop' },
          authority: { capabilities: [] },
        },
      },
      { continuation: createRunCompletion() },
    )

    const [row] = await durable.listSession('u', 's')
    expect(row).toBeDefined()
    expect(row!.payload).toMatchObject({
      executionContext: {
        invocation: { kind: 'channel', source: 'loop' },
        authority: { capabilities: [] },
      },
    })
    expect(JSON.stringify(row!.payload)).not.toContain('completion')
    expect(JSON.stringify(row!.payload)).not.toContain('promise')
  })

  test('atomic send-now claims before interrupt and a failed interrupt restores pending state', async () => {
    const { db } = await store()
    const durable = createDatabaseWakeQueueStore(db) as NonNullable<
      Parameters<typeof createWakeQueue>[0]['store']
    >
    const session = {
      ...sessionFixture(),
      id: 's',
      userId: 'u',
      sessionKind: 'chat',
      provenance: { kind: 'root' },
    } as SessionRecord
    const state = {
      activeRuns: new Map([['s', new AbortController()]]),
      drainingSessions: new Set<string>(),
      sessionRunIdentity: new Map(),
    }
    const messages = new Map<string, never>()
    const runs: string[] = []
    const queue = trackWakeQueue(
      createWakeQueue({
        repo: {
          getSession: async () => session,
          getMessage: async (_userId: string, _sessionId: string, id: string) =>
            messages.get(id) ?? null,
          insertMessages: async (batch: Array<{ id: string; payload: { content?: unknown } }>) => {
            for (const message of batch) messages.set(message.id, message as never)
          },
          listMessages: async () => [...messages.values()],
        } as never,
        streamRegistry: { publish: () => {} } as never,
        now: () => '2026-07-22T10:00:00.000Z',
        state,
        run: async ({ historyMessages }) => {
          const user = [...historyMessages]
            .reverse()
            .find((message) => message.payload.role === 'user')
          runs.push(String(user?.payload.content ?? ''))
          return { status: 'completed' as const }
        },
        store: durable,
      }),
    )
    await queue.ready()
    await queue.wake({
      userId: 'u',
      session,
      content: 'keep pending',
      internal: false,
    })
    await queue.wake({
      userId: 'u',
      session,
      content: 'send selected',
      internal: false,
    })
    const [first, selected] = await queue.list('s')

    expect(
      queue.interruptAndPromote('u', 's', selected!.id, async () => {
        throw new Error('interrupt failed')
      }),
    ).rejects.toThrow('interrupt failed')
    expect((await durable.listSession('u', 's')).map((row) => row.state)).toEqual([
      'pending',
      'pending',
    ])

    expect(
      await queue.interruptAndPromote('u', 's', selected!.id, async () => {
        state.activeRuns.delete('s')
      }),
    ).toEqual({ promoted: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(runs).toEqual(['send selected', 'keep pending'])
    expect(await durable.listSession('u', 's')).toEqual([])
    expect(first?.id).not.toBe(selected?.id)
  })

  test('send-now interrupts a running agent ticket even while its drain holds the session lease', async () => {
    const { db } = await store()
    const durable = createDatabaseWakeQueueStore(db) as NonNullable<
      Parameters<typeof createWakeQueue>[0]['store']
    >
    const session = sessionFixture({ id: 's', userId: 'u' })
    const activeRuns = new Map<string, AbortController>()
    const state = { activeRuns, drainingSessions: new Set<string>(), sessionRunIdentity: new Map() }
    const messages = new Map<string, never>()
    const firstRun = Promise.withResolvers<void>()
    const stopRun = Promise.withResolvers<void>()
    const delivered = Promise.withResolvers<void>()
    const runs: string[] = []
    const queue = trackWakeQueue(
      createWakeQueue({
        repo: {
          getSession: async () => session,
          getMessage: async (_userId: string, _sessionId: string, id: string) =>
            messages.get(id) ?? null,
          insertMessage: async (message: { id: string }) => {
            messages.set(message.id, message as never)
          },
          insertMessages: async (batch: Array<{ id: string }>) => {
            for (const message of batch) messages.set(message.id, message as never)
          },
          listMessages: async () => [...messages.values()],
        } as never,
        streamRegistry: { publish: () => {} } as never,
        now: () => '2026-07-22T10:00:00.000Z',
        state,
        run: async ({ historyMessages }) => {
          const user = [...historyMessages]
            .reverse()
            .find((message) => message.payload.role === 'user')
          runs.push(String(user?.payload.content ?? 'initial ticket'))
          if (runs.length === 1) {
            activeRuns.set('s', new AbortController())
            firstRun.resolve()
            await stopRun.promise
          }
          if (runs.length === 3) delivered.resolve()
          return { status: 'completed' as const }
        },
        store: durable,
      }),
    )

    const agentId = session.agents[0]!.agentId
    await queue.wake({
      userId: 'u',
      session,
      content: 'agent ticket',
      agentTurn: {
        speakerAgentId: agentId,
        assistantMessageId: 'initial-slot',
        triggerMessageIds: [],
        source: 'user-default',
        scope: { speakerAgentId: agentId, executionContext: rootExecutionContext() },
      },
    })
    await firstRun.promise
    expect(state.drainingSessions.has('s')).toBe(true)
    await queue.wake({ userId: 'u', session, content: 'keep pending', internal: false })
    await queue.wake({ userId: 'u', session, content: 'send selected', internal: false })
    const selected = (await queue.list('s')).find((item) => item.preview === 'send selected')!

    await expect(
      queue.interruptAndPromote('u', 's', selected.id, async () => {
        throw new Error('stop failed')
      }),
    ).rejects.toThrow('stop failed')
    expect(
      (await durable.listSession('u', 's'))
        .filter((row) => row.kind === 'user')
        .map((row) => row.state),
    ).toEqual(['pending', 'pending'])
    expect(state.drainingSessions.has('s')).toBe(true)

    const stopStarted = Promise.withResolvers<void>()
    const finishStop = Promise.withResolvers<void>()
    const promotion = queue.interruptAndPromote('u', 's', selected.id, async () => {
      stopStarted.resolve()
      await finishStop.promise
      activeRuns.delete('s')
      stopRun.resolve()
    })
    await stopStarted.promise
    expect(
      await queue.interruptAndPromote('u', 's', selected.id, async () => {
        throw new Error('duplicate interrupt')
      }),
    ).toEqual({ promoted: false, reason: 'leased' })
    finishStop.resolve()
    expect(await promotion).toEqual({ promoted: true })
    await delivered.promise

    expect(runs).toEqual(['initial ticket', 'send selected', 'keep pending'])
    expect(await durable.listSession('u', 's')).toEqual([])
  })
})

// Compile-time pin: the adapter is backed by the application's real DB table.
void (null as unknown as AppDatabase['agent_queue_items'])

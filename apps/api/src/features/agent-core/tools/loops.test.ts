import { describe, expect, test } from 'bun:test'

import type { LoopService } from '../../loops/service'
import type { SessionLoop } from '../../loops/contracts'
import { setLoopEngine } from '../../loops/runtime-binding'
import { createLoopsTool } from './loops'

const userId = 'u'
const sessionId = 's'

function makeLoop(over: Partial<SessionLoop> = {}): SessionLoop {
  return {
    id: 'loop-1',
    userId,
    sessionId,
    kind: 'fixed',
    cron: '*/5 * * * *',
    prompt: 'check deploy',
    maintenance: false,
    createdAt: '2026-06-16T10:00:00.000Z',
    nextRunAt: '2026-06-16T10:05:00.000Z',
    target: 'session',
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    runCount: 0,
    ...over,
  }
}

/** Minimal loop service stub — only the methods the tool calls are overridable. */
function stubEngine(over: Partial<LoopService> = {}): LoopService {
  return {
    create: async () => makeLoop(),
    createDynamic: async () => makeLoop({ kind: 'dynamic', cron: null }),
    get: (id: string) => (id === 'loop-1' ? makeLoop() : undefined),
    update: async () => makeLoop(),
    cancel: async () => true,
    cancelForSession: () => {},
    reschedule: async () => ({ loop: makeLoop(), appliedSeconds: 120 }),
    runNow: async () =>
      makeLoop({ runCount: 1, lastRunAt: '2026-06-16T10:01:00.000Z', lastStatus: 'ok' }),
    list: () => [],
    listForSession: () => [],
    ...over,
  } as LoopService
}

function run(input: Record<string, unknown>) {
  const tool = createLoopsTool({ userId, sessionId, agentId: 'lead' })
  // @ts-expect-error — exercising the tool with a plain input object
  return tool.execute('call-1', input, undefined, undefined, undefined)
}

describe('loops tool', () => {
  test('errors when the engine is unavailable', async () => {
    // @ts-expect-error — resetting the late binding for the no-engine path
    setLoopEngine(null)
    const res = await run({ action: 'list' })
    expect(res.isError).toBe(true)
    expect(res.content).toContain('not available')
  })

  test('list: empty vs populated (stats + subsession marker rendered)', async () => {
    setLoopEngine(stubEngine({ list: () => [] }))
    expect((await run({ action: 'list' })).content).toContain('No loops in this session')

    setLoopEngine(
      stubEngine({
        list: () => [
          makeLoop({
            runCount: 3,
            lastRunAt: '2026-06-16T10:00:00.000Z',
            lastStatus: 'ok',
            target: 'subsession',
          }),
          makeLoop({
            id: 'loop-2',
            kind: 'dynamic',
            cron: null,
            delaySeconds: 180,
          }),
        ],
      }),
    )
    const res = await run({ action: 'list' })
    expect(res.content).toContain('Loops (2)')
    expect(res.content).toContain('3 runs')
    expect(res.content).toContain('subsession')
    expect(res.content).toContain('~3m')
    // A dynamic loop always has a next run now — its watchdog — never an "idle" state.
    expect(res.content).not.toContain('idle')
  })

  test("get: requires id, refuses another session's job, renders detail", async () => {
    setLoopEngine(stubEngine())
    expect((await run({ action: 'get' })).isError).toBe(true)

    setLoopEngine(stubEngine({ get: () => makeLoop({ sessionId: 'other' }) }))
    expect((await run({ action: 'get', id: 'loop-1' })).isError).toBe(true)

    setLoopEngine(stubEngine())
    const res = await run({ action: 'get', id: 'loop-1' })
    expect(res.content).toContain('kind: fixed')
    expect(res.content).toContain('check deploy')
  })

  test('add: requires prompt; rejects bad cron; fixed vs dynamic; subsession needs cron', async () => {
    setLoopEngine(stubEngine())
    expect((await run({ action: 'add' })).isError).toBe(true)
    expect((await run({ action: 'add', prompt: 'x', cron: 'not-a-cron' })).isError).toBe(true)

    expect((await run({ action: 'add', prompt: 'x', cron: '*/5 * * * *' })).content).toContain(
      'Loop added',
    )
    expect((await run({ action: 'add', prompt: 'x' })).content).toContain('Dynamic loop added')

    const sub = await run({ action: 'add', prompt: 'x', target: 'subsession' })
    expect(sub.isError).toBe(true)
    expect(sub.content).toContain('cannot run in a subsession')
  })

  test('update: requires id + a field; passes patch through', async () => {
    setLoopEngine(stubEngine())
    expect((await run({ action: 'update', id: 'loop-1' })).isError).toBe(true)
    const res = await run({ action: 'update', id: 'loop-1', prompt: 'new task' })
    expect(res.content).toContain('Loop updated')
  })

  test('update without id changes the conversation’s only loop', async () => {
    // Seen live: the model called update with only the new prompt, and was refused.
    const patched: string[] = []
    setLoopEngine(
      stubEngine({
        list: () => [makeLoop({ id: 'loop-7' })],
        update: async (id: string) => {
          patched.push(id)
          return makeLoop({ id })
        },
      }),
    )
    const res = await run({ action: 'update', prompt: 'new task' })
    expect(res.isError).toBeUndefined()
    expect(patched).toEqual(['loop-7'])
  })

  test('update without id among several loops names them and changes none', async () => {
    const patched: string[] = []
    setLoopEngine(
      stubEngine({
        list: () => [makeLoop({ id: 'loop-a1' }), makeLoop({ id: 'loop-b2' })],
        update: async (id: string) => {
          patched.push(id)
          return makeLoop({ id })
        },
      }),
    )
    const res = await run({ action: 'update', prompt: 'new task' })
    expect(res.isError).toBe(true)
    expect(res.content).toContain('loop-a1')
    expect(res.content).toContain('loop-b2')
    expect(patched).toEqual([])
  })

  test('remove: requires id, reports success and not-found', async () => {
    setLoopEngine(stubEngine())
    expect((await run({ action: 'remove' })).isError).toBe(true)
    expect((await run({ action: 'remove', id: 'loop-1' })).content).toContain('removed')

    setLoopEngine(stubEngine({ get: () => undefined }))
    expect((await run({ action: 'remove', id: 'nope' })).isError).toBe(true)
  })

  test('run: fires now and reports where it ran', async () => {
    setLoopEngine(stubEngine())
    const res = await run({ action: 'run', id: 'loop-1' })
    expect(res.content).toContain('fired now in this session')

    setLoopEngine(stubEngine({ runNow: async () => makeLoop({ target: 'subsession' }) }))
    expect((await run({ action: 'run', id: 'loop-1' })).content).toContain('subsession')
  })

  describe('id resolution (short prefix)', () => {
    const fullA = 'abcdef01-1111-4111-8111-000000000001'
    const fullB = 'abcdef02-2222-4222-8222-000000000002'

    test('unique prefix resolves and the engine call uses the full id', async () => {
      let removedId: string | undefined
      setLoopEngine(
        stubEngine({
          // No exact id hit — force the prefix path.
          get: () => undefined,
          list: () => [makeLoop({ id: fullA })],
          cancel: async (id: string) => {
            removedId = id
            return true
          },
        }),
      )
      const res = await run({ action: 'remove', id: 'abcdef01' })
      expect(res.isError).toBeFalsy()
      expect(res.content).toContain(fullA) // echoes the resolved full id
      expect(removedId).toBe(fullA)
    })

    test('8-char short id (as /loop list shows) resolves for get', async () => {
      setLoopEngine(
        stubEngine({
          get: () => undefined,
          list: () => [makeLoop({ id: fullA })],
        }),
      )
      const res = await run({ action: 'get', id: fullA.slice(0, 8) })
      expect(res.isError).toBeFalsy()
      expect(res.content).toContain('kind: fixed')
    })

    test('ambiguous prefix errors and lists the candidates', async () => {
      setLoopEngine(
        stubEngine({
          get: () => undefined,
          list: () => [makeLoop({ id: fullA }), makeLoop({ id: fullB })],
        }),
      )
      const res = await run({ action: 'get', id: 'abcdef' })
      expect(res.isError).toBe(true)
      expect(res.content).toContain('Ambiguous')
      expect(res.content).toContain(fullA)
      expect(res.content).toContain(fullB)
    })

    test('too-short prefix does not resolve', async () => {
      setLoopEngine(
        stubEngine({
          get: () => undefined,
          list: () => [makeLoop({ id: fullA })],
        }),
      )
      const res = await run({ action: 'get', id: 'abc' })
      expect(res.isError).toBe(true)
      expect(res.content).toContain('No loop')
    })

    test("another session's loop is not resolvable (exact id refused, absent from list)", async () => {
      const foreign = 'ffffffff-9999-4999-8999-000000000009'
      setLoopEngine(
        stubEngine({
          // engine.get returns it (user-scoped), but it belongs to another session…
          get: () => makeLoop({ id: foreign, sessionId: 'other' }),
          // …and this session's list does not include it.
          list: () => [],
        }),
      )
      const exactRes = await run({ action: 'get', id: foreign })
      expect(exactRes.isError).toBe(true)
      const prefixRes = await run({ action: 'get', id: 'ffffffff' })
      expect(prefixRes.isError).toBe(true)
    })
  })

  test('reschedule: requires id + delay_seconds; passes engine error through', async () => {
    setLoopEngine(stubEngine())
    expect((await run({ action: 'reschedule', delay_seconds: 120 })).isError).toBe(true)
    expect((await run({ action: 'reschedule', id: 'loop-1' })).isError).toBe(true)
    expect(
      (await run({ action: 'reschedule', id: 'loop-1', delay_seconds: 120 })).content,
    ).toContain('~2m')

    setLoopEngine(stubEngine({ reschedule: async () => ({ error: 'is a fixed loop' }) }))
    const err = await run({ action: 'reschedule', id: 'loop-1', delay_seconds: 120 })
    expect(err.isError).toBe(true)
    expect(err.content).toBe('is a fixed loop')
  })
})

/**
 * `add` had no idempotency key: `engine.create`/`createDynamic` mint a fresh id every call. So an
 * ambiguous failure after the DB write — the run aborted, or the tool result was lost — followed by the
 * model re-issuing the identical call left TWO jobs firing forever, each waking the session. The only
 * guard was this tool's own description ("never add a second job for the same task"), and a prompt cannot
 * hold an invariant the engine can.
 */
describe('loops add is idempotent', () => {
  const existing = makeLoop({ id: 'loop-1', cron: '*/5 * * * *', prompt: 'check deploy' })

  test('re-adding the same cadence + prompt returns the EXISTING id and creates nothing', async () => {
    let created = 0
    setLoopEngine(
      stubEngine({
        list: () => [existing],
        create: async () => {
          created += 1
          return makeLoop({ id: 'loop-2' })
        },
      }),
    )
    const res = await run({ action: 'add', cron: '*/5 * * * *', prompt: 'check deploy' })
    expect(created).toBe(0)
    expect(res.isError).toBeUndefined()
    expect(res.content).toContain('already exists')
    // The id a retry needs, so `reschedule`/`update` still work.
    expect(res.content).toContain('loop-1')
  })

  test('a different cadence for the same prompt IS a new job', async () => {
    let created = 0
    setLoopEngine(
      stubEngine({
        list: () => [existing],
        create: async () => {
          created += 1
          return makeLoop({ id: 'loop-2', cron: '0 * * * *' })
        },
      }),
    )
    const res = await run({ action: 'add', cron: '0 * * * *', prompt: 'check deploy' })
    expect(created).toBe(1)
    expect(res.content).toContain('Loop added')
  })

  test('a dynamic loop dedupes against dynamic, not against a cron job of the same prompt', async () => {
    let dynamic = 0
    setLoopEngine(
      stubEngine({
        // Only the CRON job exists; a dynamic add with the same prompt is a different job.
        list: () => [existing],
        createDynamic: async () => {
          dynamic += 1
          return makeLoop({ id: 'loop-3', kind: 'dynamic', cron: null })
        },
      }),
    )
    expect((await run({ action: 'add', prompt: 'check deploy' })).isError).toBeUndefined()
    expect(dynamic).toBe(1)

    // Now the dynamic one exists too — re-adding it is the duplicate.
    setLoopEngine(
      stubEngine({
        list: () => [existing, makeLoop({ id: 'loop-3', kind: 'dynamic', cron: null })],
        createDynamic: async () => {
          dynamic += 1
          return makeLoop({ id: 'loop-4', kind: 'dynamic', cron: null })
        },
      }),
    )
    const again = await run({ action: 'add', prompt: 'check deploy' })
    expect(again.content).toContain('already exists')
    expect(dynamic).toBe(1)
  })
})

/**
 * The other half of idempotency: a guard that blocks a job the user CAN still get is correct;
 * one that blocks a job that can never fire is a dead end. That dead end — a dynamic loop the agent
 * stopped pacing, left in the list forever — cannot occur any more: a dynamic loop re-arms after
 * every fire and ends only when removed, and an ended loop is not listed. So every listed job is
 * live, and every listed job dedupes.
 */
describe('loops add dedupes against a listed job', () => {
  test('a dynamic loop that has NOT run yet blocks — that is the retry case', async () => {
    // A lost tool result re-issuing the same call must NOT create a second loop.
    const fresh = makeLoop({
      id: 'loop-fresh',
      kind: 'dynamic',
      cron: null,
      runCount: 0,
    })
    let dynamic = 0
    setLoopEngine(
      stubEngine({
        list: () => [fresh],
        createDynamic: async () => {
          dynamic += 1
          return makeLoop({ id: 'loop-two', kind: 'dynamic', cron: null })
        },
      }),
    )
    const res = await run({ action: 'add', prompt: 'check deploy' })
    expect(res.content).toContain('already exists')
    expect(res.content).toContain('loop-fresh')
    expect(dynamic).toBe(0)
  })

  test('an ended FIXED loop is not a thing — a cron job always still fires', async () => {
    // A cron job with runs behind it is live by definition; it must keep deduping.
    const ran = makeLoop({ id: 'loop-cron', cron: '*/5 * * * *', runCount: 9 })
    let created = 0
    setLoopEngine(
      stubEngine({
        list: () => [ran],
        create: async () => {
          created += 1
          return makeLoop({ id: 'loop-x' })
        },
      }),
    )
    const res = await run({ action: 'add', cron: '*/5 * * * *', prompt: 'check deploy' })
    expect(res.content).toContain('already exists')
    expect(created).toBe(0)
  })

  test('the same prompt + cadence in a different TARGET is a different job', async () => {
    // 'session' fires inside this conversation; 'subsession' fires in a detached child. Treating
    // them as one job silently handed back the other one's id and scheduled nothing.
    const inSession = makeLoop({ id: 'loop-s', cron: '*/5 * * * *', target: 'session' })
    let created = 0
    setLoopEngine(
      stubEngine({
        list: () => [inSession],
        create: async () => {
          created += 1
          return makeLoop({ id: 'loop-sub', target: 'subsession' })
        },
      }),
    )
    const res = await run({
      action: 'add',
      cron: '*/5 * * * *',
      prompt: 'check deploy',
      target: 'subsession',
    })
    expect(res.content).toContain('Loop added')
    expect(created).toBe(1)
  })

  test('a subsession dynamic loop is refused for the right reason, not as a duplicate', async () => {
    // A dynamic + subsession row cannot be created by the CURRENT tool, but it can be loaded from
    // a database written before that combination was refused. With such a row present, the
    // duplicate check would match — so only checking the impossible combination FIRST produces the
    // accurate refusal instead of "already exists", which would send the model off to `update` a
    // job that cannot express what it just asked for.
    const legacy = makeLoop({
      id: 'loop-legacy',
      kind: 'dynamic',
      cron: null,
      target: 'subsession',
    })
    setLoopEngine(stubEngine({ list: () => [legacy] }))
    const res = await run({ action: 'add', prompt: 'check deploy', target: 'subsession' })
    expect(res.isError).toBe(true)
    expect(res.content).toContain('cannot run in a subsession')
  })
})

describe('loops classify', () => {
  const tool = createLoopsTool({ userId: 'u', sessionId: 's', agentId: 'a' })
  test.each([
    ['list', { effect: 'read' }],
    ['get', { effect: 'read' }],
    ['reschedule', { effect: 'session' }],
    ['add', { effect: 'host' }],
    ['update', { effect: 'host' }],
    ['run', { effect: 'host' }],
    ['remove', { effect: 'host', irreversible: true }],
    ['unknown', { effect: 'external' }],
    // A prototype key must not resolve to an inherited method.
    ['toString', { effect: 'external' }],
  ] as const)('%s', (action, expected) => {
    expect(tool.classify?.({ action })).toEqual(expected)
  })

  test('a missing input is external, never read', () => {
    expect(tool.classify?.(undefined)).toEqual({ effect: 'external' })
  })
})

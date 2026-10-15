import { describe, expect, test } from 'bun:test'
import {
  createHumanInLoopController,
  HumanInLoopAbortError,
  HumanInLoopDismissedError,
  HumanInLoopTimeoutError,
} from './human-in-loop'

describe('createHumanInLoopController', () => {
  test('rejects pending requests on abort', () => {
    const controller = createHumanInLoopController()
    const abort = new AbortController()
    const promise = controller.request(
      {
        id: 'request_1',
        kind: 'ask',
        payload: {},
        createdAt: Date.now(),
      },
      abort.signal,
    )

    expect(controller.listPending()).toHaveLength(1)
    abort.abort()

    expect(promise).rejects.toBeInstanceOf(HumanInLoopAbortError)
    expect(controller.listPending()).toHaveLength(0)
    expect(controller.getRecord('request_1')?.status).toBe('aborted')
  })

  test('keeps a response history record and rejects mismatched response kinds', () => {
    const controller = createHumanInLoopController()
    const promise = controller.request({
      id: 'request_1',
      kind: 'ask',
      payload: {},
      createdAt: 1,
    })

    expect(
      controller.respond({
        requestId: 'request_1',
        kind: 'approval',
        payload: {},
        respondedAt: 2,
      }),
    ).toBe(false)

    expect(
      controller.respond({
        requestId: 'request_1',
        kind: 'ask',
        payload: { value: 'yes' },
        respondedAt: 3,
      }),
    ).toBe(true)

    expect(promise).resolves.toMatchObject({ payload: { value: 'yes' } })
    expect(controller.getRecord('request_1')).toMatchObject({
      status: 'responded',
      response: { payload: { value: 'yes' } },
    })
  })

  test('expires requests with expiresAt', async () => {
    let currentTime = 100
    const controller = createHumanInLoopController({ now: () => currentTime })
    const promise = controller.request({
      id: 'request_1',
      kind: 'ask',
      payload: {},
      createdAt: currentTime,
      expiresAt: currentTime + 1,
    })
    // Capture the rejection BEFORE the clock moves: the request expires during the
    // sleep below, and a rejection with no handler attached is an unhandled rejection.
    const settled = promise.catch((err: unknown) => err)
    currentTime += 2
    await Bun.sleep(5)

    expect(await settled).toBeInstanceOf(HumanInLoopTimeoutError)
    expect(controller.getRecord('request_1')?.status).toBe('expired')
  })

  test('persists an already-expired request as put→expired (store + record)', () => {
    const updates: string[] = []
    const currentTime = 100
    const controller = createHumanInLoopController({
      now: () => currentTime,
      store: {
        put: (record) => {
          updates.push(`put:${record.status}`)
        },
        update: (record) => {
          updates.push(`update:${record.status}`)
        },
      },
    })

    const promise = controller.request({
      id: 'request_1',
      kind: 'ask',
      payload: {},
      createdAt: currentTime,
      expiresAt: currentTime - 1, // already in the past at request time
    })

    expect(promise).rejects.toBeInstanceOf(HumanInLoopTimeoutError)
    expect(controller.getRecord('request_1')?.status).toBe('expired')
    expect(updates).toEqual(['put:pending', 'update:expired'])
  })

  test('an already-expired request ignores a later abort of its signal', async () => {
    const controller = createHumanInLoopController({ now: () => 100 })
    const abort = new AbortController()
    const promise = controller.request(
      { id: 'request_1', kind: 'ask', payload: {}, createdAt: 100, expiresAt: 99 },
      abort.signal,
    )
    await expect(promise).rejects.toBeInstanceOf(HumanInLoopTimeoutError)
    abort.abort()
    expect(controller.getRecord('request_1')?.status).toBe('expired')
  })

  test('a rejecting store does not leak an unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const controller = createHumanInLoopController({
        store: {
          put: () => Promise.reject(new Error('disk full')),
          update: () => Promise.reject(new Error('disk full')),
        },
      })
      const promise = controller.request({
        id: 'request_1',
        kind: 'ask',
        payload: {},
        createdAt: 1,
      })
      controller.reject('request_1', new Error('no'))
      await expect(promise).rejects.toThrow('no')
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(unhandled).toEqual([])
      expect(controller.getRecord('request_1')?.status).toBe('rejected')
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  test('mirrors record writes to an optional store', async () => {
    const updates: string[] = []
    const controller = createHumanInLoopController({
      store: {
        put: (record) => {
          updates.push(`put:${record.status}`)
        },
        update: (record) => {
          updates.push(`update:${record.status}`)
        },
      },
    })

    const promise = controller.request({
      id: 'request_1',
      kind: 'ask',
      payload: {},
      createdAt: 1,
    })

    controller.respond({
      requestId: 'request_1',
      kind: 'ask',
      payload: {},
      respondedAt: 2,
    })
    await promise

    expect(updates).toEqual(['put:pending', 'update:responded'])
  })

  test('records dismissed requests as a control outcome', () => {
    const controller = createHumanInLoopController()
    const promise = controller.request({
      id: 'hitl_1',
      kind: 'ask',
      payload: {},
      createdAt: Date.now(),
    })

    expect(controller.reject('hitl_1', new HumanInLoopDismissedError())).toBe(true)
    expect(promise).rejects.toBeInstanceOf(HumanInLoopDismissedError)
    expect(controller.getRecord('hitl_1')?.status).toBe('dismissed')
  })

  test('bounds completed local history without evicting pending requests', async () => {
    const controller = createHumanInLoopController({ maxRetainedRecords: 1 })
    const first = controller.request({ id: 'first', kind: 'ask', payload: {}, createdAt: 1 })
    controller.respond({ requestId: 'first', kind: 'ask', payload: {}, respondedAt: 2 })
    await first

    const pending = controller.request({ id: 'pending', kind: 'ask', payload: {}, createdAt: 3 })
    const second = controller.request({ id: 'second', kind: 'ask', payload: {}, createdAt: 4 })
    controller.respond({ requestId: 'second', kind: 'ask', payload: {}, respondedAt: 5 })
    await second

    expect(controller.getRecord('first')).toBeUndefined()
    expect(controller.getRecord('pending')?.status).toBe('pending')
    expect(controller.getRecord('second')?.status).toBe('responded')
    expect(controller.listRecords().map((record) => record.request.id)).toEqual([
      'pending',
      'second',
    ])

    controller.reject('pending', new HumanInLoopDismissedError())
    expect(pending).rejects.toBeInstanceOf(HumanInLoopDismissedError)
  })

  test('supports disabling completed local history and validates the bound', async () => {
    const controller = createHumanInLoopController({ maxRetainedRecords: 0 })
    const response = controller.request({ id: 'request_1', kind: 'ask', payload: {}, createdAt: 1 })
    expect(controller.getRecord('request_1')?.status).toBe('pending')
    controller.respond({ requestId: 'request_1', kind: 'ask', payload: {}, respondedAt: 2 })
    await response
    expect(controller.getRecord('request_1')).toBeUndefined()

    expect(() => createHumanInLoopController({ maxRetainedRecords: -1 })).toThrow(
      'non-negative safe integer',
    )
  })
})

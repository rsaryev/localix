import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import { miniAppFiles, miniAppRealtime } from '@localixai/mini-app-sdk/ui/runtime'
import { emptySpace } from '../shared/format/document'
import type { SpaceView } from '../shared/api'
import { spaceApi } from './api'
import { SPACE_POLL_MS, watchSpaceUpdates } from './spaceUpdates'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(() => teardown())

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * The board polled every 10 s for as long as it stayed open, beside a live stream that already
 * announced every change — a full document re-read every 10 s to learn nothing. The poll now runs
 * only while the stream is not carrying the board: before the host answers, and while the socket
 * is down until the resubscribe is answered.
 */
test('the board polls only while its stream is not live', async () => {
  const sessionId = 'poll-only-when-not-live'
  const polls = new Set<unknown>()
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  const setSpy = spyOn(globalThis, 'setInterval').mockImplementation(((
    handler: () => void,
    ms?: number,
  ) => {
    const id = realSetInterval(handler, ms)
    if (ms === SPACE_POLL_MS) polls.add(id)
    return id
  }) as typeof setInterval)
  const clearSpy = spyOn(globalThis, 'clearInterval').mockImplementation(((
    id?: Parameters<typeof clearInterval>[0],
  ) => {
    polls.delete(id)
    realClearInterval(id)
  }) as typeof clearInterval)
  let disconnect = () => {}
  let reconnect = () => {}
  let accept = true
  const requestSpy = spyOn(miniAppRealtime, 'request').mockImplementation(
    async <T>(payload: Record<string, unknown>): Promise<T> =>
      (String(payload.t).endsWith(':subscribe') && accept ? { subscribed: true } : {}) as T,
  )
  const frameSpy = spyOn(miniAppRealtime, 'onFrame').mockImplementation(() => () => {})
  const reconnectSpy = spyOn(miniAppRealtime, 'onReconnect').mockImplementation((handler) => {
    reconnect = handler
    return () => {}
  })
  const disconnectSpy = spyOn(miniAppRealtime, 'onDisconnect').mockImplementation((handler) => {
    disconnect = handler
    return () => {}
  })
  let fileChanged: (paths: string[] | null) => void = () => {}
  let fileLive: (live: boolean) => void = () => {}
  const filesSpy = spyOn(miniAppFiles, 'watchWorkspace').mockImplementation(
    (_sessionId, listener, options?: { onLive?: (live: boolean) => void }) => {
      fileChanged = (paths) => listener({ sessionId, paths })
      fileLive = (next) => options?.onLive?.(next)
      fileLive(true)
      return () => {}
    },
  )
  const saved: SpaceView = {
    space: emptySpace(),
    revision: 'r1',
    issues: [],
    writable: true,
    canUndo: false,
    canRedo: false,
    missing: [],
    stamps: {},
    liveUpdates: true,
  }
  let reads = 0
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async () => {
      reads += 1
      return Response.json(saved)
    },
  })
  const release = watchSpaceUpdates(sessionId, () => {})
  try {
    expect(polls.size, 'nothing carries the board yet').toBe(1)
    await spaceApi.space(sessionId)
    await settle()
    expect(polls.size, 'the stream answered: no poll beside it').toBe(0)

    // A hand edit of the board file reaches no stream; the workspace watcher re-reads it.
    const before = reads
    fileChanged(['/project/src/index.ts'])
    fileChanged(['/project/.localix/project-space/space.json'])
    await settle()
    expect(reads).toBe(before + 1)
    fileLive(false)
    expect(polls.size, 'a chat whose files are not watched still polls for hand edits').toBe(1)
    fileLive(true)
    expect(polls.size).toBe(0)

    disconnect()
    expect(polls.size, 'the socket is down: poll again').toBe(1)
    accept = false
    reconnect()
    await settle()
    expect(polls.size, 'a refused resubscribe keeps polling').toBe(1)
    accept = true
    reconnect()
    await settle()
    expect(polls.size).toBe(0)
  } finally {
    release()
    expect(polls.size, 'a closed board leaves no timer').toBe(0)
    unbind()
    for (const spy of [requestSpy, frameSpy, reconnectSpy, disconnectSpy, setSpy, clearSpy])
      spy.mockRestore()
    filesSpy.mockRestore()
  }
})

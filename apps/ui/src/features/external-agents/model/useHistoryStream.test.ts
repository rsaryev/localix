import { afterEach, expect, test } from 'bun:test'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from '@localixai/mini-app-sdk/ui/runtime'

import {
  HISTORY_FRAME_TAG,
  HISTORY_SUBSCRIBE,
  HISTORY_UNSUBSCRIBE,
} from '@localixai/api/external-agent-history-stream'
import { HISTORY, historyFeed } from './useHistoryStream'

const followHistoryStream = (listener: { changed: () => void; live: (live: boolean) => void }) =>
  historyFeed.follow(HISTORY, {
    frame: listener.changed,
    live: listener.live,
    reconnect: listener.changed,
  })

let unbind: (() => void) | undefined
afterEach(() => {
  unbind?.()
  unbind = undefined
})

function fakeRealtime() {
  const frames = new Set<(json: string) => void>()
  const reconnects = new Set<() => void>()
  const disconnects = new Set<() => void>()
  const commands: string[] = []
  const on = (set: Set<() => void>) => (handler: () => void) => {
    set.add(handler)
    return () => set.delete(handler)
  }
  unbind = bindMiniAppUiRuntime({
    realtime: {
      onFrame: (tag: string, handler: (json: string) => void) => {
        if (tag !== HISTORY_FRAME_TAG) throw new Error(`unexpected tag ${tag}`)
        frames.add(handler)
        return () => frames.delete(handler)
      },
      onReconnect: on(reconnects),
      onDisconnect: on(disconnects),
      request: async (payload: { t: string }) => {
        commands.push(payload.t)
      },
    },
  } as unknown as MiniAppUiRuntime)
  return {
    commands,
    frame: (value: unknown) => {
      for (const handler of frames) handler(JSON.stringify(value))
    },
    reconnect: () => reconnects.forEach((handler) => handler()),
    disconnect: () => disconnects.forEach((handler) => handler()),
    listening: () => frames.size + reconnects.size + disconnects.size,
  }
}

/**
 * The roster re-enumerated four history roots on a timer to learn what a frame now says. Two open
 * rosters share one subscription; a dropped socket stops claiming "pushed" so the timer speeds back
 * up, and a reconnect re-subscribes and re-reads once, since frames sent while down are gone.
 */
test('one subscription, pushed changes, and an honest live flag across a reconnect', () => {
  const socket = fakeRealtime()
  const seen: string[] = []
  const a = followHistoryStream({
    changed: () => seen.push('a:changed'),
    live: (live) => seen.push(`a:${live}`),
  })
  const b = followHistoryStream({ changed: () => seen.push('b:changed'), live: () => {} })
  expect(socket.commands).toEqual([HISTORY_SUBSCRIBE])

  socket.frame({ live: true })
  socket.frame({ changed: true })
  socket.frame({ nonsense: 1 })
  expect(seen).toEqual(['a:true', 'a:changed', 'b:changed'])

  seen.length = 0
  socket.disconnect()
  socket.reconnect()
  expect(seen).toEqual(['a:false', 'a:changed', 'b:changed'])
  expect(socket.commands).toEqual([HISTORY_SUBSCRIBE, HISTORY_SUBSCRIBE])

  a()
  expect(socket.commands).toHaveLength(2)
  b()
  expect(socket.commands.at(-1)).toBe(HISTORY_UNSUBSCRIBE)
  expect(socket.listening()).toBe(0)
})

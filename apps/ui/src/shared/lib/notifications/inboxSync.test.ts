import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { change, drain, fakeServer, fakeSocket, inboxRow } from './journal.test-utils'
import { startNotificationSync } from './inboxSync'
import { resetNotificationsForTests, useNotificationsStore } from './store'

/**
 * The window's copy of the server inbox: what a sync replaces, what a delta and a live frame add,
 * and that the two delivering the same change — every reconnect does — apply it once.
 */

const entries = () => useNotificationsStore.getState().entries
const ids = () => entries().map((entry) => entry.id)
let stop: (() => void) | null = null

beforeEach(() => resetNotificationsForTests())
afterEach(() => {
  stop?.()
  stop = null
  resetNotificationsForTests()
})

describe('catching up with the server journal', () => {
  test('a full sync replaces the copy; a delta adds to it; a removal drops the row', async () => {
    const responses = [
      {
        changes: [change(1, inboxRow('a')), change(2, inboxRow('b'))],
        cursor: 2,
        floor: 1,
        full: true,
      },
      {
        changes: [change(3, inboxRow('c', { lastSeenAt: 2_000 })), { seq: 4, removedKey: 'a' }],
        cursor: 4,
        floor: 1,
        full: false,
      },
    ]
    const server = fakeServer({ sync: () => responses.shift()! })
    const socket = fakeSocket()
    // The start itself is the first read (full); the socket's first open comes later.
    stop = startNotificationSync({ socket: socket.socket, transport: server.transport })
    await drain()
    expect(ids().sort()).toEqual(['a', 'b'])

    socket.disconnect()
    socket.connect()
    await drain()
    // The reconnect asked only for what it had not seen.
    expect(server.state.syncs).toEqual([0, 2])
    expect(ids()).toEqual(['c', 'b'])
  })

  test('the journal is read at start, whether or not the socket ever opens', async () => {
    // Found running the real app: with the socket down the window showed "No events yet" while the
    // server held every row. History is an HTTP read; the socket only carries what changes next.
    const server = fakeServer({
      sync: () => ({ changes: [change(1, inboxRow('a'))], cursor: 1, floor: 1, full: true }),
    })
    const socket = fakeSocket()
    stop = startNotificationSync({ socket: socket.socket, transport: server.transport })
    await drain()
    expect(server.state.syncs).toEqual([0])
    expect(ids()).toEqual(['a'])
  })

  test('a live frame and the sync carrying the same change apply it once, newest wins', async () => {
    const server = fakeServer({
      sync: () => ({
        changes: [change(5, inboxRow('run', { title: 'older' }))],
        cursor: 6,
        floor: 1,
        full: true,
      }),
    })
    const socket = fakeSocket()
    stop = startNotificationSync({ socket: socket.socket, transport: server.transport })
    socket.connect()
    // Arrives while the sync is in flight, and is newer than what the sync will say.
    socket.frame(change(6, inboxRow('run', { title: 'newer', state: 'settled', settledAt: 9 })))
    await drain()
    expect(entries()).toHaveLength(1)
    expect(entries()[0]).toMatchObject({ title: 'newer', resolvedAt: 9 })

    // A replayed older change changes nothing.
    socket.frame(change(5, inboxRow('run', { title: 'older' })))
    expect(entries()[0]!.title).toBe('newer')
  })

  test('a full sync keeps a row that arrived live after its snapshot was taken', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const server = fakeServer()
    server.transport.sync = async () => {
      await gate
      return { changes: [change(1, inboxRow('old'))], cursor: 1, floor: 1, full: true }
    }
    const socket = fakeSocket()
    stop = startNotificationSync({ socket: socket.socket, transport: server.transport })
    socket.connect()
    socket.frame(change(2, inboxRow('fresh')))
    release()
    await drain()
    expect(ids().sort()).toEqual(['fresh', 'old'])
  })

  test('below the retained floor the server answers with the whole inbox, and the copy is replaced', async () => {
    const answers = [
      { changes: [change(1, inboxRow('stale'))], cursor: 1, floor: 1, full: true },
      // Retention pruned everything up to 50 while this window was away: a delta cannot be given.
      { changes: [change(60, inboxRow('kept'))], cursor: 60, floor: 50, full: true },
    ]
    const server = fakeServer({ sync: () => answers.shift()! })
    const socket = fakeSocket()
    stop = startNotificationSync({ socket: socket.socket, transport: server.transport })
    socket.connect()
    await drain()
    socket.disconnect()
    socket.connect()
    await drain()
    expect(ids()).toEqual(['kept'])
  })

  test('a server whose journal is BEHIND this window (a reset home) is read again from zero', async () => {
    const server = fakeServer({
      sync: (since) =>
        since === 0
          ? { changes: [change(1, inboxRow('new-home'))], cursor: 1, floor: 1, full: true }
          : { changes: [], cursor: 1, floor: 1, full: false },
    })
    const socket = fakeSocket()
    stop = startNotificationSync({ socket: socket.socket, transport: server.transport })
    socket.frame(change(40, inboxRow('from-before')))
    socket.connect()
    await drain()
    socket.disconnect()
    socket.connect()
    await drain()
    expect(server.state.syncs.at(-1)).toBe(0)
    expect(ids()).toContain('new-home')
  })

  test('a frame this client cannot read is dropped without touching the copy', async () => {
    const socket = fakeSocket()
    stop = startNotificationSync({ socket: socket.socket, transport: fakeServer().transport })
    socket.frame({ seq: 1 } as never)
    expect(entries()).toEqual([])
  })
})

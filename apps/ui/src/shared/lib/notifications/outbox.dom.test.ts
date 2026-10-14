import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import type { ClientJournalOp } from '@localixai/api/notification-contracts'

import { registerDom } from '@localixai/kit/testing/dom'
import { change, drain, fakeServer, fakeSocket, inboxRow } from './journal.test-utils'
import { startNotificationSync } from './inboxSync'
import { pendingOps, reloadOutboxForTests } from './outbox'
import {
  resetNotificationsForTests,
  seedNotificationsForTests,
  useNotificationsStore,
} from './store'

/**
 * The client's own writes: visible the moment they are made, delivered when the server can take
 * them, and never lost to the outage they so often describe.
 */

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(() => teardown())

const entries = () => useNotificationsStore.getState().entries
const store = () => useNotificationsStore.getState()
let stop: (() => void) | null = null

beforeEach(() => resetNotificationsForTests())
afterEach(() => {
  stop?.()
  stop = null
  resetNotificationsForTests()
})

function connected(server = fakeServer()) {
  const socket = fakeSocket()
  stop = startNotificationSync({ socket: socket.socket, transport: server.transport })
  socket.connect()
  return { server, socket }
}

describe('optimistic ops', () => {
  test('marking read shows at once, and the server answer replaces it without a flicker', async () => {
    const { server } = connected()
    await drain()
    seedNotificationsForTests([
      {
        id: 'a',
        topic: 'run.completed',
        category: 'agent',
        severity: 'success',
        title: 'Done',
        origin: { kind: 'application' },
      },
    ])
    server.state.answer = (op) =>
      op.op === 'read' ? [change(50, inboxRow('a', { title: 'Done', readAt: 7 }))] : []

    store().markRead('a')
    // Before the server has said anything.
    expect(entries()[0]!.read).toBe(true)
    await drain()
    expect(server.state.posts.flat().map((op) => op.op)).toEqual(['read'])
    expect(pendingOps()).toEqual([])
    expect(entries()[0]!.read).toBe(true)
  })

  test('remove, clear and settle each become the op the server applies', async () => {
    const { server } = connected()
    await drain()
    seedNotificationsForTests([
      {
        id: 'done',
        topic: 'run.completed',
        category: 'agent',
        severity: 'success',
        title: 'Done',
        origin: { kind: 'application' },
      },
      {
        id: 'problem',
        topic: 'application.notification',
        category: 'system',
        severity: 'error',
        title: 'Broken',
        origin: { kind: 'application' },
        condition: true,
      },
    ])
    store().clearHistory()
    // The standing problem survives a clear; the finished run does not.
    expect(entries().map((entry) => entry.id)).toEqual(['problem'])
    store().settle('problem', 'fixed')
    expect(entries()[0]!.resolvedAt).toBeGreaterThan(0)
    store().remove('problem')
    expect(entries()).toEqual([])
    await drain()
    expect(server.state.posts.flat().map((op) => op.op)).toEqual(['clear', 'settle', 'remove'])
  })

  test('mark all read covers what the server has shown and names what is still in transit', async () => {
    const { server } = connected(
      fakeServer({
        sync: () => ({ changes: [change(9, inboxRow('seen'))], cursor: 9, floor: 1, full: true }),
      }),
    )
    await drain()
    server.state.down = true
    const local = store().push({
      topic: 'application.notification',
      category: 'system',
      severity: 'error',
      title: 'Local',
      origin: { kind: 'application' },
    })
    store().markAllRead()
    expect(entries().every((entry) => entry.read)).toBe(true)
    const ops = pendingOps().filter((op) => op.op !== 'raise')
    expect(ops).toEqual([
      expect.objectContaining({ op: 'read_through', seq: 9 }),
      expect.objectContaining({ op: 'read', keys: [local] }),
    ])
  })
})

describe('the outbox', () => {
  test('a fact raised while the API is down stays on screen, survives a reload, and is resent once', async () => {
    const server = fakeServer()
    server.state.down = true
    const { socket } = connected(server)
    await drain()

    const key = store().push({
      topic: 'application.notification',
      category: 'system',
      severity: 'warning',
      title: 'Realtime connection unavailable',
      origin: { kind: 'application' },
      ts: 1234,
    })
    await drain()
    expect(entries().map((entry) => entry.id)).toEqual([key])
    expect(pendingOps()).toHaveLength(1)

    // A reload: the buffer is read back from storage, ops and all.
    const before = pendingOps().map((op) => op.id)
    reloadOutboxForTests()
    expect(pendingOps().map((op) => op.id)).toEqual(before)

    server.state.down = false
    server.state.answer = (op) =>
      op.op === 'raise' ? [change(3, inboxRow(op.fact.key, { title: op.fact.title }))] : []
    socket.disconnect()
    socket.connect()
    await drain()
    const sent = server.state.posts.flat() as Extract<ClientJournalOp, { op: 'raise' }>[]
    // The same op id — a resend after a lost answer is a no-op on the server — and the fact's own time.
    expect(sent.map((op) => op.id)).toEqual(before)
    expect(sent[0]!.fact.occurredAt).toBe(1234)
    expect(pendingOps()).toEqual([])
    expect(entries().map((entry) => entry.id)).toEqual([key])
  })

  test('ops wait while disconnected and are delivered in the order they were made', async () => {
    const server = fakeServer()
    const { socket } = connected(server)
    await drain()
    socket.disconnect()
    store().push({
      id: 'k',
      topic: 'application.notification',
      category: 'system',
      severity: 'error',
      title: 'Broken',
      origin: { kind: 'application' },
      condition: true,
    })
    store().resolveCondition('k')
    await drain()
    expect(server.state.posts).toEqual([])
    socket.connect()
    await drain()
    expect(server.state.posts.flat().map((op) => op.op)).toEqual(['raise', 'settle'])
  })

  test('a batch the server will never accept is dropped instead of resent forever', async () => {
    const server = fakeServer()
    server.state.reject = true
    connected(server)
    await drain()
    store().push({
      topic: 'application.notification',
      category: 'system',
      severity: 'info',
      title: 'x',
      origin: { kind: 'application' },
    })
    await drain()
    expect(server.state.posts).toHaveLength(1)
    expect(pendingOps()).toEqual([])
  })
})

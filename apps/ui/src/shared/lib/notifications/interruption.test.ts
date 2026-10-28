import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { resetActiveEventRoute, setActiveEventRoute } from './context'
import { change, drain, fakeServer, fakeSocket, inboxRow } from './journal.test-utils'
import { startNotificationSync } from './inboxSync'
import { pendingOps } from './outbox'
import { useNotificationPrefs } from './prefs'
import { resetNotificationsForTests, useNotificationsStore } from './store'

/**
 * Only a row that OPENS while this window is listening may interrupt — never one learned from a
 * sync, which is history — and then only as the shared policy allows.
 */

let stop: (() => void) | null = null
let banners: string[] = []

async function live(syncRows: ReturnType<typeof inboxRow>[] = [], focused = false) {
  const socket = fakeSocket()
  const server = fakeServer({
    sync: () => ({
      changes: syncRows.map((row, index) => change(index + 1, row)),
      cursor: syncRows.length,
      floor: 1,
      full: true,
    }),
  })
  stop = startNotificationSync({
    socket: socket.socket,
    transport: server.transport,
    interruption: {
      desktop: true,
      focused: () => focused,
      notify: (title) => void banners.push(title),
    },
  })
  socket.connect()
  await drain()
  return socket
}

beforeEach(() => {
  resetNotificationsForTests()
  resetActiveEventRoute()
  useNotificationPrefs.getState().setCondition('unfocused')
  banners = []
})
afterEach(() => {
  stop?.()
  stop = null
  resetNotificationsForTests()
  resetActiveEventRoute()
})

const now = () => Date.now()

describe('interrupting for a row that opens live', () => {
  test('a failure and a waiting request raise their banners; history from the sync does not', async () => {
    const socket = await live([
      inboxRow('old-failure', { severity: 'error', firstSeenAt: now(), lastSeenAt: now() }),
    ])
    expect(banners).toEqual([])

    socket.frame(
      change(
        10,
        inboxRow('run.failed:s1:m1', {
          topic: 'run.failed',
          severity: 'error',
          title: 'Agent run failed',
          lastSeenAt: now(),
        }),
      ),
    )
    socket.frame(
      change(
        11,
        inboxRow('hitl:r1', {
          topic: 'hitl.required',
          category: 'human-input',
          severity: 'warning',
          title: 'Approve?',
          lastSeenAt: now(),
        }),
      ),
    )
    expect(banners).toEqual(['Agent run failed', 'Approve?'])
  })

  test('what waits on the person is decided by its category, not by a list of topics', async () => {
    const socket = await live()
    // A presented plan shares HITL's topic but any future kind of waiting just needs the category.
    socket.frame(
      change(
        10,
        inboxRow('plan:s1:p1', {
          topic: 'hitl.required',
          category: 'human-input',
          severity: 'warning',
          title: 'Review plan',
          lastSeenAt: now(),
        }),
      ),
    )
    // The same topic filed as agent news is reporting, not waiting: no banner.
    socket.frame(
      change(
        11,
        inboxRow('hitl:filed-as-agent', {
          topic: 'hitl.required',
          category: 'agent',
          severity: 'warning',
          lastSeenAt: now(),
        }),
      ),
    )
    expect(banners).toEqual(['Review plan'])
  })

  test('a change to a row already open — read elsewhere, repeated — is not a new interruption', async () => {
    const socket = await live()
    const row = inboxRow('run.failed:s1:m1', { severity: 'error', lastSeenAt: now() })
    socket.frame(change(10, row))
    socket.frame(change(11, { ...row, occurrenceCount: 2 }))
    socket.frame(change(12, { ...row, readAt: now() }))
    expect(banners).toHaveLength(1)
  })

  test('a fact past its moment is recorded without a banner', async () => {
    const socket = await live()
    socket.frame(
      change(10, inboxRow('late', { severity: 'error', lastSeenAt: now() - 60 * 60_000 })),
    )
    expect(banners).toEqual([])
  })

  test("the producer's own wish wins: an outage this window raised stays inside the app", async () => {
    const socket = await live()
    const key = useNotificationsStore.getState().push(
      {
        topic: 'application.notification',
        category: 'system',
        severity: 'error',
        title: 'Down',
        origin: { kind: 'application' },
      },
      { hint: { native: false } },
    )
    socket.frame(change(10, inboxRow(key, { severity: 'error', title: 'Down', lastSeenAt: now() })))
    expect(banners).toEqual([])
  })

  test('the pref turns every banner off', async () => {
    useNotificationPrefs.getState().setCondition('off')
    const socket = await live()
    socket.frame(change(10, inboxRow('x', { severity: 'error', lastSeenAt: now() })))
    expect(banners).toEqual([])
  })

  test('a row from the chat on screen is marked read — the person is already looking at it', async () => {
    setActiveEventRoute('/project/p1/s1')
    const socket = await live([], true)
    socket.frame(
      change(
        10,
        inboxRow('run.completed:s1:m1', {
          topic: 'run.completed',
          severity: 'success',
          origin: { kind: 'session', sessionId: 's1', projectId: 'p1' },
          lastSeenAt: now(),
        }),
      ),
    )
    expect(useNotificationsStore.getState().entries[0]!.read).toBe(true)
    expect(pendingOps()).toContainEqual(
      expect.objectContaining({ op: 'read', keys: ['run.completed:s1:m1'] }),
    )
  })
})

test('an inactive native tab cannot mark its chat read', async () => {
  setActiveEventRoute('/project/p1/s1')
  const socket = await live()
  socket.frame(
    change(
      10,
      inboxRow('hitl:background', {
        category: 'human-input',
        severity: 'warning',
        title: 'Review plan',
        origin: { kind: 'session', sessionId: 's1', projectId: 'p1' },
        lastSeenAt: now(),
      }),
    ),
  )
  expect(useNotificationsStore.getState().entries[0]!.read).toBe(false)
  expect(pendingOps().some((op) => op.op === 'read')).toBe(false)
  expect(banners).toEqual(['Review plan'])
})

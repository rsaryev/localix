import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { notificationCommandAvailable } from './commandRegistry'
import { change, drain, fakeServer, fakeSocket, inboxRow } from './journal.test-utils'
import { startNotificationSync } from './inboxSync'
import { pendingOps } from './outbox'
import { resetNotificationsForTests, useNotificationsStore } from './store'
import type { NotificationAction } from './types'

/**
 * A callback cannot be stored, so it lives beside the row in this window only — merged in when
 * the row renders, retired when the row settles, gone when it expires.
 */

const entries = () => useNotificationsStore.getState().entries
const undo = (expiresAt?: number): NotificationAction => ({
  id: 'undo',
  label: 'Undo',
  kind: 'callback',
  onClick: () => {},
  available: true,
  ...(expiresAt ? { expiresAt } : {}),
})
const agent: NotificationAction = {
  id: 'send-to-agent',
  label: 'Send to agent',
  kind: 'invoke',
  command: 'send_to_agent',
  available: true,
}
let stop: (() => void) | null = null

beforeEach(() => resetNotificationsForTests())
afterEach(() => {
  stop?.()
  stop = null
  resetNotificationsForTests()
})

function push(actions: NotificationAction[]) {
  return useNotificationsStore.getState().push({
    topic: 'application.notification',
    category: 'system',
    severity: 'info',
    title: 'Renamed',
    origin: { kind: 'application' },
    actions,
  })
}

describe('callbacks beside the journal', () => {
  test('are never sent, but render in the producer’s order with the serializable ones', () => {
    push([undo(), agent])
    const [raise] = pendingOps()
    expect(raise?.op === 'raise' && raise.fact.actions?.map((action) => action.id)).toEqual([
      'send-to-agent',
    ])
    expect(entries()[0]!.actions?.map((action) => action.id)).toEqual(['undo', 'send-to-agent'])
  })

  test('leave the row when they expire', async () => {
    // Capture the expiry timer instead of waiting for it, then fire it at the point of expiry.
    const realSetTimeout = globalThis.setTimeout
    const expiries: Array<() => void> = []
    globalThis.setTimeout = ((fn: () => void) => {
      expiries.push(fn)
      return 0
    }) as unknown as typeof setTimeout
    try {
      push([undo(Date.now() + 5)])
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
    expect(entries()[0]!.actions).toHaveLength(1)
    for (const expire of expiries) expire()
    expect(entries()[0]!.actions ?? []).toEqual([])
  })

  test('die with the row: settled on the server, they can no longer act', async () => {
    const socket = fakeSocket()
    const server = fakeServer()
    stop = startNotificationSync({ socket: socket.socket, transport: server.transport })
    socket.connect()
    await drain()
    const key = push([undo(), agent])
    socket.frame(
      change(
        5,
        inboxRow(key, {
          title: 'Renamed',
          state: 'settled',
          settledAt: 9,
          actions: [
            {
              id: agent.id,
              label: agent.label,
              kind: 'invoke',
              command: agent.command,
              available: false,
            },
          ],
        }),
      ),
    )
    await drain()
    const actions = entries().find((entry) => entry.id === key)?.actions ?? []
    // Only the stored action remains, and it carries the server's availability.
    expect(actions.map((action) => [action.id, notificationCommandAvailable(action)])).toEqual([
      ['send-to-agent', false],
    ])
  })
})

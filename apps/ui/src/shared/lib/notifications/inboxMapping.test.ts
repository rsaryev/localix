import { describe, expect, test } from 'bun:test'
import type { InboxEntry } from '@localixai/api/notification-contracts'

import { entryFromInbox, factFromEntry } from './inboxMapping'

/**
 * A recovery action ("Open MCP settings", "Sign in") is a `navigate` action whose destination is a
 * `localix://` URI rather than a conversation. Dropping the URI anywhere on the way left the button
 * on the row with nothing to open — a click that went nowhere.
 */
describe('a recovery action keeps its destination across the journal', () => {
  const row = {
    key: 'condition:mcp:github',
    topic: 'application.notification',
    category: 'system',
    severity: 'error',
    title: 'Sign in to the GitHub MCP server',
    origin: { kind: 'session', sessionId: 'LX-1', projectId: null },
    actions: [
      {
        id: 'sign-in',
        label: 'Sign in',
        kind: 'navigate',
        uri: 'localix://ui/settings/mcp',
        available: true,
      },
    ],
    state: 'open',
    occurrenceCount: 1,
    firstSeenAt: 1,
    lastSeenAt: 1,
    createdAt: 1,
    readAt: null,
  } as unknown as InboxEntry

  test('reading a row keeps the URI on its action', () => {
    expect(entryFromInbox(row).actions?.[0]?.uri).toBe('localix://ui/settings/mcp')
  })

  test('writing the row back keeps it too', () => {
    const fact = factFromEntry(entryFromInbox(row), { occurredAt: 2 })
    expect(fact.actions?.[0]).toMatchObject({ kind: 'navigate', uri: 'localix://ui/settings/mcp' })
  })
})

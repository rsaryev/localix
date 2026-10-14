import { describe, expect, it } from 'bun:test'
import { notificationNavTarget } from './navigate'
import type { NotificationEntry, NotificationOrigin } from './types'

function entry(origin: NotificationOrigin): NotificationEntry {
  return {
    id: 'a',
    topic: 'application.notification',
    category: 'system',
    severity: 'info',
    title: 'Hello',
    origin,
    ts: 1,
    read: false,
  }
}

describe('notificationNavTarget', () => {
  it('returns the explicitly typed session origin', () => {
    expect(
      notificationNavTarget(
        entry({ kind: 'session', sessionId: 'LOCALIX-18', projectId: 'project-1' }),
      ),
    ).toEqual({ sessionId: 'LOCALIX-18', projectId: 'project-1' })
  })

  it('keeps Global scope explicit', () => {
    expect(
      notificationNavTarget(entry({ kind: 'session', sessionId: 'LOCALIX-18', projectId: null })),
    ).toEqual({ sessionId: 'LOCALIX-18', projectId: null })
  })

  it('does not infer navigation from application events', () => {
    expect(notificationNavTarget(entry({ kind: 'application' }))).toBeNull()
  })
})

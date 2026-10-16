import { describe, expect, it } from 'bun:test'
import { sanitizeNotificationEntry } from './sanitize'
import type { NotificationEntry } from './types'

function entry(): NotificationEntry {
  return {
    id: 'event-1',
    topic: 'application.notification',
    category: 'system',
    severity: 'error',
    title: 'T'.repeat(400),
    message: 'M'.repeat(8_000),
    origin: {
      kind: 'resource',
      sessionId: 'LOCALIX-18',
      projectId: 'project-1',
      resourceKind: 'tool',
      resourceId: 'call-identity-must-remain-exact',
      label: 'L'.repeat(300),
    },
    actions: [
      {
        id: 'retry',
        label: 'A'.repeat(300),
        kind: 'navigate',
        target: { kind: 'session', sessionId: 'LOCALIX-18', projectId: 'project-1' },
        available: true,
      },
    ],
    trace: Array.from({ length: 20 }, (_, index) => ({
      id: `step-${index}`,
      ts: index,
      kind: `kind-${index}-${'K'.repeat(200)}`,
      summary: 'S'.repeat(1_000),
      origin: { kind: 'session' as const, sessionId: 'LOCALIX-18', projectId: 'project-1' },
      attributes: Object.fromEntries(
        Array.from({ length: 30 }, (__, attribute) => [
          `attribute-${attribute}`,
          attribute === 0 ? Number.NaN : 'V'.repeat(1_000),
        ]),
      ),
    })),
    ts: 1,
    read: false,
  }
}

describe('event journal sanitization', () => {
  it('bounds display/diagnostic data while preserving navigation identities', () => {
    const sanitized = sanitizeNotificationEntry(entry())

    expect(sanitized.title.endsWith('…')).toBeTrue()
    expect(sanitized.message?.endsWith('…')).toBeTrue()
    expect(sanitized.trace).toHaveLength(12)
    expect(sanitized.trace?.[0]?.id).toBe('step-8')
    expect(Object.keys(sanitized.trace?.[0]?.attributes ?? {})).toHaveLength(23)
    expect(sanitized.trace?.[0]?.attributes?.['attribute-0']).toBeUndefined()
    expect(sanitized.origin).toMatchObject({
      sessionId: 'LOCALIX-18',
      resourceId: 'call-identity-must-remain-exact',
    })
    expect(sanitized.actions?.[0]?.target?.sessionId).toBe('LOCALIX-18')
  })
})

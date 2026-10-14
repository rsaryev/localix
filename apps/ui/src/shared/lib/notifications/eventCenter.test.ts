import { describe, expect, it } from 'bun:test'
import {
  eventNeedsAction,
  eventSignalKey,
  filterEvents,
  formatEventForClipboard,
  highestUnreadSeverity,
  retainActionableEvents,
} from './eventCenter'
import type { NotificationEntry } from './types'

function entry(over: Partial<NotificationEntry> = {}): NotificationEntry {
  return {
    id: over.id ?? 'event-1',
    topic: over.topic ?? 'application.notification',
    category: over.category ?? 'system',
    severity: over.severity ?? 'info',
    title: over.title ?? 'Something happened',
    origin: over.origin ?? { kind: 'application' },
    ts: over.ts ?? 1,
    read: over.read ?? false,
    ...over,
  }
}

describe('event center filtering', () => {
  const rows = [
    entry({
      id: 'hitl',
      topic: 'hitl.required',
      category: 'human-input',
      severity: 'warning',
      title: 'Approve deploy',
      origin: { kind: 'session', sessionId: 'LOCALIX-14', projectId: null },
      actions: [
        {
          id: 'respond',
          label: 'Respond',
          kind: 'navigate',
          target: {
            kind: 'session',
            sessionId: 'LOCALIX-14',
            projectId: null,
            focus: 'interaction',
          },
          requestId: 'r1',
          available: true,
        },
      ],
    }),
    entry({
      id: 'terminal',
      topic: 'terminal.finished',
      category: 'terminal',
      severity: 'error',
      title: 'Build failed',
      read: true,
    }),
  ]

  it('finds action-required events and excludes resolved requests', () => {
    expect(eventNeedsAction(rows[0])).toBe(true)
    expect(eventNeedsAction({ ...rows[0], resolvedAt: 2 })).toBe(false)
    expect(
      filterEvents(rows, {
        scope: 'action',
        category: 'all',
        severity: 'all',
        time: 'all',
        query: '',
      }),
    ).toHaveLength(1)
  })

  it('clears settled history without discarding pending actions', () => {
    expect(retainActionableEvents(rows).map((row) => row.id)).toEqual(['hitl'])
    expect(retainActionableEvents([{ ...rows[0], resolvedAt: 2 }, rows[1]])).toEqual([])
  })

  it('combines category, severity and text search', () => {
    expect(
      filterEvents(rows, {
        scope: 'all',
        category: 'human-input',
        severity: 'warning',
        time: 'all',
        query: 'localix-14',
      }).map((row) => row.id),
    ).toEqual(['hitl'])
  })

  it('supports structured, negative, trace and current-session queries', () => {
    const traced = entry({
      id: 'trace',
      category: 'system',
      severity: 'error',
      origin: {
        kind: 'resource',
        sessionId: 'LOCALIX-18',
        projectId: null,
        resourceKind: 'tool',
        resourceId: 'call-1',
      },
      trace: [
        {
          id: 'step-1',
          ts: 9_000,
          kind: 'rpc.interact',
          summary: 'interact failed',
          origin: { kind: 'session', sessionId: 'LOCALIX-18', projectId: null },
          attributes: { code: 'interaction_settled' },
        },
      ],
      ts: 10_000,
    })
    const other = entry({ id: 'other', severity: 'error', ts: 10_000 })

    expect(
      filterEvents(
        [traced, other],
        {
          scope: 'session',
          category: 'all',
          severity: 'all',
          time: 'all',
          query: 'level:error source:tool trace:interact -topic:terminal.finished',
          currentSessionId: 'LOCALIX-18',
        },
        10_000,
      ).map((item) => item.id),
    ).toEqual(['trace'])
  })

  it('supports resource, project, phase, action, presence and typographic negation filters', () => {
    const traced = entry({
      id: 'resource-event',
      severity: 'warning',
      occurrenceCount: 2,
      origin: {
        kind: 'resource',
        sessionId: 'LOCALIX-18',
        projectId: 'project-1',
        resourceKind: 'tool',
        resourceId: 'call-7',
      },
      actions: [
        {
          id: 'retry',
          label: 'Retry operation',
          kind: 'invoke',
          command: 'plugin.retry',
          available: true,
        },
      ],
      trace: [
        {
          id: 'failed-step',
          ts: 1_000,
          kind: 'rpc.interact',
          summary: 'interact failed',
          phase: 'failed',
          origin: { kind: 'session', sessionId: 'LOCALIX-18', projectId: 'project-1' },
        },
      ],
    })

    const match = (query: string) =>
      filterEvents([traced], {
        scope: 'all',
        category: 'all',
        severity: 'all',
        time: 'all',
        query,
      })
    expect(
      match(
        'project:project-1 resource:call-7 phase:failed action:plugin.retry has:trace has:session is:repeated is:failed −level:error',
      ),
    ).toHaveLength(1)
    expect(match('has:resource −resource:tool')).toEqual([])
  })

  it('filters against the last occurrence time', () => {
    const repeated = entry({ id: 'repeat', ts: 1_000, lastSeenAt: 9_500 })
    expect(
      filterEvents(
        [repeated],
        { scope: 'all', category: 'all', severity: 'all', time: 'hour', query: '' },
        10_000,
      ),
    ).toHaveLength(1)
  })

  it('changes the bell signal when an existing row receives another occurrence', () => {
    const first = entry({ id: 'same', ts: 1_000, occurrenceCount: 1, lastSeenAt: 1_000 })
    const repeated = { ...first, ts: 2_000, occurrenceCount: 2, lastSeenAt: 2_000 }
    expect(eventSignalKey(repeated)).not.toBe(eventSignalKey(first))
  })

  it('uses the most urgent unread severity for the trigger signal', () => {
    expect(highestUnreadSeverity(rows)).toBe('warning')
    expect(highestUnreadSeverity([...rows, entry({ id: 'error', severity: 'error' })])).toBe(
      'error',
    )
  })

  it('formats portable diagnostics with origin, actions and structured trace data', () => {
    const details = formatEventForClipboard(
      entry({
        title: 'Deploy failed',
        message: 'The deploy command exited with status 1.',
        severity: 'error',
        category: 'terminal',
        topic: 'terminal.finished',
        ts: 1_000,
        origin: {
          kind: 'resource',
          sessionId: 'LOCALIX-18',
          projectId: 'project-1',
          resourceKind: 'terminal',
          resourceId: 'term-7',
        },
        actions: [
          {
            id: 'retry',
            label: 'Retry',
            kind: 'invoke',
            command: 'terminal.retry',
            available: true,
          },
        ],
        trace: [
          {
            id: 'trace-1',
            ts: 900,
            kind: 'terminal.lifecycle',
            summary: 'Process exited',
            phase: 'failed',
            origin: {
              kind: 'resource',
              sessionId: 'LOCALIX-18',
              projectId: 'project-1',
              resourceKind: 'terminal',
              resourceId: 'term-7',
            },
            attributes: { exitCode: 1 },
          },
        ],
      }),
    )

    expect(details).toContain('Severity: error')
    expect(details).toContain('Origin: project-1 / LOCALIX-18 / terminal:term-7')
    expect(details).toContain('Retry [invoke:terminal.retry]')
    expect(details).toContain('[failed] terminal.lifecycle: Process exited')
    expect(details).toContain('Data: exitCode=1')
  })
})

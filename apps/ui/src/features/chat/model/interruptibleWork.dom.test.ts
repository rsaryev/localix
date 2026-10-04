import { describe, expect, test } from 'bun:test'
import type { SessionWork, UiSession } from '@/shared/api/contracts'
import { collectInterruptibleWork, describeInterruptibleWork } from './interruptibleWork'

/**
 * Restart-to-update used to end every agent turn and background job on one click; at the next
 * boot the jobs came back `lost`. The confirmation must name exactly what a restart stops — and
 * nothing it does not, or it becomes a dialog people learn to click through. (Reading the roster
 * is `restartToUpdate.dom.test.ts`.)
 */

const work = (id: string, kind: SessionWork['kind'], label: string): SessionWork => ({
  id,
  kind,
  label,
  startedAt: '2026-09-29T00:00:00.000Z',
  toolCallId: `call-${id}`,
  terminalId: null,
  eventCount: 0,
  lastEvent: null,
  lastEventAt: null,
})

const session = (patch: Partial<UiSession>): UiSession =>
  ({
    id: 'session',
    title: 'Conversation',
    isRunning: false,
    parentSessionId: null,
    work: [],
    messages: [],
    ...patch,
  }) as unknown as UiSession

describe('interruptible work', () => {
  test('names running top-level turns and every job a restart loses', () => {
    const found = collectInterruptibleWork([
      session({ id: 'a', title: 'Release notes', isRunning: true }),
      // Its turn is part of the parent's, so it is not a second interruption.
      session({ id: 'b', title: 'Child', isRunning: true, parentSessionId: 'a' }),
      session({
        id: 'c',
        title: 'Dev server',
        work: [work('bg-3', 'job', 'bun run dev'), work('mon-1', 'monitor', 'CI status')],
      }),
    ])

    expect(found).toEqual({ turns: ['Release notes'], work: ['bg-3 (bun run dev)'] })
    expect(describeInterruptibleWork(found)).toBe(
      'Restarting stops 1 agent turn in Release notes, and 1 background job: bg-3 (bun run dev). ' +
        'A stopped turn does not continue after the update, and a stopped job comes back marked lost.',
    )
  })

  test('says nothing when only a resumable monitor is running', () => {
    const found = collectInterruptibleWork([
      session({ work: [work('mon-1', 'monitor', 'CI status')] }),
    ])
    expect(describeInterruptibleWork(found)).toBeNull()
  })

  test('caps the names it lists and counts the rest', () => {
    expect(describeInterruptibleWork({ turns: ['A', 'B', 'C', 'D', 'E'], work: [] })).toStartWith(
      'Restarting stops 5 agent turns in A, B, C and 2 more.',
    )
  })
})

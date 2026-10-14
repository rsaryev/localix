import { describe, expect, test } from 'bun:test'

import { ApiError } from '../../../lib/errors'
import type { WakeRequest } from '../contracts'
import type { SessionRecord } from '../repository'
import { wakeSession, type TurnEntryContext } from './turn-entry'

const chat = {
  id: 's1',
  userId: 'u1',
  sessionKind: 'chat',
  agents: [{ agentId: 'qa', handle: 'qa' }],
} as unknown as SessionRecord
const job = { id: 's1', userId: 'u1', sessionKind: 'job' } as unknown as SessionRecord

function ctx(
  requireSession: TurnEntryContext['requireSession'],
  woke: Record<string, unknown>[] = [],
): TurnEntryContext {
  return {
    requireSession,
    runner: {
      wake: async (params: Record<string, unknown>) => {
        woke.push(params)
      },
    },
  } as unknown as TurnEntryContext
}

const request = (content: string, extra: Partial<WakeRequest> = {}): WakeRequest => ({
  userId: 'u1',
  sessionId: 's1',
  content,
  source: 'bg-job',
  ...extra,
})

describe('wakeSession answers whether the wake landed', () => {
  test('a delivered wake reports delivered', async () => {
    const woke: Record<string, unknown>[] = []
    const res = await wakeSession(
      ctx(async () => chat, woke),
      request('board moved'),
    )
    expect(res).toEqual({ delivered: true })
    expect(woke.map((params) => params.content)).toEqual(['board moved'])
  })

  test('every named field reaches the queue, and an unset one is absent rather than undefined', async () => {
    // The positional form forwarded `undefined` placeholders and re-spread `...args`; a named
    // request either carries a field or does not.
    const woke: Record<string, unknown>[] = []
    await wakeSession(
      ctx(async () => chat, woke),
      request('report', {
        source: 'subagent',
        to: { participant: 'agent:qa', handle: 'qa' },
        deliveryKey: 'child-terminal:c1',
        receipt: true,
      }),
    )
    await wakeSession(
      ctx(async () => chat, woke),
      request('tick'),
    )
    expect(woke[0]).toMatchObject({
      source: 'subagent',
      to: { participant: 'agent:qa', handle: 'qa' },
      deliveryKey: 'child-terminal:c1',
      receipt: true,
    })
    expect(Object.keys(woke[1]!).sort()).toEqual(['content', 'session', 'source', 'userId'])
  })

  test('an addressee who LEFT is dropped, so the wake still lands and the conversation chooses', async () => {
    // The drain dismisses a delivery no current participant answers — a loop armed by a removed
    // participant would otherwise vanish on every fire.
    const woke: Record<string, unknown>[] = []
    const res = await wakeSession(
      ctx(async () => chat, woke),
      request('tick', { source: 'loop', to: { participant: 'agent:backend', handle: 'backend' } }),
    )
    expect(res).toEqual({ delivered: true })
    expect(woke[0]).not.toHaveProperty('to')
  })

  test('a deleted session is `gone` — the ordinary case, no detail', async () => {
    const res = await wakeSession(
      ctx(() => Promise.reject(new ApiError(404, 'not_found', 'No such session.'))),
      request('x'),
    )
    expect(res).toEqual({ delivered: false, missed: 'gone' })
  })

  test('a STORE failure is distinguishable from a deleted session, and carries the raw text', async () => {
    // This is the one that stalled a board: the wake was dropped and nothing anywhere
    // said why, because a repository error and a 404 looked identical to the caller.
    const res = await wakeSession(
      ctx(() => Promise.reject(new Error('SQLITE_BUSY: database is locked'))),
      request('x'),
    )
    expect(res.delivered).toBe(false)
    expect(res.missed).toBe('unreadable')
    expect(res.detail).toContain('SQLITE_BUSY')
  })

  // A board that woke the chat once used to leave its tool on the session for good.
  test('a plugin’s wake carries its plugin to the queued row, and writes nothing to the session', async () => {
    const woke: Record<string, unknown>[] = []
    const record = { ...chat, activatedTools: ['github_create_issue'] } as SessionRecord
    const context = {
      requireSession: async () => record,
      repo: {
        changeActivatedTools: () => {
          throw new Error('a wake must not touch the stored activations')
        },
      },
      runner: {
        wake: async (params: Record<string, unknown>) => {
          woke.push(params)
        },
      },
    } as unknown as TurnEntryContext

    const res = await wakeSession(
      context,
      request('your move', { source: 'plugin', plugin: 'board-game' }),
    )

    expect(res).toEqual({ delivered: true })
    expect(woke[0]).toMatchObject({ plugins: ['board-game'] })
    expect(record.activatedTools).toEqual(['github_create_issue'])
  })

  test('a non-chat target is refused, and says so', async () => {
    const woke: Record<string, unknown>[] = []
    const res = await wakeSession(
      ctx(async () => job, woke),
      request('x'),
    )
    expect(res).toEqual({ delivered: false, missed: 'not-chat' })
    expect(woke).toEqual([])
  })

  test('a delegated child takes its own child’s REPORT — and nothing else', async () => {
    // Once children delegate, a grandchild's report answers the child that asked for the work.
    const child = {
      ...chat,
      sessionKind: 'subagent',
      provenance: { kind: 'task-delegation', parentSessionId: 'root', toolCallId: 't' },
    } as unknown as SessionRecord
    const woke: Record<string, unknown>[] = []
    const report = request('done', { source: 'subagent' })
    expect(
      await wakeSession(
        ctx(async () => child, woke),
        report,
      ),
    ).toEqual({ delivered: true })
    // Any other producer is still refused.
    expect(
      await wakeSession(
        ctx(async () => child, woke),
        request('x'),
      ),
    ).toEqual({
      delivered: false,
      missed: 'not-chat',
    })
    // And a closed child takes nothing at all.
    const closed = { ...child, closedAt: '2026-10-01' } as SessionRecord
    expect(
      await wakeSession(
        ctx(async () => closed, woke),
        report,
      ),
    ).toMatchObject({
      delivered: false,
    })
    expect(woke).toHaveLength(1)
  })
})

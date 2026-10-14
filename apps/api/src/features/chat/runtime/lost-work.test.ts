import { describe, expect, test } from 'bun:test'

import type { WorkRecord } from '../../work/contracts'
import { itemEndingOf, markLostWorkItems, settleWorkItem } from './lost-work'

const lostJob = (over: Partial<WorkRecord> = {}): WorkRecord => ({
  id: 'w1',
  userId: 'u1',
  sessionId: 's1',
  agentId: 'lead',
  displayId: 'bg-1',
  kind: 'job',
  label: 'bun dev',
  status: 'lost',
  exitCode: null,
  toolCallId: 'tc-1',
  messageId: 'm1',
  terminalId: null,
  childSessionId: null,
  eventCount: 0,
  lastEvent: null,
  lastEventAt: null,
  startedAt: '2026-09-23T10:00:00.000Z',
  endedAt: '2026-09-23T11:00:00.000Z',
  ...over,
})

function repo(items: unknown[]) {
  const patches: unknown[] = []
  return {
    patches,
    repo: {
      getMessage: async () => ({ payload: { items } }),
      updateMessage: async (_u: string, _s: string, _id: string, patch: unknown) => {
        patches.push(patch)
        return null
      },
    } as never,
  }
}

describe('a job lost to a restart stops claiming to run', () => {
  test("its item is aborted and says `lost` — the badge's live state came from `running`", async () => {
    const running = {
      type: 'command',
      id: 'tc-1',
      toolCallId: 'tc-1',
      status: 'running',
      jobStatus: 'running',
    }
    const other = { type: 'command', id: 'tc-2', toolCallId: 'tc-2', status: 'completed' }
    const h = repo([running, other])
    expect(await markLostWorkItems(h.repo, [lostJob()], '2026-09-23T12:00:00.000Z')).toBe(1)
    expect(h.patches).toEqual([
      { items: [{ ...running, status: 'aborted', jobStatus: 'lost' }, other] },
    ])
  })

  test('work with no item to correct is skipped, and one failure does not stop the rest', async () => {
    const warnings: string[] = []
    const calls: string[] = []
    const flaky = {
      getMessage: async (_u: string, _s: string, id: string) => {
        calls.push(id)
        if (id === 'm-broken') throw new Error('SQLITE_BUSY')
        return {
          payload: {
            items: [{ type: 'command', id: 'tc-1', toolCallId: 'tc-1', status: 'running' }],
          },
        }
      },
      updateMessage: async () => null,
    } as never
    const marked = await markLostWorkItems(
      flaky,
      [
        lostJob({ messageId: null }),
        lostJob({ messageId: 'm-broken' }),
        lostJob({ messageId: 'm-ok' }),
      ],
      '2026-09-23T12:00:00.000Z',
      { warn: (msg) => warnings.push(msg) },
    )
    expect(calls).toEqual(['m-broken', 'm-ok'])
    expect(marked).toBe(1)
    expect(warnings).toHaveLength(1)
  })
})

describe('a resumed monitor that ends settles its card itself', () => {
  test('the item reads as the work ended, and the corrected row is PUBLISHED', async () => {
    const item = { type: 'command', id: 'tc-1', toolCallId: 'tc-1', status: 'running' }
    const published: unknown[] = []
    const ports = {
      repo: {
        getMessage: async () => ({ payload: { items: [item] }, createdAt: 'c' }),
        updateMessage: async () => null,
      } as never,
      streamRegistry: {
        publish: (_u: string, _s: string, event: unknown) => published.push(event),
      } as never,
    }
    const record = lostJob({ kind: 'monitor', displayId: 'mon-1', status: 'succeeded' })
    expect(await settleWorkItem(ports, record, itemEndingOf(record.status), 'now')).toBe(true)
    expect(published).toMatchObject([
      {
        type: 'message.updated',
        message: {
          payload: { items: [{ ...item, status: 'completed', jobStatus: 'completed' }] },
        },
      },
    ])
  })
})

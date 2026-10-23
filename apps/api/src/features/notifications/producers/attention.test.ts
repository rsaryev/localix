import { afterEach, describe, expect, it } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import { createHitlRegistry } from '../../chat/runtime/hitl-registry'
import type { SessionPlan } from '../../plans/contracts'
import { createMemoryWorkRepository } from '../../work/testing/memory-repository'
import { createWorkRegistry } from '../../work/registry'
import type { InboxEntry } from '../contracts'
import { createNotificationJournal } from '../journal'
import { settleStaleRequests } from './boot'
import { startAgentNotifications } from '.'
import type { SessionFacts } from './facts'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

const U = 'local-user'
const chat: SessionFacts = {
  id: 'R',
  projectId: 'P1',
  title: 'Deploy',
  sessionKind: 'chat',
  parentSessionId: null,
  provenance: { kind: 'root' },
}

const plan = (n: number, overrides: Partial<SessionPlan> = {}): SessionPlan => ({
  id: `p${n}`,
  sessionId: 'R',
  version: n,
  status: 'presented',
  title: `Cache v${n}`,
  body: '## Goal\nFast',
  authorAgentId: 'lead',
  approvedMode: null,
  createdAt: '2026-10-03T00:00:00.000Z',
  decidedAt: null,
  completedAt: null,
  completionSummary: null,
  dismissedBy: null,
  filePath: `/w/.localix/plans/LOCALIX-1/v${n}.md`,
  ...overrides,
})

async function setup() {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  const journal = createNotificationJournal({ db })
  const producers = await startAgentNotifications({
    db,
    journal,
    lookupSession: async (_user, id) => (id === chat.id ? chat : null),
    defaultUserId: U,
    work: createWorkRegistry({ repo: createMemoryWorkRepository() }),
  })
  const inbox = async (): Promise<Map<string, InboxEntry>> => {
    await producers.idle()
    await journal.flush()
    const rows = new Map<string, InboxEntry>()
    for (const change of (await journal.sync(U, 0)).changes)
      if ('entry' in change) rows.set(change.entry.key, change.entry)
    return rows
  }
  return { db, journal, producers, inbox }
}

describe('a plan waiting for review, in the journal', () => {
  it('raises one human-input row with Open chat and a Review plan focus action', async () => {
    const { producers, inbox } = await setup()
    producers.plans.awaiting(U, plan(1), 'lead')
    const row = (await inbox()).get('plan:R:p1')
    expect(row).toMatchObject({
      topic: 'hitl.required',
      category: 'human-input',
      severity: 'warning',
      title: '@lead presented a plan',
      body: 'Plan v1: Cache v1',
      state: 'open',
      origin: { kind: 'resource', resourceKind: 'plan', resourceId: 'p1', label: 'Plan' },
    })
    expect(row!.actions?.map((action) => action.id)).toEqual(['open', 'review'])
    expect(row!.actions?.[1]).toMatchObject({
      label: 'Review plan',
      kind: 'navigate',
      target: { sessionId: 'R', focus: 'interaction' },
    })
  })

  it('a newer version supersedes the older row; decisions settle with their reason', async () => {
    const { producers, inbox } = await setup()
    producers.plans.awaiting(U, plan(1), null)
    producers.plans.awaiting(U, plan(2), null)
    let rows = await inbox()
    expect(rows.get('plan:R:p1')).toMatchObject({ state: 'settled', settleReason: 'superseded' })
    expect(rows.get('plan:R:p2')).toMatchObject({
      state: 'open',
      title: 'A plan is waiting for your review',
    })
    producers.plans.settled(U, 'R', 'p2', 'answered')
    producers.plans.awaiting(U, plan(3), null)
    producers.plans.settled(U, 'R', 'p3', 'dismissed')
    rows = await inbox()
    expect(rows.get('plan:R:p2')).toMatchObject({ settleReason: 'answered' })
    expect(rows.get('plan:R:p3')).toMatchObject({ settleReason: 'dismissed' })
  })

  it('the boot sweep settles hitl rows and leaves plan rows open', async () => {
    const { db, journal, producers, inbox } = await setup()
    producers.plans.awaiting(U, plan(1), null)
    producers.hitl.raised({ userId: U, sessionId: 'R', requestId: 'r1', title: 'Pick' })
    await inbox()
    await settleStaleRequests(db, journal)
    const rows = await inbox()
    expect(rows.get('hitl:r1')).toMatchObject({ state: 'settled', settleReason: 'restart' })
    expect(rows.get('plan:R:p1')?.state).toBe('open')
  })

  it('a completed plan is an informational row nobody has to act on', async () => {
    const { producers, inbox } = await setup()
    producers.plans.completed(U, plan(1, { status: 'completed', completionSummary: 'Shipped' }))
    expect((await inbox()).get('plan-completed:R:p1')).toMatchObject({
      topic: 'run.completed',
      category: 'agent',
      severity: 'info',
      title: 'Plan v1 completed',
      body: 'Shipped',
      state: 'open',
    })
  })
})

describe('the other sources keep their rows', () => {
  it('an interaction item carries the hitl.requested payload, so it can be answered in place', async () => {
    const { producers } = await setup()
    const hitl = createHitlRegistry({ lifecycle: producers.hitl })
    const request = { id: 'r1', kind: 'ask', title: 'Pick a region', payload: { q: 1 } } as never
    hitl.trackRequest('R', 'm1', 'call-1', 'ask', request, U)
    expect(producers.attention.list(U)[0]).toMatchObject({
      key: 'hitl:r1',
      kind: 'interaction',
      sessionId: 'R',
      subject: { requestId: 'r1' },
      interaction: {
        messageId: 'm1',
        toolCallId: 'call-1',
        toolName: 'ask',
        request: { requestId: 'r1', kind: 'ask', title: 'Pick a region', payload: { q: 1 } },
      },
    })
  })

  it('a mention row names who asked and settles when the person writes', async () => {
    const { producers, inbox } = await setup()
    producers.mentions.mentioned({
      userId: U,
      sessionId: 'R',
      messageId: 'm1',
      from: 'qa',
      text: 'Ship it?',
      mentionedAt: Date.parse('2026-10-03T00:00:00.000Z'),
    })
    expect((await inbox()).get('mention:R:m1')).toMatchObject({
      topic: 'user.mentioned',
      category: 'human-input',
      title: '@qa assigned you a card',
      body: 'Ship it?',
    })
    expect(producers.attention.list(U)[0]).toMatchObject({
      kind: 'mention',
      summary: 'Ship it?',
      subject: { messageId: 'm1', agentHandle: 'qa' },
    })
    producers.mentions.answered(U, 'R')
    expect((await inbox()).get('mention:R:m1')).toMatchObject({ settleReason: 'answered' })
    expect(producers.attention.list(U)).toEqual([])
  })
})

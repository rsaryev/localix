import { afterEach, describe, expect, it } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import type { InboxEntry } from '../contracts'
import { createNotificationJournal } from '../journal'
import { createAgentNotifications } from '.'
import type { SessionFacts } from './facts'
import type { RunEnded } from './runs'
import { presentErrorInfo } from '@localixai/agent/agents'
import { createProviderConditions } from '../conditions/providers'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

const U = 'local-user'
const chat: SessionFacts = {
  id: 'S1',
  projectId: 'P1',
  title: 'Refactor the parser',
  sessionKind: 'chat',
  parentSessionId: null,
  provenance: { kind: 'root' },
}

async function setup() {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  const journal = createNotificationJournal({ db })
  const producers = createAgentNotifications({
    journal,
    lookupSession: async (_user, id) => (id === chat.id ? chat : null),
    defaultUserId: U,
    runningWork: () => [],
  })
  const inbox = async (): Promise<InboxEntry[]> => {
    await producers.idle()
    await journal.flush()
    return (await journal.sync(U, 0)).changes.flatMap((change) =>
      'entry' in change ? [change.entry] : [],
    )
  }
  const end = (over: Partial<RunEnded>) =>
    producers.runs.ended({ userId: U, session: chat, runId: 'm1', outcome: 'completed', ...over })
  return { producers, inbox, end }
}

describe('run outcomes', () => {
  it('records a finished top-level run once, however often its end is reported', async () => {
    const { inbox, end } = await setup()
    end({})
    end({})
    const rows = await inbox()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: 'run:S1:m1',
      topic: 'run.completed',
      severity: 'success',
      body: 'Refactor the parser',
      origin: { kind: 'resource', resourceKind: 'run', resourceId: 'm1', projectId: 'P1' },
    })
  })

  it('offers Retry on a failure, naming the run it would regenerate', async () => {
    const { inbox, end } = await setup()
    end({
      outcome: 'failed',
      presented: presentErrorInfo({
        kind: 'fatal',
        userMessage: 'Network connection to the provider dropped.',
        retryable: true,
      }),
    })
    const [row] = await inbox()
    expect(row).toMatchObject({
      key: 'run-failed:S1:m1',
      topic: 'run.failed',
      // "Could not …", naming the conversation; the reason is the body, as a sentence.
      title: 'Could not finish the reply in “Refactor the parser”',
      body: 'Network connection to the provider dropped.',
    })
    expect(row!.actions?.find((a) => a.id === 'retry')).toMatchObject({
      kind: 'invoke',
      command: 'retry_run',
      runId: 'm1',
      target: { sessionId: 'S1' },
      available: true,
    })
  })

  it('offers no Retry where trying again cannot help, and never shows a raw provider body', async () => {
    const { inbox, end } = await setup()
    end({
      outcome: 'failed',
      presented: presentErrorInfo({
        kind: 'fatal',
        userMessage: 'Error: 418: {"error":{"message":"teapot"}}',
        retryable: false,
        verbatim: true,
      }),
    })
    const [row] = await inbox()
    expect(row!.body).toBe('The run stopped on an unexpected error.')
    expect(row!.actions?.map((a) => a.id)).toEqual(['open'])
  })

  it('leaves a failure the connection owns to the connection’s condition: one row per problem', async () => {
    const db = createDatabase()
    databases.push(db)
    await migrateToLatest(db)
    const journal = createNotificationJournal({ db })
    const provider = createProviderConditions(journal, async () => 'Anthropic')
    const producers = createAgentNotifications({
      journal,
      lookupSession: async () => chat,
      defaultUserId: U,
      runningWork: () => [],
      provider,
    })
    const failure = { authFailed: true, retryable: false }
    producers.runs.ended({
      userId: U,
      session: chat,
      runId: 'm1',
      outcome: 'failed',
      connectionId: 'conn-1',
      failure,
      presented: presentErrorInfo(
        { kind: 'fatal', userMessage: 'x', retryable: false, authFailed: true },
        { connectionId: 'conn-1' },
      ),
    })
    await producers.idle()
    await journal.flush()
    const rows = (await journal.sync(U, 0)).changes.flatMap((c) => ('entry' in c ? [c.entry] : []))
    expect(rows.map((row) => row.title)).toEqual(['Could not sign in to Anthropic'])
    expect(rows[0]!.actions?.[0]).toMatchObject({ id: 'sign-in', kind: 'navigate' })
  })

  it('settles a failure once a later run of the session finishes, and retires its Retry', async () => {
    const { inbox, end } = await setup()
    end({ runId: 'm1', outcome: 'failed' })
    end({ runId: 'm2', outcome: 'completed' })
    const failed = (await inbox()).find((row) => row.key === 'run-failed:S1:m1')
    expect(failed).toMatchObject({ state: 'settled', settleReason: 'completed' })
    expect(failed!.actions?.every((a) => !a.available)).toBe(true)
  })

  it('a second failure supersedes the first, and keeps its own row open', async () => {
    const { inbox, end } = await setup()
    end({ runId: 'm1', outcome: 'failed' })
    end({ runId: 'm2', outcome: 'failed' })
    const rows = await inbox()
    expect(rows.find((r) => r.key === 'run-failed:S1:m1')?.settleReason).toBe('superseded')
    expect(rows.find((r) => r.key === 'run-failed:S1:m2')?.state).toBe('open')
  })

  it('an accepted regenerate settles the failure as retried', async () => {
    const { producers, inbox, end } = await setup()
    end({ outcome: 'failed' })
    producers.runs.retried(U, 'S1')
    expect((await inbox())[0]).toMatchObject({ state: 'settled', settleReason: 'retried' })
  })

  it('raises nothing for a stopped run, but a stop still supersedes an older failure', async () => {
    const { inbox, end } = await setup()
    end({ runId: 'm1', outcome: 'failed' })
    end({ runId: 'm2', outcome: 'stopped' })
    const rows = await inbox()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: 'run-failed:S1:m1', settleReason: 'superseded' })
  })

  it('suppresses a channel turn, an internal hook job, and a nested chat’s completion', async () => {
    const { inbox, end } = await setup()
    end({ invocation: 'channel' })
    end({ session: { ...chat, id: 'H', sessionKind: 'job', provenance: { kind: 'hook' } } })
    end({ session: { ...chat, id: 'F', parentSessionId: 'S1' } })
    expect(await inbox()).toHaveLength(0)
  })

  it('suppresses a completion while turns are still queued — the last one reports', async () => {
    const { inbox, end } = await setup()
    end({ runId: 'm1', hasQueuedTurns: async () => true })
    end({ runId: 'm2', hasQueuedTurns: async () => false })
    expect((await inbox()).map((row) => row.key)).toEqual(['run:S1:m2'])
  })

  it('a child taken down by its parent’s stop records nothing; one stopped on its own does', async () => {
    const { inbox, end } = await setup()
    const child = (id: string) => ({
      ...chat,
      id,
      sessionKind: 'subagent' as const,
      parentSessionId: 'S1',
    })
    end({ session: child('C1'), runId: 'r1', outcome: 'stopped', cascaded: true })
    end({ session: child('C2'), runId: 'r1', outcome: 'stopped', cascaded: true })
    end({ session: child('C3'), runId: 'r1', outcome: 'stopped' })
    // A cascade never hides a failure: the child failed before the stop reached it.
    end({ session: child('C4'), runId: 'r1', outcome: 'failed', cascaded: true })
    expect((await inbox()).map((row) => row.key).sort()).toEqual(['child:C3:r1', 'child:C4:r1'])
  })

  it('reports a sub-agent’s ending per run, and a stop as info', async () => {
    const { inbox, end } = await setup()
    const child = { ...chat, id: 'C1', sessionKind: 'subagent' as const, parentSessionId: 'S1' }
    end({ session: child, runId: 'r1', outcome: 'completed' })
    end({ session: child, runId: 'r2', outcome: 'stopped' })
    const rows = await inbox()
    expect(rows.map((row) => [row.key, row.topic, row.severity])).toEqual([
      ['child:C1:r1', 'child.completed', 'success'],
      ['child:C1:r2', 'child.stopped', 'info'],
    ])
  })
})

describe('mentions', () => {
  it('records who asked and what, keyed by the message', async () => {
    const { producers, inbox } = await setup()
    const mention = { userId: U, sessionId: 'S1', messageId: 'q1', from: 'reviewer', text: 'Ship?' }
    producers.mentions.mentioned(mention)
    producers.mentions.mentioned(mention)
    const rows = await inbox()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: 'mention:S1:q1',
      topic: 'user.mentioned',
      category: 'human-input',
      title: '@reviewer assigned you a card',
      body: 'Ship?',
    })
  })

  it('settles every question of a conversation once the person writes in it, and only there', async () => {
    const { producers, inbox } = await setup()
    producers.mentions.mentioned({ userId: U, sessionId: 'S1', messageId: 'q1', from: 'a' })
    producers.mentions.mentioned({ userId: U, sessionId: 'S12', messageId: 'q2', from: 'b' })
    producers.mentions.answered(U, 'S1')
    const states = Object.fromEntries((await inbox()).map((row) => [row.key, row.state]))
    // `S12` shares a prefix with `S1` as text; the encoded, terminated prefix keeps them apart.
    expect(states).toEqual({ 'mention:S1:q1': 'settled', 'mention:S12:q2': 'open' })
  })
})

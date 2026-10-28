import { afterEach, describe, expect, it } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import { createHitlRegistry } from '../../chat/runtime/hitl-registry'
import { createMemoryWorkRepository } from '../../work/testing/memory-repository'
import { createWorkRegistry } from '../../work/registry'
import type { InboxEntry } from '../contracts'
import { createNotificationJournal } from '../journal'
import { settleStaleRequests } from './boot'
import { recordInterruptedRuns, startAgentNotifications } from '.'
import type { SessionFacts } from './facts'
import { terminalOutcome } from './work'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

const U = 'local-user'
const chat: SessionFacts = {
  id: 'S1',
  projectId: 'P1',
  title: 'Deploy',
  sessionKind: 'chat',
  parentSessionId: null,
  provenance: { kind: 'root' },
}
const lookupSession = async (_user: string, id: string) => (id === chat.id ? chat : null)

async function setup() {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  const journal = createNotificationJournal({ db })
  const work = createWorkRegistry({ repo: createMemoryWorkRepository() })
  const producers = await startAgentNotifications({
    db,
    journal,
    lookupSession,
    defaultUserId: U,
    work,
  })
  const inbox = async (): Promise<InboxEntry[]> => {
    await producers.idle()
    await journal.flush()
    return (await journal.sync(U, 0)).changes.flatMap((change) =>
      'entry' in change ? [change.entry] : [],
    )
  }
  return { db, journal, work, producers, inbox }
}

const request = (id: string) => ({ id, kind: 'ask', title: 'Pick a region', payload: {} }) as never

describe('human-in-the-loop requests', () => {
  it('raises a Respond row that lands on the interaction, and settles it when answered', async () => {
    const { producers, inbox } = await setup()
    const hitl = createHitlRegistry({ lifecycle: producers.hitl })
    hitl.trackRequest('S1', 'm1', 'call-1', 'AskUserQuestion', request('r1'), U)
    const [raised] = await inbox()
    expect(raised).toMatchObject({
      key: 'hitl:r1',
      topic: 'hitl.required',
      title: 'Pick a region',
      body: 'Deploy',
      origin: { kind: 'resource', resourceKind: 'interaction', resourceId: 'r1' },
    })
    expect(raised!.actions?.find((a) => a.id === 'respond')).toMatchObject({
      requestId: 'r1',
      target: { sessionId: 'S1', focus: 'interaction' },
    })
    // Answered immediately after the raise: the ordered lane keeps the settle behind it.
    const answered = hitl.controller.request(request('r2'))
    hitl.trackRequest('S1', 'm1', 'call-2', 'AskUserQuestion', request('r2'), U)
    hitl.respond('r2', ['eu'], U)
    await answered.catch(() => undefined)
    const rows = await inbox()
    expect(rows.find((row) => row.key === 'hitl:r2')).toMatchObject({
      state: 'settled',
      settleReason: 'answered',
    })
  })

  it('a request that ends without an answer settles as cancelled', async () => {
    const { producers, inbox } = await setup()
    const hitl = createHitlRegistry({ lifecycle: producers.hitl })
    hitl.trackRequest('S1', 'm1', 'call-1', 'AskUserQuestion', request('r1'), U)
    hitl.clearRequest('r1')
    expect((await inbox())[0]).toMatchObject({ state: 'settled', settleReason: 'cancelled' })
  })

  it('a restart settles every open request the old process held', async () => {
    const { db, journal, producers, inbox } = await setup()
    producers.hitl.raised({ userId: U, sessionId: 'S1', requestId: 'r1' })
    await inbox()
    await settleStaleRequests(db, journal)
    expect((await inbox())[0]).toMatchObject({ state: 'settled', settleReason: 'restart' })
  })
})

describe('background work', () => {
  const start = (work: ReturnType<typeof createWorkRegistry>, toolCallId: string) =>
    work.start({
      owner: { userId: U, sessionId: 'S1' },
      kind: 'job',
      label: 'bun test',
      toolCallId,
      messageId: null,
    })

  it('records a failed job as an error and a finished one quietly', async () => {
    const { work, inbox } = await setup()
    const failed = start(work, 'c1')
    const done = start(work, 'c2')
    work.end('c1', { status: 'failed', exitCode: 1 })
    work.end('c2', { status: 'succeeded', exitCode: 0 })
    const rows = await inbox()
    expect(rows.find((row) => row.key === `work:${failed.id}`)).toMatchObject({
      topic: 'child.failed',
      severity: 'error',
      title: 'Could not finish a background job',
      body: 'bun test',
    })
    // `success`, like a sub-agent's finished run: one severity table for every producer.
    expect(rows.find((row) => row.key === `work:${done.id}`)?.severity).toBe('success')
  })

  it('raises nothing for an ending that wakes the agent — the woken turn reports it', async () => {
    const { work, inbox } = await setup()
    start(work, 'c1')
    work.end('c1', { status: 'failed', exitCode: 1, wakesAgent: true })
    expect(await inbox()).toHaveLength(0)
  })

  it('a terminal a work record stands for is reported once, by the work', async () => {
    const { work, producers, inbox } = await setup()
    start(work, 'c1')
    work.setTerminal('c1', 'T1')
    // A job still running when its pane exits is covered too: the record holds the terminal.
    start(work, 'c4')
    work.setTerminal('c4', 'T4')
    work.end('c1', { status: 'failed', exitCode: 2 })
    const finished = { type: 'terminal.finished' as const, exitCode: 0 }
    producers.work.terminalLifecycle(U, 'S1', { ...finished, terminalId: 'T1', exitCode: 2 })
    producers.work.terminalLifecycle(U, 'S1', { ...finished, terminalId: 'T4' })
    // A pane no record stands for is reported by the terminal; a login shell and input are not.
    producers.work.terminalLifecycle(U, 'S1', { ...finished, terminalId: 'T2', command: 'ls' })
    producers.work.terminalLifecycle(U, 'S1', { ...finished, terminalId: 'T3', interactive: true })
    producers.work.terminalLifecycle(U, 'S1', { type: 'terminal.input' })
    const keys = (await inbox()).map((row) => row.key)
    expect(keys.filter((key) => key.startsWith('work:'))).toHaveLength(1)
    expect(keys.filter((key) => key.startsWith('terminal:'))).toEqual(['terminal:T2'])
  })

  // LOCALIX-388: a server closed at its 60 s timeout was journaled as an error "exited (130)".
  it('a stop says why, a stop signal is an interruption, and only a real failure is an error', () => {
    expect(terminalOutcome({ exitCode: 130, stopped: true, stopReason: 'timeout 60 s' })).toEqual({
      severity: 'info',
      title: 'Background terminal stopped (timeout 60 s)',
    })
    expect(terminalOutcome({ exitCode: 130 })).toEqual({
      severity: 'info',
      title: 'Background terminal interrupted (exit 130)',
    })
    expect(terminalOutcome({ exitCode: 2 })).toEqual({
      severity: 'error',
      title: 'Background terminal exited with code 2',
    })
  })

  it('an explicitly closed terminal is a stopped event rather than a failure', async () => {
    const { producers, inbox } = await setup()
    producers.work.terminalLifecycle(U, 'S1', {
      type: 'terminal.finished',
      terminalId: 'stopped',
      exitCode: 130,
      stopped: true,
    })
    expect((await inbox())[0]).toMatchObject({
      key: 'terminal:stopped',
      severity: 'info',
      title: 'Background terminal stopped',
    })
  })

  it('work a restart lost is reported as a warning through the same observer', async () => {
    const repo = createMemoryWorkRepository()
    // The previous process started it and died without ending it.
    createWorkRegistry({ repo }).start({
      owner: { userId: U, sessionId: 'S1' },
      kind: 'job',
      label: 'dev server',
      toolCallId: 'c1',
      messageId: null,
    })
    await Promise.resolve()
    const db = createDatabase()
    databases.push(db)
    await migrateToLatest(db)
    const journal = createNotificationJournal({ db })
    const work = createWorkRegistry({ repo })
    const producers = await startAgentNotifications({
      db,
      journal,
      lookupSession,
      defaultUserId: U,
      work,
    })
    await work.hydrate()
    await producers.idle()
    await journal.flush()
    const [row] = (await journal.sync(U, 0)).changes.flatMap((c) => ('entry' in c ? [c.entry] : []))
    expect(row).toMatchObject({
      severity: 'warning',
      title: 'Background job was lost when the app restarted',
    })
  })
})

describe('interrupted runs', () => {
  it('files an interruption under the failure prefix, so the next finished run settles it', async () => {
    const { journal, producers, inbox } = await setup()
    await recordInterruptedRuns({ journal, lookupSession }, [
      { runId: 'run-1', sessionId: 'S1', userId: U },
    ])
    producers.runs.ended({ userId: U, session: chat, runId: 'm2', outcome: 'completed' })
    const row = (await inbox()).find((entry) => entry.key === 'run-failed:S1:interrupted:run-1')
    expect(row).toMatchObject({
      topic: 'run.failed',
      severity: 'warning',
      settleReason: 'completed',
    })
  })
})

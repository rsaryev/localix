import { afterEach, expect, test } from 'bun:test'
import { sql } from 'kysely'
import { createDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import { createDatabaseWakeQueueStore } from '../runtime/wake-queue-store'
import { recordDecidedDelivery } from '../runtime/delivery-receipts'
import { recoverDelegationReports } from './recover-delegation'
import { listDelegatedRuns } from './delegated-runs'
import { createUsageRepository } from '../../usage/repository'
import { readSessionUsageRows, summarizeSessionUsageFromTurns } from '../../usage/session-summary'
import { createChatRepository } from '../repository'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.destroy()))
})

async function fixture() {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  await sql`INSERT INTO projects (id, user_id, name, working_dir) VALUES ('p', 'u', 'Test', '/tmp/test')`.execute(
    db,
  )
  await sql`INSERT INTO agent_sessions (id, user_id, title, project_id, root_session_id) VALUES ('parent', 'u', 'Parent', 'p', 'parent')`.execute(
    db,
  )
  const addChild = async (
    id: string,
    status = 'completed',
    content = 'Responsive layout verified.',
    updatedAt = SETTLED_AT,
  ) => {
    const invocation = JSON.stringify({
      kind: 'task-delegation',
      parentSessionId: 'parent',
      parentParticipant: 'agent:builtin:lead',
    })
    await sql`INSERT INTO agent_sessions (id, user_id, title, project_id, parent_session_id, root_session_id, session_kind, runtime_status, invocation_json, updated_at)
      VALUES (${id}, 'u', ${id}, 'p', 'parent', 'parent', 'subagent', ${status}, ${invocation}, ${updatedAt})`.execute(
      db,
    )
    const payload = JSON.stringify({
      id: `message-${id}`,
      role: 'assistant',
      from: 'agent:builtin:qa',
      content,
      items: [
        { type: 'reasoning', text: 'PRIVATE REASONING' },
        { type: 'tool_call', name: 'browser', result: 'PRIVATE TOOL OUTPUT' },
      ],
    })
    await sql`INSERT INTO agent_messages (id, user_id, session_id, sequence, role, payload_json, created_at, updated_at)
      VALUES (${`message-${id}`}, 'u', ${id}, 1, 'assistant', ${payload}, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`.execute(
      db,
    )
  }
  const queue = createDatabaseWakeQueueStore(db)
  const item = (key: string, sessionId = 'parent', userId = 'u') => ({
    id: key,
    deliveryKey: key,
    userId,
    sessionId,
    kind: 'wake' as const,
    priority: 10,
    payload: {},
    queuedAt: '2026-09-01T00:00:00.000Z',
    receipt: true as const,
  })
  return { db, addChild, queue, item }
}

/** Children settle here; the sweep runs a few days later, well inside the receipt horizon. */
const SETTLED_AT = '2026-09-01T00:00:00.000Z'
const SWEEP_AT = Date.parse('2026-09-04T12:00:00.000Z')

/** A wake that admits into the real store, as `wakeSession` does, and records what it sent. */
function admittingWake(queue: ReturnType<typeof createDatabaseWakeQueueStore>) {
  const sent: Parameters<Parameters<typeof recoverDelegationReports>[1]>[0][] = []
  const wake: Parameters<typeof recoverDelegationReports>[1] = async (request) => {
    sent.push(request)
    await queue.enqueue({
      id: request.deliveryKey!,
      deliveryKey: request.deliveryKey!,
      userId: request.userId,
      sessionId: request.sessionId,
      kind: 'wake',
      priority: 10,
      payload: {},
      queuedAt: '2026-09-01T00:00:00.000Z',
      ...(request.receipt ? { receipt: request.receipt } : {}),
    })
    return { delivered: true }
  }
  return { sent, wake }
}

test('delegation receipts survive queue acknowledgement and adapter restart', async () => {
  const { db, queue, item } = await fixture()
  const report = item('child-terminal:child')
  expect(await queue.enqueue(report)).toBe(true)
  expect(
    await queue.claim(
      'u',
      'parent',
      [report.id],
      'worker',
      '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:01:00.000Z',
    ),
  ).toBe(true)
  expect(await queue.ack('u', 'parent', [report.id], 'worker')).toBe(true)
  const restarted = createDatabaseWakeQueueStore(db)
  expect(await restarted.enqueue(report)).toBe(false)
  expect(await restarted.listAll()).toEqual([])
})

test('failed queue admission rolls back the receipt so a later sweep can retry', async () => {
  const { db, queue, item } = await fixture()
  await sql`CREATE TRIGGER refuse_report BEFORE INSERT ON agent_queue_items BEGIN SELECT RAISE(ABORT, 'temporary failure'); END`.execute(
    db,
  )
  await expect(queue.enqueue(item('child-terminal:child'))).rejects.toThrow('temporary failure')
  expect(await db.selectFrom('agent_delivery_receipts').selectAll().execute()).toEqual([])
  await sql`DROP TRIGGER refuse_report`.execute(db)
  expect(await queue.enqueue(item('child-terminal:child'))).toBe(true)
})

test('the receipt is the producer flag, not the spelling of the key', async () => {
  const { db, queue, item } = await fixture()
  // A report-shaped key without the flag is an ordinary delivery: no receipt, re-admittable.
  const { receipt: _flag, ...plain } = item('child-terminal:plain')
  expect(await queue.enqueue(plain)).toBe(true)
  expect(await db.selectFrom('agent_delivery_receipts').selectAll().execute()).toEqual([])
  // Any key WITH the flag is once-ever, whatever it is called.
  expect(await queue.enqueue(item('anything-at-all'))).toBe(true)
  const receipts = await db.selectFrom('agent_delivery_receipts').selectAll().execute()
  expect(receipts.map((row) => row.delivery_key)).toEqual(['anything-at-all'])
  expect(Date.parse(receipts[0]!.created_at)).not.toBeNaN()
})

test('recovery delivers one bounded report to its parent participant without rerunning the child', async () => {
  const { db, addChild, queue } = await fixture()
  await sql`INSERT INTO conversation_participants (session_id, agent_id, handle, model_id) VALUES ('parent', 'builtin:lead', 'lead', 'm')`.execute(
    db,
  )
  await addChild('child', 'completed', 'Result.\n'.repeat(3000))
  await addChild('still-running', 'running')
  const { sent, wake } = admittingWake(queue)
  expect(await recoverDelegationReports(db, wake, SWEEP_AT)).toBe(1)
  expect(await recoverDelegationReports(db, wake, SWEEP_AT)).toBe(0)
  expect(sent).toHaveLength(1)
  // The same key and flag the live path sends, so whichever path wins, the other is a duplicate.
  expect(sent[0]).toMatchObject({
    deliveryKey: 'child-terminal:child:message-child',
    receipt: true,
    source: 'subagent',
  })
  // The same address a live report carries: participant AND handle.
  expect(sent[0]!.to).toEqual({ participant: 'agent:builtin:lead', handle: 'lead' })
  expect(sent[0]!.content.length).toBeLessThan(13000)
  // The same truncation marker as a live report: it names where the rest of the report lives.
  expect(sent[0]!.content).toContain('history_search session_id:"child"')
  expect(sent[0]!.content).not.toContain('PRIVATE')
  expect(
    (
      await db
        .selectFrom('agent_sessions')
        .select('runtime_status')
        .where('id', '=', 'child')
        .executeTakeFirst()
    )?.runtime_status,
  ).toBe('completed')
})

test("a follow-up run's lost report is recovered even though the first run's was delivered", async () => {
  // Keyed per child, the first report's receipt covered the child for good: a follow-up run
  // whose report died with the process was never recovered. Keyed per run, it is.
  const { db, addChild, queue, item } = await fixture()
  await addChild('child', 'completed', 'First answer.')
  expect(await queue.enqueue(item('child-terminal:child:message-child'))).toBe(true)
  const followUp = JSON.stringify({ id: 'follow-up', role: 'assistant', content: 'Second answer.' })
  await sql`INSERT INTO agent_messages (id, user_id, session_id, sequence, role, payload_json, created_at, updated_at)
    VALUES ('follow-up', 'u', 'child', 2, 'assistant', ${followUp}, ${SETTLED_AT}, ${SETTLED_AT})`.execute(
    db,
  )
  const { sent, wake } = admittingWake(queue)
  expect(await recoverDelegationReports(db, wake, SWEEP_AT)).toBe(1)
  expect(sent[0]).toMatchObject({ deliveryKey: 'child-terminal:child:follow-up' })
  expect(sent[0]!.content).toContain('Second answer.')
  // And once that one is admitted too, there is nothing left to send.
  expect(await recoverDelegationReports(db, wake, SWEEP_AT)).toBe(0)
})

test('a run whose report the live seam DECIDED against is never sent by the sweep', async () => {
  // A stopped run, or a person's own dialog with the child, reports nothing — and has no
  // admission receipt. Without the decided receipt the sweep read that as a lost report and sent
  // it anyway, half a minute later.
  const { db, addChild, queue } = await fixture()
  await addChild('stopped', 'stopped')
  await recordDecidedDelivery(db, {
    deliveryKey: 'child-terminal:stopped:message-stopped',
    userId: 'u',
    sessionId: 'parent',
  })
  // Positive control: an undecided twin is still recovered.
  await addChild('lost', 'completed')
  const { sent, wake } = admittingWake(queue)
  expect(await recoverDelegationReports(db, wake, SWEEP_AT)).toBe(1)
  expect(sent.map((request) => request.deliveryKey)).toEqual(['child-terminal:lost:message-lost'])
})

test('a nested child is recovered into its DELEGATOR, where the live path would have woken', async () => {
  // It used to go to the root, while delegation was one level deep and the root always delegated.
  const { db } = await fixture()
  const invocation = JSON.stringify({ kind: 'task-delegation', parentSessionId: 'mid' })
  await sql`INSERT INTO agent_sessions (id, user_id, title, project_id, parent_session_id, root_session_id, session_kind, runtime_status)
    VALUES ('mid', 'u', 'mid', 'p', 'parent', 'parent', 'subagent', 'completed')`.execute(db)
  await sql`INSERT INTO agent_sessions (id, user_id, title, project_id, parent_session_id, root_session_id, session_kind, runtime_status, invocation_json, updated_at)
    VALUES ('leaf', 'u', 'leaf', 'p', 'mid', 'parent', 'subagent', 'failed', ${invocation}, '2026-09-01T00:00:00.000Z')`.execute(
    db,
  )
  const woken: string[] = []
  const wake: Parameters<typeof recoverDelegationReports>[1] = async (request) => {
    woken.push(request.sessionId)
    return { delivered: true }
  }
  await recoverDelegationReports(db, wake, SWEEP_AT)
  expect(woken).toEqual(['mid'])
})

test('an old child without a receipt is NOT re-sent: its receipt may have been pruned', async () => {
  const { db, addChild, queue } = await fixture()
  // Settled eight days before the sweep — past the horizon receipts are kept for. A missing
  // receipt there is indistinguishable from a pruned one, and re-sending would be a duplicate.
  await addChild('old', 'completed', 'Done long ago.', '2026-08-27T11:00:00.000Z')
  await addChild('recent')
  const { sent, wake } = admittingWake(queue)
  expect(await recoverDelegationReports(db, wake, SWEEP_AT)).toBe(1)
  expect(sent.map((request) => request.deliveryKey)).toEqual([
    'child-terminal:recent:message-recent',
  ])
})

test('the sweep prunes receipts past the horizon and keeps the rest', async () => {
  const { db, queue } = await fixture()
  await sql`INSERT INTO agent_delivery_receipts (delivery_key, user_id, session_id, created_at)
    VALUES ('expired', 'u', 'parent', '2026-08-27T00:00:00.000Z'),
           ('kept', 'u', 'parent', '2026-09-01T00:00:00.000Z')`.execute(db)
  await recoverDelegationReports(db, admittingWake(queue).wake, SWEEP_AT)
  const left = await db.selectFrom('agent_delivery_receipts').select('delivery_key').execute()
  expect(left.map((row) => row.delivery_key)).toEqual(['kept'])
})

test("recovery runs for every user who owns a child, each report under its owner's id", async () => {
  const { db, addChild, queue } = await fixture()
  await addChild('mine')
  await sql`INSERT INTO projects (id, user_id, name, working_dir) VALUES ('p2', 'u2', 'Other', '/tmp/other')`.execute(
    db,
  )
  await sql`INSERT INTO agent_sessions (id, user_id, title, project_id, root_session_id) VALUES ('parent2', 'u2', 'Parent', 'p2', 'parent2')`.execute(
    db,
  )
  const invocation = JSON.stringify({ kind: 'task-delegation', parentSessionId: 'parent2' })
  await sql`INSERT INTO agent_sessions (id, user_id, title, project_id, parent_session_id, root_session_id, session_kind, runtime_status, invocation_json, updated_at)
    VALUES ('theirs', 'u2', 'theirs', 'p2', 'parent2', 'parent2', 'subagent', 'failed', ${invocation}, ${SETTLED_AT})`.execute(
    db,
  )
  const { sent, wake } = admittingWake(queue)
  expect(await recoverDelegationReports(db, wake, SWEEP_AT)).toBe(2)
  expect(
    sent
      .map((request) => [request.userId, request.sessionId, request.deliveryKey])
      .sort((a, b) => a[0]!.localeCompare(b[0]!)),
  ).toEqual([
    ['u', 'parent', 'child-terminal:mine:message-mine'],
    // A child with no assistant row failed at launch — the key the continuation reports it by.
    ['u2', 'parent2', 'child-terminal:theirs:launch'],
  ])
})

test('a run summary carries what the child consumed across all its runs, and its priority', async () => {
  const { db, addChild } = await fixture()
  await addChild('spender')
  await sql`INSERT INTO agent_message_usage (message_id, total_tokens, total_cost)
    VALUES ('message-spender', 1500, 0.25)`.execute(db)
  await addChild('fresh')
  const rows = await listDelegatedRuns(db, 'u', 'parent')
  expect(rows.find((row) => row.sessionId === 'spender')).toMatchObject({
    usage: { tokens: 1500, costUsd: 0.25 },
    // Delegated before priorities were stored: it queues, and reads, as normal.
    priority: 'normal',
  })
  expect(rows.find((row) => row.sessionId === 'fresh')?.usage).toEqual({ tokens: 0, costUsd: null })
})

test('a child’s spend in runs is the SAME total its own chat shows — auxiliary calls included', async () => {
  // A second sum here (every branch, no auxiliary calls) gave one agent two different numbers.
  const { db, addChild } = await fixture()
  await addChild('spender')
  await sql`INSERT INTO agent_message_usage (message_id, total_tokens, total_cost)
    VALUES ('message-spender', 1500, 0.25)`.execute(db)
  // Its title was generated by an auxiliary call, billed to the same session.
  await createUsageRepository(db).recordEvent({
    messageId: 'title-spender',
    sessionId: 'spender',
    userId: 'u',
    modelId: 'm',
    totalTokens: 100,
    costUsd: 0.01,
    finishReason: 'title',
  })
  const canonical = summarizeSessionUsageFromTurns(
    await createChatRepository(db).getActiveBranchUsage('u', 'spender'),
    await readSessionUsageRows(createUsageRepository(db), 'u', 'spender'),
  ).usage
  const [run] = await listDelegatedRuns(db, 'u', 'parent')
  expect(run?.usage).toEqual({ tokens: 1600, costUsd: 0.26 })
  expect(run?.usage?.tokens).toBe(canonical?.totalTokens ?? -1)
  expect(run?.usage?.costUsd).toBe(canonical?.totalCost ?? -1)
  // A reader that shows no spend skips the reads.
  expect((await listDelegatedRuns(db, 'u', 'parent', { usage: false }))[0]?.usage).toBeUndefined()
})

test('progress exposes public text or tool name, never reasoning or tool payloads', async () => {
  const { db, addChild } = await fixture()
  await addChild('reported')
  await addChild('working', 'running', '')
  const rows = await listDelegatedRuns(db, 'u', 'parent')
  expect(rows.find((row) => row.sessionId === 'reported')).toMatchObject({
    reportAvailable: true,
    progress: 'Responsive layout verified.',
  })
  expect(rows.find((row) => row.sessionId === 'working')).toMatchObject({
    reportAvailable: false,
    progress: 'Last observed tool: browser',
  })
  expect(JSON.stringify(rows)).not.toContain('PRIVATE')
  expect(await listDelegatedRuns(db, 'other-user', 'parent')).toEqual([])
})

test('reopening the current schema does not falsely acknowledge undelivered reports', async () => {
  const { db, addChild } = await fixture()
  await addChild('undelivered')
  await migrateToLatest(db)
  expect(await db.selectFrom('agent_delivery_receipts').selectAll().execute()).toEqual([])
})

test('progress reads only the latest assistant and emits one row per child', async () => {
  const { db, addChild } = await fixture()
  await addChild('child', 'running', '')
  await sql`INSERT INTO conversation_participants (session_id, agent_id, handle, position, model_id)
    VALUES ('child','first','first',0,'model'),('child','second','second',1,'model')`.execute(db)
  const latest = JSON.stringify({
    content: '',
    items: [{ type: 'command', name: 'bash', output: 'PRIVATE' }],
  })
  await sql`INSERT INTO agent_messages (id,user_id,session_id,sequence,role,payload_json)
    VALUES ('latest','u','child',2,'assistant',${latest})`.execute(db)
  const rows = await listDelegatedRuns(db, 'u', 'parent')
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ agentId: 'first', progress: 'Last observed tool: bash' })
  await sql`UPDATE agent_messages SET payload_json='{"content":"","items":[]}' WHERE id='latest'`.execute(
    db,
  )
  expect((await listDelegatedRuns(db, 'u', 'parent'))[0]?.progress).toBe('No public progress yet')
})

test('a session sees its whole subtree, each row with its level — and nothing above it', async () => {
  const { db, addChild } = await fixture()
  await addChild('child')
  await sql`INSERT INTO agent_sessions (id, user_id, title, project_id, parent_session_id, root_session_id, session_kind, runtime_status)
    VALUES ('grandchild', 'u', 'grandchild', 'p', 'child', 'parent', 'subagent', 'running')`.execute(
    db,
  )
  const fromRoot = await listDelegatedRuns(db, 'u', 'parent')
  expect(fromRoot.map((run) => [run.sessionId, run.level, run.parentSessionId])).toEqual([
    ['child', 1, 'parent'],
    ['grandchild', 2, 'child'],
  ])
  // The child sees its own child as level 1, and never the session that delegated to it.
  const fromChild = await listDelegatedRuns(db, 'u', 'child')
  expect(fromChild.map((run) => [run.sessionId, run.level])).toEqual([['grandchild', 1]])
})

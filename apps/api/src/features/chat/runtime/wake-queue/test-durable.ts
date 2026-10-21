/**
 * A live wake queue over a real SQLite store, for tests of what the durable rows do: batches that
 * survive a failed delivery, parked failures, leases held by another owner.
 */
import { createDatabase } from '../../../../db/connection'
import { sessionFixture } from '../../../../testing/session-fixture'
import type { PersistedMessage } from '../../contracts'
import type { RunParams } from '../run-contract'
import { createWakeQueue, type WakeQueueContext } from '../wake-queue'
import { createDatabaseWakeQueueStore, type WakeQueueStore } from '../wake-queue-repository'
import type { PendingTurn } from './entry'

export type DurableStore = WakeQueueStore<PendingTurn>

const opened: Array<{ close: () => Promise<void> }> = []

/** Close every queue and database a test opened (`afterEach`). */
export async function closeDurable(): Promise<void> {
  for (const item of opened.splice(0).reverse()) await item.close()
}

export async function durableStore(): Promise<DurableStore> {
  const db = createDatabase()
  opened.push({ close: () => db.destroy() })
  await db.schema
    .createTable('agent_queue_items')
    .addColumn('sequence', 'integer', (c) => c.primaryKey().autoIncrement())
    .addColumn('id', 'text', (c) => c.notNull().unique())
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('session_id', 'text', (c) => c.notNull())
    .addColumn('priority', 'integer', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('payload_json', 'text', (c) => c.notNull())
    .addColumn('state', 'text', (c) => c.notNull().defaultTo('pending'))
    .addColumn('lease_owner', 'text')
    .addColumn('lease_expires_at', 'text')
    .addColumn('delivery_key', 'text', (c) => c.notNull().unique())
    .addColumn('queued_at', 'text', (c) => c.notNull())
    .addColumn('batch_id', 'text')
    .addColumn('failure', 'text')
    .execute()
  await db.schema
    .createTable('agent_turn_starts')
    .addColumn('assistant_message_id', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('session_id', 'text', (c) => c.notNull())
    .addColumn('agent_id', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute()
  return createDatabaseWakeQueueStore<PendingTurn>(db)
}

interface DurableQueueOptions {
  store?: DurableStore
  busy?: boolean
  /** Runs before every transcript insert; throw to fail a delivery. */
  beforeInsert?: (rows: readonly PersistedMessage[]) => void | Promise<void>
  /** Runs before the delivery reads the transcript; await to make a delivery slow. */
  beforeRead?: () => void | Promise<void>
  context?: Partial<WakeQueueContext>
}

export async function durableQueue(options: DurableQueueOptions = {}) {
  const store = options.store ?? (await durableStore())
  const session = sessionFixture({ id: 's', userId: 'u' })
  const messages = new Map<string, PersistedMessage>()
  const runs: RunParams[] = []
  const published: unknown[] = []
  const errors: unknown[] = []
  const activeRuns = new Map<string, AbortController>()
  if (options.busy) activeRuns.set(session.id, new AbortController())
  const insert = async (rows: readonly PersistedMessage[]) => {
    await options.beforeInsert?.(rows)
    for (const row of rows) messages.set(row.id, row)
  }
  const queue = createWakeQueue({
    repo: {
      getSession: async () => session,
      getMessage: async (_u: string, _s: string, id: string) => messages.get(id) ?? null,
      insertMessage: (row: PersistedMessage) => insert([row]),
      insertMessages: insert,
      listMessages: async () => {
        await options.beforeRead?.()
        return [...messages.values()]
      },
    } as never,
    streamRegistry: {
      publish: (_u: string, _s: string, event: unknown) => void published.push(event),
    } as never,
    now: () => new Date().toISOString(),
    state: { activeRuns, drainingSessions: new Set(), sessionRunIdentity: new Map() },
    run: async (params: RunParams) => {
      runs.push(params)
      return { status: 'completed' as const }
    },
    store,
    onError: (error) => void errors.push(error),
    ...options.context,
  })
  opened.push({ close: () => queue.close() })
  await queue.ready()

  const say = (content: string) =>
    queue.wake({ userId: 'u', session, content, internal: false, source: 'user-busy' })
  /** The person's turns that reached the transcript, in order. */
  const delivered = () =>
    [...messages.values()]
      .filter((row) => row.payload.role === 'user')
      .map((row) => row.payload.content)
  const until = async (done: () => boolean | Promise<boolean>, ms = 2_000) => {
    for (const end = Date.now() + ms; Date.now() < end && !(await done());)
      await new Promise((resolve) => setTimeout(resolve, 5))
  }
  /** End the busy run, as its teardown does: the queue drains. */
  const idle = () => {
    activeRuns.delete(session.id)
    queue.scheduleDrain(session.id)
  }
  return {
    store,
    session,
    queue,
    messages,
    runs,
    published,
    errors,
    activeRuns,
    say,
    delivered,
    until,
    idle,
  }
}

// The emulated session both context-window integration suites replay.
/**
 * A LONG CODING SESSION, EMULATED TURN BY TURN against the real context stack: the migrated
 * schema and model-context repository, `loadModelView` (the durable-fact decision), the chat
 * history strategy (checkpoint, preflight, admission) and the budget frame. Only the provider is
 * simulated: the "measured" request is the real wire's heuristic size plus the fixed overhead plus
 * the turn's own tool traffic — what the run's final request would report as `contextTokens`.
 *
 * The same scripted session is replayed against several model windows, so what the window policy
 * changes (when a checkpoint fires, how far it cuts, how big a request can get) is read off one
 * table. Everything is seeded and clockless: two runs produce the same log.
 */
import { afterAll, beforeAll } from 'bun:test'
import { estimateChatMessageTokens, type ContextLimit } from '@localixai/agent'
import { sql, type Kysely } from 'kysely'

import { createDatabase, destroyDatabase } from '../../../../db/connection'
import { migrateToLatest } from '../../../../db/migrator'
import type { AppDatabase } from '../../../../db/types'
import type { PersistedMessage } from '../../contracts'
import { SCRIPT, TURNS, toolCall } from './context-window-session.fixtures'
import { createModelContextRepository } from '../../model-context-repository'
import { resolveContextBudgetFrame } from '../context-budget'
import { createChatHistoryRun } from '../history/chat-strategy'
import { bareFrame, freshLane, persistedRow, TEST_IDENTITY } from '../history/testing/test-fixtures'
import { checkpointAtTokens } from '../model-view/checkpoint-policy'
import { loadModelView } from '../model-view/view'

export const VIEWER = 'agent:default'
export const SESSION = 's'
export const OVERHEAD = 12_000

let db: Kysely<AppDatabase>
let users = 0

/**
 * Open the migrated database for the calling test file and close it after its last test. Files
 * that share one process (a focused run of several files) share the database; it closes when the
 * last of them is done.
 */
export function sessionDatabasePerFile(): void {
  beforeAll(async () => {
    if (users++ > 0) return
    db = createDatabase()
    await migrateToLatest(db)
    await sql`INSERT INTO agent_sessions (id, project_id, user_id, title) VALUES (${SESSION}, 'PRJ-1', 'u', 't')`.execute(
      db,
    )
  })
  afterAll(async () => {
    if (--users === 0) await destroyDatabase(db)
  })
}

let sequence = 0
let runs = 0
export async function store(row: PersistedMessage) {
  const next = (sequence += 1)
  await sql`INSERT INTO agent_messages (id, session_id, user_id, sequence, role, parent_id, payload_json)
    VALUES (${row.id}, ${SESSION}, 'u', ${next}, ${row.payload.role}, NULL, ${JSON.stringify(row.payload)})`.execute(
    db,
  )
}

export const bytesOf = (wire: readonly unknown[]) =>
  wire.map((m) =>
    JSON.stringify(m, (k, v) => (k === 'timestamp' || k === 'cacheAnchor' ? undefined : v)),
  )

export interface TurnLog {
  turn: number
  /** Request size the provider measured for this turn's final request. */
  measured: number
  checkpoint?: {
    reason: string
    view: number
    cards: number
    evicted: boolean
    requestAfter: number
  }
  /** Size of the request this turn started with (heuristic, incl. fixed overhead). */
  startEstimate: number
  appendOnly?: boolean
}

export interface Options {
  window: number
  limit?: ContextLimit
  depth?: number
}

export async function runSession({ window, limit, depth }: Options): Promise<TurnLog[]> {
  const id = `${window}-${limit ?? 'auto'}-${depth ?? 0}-${String(++runs).padStart(4, '0')}`
  const repo = createModelContextRepository(db)
  const frame = resolveContextBudgetFrame({
    contextWindow: window,
    fixedOverheadTokens: OVERHEAD,
    depth,
    contextLimit: limit,
  })
  const state = freshLane()
  const history: PersistedMessage[] = []
  const logs: TurnLog[] = []
  let previousWire: string[] | undefined

  for (let t = 0; t < TURNS; t++) {
    const script = SCRIPT[t]!
    const user = persistedRow(`u-${id}-${t}`, {
      role: 'user',
      from: 'user',
      content: script.prompt,
    })
    const assistantId = `a-${id}-${t}`
    history.push(user)
    await store(user)

    const view = await loadModelView(repo, {
      sessionId: SESSION,
      viewer: VIEWER,
      historyMessages: history,
      currentMessageId: assistantId,
      contextWindow: window,
      ...(depth !== undefined ? { depth } : {}),
      ...(limit !== undefined ? { contextLimit: limit } : {}),
    })
    const run = createChatHistoryRun({
      sessionId: SESSION,
      frame,
      identity: TEST_IDENTITY,
      view,
      media: {},
      state,
      recoveryToolAvailable: true,
      recallToolAvailable: true,
    })
    const out = await run.materialize(
      bareFrame(history, user.id, [], assistantId),
      new AbortController().signal,
    )

    // The row the run will write must exist before its view state does (FK + cascade).
    const items = script.calls.map((call, k) => toolCall(t, k, call))
    const assistant = persistedRow(assistantId, {
      role: 'assistant',
      from: VIEWER,
      content: script.answer,
      items,
    })
    await store(assistant)
    if (out.turnContext || out.checkpoint) {
      await repo.write({
        sessionId: SESSION,
        messageId: assistantId,
        ...(out.turnContext ? { turnContext: out.turnContext } : {}),
        ...(out.checkpoint ? { checkpoint: out.checkpoint } : {}),
        now: '2026-01-01T00:00:00.000Z',
      })
    }

    // The provider's number for the final request of this run: the wire it was sent, the fixed
    // prompt+tools, and everything the run's own tool calls added.
    const wireTokens = out.payloads.reduce((n, p) => n + estimateChatMessageTokens(p), 0)
    const measured = wireTokens + OVERHEAD + estimateChatMessageTokens(assistant.payload as never)
    ;(assistant.payload as { usage?: unknown }).usage = {
      contextTokens: measured,
      contextIdentity: out.identity,
    }
    await sql`UPDATE agent_messages SET payload_json = ${JSON.stringify(assistant.payload)} WHERE id = ${assistantId}`.execute(
      db,
    )
    history.push(assistant)

    const bytes = bytesOf(out.wire)
    logs.push({
      turn: t + 1,
      measured,
      startEstimate: out.estimate.tokens,
      ...(out.checkpoint
        ? {
            checkpoint: {
              reason: out.checkpoint.reason,
              view: out.checkpoint.tokens.after,
              requestAfter: out.estimate.tokens,
              cards: out.checkpoint.cards.length,
              evicted: out.checkpoint.evictedThroughId !== undefined,
            },
          }
        : {}),
      ...(previousWire && !out.checkpoint
        ? { appendOnly: previousWire.every((line, i) => bytes[i] === line) }
        : {}),
    })
    previousWire = bytes
  }
  return logs
}

export const fmt = (n: number) => n.toLocaleString('en-US')

export function report(label: string, options: Options, logs: TurnLog[]) {
  const frame = resolveContextBudgetFrame({
    contextWindow: options.window,
    fixedOverheadTokens: OVERHEAD,
    depth: options.depth,
    contextLimit: options.limit,
  })
  const taken = logs.filter((l) => l.checkpoint)
  const lines = [
    `\n=== ${label} ===`,
    `window ${fmt(frame.rawWindow)} → policy ${fmt(frame.effectiveWindow)}, ceiling ${fmt(frame.trigger)}, checkpoint at ${fmt(checkpointAtTokens(frame))}`,
    `peak measured ${fmt(Math.max(...logs.map((l) => l.measured)))} (${Math.round((Math.max(...logs.map((l) => l.measured)) / frame.trigger) * 100)}% of ceiling); checkpoints: ${taken.length}`,
    ...taken.map(
      (l) =>
        `  turn ${String(l.turn).padStart(3)}: ${l.checkpoint!.reason.padEnd(9)} after a ${fmt(logs[l.turn - 2]?.measured ?? 0)} request → view ${fmt(l.checkpoint!.view)}, next request ${fmt(l.checkpoint!.requestAfter)}; ${l.checkpoint!.cards} cards${l.checkpoint!.evicted ? ', evicted' : ', masked/folded only'}`,
    ),
  ]
  console.log(lines.join('\n'))
}

export const WINDOWS: [string, Options][] = [
  ['128k model', { window: 128_000 }],
  ['200k model', { window: 200_000 }],
  ['272k model (Codex-class input limit)', { window: 272_000 }],
  ['400k model', { window: 400_000 }],
  ['1M model, Auto', { window: 1_000_000 }],
  ['1M model, 600k limit', { window: 1_000_000, limit: 600_000 }],
  ['1M model, 128k limit (cost saver)', { window: 1_000_000, limit: 128_000 }],
  ['1M delegated child (depth 1)', { window: 1_000_000, depth: 1 }],
]

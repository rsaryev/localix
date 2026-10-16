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
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { estimateChatMessageTokens, type ContextLimit } from '@localixai/agent'
import { sql, type Kysely } from 'kysely'

import { createDatabase, destroyDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import type { AppDatabase } from '../../../db/types'
import type { PersistedMessage } from '../contracts'
import { SCRIPT, TURNS, toolCall } from './context-window-session.fixtures'
import { createModelContextRepository } from '../model-context-repository'
import { resolveContextBudgetFrame } from './context-budget'
import { createChatHistoryRun } from './history/chat-strategy'
import { bareFrame, freshLane, persistedRow, TEST_IDENTITY } from './history/test-fixtures'
import { checkpointAtTokens } from './model-view/checkpoint-policy'
import { loadModelView } from './model-view/view'

const VIEWER = 'agent:default'
const SESSION = 's'
const OVERHEAD = 12_000

let db: Kysely<AppDatabase>
beforeAll(async () => {
  db = createDatabase()
  await migrateToLatest(db)
  await sql`INSERT INTO agent_sessions (id, project_id, user_id, title) VALUES (${SESSION}, 'PRJ-1', 'u', 't')`.execute(
    db,
  )
})
afterAll(() => destroyDatabase(db))

let sequence = 0
let runs = 0
async function store(row: PersistedMessage) {
  const next = (sequence += 1)
  await sql`INSERT INTO agent_messages (id, session_id, user_id, sequence, role, parent_id, payload_json)
    VALUES (${row.id}, ${SESSION}, 'u', ${next}, ${row.payload.role}, NULL, ${JSON.stringify(row.payload)})`.execute(
    db,
  )
}

const bytesOf = (wire: readonly unknown[]) =>
  wire.map((m) =>
    JSON.stringify(m, (k, v) => (k === 'timestamp' || k === 'cacheAnchor' ? undefined : v)),
  )

interface TurnLog {
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

interface Options {
  window: number
  limit?: ContextLimit
  depth?: number
}

async function runSession({ window, limit, depth }: Options): Promise<TurnLog[]> {
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

const fmt = (n: number) => n.toLocaleString('en-US')

function report(label: string, options: Options, logs: TurnLog[]) {
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

const WINDOWS: [string, Options][] = [
  ['128k model', { window: 128_000 }],
  ['200k model', { window: 200_000 }],
  ['272k model (Codex-class input limit)', { window: 272_000 }],
  ['400k model', { window: 400_000 }],
  ['1M model, Auto', { window: 1_000_000 }],
  ['1M model, 600k limit', { window: 1_000_000, limit: 600_000 }],
  ['1M model, 128k limit (cost saver)', { window: 1_000_000, limit: 128_000 }],
  ['1M delegated child (depth 1)', { window: 1_000_000, depth: 1 }],
]

describe('a 100-turn coding session across model windows', () => {
  const results = new Map<string, TurnLog[]>()

  for (const [label, options] of WINDOWS) {
    test(
      label,
      async () => {
        const logs = await runSession(options)
        results.set(label, logs)
        report(label, options, logs)
        const frame = resolveContextBudgetFrame({
          contextWindow: options.window,
          fixedOverheadTokens: OVERHEAD,
          depth: options.depth,
          contextLimit: options.limit,
        })

        // Every request the strategy ADMITS fits under the ceiling.
        for (const log of logs) expect(log.startEstimate).toBeLessThanOrEqual(frame.trigger)
        // A checkpoint is taken only when the measured size said so (or the view overflowed).
        for (const [i, log] of logs.entries()) {
          if (!log.checkpoint) continue
          const before = logs[i - 1]?.measured ?? 0
          expect(before >= checkpointAtTokens(frame) || log.checkpoint.reason !== 'threshold').toBe(
            true,
          )
          expect(log.checkpoint.requestAfter).toBeLessThan(checkpointAtTokens(frame))
          expect(log.checkpoint.requestAfter).toBeLessThan(before || Number.POSITIVE_INFINITY)
        }
        // However the turn's own traffic grows, a request never outgrows the physical window.
        for (const log of logs) expect(log.measured).toBeLessThanOrEqual(frame.rawWindow)
        // Between checkpoints the request is an exact byte prefix of the next: the cache stays warm.
        for (const log of logs) if (log.appendOnly !== undefined) expect(log.appendOnly).toBe(true)
      },
      120_000,
    )
  }
})

describe('the emulation is deterministic and the policy is ordered', () => {
  test('two replays of the same session produce the same log', async () => {
    const first = await runSession({ window: 272_000 })
    const second = await runSession({ window: 272_000 })
    expect(second).toEqual(first)
  }, 120_000)

  test('a 1M model on Auto lives in the same budget as a 400k one', async () => {
    const [large, mid] = [
      await runSession({ window: 1_000_000 }),
      await runSession({ window: 400_000 }),
    ]
    const turns = (logs: TurnLog[]) => logs.filter((l) => l.checkpoint).map((l) => l.turn)
    // 300k vs 299.2k policy windows: the same marks within a turn, never a 700k free-for-all.
    expect(turns(large).length).toBe(turns(mid).length)
    expect(Math.max(...large.map((l) => l.measured))).toBeLessThan(300_000)
  }, 120_000)
})

/**
 * replay-context-policy — replay a STORED session through the live checkpoint policy and print
 * every number a checkpoint decision turns on, so "why did it checkpoint here?" and "what would a
 * checkpoint keep now?" are answered from evidence rather than from a reading of the code.
 *
 *   bun apps/api/scripts/replay-context-policy.ts <sessionId> [--upto SEQ] [--window N]
 *     [--viewer agent:<id>] [--db PATH]
 *
 * It reports
 *   - the budget frame: window → policy window, request ceiling, fixed overhead, checkpoint mark;
 *   - per viewer turn: the provider-measured request against the checkpoint mark, the pressure
 *     band it fell in (clear / near / due), and whether that run took a checkpoint;
 *   - the model view the NEXT run would start from (checkpoint in force, whether one is due);
 *   - a checkpoint planned on the stored rows NOW, with its tokens before/after/target, the
 *     message it evicts through and its card count.
 * Rows are read in sequence order (all branches), exactly as stored. Read-only: the database is
 * opened `readonly` with `query_only`, and nothing the replay produces is written back.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

import { createDatabase } from '../src/db/connection'
import type { StoredMessagePayload } from '../src/db/payload'
import type { PersistedMessage } from '../src/features/chat/contracts'
import { createModelContextRepository } from '../src/features/chat/model-context-repository'
import { resolveContextBudgetFrame } from '../src/features/chat/runtime/context-budget'
import { createChatHistoryRun } from '../src/features/chat/runtime/history/chat-strategy'
import type { ChatTurnFrame } from '../src/features/chat/runtime/history/frame'
import {
  checkpointAtTokens,
  checkpointPressure,
  checkpointTargetTokens,
} from '../src/features/chat/runtime/model-view/checkpoint-policy'
import { loadModelView, type ModelView } from '../src/features/chat/runtime/model-view/view'

const args = process.argv.slice(2)
const sessionId = args.find((a) => !a.startsWith('--'))
if (!sessionId) {
  console.error(
    'usage: replay-context-policy <sessionId> [--upto SEQ] [--window N] [--viewer agent:<id>] [--db PATH]',
  )
  process.exit(2)
}
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const upto = Number(flag('upto') ?? Number.POSITIVE_INFINITY)
const contextWindow = Number(flag('window') ?? 400_000)
const dbPath = flag('db') ?? join(homedir(), '.localix', 'localix.db')

const db = createDatabase({ filename: dbPath, readonly: true })
const repo = createModelContextRepository(db)
const rows = await db
  .selectFrom('agent_messages')
  .select(['id', 'user_id', 'sequence', 'created_at', 'payload_json'])
  .where('session_id', '=', sessionId)
  .orderBy('sequence')
  .execute()
const history: PersistedMessage[] = rows
  .filter((r) => r.sequence <= upto)
  .map((r) => ({
    id: r.id,
    sessionId,
    userId: r.user_id,
    payload: JSON.parse(r.payload_json) as StoredMessagePayload,
    createdAt: r.created_at,
    updatedAt: r.created_at,
  }))
if (history.length === 0) {
  console.error(`no rows for session ${sessionId}`)
  process.exit(1)
}

// Whose view: a checkpoint belongs to the participant whose run took it.
const lastAssistant = [...history].reverse().find((m) => m.payload.role === 'assistant')
const viewer = flag('viewer') ?? lastAssistant?.payload.from ?? 'agent:default'
// The identity the provider measurement was persisted under — its fixed overhead is what the
// live frame subtracted, so the replayed marks match the ones the run compared against.
const anchorRow = [...history]
  .reverse()
  .find((m) => m.payload.role === 'assistant' && m.payload.usage?.contextIdentity)
const identity = anchorRow?.payload.usage?.contextIdentity
const frame = resolveContextBudgetFrame({
  contextWindow,
  fixedOverheadTokens: identity?.fixedOverheadTokens ?? 0,
})
const fmt = (n: number) => n.toLocaleString('en-US')

console.log(`session ${sessionId}: ${history.length} rows, viewer ${viewer}`)
console.log(
  `frame: window ${fmt(frame.rawWindow)} → policy ${fmt(frame.effectiveWindow)}, ceiling ${fmt(frame.trigger)}, fixed overhead ${fmt(frame.fixedOverhead)}, checkpoint at ${fmt(checkpointAtTokens(frame))}, low-water target ${fmt(checkpointTargetTokens(frame, 0))}`,
)

// ---- Per turn: what the provider measured, against the mark the next turn compared it to -----
const viewerTurns = history.filter(
  (m) => m.payload.role === 'assistant' && m.payload.from === viewer,
)
const stored = await repo.list(
  sessionId,
  viewerTurns.map((m) => m.id),
)
console.log('\nper viewer turn (measured request → pressure; * = this run took a checkpoint):')
for (const row of viewerTurns) {
  const measured = row.payload.usage?.contextTokens
  const took = stored.get(row.id)?.hasCheckpoint ? ' *' : ''
  if (typeof measured !== 'number' || measured <= 0) {
    console.log(`  ${row.id.slice(0, 8)}…: no measurement${took}`)
    continue
  }
  const share = Math.round((measured / frame.trigger) * 100)
  console.log(
    `  ${row.id.slice(0, 8)}…: ${fmt(measured)} (${share}% of ceiling) → ${checkpointPressure(frame, measured)}${took}`,
  )
}

// ---- The view the next run would start from -----------------------------------------------
const view = await loadModelView(repo, {
  sessionId,
  viewer,
  historyMessages: history,
  currentMessageId: 'replay',
  contextWindow,
})
const inForce = view.checkpoint
console.log(
  `\nnext run: ${inForce ? `checkpoint in force from ${inForce.hostId.slice(0, 8)}… (${inForce.record.reason}, evicted through ${inForce.record.evictedThroughId ?? 'nothing'}, ${inForce.record.cards.length} cards, ${fmt(inForce.record.tokens.before)} → ${fmt(inForce.record.tokens.after)})` : 'no checkpoint in force'}; due: ${view.due ?? 'no'}${view.checkpointNear ? ' (near — the warning section is sent)' : ''}`,
)

// ---- A checkpoint planned now: what it would keep ------------------------------------------
async function materialize(modelView: ModelView) {
  const run = createChatHistoryRun({
    sessionId: sessionId!,
    frame,
    identity: {
      providerId: identity?.providerId ?? 'unknown',
      modelId: identity?.modelId ?? 'unknown',
      systemPromptHash: identity?.systemPromptHash ?? '',
      toolSchemaHash: identity?.toolSchemaHash ?? '',
    },
    view: modelView,
    recoveryToolAvailable: true,
    recallToolAvailable: true,
    media: {},
    state: {
      elidedToolCallIds: new Set(),
      elidedArgToolCallIds: new Set(),
      wireResultIds: new Set(),
    },
  })
  const turnFrame: ChatTurnFrame = {
    messages: history,
    runtimeSections: [],
    systemBindings: [],
    assistantMessageId: 'replay',
    assistantCreatedAt: new Date().toISOString(),
    sessionId: sessionId!,
    userId: history[0]!.userId,
    promptMessage: history.at(-1),
    now: () => new Date().toISOString(),
  }
  return run.materialize(turnFrame, new AbortController().signal)
}

const current = await materialize(view)
console.log(
  `as shown next run: ${current.wire.length} wire messages, estimate ${fmt(current.estimate.tokens)} (${current.estimate.source})`,
)
const planned = await materialize({ ...view, due: view.due ?? 'threshold', epochId: 'replay' })
const checkpoint = planned.checkpoint
if (!checkpoint) {
  console.log('checkpoint now: none planned (nothing past the protected tail to reshape)')
} else {
  const masked = Object.values(checkpoint.transforms).filter((t) => t.op).length
  console.log(
    `checkpoint now (${checkpoint.reason}): ${fmt(checkpoint.tokens.before)} → ${fmt(checkpoint.tokens.after)} tokens (target ${fmt(checkpoint.tokens.target)}); evicts through ${checkpoint.evictedThroughId ?? 'nothing'}; ${checkpoint.cards.length} cards; ${masked} messages masked or folded; ${checkpoint.pinnedIds.length} evicted pins kept whole; ${planned.wire.length} wire messages`,
  )
}
await db.destroy()

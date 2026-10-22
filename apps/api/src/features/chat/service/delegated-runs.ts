import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../../db/types'
import type { DelegatedRunSummary } from '../../agent-core/tools/delegate-control'
import { DELEGATION_PRIORITIES, type DelegationPriority } from '../../agent-core/delegation-lanes'
import type { UsageRepository } from '../../usage/repository'
import { readSessionUsageRows, summarizeSessionUsageFromTurns } from '../../usage/session-summary'
import { createChatRepository } from '../repository'
import { delegatedRunsQuery } from '../repository-delegated-runs'

const isDelegationPriority = (value: unknown): value is DelegationPriority =>
  (DELEGATION_PRIORITIES as readonly unknown[]).includes(value)

/**
 * What a child has consumed: the SAME canonical total its own composer shows as "Session total"
 * (`summarizeSessionUsageFromTurns` — its active branch's turns plus every auxiliary call).
 *
 * It was a second sum, over every branch and without the auxiliary calls, so one agent carried
 * two different numbers — one in its parent's `list`, another in its own chat.
 */
export async function readSessionSpend(
  db: Kysely<AppDatabase>,
  usageRepo: UsageRepository,
  userId: string,
  sessionId: string,
): Promise<{ tokens: number; outputTokens: number; costUsd: number | null }> {
  const [turns, ledger] = await Promise.all([
    createChatRepository(db).getActiveBranchUsage(userId, sessionId),
    readSessionUsageRows(usageRepo, userId, sessionId),
  ])
  const usage = summarizeSessionUsageFromTurns(turns, ledger).usage
  return {
    tokens: usage?.totalTokens ?? 0,
    // What a workflow's `budget.spent()` counts, as Claude Code counts it: output tokens.
    outputTokens: usage?.outputTokens ?? 0,
    costUsd: usage?.totalCost ?? null,
  }
}

async function sessionSpend(
  db: Kysely<AppDatabase>,
  usageRepo: UsageRepository,
  userId: string,
  sessionId: string,
): Promise<NonNullable<DelegatedRunSummary['usage']>> {
  const { tokens, costUsd } = await readSessionSpend(db, usageRepo, userId, sessionId)
  return { tokens, costUsd }
}

/** One public projection for the tool and prompt; never copy reasoning or full tool traces. */
export async function listDelegatedRuns(
  db: Kysely<AppDatabase>,
  usageRepo: UsageRepository,
  userId: string,
  parentSessionId: string,
  /** `usage: false` for a reader that shows none (the prompt's roster), sparing its reads. */
  opts: { usage?: boolean } = {},
): Promise<DelegatedRunSummary[]> {
  const rows = await delegatedRunsQuery(db, userId, parentSessionId).execute()
  const spend =
    opts.usage === false
      ? undefined
      : await Promise.all(rows.map((row) => sessionSpend(db, usageRepo, userId, row.id)))
  return rows.map((row, index) => ({
    sessionId: row.id,
    taskName: row.task_name ?? row.id,
    // A closed child is terminal whatever its last run did — the one status nothing changes again.
    status: row.closed_at ? 'closed' : row.runtime_status,
    // A child delegated before priorities existed has none stored; it queues as `normal`.
    priority: isDelegationPriority(row.priority) ? row.priority : 'normal',
    ...(spend ? { usage: spend[index]! } : {}),
    agentId: row.agent_id ?? undefined,
    updatedAt: row.updated_at,
    progress:
      row.progress ||
      (row.last_tool ? `Last observed tool: ${row.last_tool}` : 'No public progress yet'),
    reportAvailable: row.runtime_status === 'completed' && Boolean(row.progress),
    level: Number(row.level),
    ...(row.parent_session_id ? { parentSessionId: row.parent_session_id } : {}),
  }))
}

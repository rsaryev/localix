import {
  accumulateUsage,
  createUsageAccumulator,
  finishUsageAccumulator,
  hasRecordedUsage,
  type ChatUsagePayload,
  type UsageAccumulator,
} from '@localixai/agent'

import type { PersistedMessage } from '../chat/contracts'
import type { UsageStatRow } from './usage-types'
import type { createUsageRepository } from './repository'

/** Auxiliary ledger is secondary to durable message usage; session reads fail open. */
export async function readSessionUsageRows(
  usageRepo: ReturnType<typeof createUsageRepository>,
  userId: string,
  sessionId: string,
): Promise<UsageStatRow[]> {
  try {
    return await usageRepo.queryStats({ userId, session: sessionId, groupBy: 'kind' })
  } catch (error) {
    console.warn('[session-usage] ledger summary unavailable; using message usage', error)
    return []
  }
}

export function ledgerCostSource(row: UsageStatRow) {
  if (row.costUsd <= 0 || row.messages <= 0) return undefined
  if (row.subscriptionMessages === row.messages) return 'subscription' as const
  if (row.actualCostMessages === row.messages) return 'actual' as const
  return 'estimated' as const
}

function addAuxiliaryUsage(accumulator: UsageAccumulator, ledgerByKind: UsageStatRow[]): number {
  let auxiliaryCalls = 0
  for (const row of ledgerByKind) {
    if (row.key === 'turn') continue
    auxiliaryCalls += row.messages
    accumulateUsage(accumulator, {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cachedInputTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      cacheWrite1hTokens: row.cacheWrite1hTokens,
      reasoningTokens: row.reasoningTokens,
      totalTokens: row.totalTokens,
      totalCost: row.costUsd,
      costSource: ledgerCostSource(row),
    })
  }
  return auxiliaryCalls
}

/**
 * Canonical whole-session usage. Persisted assistant payloads remain the crash-safe
 * authority for visible turns (the ledger write intentionally follows the message
 * commit); the ledger contributes every auxiliary call such as title/
 * autocomplete. This avoids both under-counting auxiliary spend and double-counting
 * normal turns while the boot reconciler repairs a missing turn ledger row.
 */
export function summarizeSessionUsage(
  messages: PersistedMessage[],
  ledgerByKind: UsageStatRow[] = [],
) {
  const accumulator = createUsageAccumulator()
  let turns = 0
  for (const message of messages) {
    const usage = message.payload.usage
    if (message.payload.role !== 'assistant' || !hasRecordedUsage(usage)) continue
    turns += 1
    accumulateUsage(accumulator, usage)
  }

  const auxiliaryCalls = addAuxiliaryUsage(accumulator, ledgerByKind)
  return { usage: finishUsageAccumulator(accumulator), turns, auxiliaryCalls }
}

/**
 * Same canonical fold when the turn half already came from the transactional
 * `agent_message_usage` covering projection.
 */
export function summarizeSessionUsageFromTurns(
  turns: { usage?: ChatUsagePayload; turns: number },
  ledgerByKind: UsageStatRow[] = [],
) {
  const accumulator = createUsageAccumulator()
  accumulateUsage(accumulator, turns.usage)
  const auxiliaryCalls = addAuxiliaryUsage(accumulator, ledgerByKind)
  return {
    usage: finishUsageAccumulator(accumulator),
    turns: turns.turns,
    auxiliaryCalls,
  }
}

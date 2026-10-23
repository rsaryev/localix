import type { UsageEventInput, UsageRepository } from '../../usage/repository'
import type { USAGE_AUXILIARY_KINDS } from '../../usage/usage-types'

/** Raw token totals accumulated across every turn; costs are priced per request separately. */
export interface RunUsageTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheWrite1hTokens: number
  reasoningTokens: number
  totalTokens: number
}

export interface UsageLike {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cacheWrite1hTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  totalCost?: number
  costSource?: string
}

function finiteNonnegative(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function zeroUsageTotals(): RunUsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  }
}

export function normalizeUsage(usage: UsageLike) {
  const inputTokens = finiteNonnegative(usage.inputTokens) ?? 0
  const outputTokens = finiteNonnegative(usage.outputTokens) ?? 0
  const cacheReadTokens = finiteNonnegative(usage.cacheReadTokens) ?? 0
  const cacheWriteTokens = finiteNonnegative(usage.cacheWriteTokens) ?? 0
  const cacheWrite1hTokens = Math.min(
    cacheWriteTokens,
    finiteNonnegative(usage.cacheWrite1hTokens) ?? 0,
  )
  const reasoningTokens = finiteNonnegative(usage.reasoningTokens) ?? 0
  const totalTokens = finiteNonnegative(usage.totalTokens) ?? inputTokens + outputTokens
  const totalCost = finiteNonnegative(usage.totalCost) ?? 0
  const costSource =
    usage.costSource === 'actual' ||
    usage.costSource === 'subscription' ||
    usage.costSource === 'estimated'
      ? usage.costSource
      : 'estimated'
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheWrite1hTokens,
    reasoningTokens,
    totalTokens,
    totalCost,
    costSource,
  }
}

export function providerIdFromModel(modelId: string): string | null {
  const slash = modelId.indexOf('/')
  // Catalog/session model ids are often raw (for example `gpt-5.4`). A raw id
  // contains no provider identity, so treating the whole string as provider_id
  // invents a bogus provider bucket in Stats. This mirrors startup ledger repair:
  // only a non-empty namespace before `/` is authoritative.
  return slash > 0 ? modelId.slice(0, slash) : null
}

export function usageEventFields(
  usage: UsageLike,
): Pick<
  UsageEventInput,
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheReadTokens'
  | 'cacheWriteTokens'
  | 'cacheWrite1hTokens'
  | 'reasoningTokens'
  | 'totalTokens'
  | 'costUsd'
  | 'costSource'
> {
  const normalized = normalizeUsage(usage)
  return {
    inputTokens: normalized.inputTokens,
    outputTokens: normalized.outputTokens,
    cacheReadTokens: normalized.cacheReadTokens,
    cacheWriteTokens: normalized.cacheWriteTokens,
    cacheWrite1hTokens: normalized.cacheWrite1hTokens,
    reasoningTokens: normalized.reasoningTokens,
    totalTokens: normalized.totalTokens,
    costUsd: normalized.totalCost,
    costSource: normalized.costSource as UsageEventInput['costSource'],
  }
}

/**
 * Record title-generation spend. The happy path runs once, but retries and two
 * concurrent first-turn sends can both reach the model before the conditional
 * title update wins. Every call was billed, so accumulate rather than overwrite;
 * include routing identity so an aux-model change cannot reattribute old spend.
 */
export function recordTitleGenUsage(args: {
  usageRepo: UsageRepository
  userId: string
  sessionId: string
  modelId: string
  providerConnectionId?: string | null
  providerId?: string | null
  usage: UsageLike | null | undefined
  onRecorded?: () => void | Promise<void>
}): void {
  if (!args.usage) return
  const fields = usageEventFields(args.usage)
  if (!fields.inputTokens && !fields.outputTokens && !fields.totalTokens && !fields.costUsd) return
  void args.usageRepo
    .accumulateEvent({
      messageId: `aux-title:${JSON.stringify([
        args.sessionId,
        args.providerConnectionId ?? null,
        args.modelId,
      ])}`,
      // No `rootSessionId`: the ledger reads the session's real root (usage repository).
      sessionId: args.sessionId,
      userId: args.userId,
      providerConnectionId: args.providerConnectionId ?? null,
      providerId: args.providerId ?? providerIdFromModel(args.modelId),
      modelId: args.modelId,
      ...fields,
      finishReason: 'title',
    })
    .then(() => args.onRecorded?.())
    .catch((err: unknown) => console.warn('[chat-service] failed to record title-gen usage:', err))
}

/** The auxiliary LLM calls whose spend accumulates onto one stable-keyed ledger
 *  row per (session, kind). The id doubles as the ledger's finish_reason bucket,
 *  so each surfaces in the dashboard's Kind breakdown. Most are high-frequency
 *  (autocomplete per keystroke-idle), so repeated calls share an accumulating row.
 *  Every ledger kind but `title` (its own writer above) and the retired `improve`. */
export type AuxCallKind = Exclude<(typeof USAGE_AUXILIARY_KINDS)[number], 'title' | 'improve'>

/**
 * Record an auxiliary LLM call (editor prediction, text-input completion)
 * in the usage ledger. Unlike
 * a title — which fires ~once and so overwrites a stable-keyed row — these
 * fire often (autocomplete is per keystroke-idle) and would each warrant a row, so
 * they ACCUMULATE onto one row per (session, kind, routing identity). Including
 * connection + model is essential: otherwise switching an aux model rewrites
 * the row metadata and falsely attributes every earlier call to the latest
 * provider/model. This still keeps repeated calls compact. Fire-and-forget (a
 * ledger write must never break the caller); no-op when the call produced no
 * usage / no billed tokens.
 */
export function recordAuxCallUsage(args: {
  usageRepo: Pick<UsageRepository, 'accumulateEvent'>
  userId: string
  sessionId: string
  modelId: string
  providerConnectionId?: string | null
  providerId?: string | null
  kind: AuxCallKind
  usage: UsageLike | null | undefined
  onRecorded?: () => void | Promise<void>
}): void {
  if (!args.usage) return
  const fields = usageEventFields(args.usage)
  // Skip a genuinely-empty call (provider reported no tokens/cost) — nothing to add.
  if (!fields.inputTokens && !fields.outputTokens && !fields.totalTokens && !fields.costUsd) return
  void args.usageRepo
    .accumulateEvent({
      // JSON tuple encoding is delimiter-safe and stable across calls. Keep the
      // readable kind prefix for usage-log diagnostics.
      messageId: `aux-${args.kind}:${JSON.stringify([
        args.sessionId,
        args.providerConnectionId ?? null,
        args.modelId,
      ])}`,
      // No `rootSessionId`: the ledger reads the session's real root (usage repository).
      sessionId: args.sessionId,
      userId: args.userId,
      providerConnectionId: args.providerConnectionId ?? null,
      providerId: args.providerId ?? providerIdFromModel(args.modelId),
      modelId: args.modelId,
      ...fields,
      finishReason: args.kind,
    })
    .then(() => args.onRecorded?.())
    .catch((err: unknown) => console.warn(`[aux-usage] failed to record ${args.kind} usage:`, err))
}

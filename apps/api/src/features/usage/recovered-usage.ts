import type { UsageEventInput } from './usage-types'

type JsonObject = Record<string, unknown>

function jsonObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function optionalFiniteNonnegative(object: JsonObject, key: string): number | null | undefined {
  const value = object[key]
  if (value === undefined) return undefined
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function optionalString(object: JsonObject | null, key: string): string | undefined {
  const value = object?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function recoveredUsage(payloadJson: string) {
  try {
    const payload = jsonObject(JSON.parse(payloadJson))
    const usage = jsonObject(payload?.usage)
    if (!payload || !usage) return null
    const numericKeys = [
      'inputTokens',
      'outputTokens',
      'cachedInputTokens',
      'cacheWriteTokens',
      'cacheWrite1hTokens',
      'reasoningTokens',
      'totalTokens',
      'totalCost',
    ] as const
    const values = Object.fromEntries(
      numericKeys.map((key) => [key, optionalFiniteNonnegative(usage, key)]),
    ) as Record<(typeof numericKeys)[number], number | null | undefined>
    // Never turn malformed persisted accounting into a plausible zero row.
    if (Object.values(values).some((value) => value === null)) return null
    const costSourceValue = usage.costSource
    if (
      costSourceValue !== undefined &&
      costSourceValue !== 'actual' &&
      costSourceValue !== 'estimated' &&
      costSourceValue !== 'subscription'
    ) {
      return null
    }
    const providerMeta = jsonObject(payload.providerMeta)
    // The message's own author, which is the one attribution a repair can trust: the session's
    // party may have been re-ordered, or the member removed, since the row was written.
    const from = jsonObject(payload.from)
    const timing = jsonObject(payload.timing)
    const modelMs = timing ? optionalFiniteNonnegative(timing, 'modelMs') : undefined
    // The last turn's routing, stamped by the run (`payload.turnEnd`); absent on older messages.
    const turnEnd = jsonObject(payload.turnEnd)
    return {
      ...values,
      costSource: costSourceValue as UsageEventInput['costSource'],
      providerId: optionalString(providerMeta, 'providerId'),
      modelId: optionalString(providerMeta, 'modelId'),
      keyLabel: optionalString(providerMeta, 'keyLabel') ?? optionalString(turnEnd, 'keyLabel'),
      keyMasked: optionalString(providerMeta, 'keyMasked') ?? optionalString(turnEnd, 'keyMasked'),
      turnEnd: turnEnd
        ? {
            finishReason: optionalString(turnEnd, 'finishReason'),
            keyId: optionalString(turnEnd, 'keyId'),
            providerId: optionalString(turnEnd, 'providerId'),
            modelId: optionalString(turnEnd, 'modelId'),
            providerConnectionId: optionalString(turnEnd, 'providerConnectionId'),
          }
        : undefined,
      agentId: optionalString(from, 'agentId'),
      modelMs: modelMs === null ? undefined : modelMs,
    }
  } catch {
    return null
  }
}

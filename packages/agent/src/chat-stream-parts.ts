import type {
  ChatCacheDiagnosticsPayload,
  ChatCacheSnapshotPayload,
  ChatUsagePayload,
} from './chat-stream-types'

const CACHE_DIFF_KEYS: Array<keyof ChatCacheSnapshotPayload> = [
  'providerId',
  'modelId',
  'systemPromptHash',
  'stablePrefixHash',
  'dynamicSuffixHash',
  'promptContextHash',
  'providerOptionsHash',
  'toolNamesHash',
  'hasSystemCacheBoundary',
  'promptContextCacheTarget',
]

const CACHE_DIFF_LABELS: Partial<Record<keyof ChatCacheSnapshotPayload, string>> = {
  systemPromptHash: 'systemPrompt',
  stablePrefixHash: 'stablePrefix',
  dynamicSuffixHash: 'dynamicSuffix',
  promptContextHash: 'promptContext',
  providerOptionsHash: 'providerOptions',
  toolNamesHash: 'toolNames',
}

export function createChatCacheDiagnostics(
  snapshot: ChatCacheSnapshotPayload,
  previous?: ChatCacheSnapshotPayload | null,
): ChatCacheDiagnosticsPayload {
  if (!previous) return { snapshot }
  const changed = CACHE_DIFF_KEYS.flatMap((key) =>
    snapshot[key] !== previous[key] ? [CACHE_DIFF_LABELS[key] ?? key] : [],
  )
  return changed.length > 0 ? { snapshot, previous: { changed } } : { snapshot }
}

export function usageToChatUsagePayload(
  usage: {
    totalTokens?: number
    totalCost?: number
    costSource?: 'actual' | 'estimated' | 'subscription'
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    cacheWrite1hTokens?: number
    reasoningTokens?: number
  },
  isSummary = false,
): ChatUsagePayload {
  return {
    totalTokens: usage.totalTokens ?? usage.inputTokens + usage.outputTokens,
    totalCost: usage.totalCost,
    costSource: usage.costSource,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheWrite1hTokens: usage.cacheWrite1hTokens,
    reasoningTokens: usage.reasoningTokens,
    isSummary,
  }
}

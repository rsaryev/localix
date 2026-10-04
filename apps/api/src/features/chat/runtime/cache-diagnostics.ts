import { agentRoute } from '../session-route'
import type { ChatCacheDiagnosticsPayload } from '@localixai/agent'
import type { createChatCacheDiagnostics } from '@localixai/agent'
import {
  createBrowserCacheSnapshot,
  stableStringify,
  toModelMessages,
} from '@localixai/agent/agents/chat'
import {
  detectCacheVolatility,
  partitionPromptForCache,
  RUNTIME_CONTEXT_MARKER,
} from '@localixai/agent/chat-cache'

import { promptTexts } from '../../effective-config/prompt-texts'
import type { PersistedMessage } from '../contracts'
import type { SessionRecord } from '../repository'

// Prompt-cache diagnostics for one turn. It reads the same history the persistence path
// writes, but stores nothing itself — it is opt-in instrumentation (LOCALIX_CACHE_DIAGNOSTICS),
// which is why it does not live beside the message writers.

export function computeCacheDiagnostics(params: {
  createDiagnostics: typeof createChatCacheDiagnostics
  session: SessionRecord
  agentId: string
  historyMessages: PersistedMessage[]
  systemPrompt: string
  providerId: string
  runtimeTools: { toolNames: readonly string[] }
}): ChatCacheDiagnosticsPayload {
  const historyPayloads = params.historyMessages.map((message) => message.payload)
  const route = agentRoute(params.session, params.agentId)
  if (!route) throw new Error(`Agent is unavailable: ${params.agentId}`)

  // Cache-stability guard: warn if a per-turn-volatile token leaked into the
  // provider-cached stable prefix (everything above the runtime-context marker) —
  // that silently busts the prompt cache every turn. Diagnostics-only (this whole
  // function runs under LOCALIX_CACHE_DIAGNOSTICS), so the warning is opt-in.
  const { stableBase } = partitionPromptForCache(params.systemPrompt, RUNTIME_CONTEXT_MARKER)
  const volatility = detectCacheVolatility(stableBase)
  if (volatility.length > 0) {
    console.warn(
      `[cache-diagnostics] ${volatility.length} per-turn-volatile token(s) in the cached prefix may reduce prompt-cache hit-rate: ` +
        volatility
          .slice(0, 3)
          .map((v) => `${v.kind}(${v.sample})`)
          .join(', '),
    )
  }

  const dynamicSuffix = stableStringify(toModelMessages(historyPayloads))
  const snapshot = createBrowserCacheSnapshot({
    providerId: params.providerId,
    modelId: route.modelId,
    systemPrompt: params.systemPrompt,
    // The cached half, explicitly. Without it the snapshot hashed the whole prompt twice and
    // `changed: ['stablePrefixHash']` said nothing `systemPromptHash` had not already said.
    stablePrefix: stableBase,
    dynamicSuffix,
    providerOptions: {
      model: route.modelId,
      reasoningEffort: route.reasoningEffort,
    },
    toolNames: [...params.runtimeTools.toolNames],
    messageCount: historyPayloads.length,
  })

  // Retain the text behind the hashes just computed, so "the stable prefix changed" can be
  // answered with WHAT changed. Only reachable under LOCALIX_CACHE_DIAGNOSTICS, like the rest
  // of this function — prompt text is held because someone asked for diagnostics, never as a
  // matter of course.
  promptTexts.put(snapshot.systemPromptHash, params.systemPrompt)
  promptTexts.put(snapshot.stablePrefixHash, stableBase)
  if (snapshot.dynamicSuffixHash) promptTexts.put(snapshot.dynamicSuffixHash, dynamicSuffix)

  return params.createDiagnostics(snapshot)
}

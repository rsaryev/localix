/**
 * MODEL ACCESS for one run: the model found in the catalog, its credential made into request
 * access, the request checked against what the model can serve, and the session the loop streams
 * through.
 */
import type { Message, ReasoningEffort } from '@localixai/agent'
import { clampModelReasoning } from '@localixai/agent'
import { MODEL_NOT_DOWNLOADED } from '@localixai/agent/agents'
import type {
  LocalProviderHost,
  ModelSession,
  RuntimeCredential,
  RuntimeCredentialStore,
  RuntimeModelRef,
} from '@localixai/agent/runtime'

import { accessFor } from './auth/auth'
import type { CatalogEntry, ModelCatalog } from './catalog/catalog'
import { languageModelFor, profileFor, type ProviderAccess } from './providers/connect'
import type { RetryPolicy } from './retry'
import { createModelSession, type BoundModel, type SilenceDeadline } from './session'
import { wireTraits } from './wire/traits'

/** A request the model cannot serve. Terminal: no retry makes it servable. */
export class PreflightRejection extends Error {
  readonly code = 'unsupported_content' as const
  constructor(message: string) {
    super(message)
    this.name = 'PreflightRejection'
  }
}

/**
 * The image the person is sending now: the newest user message's. An image further back in the
 * conversation, or one a tool returned, is replaced by a placeholder for a model that cannot read
 * it (`wire/media`), so switching to a text-only model never strands a conversation.
 */
function sendsImage(messages: readonly Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (message.role !== 'user') continue
    return Array.isArray(message.content) && message.content.some((part) => part.type === 'image')
  }
  return false
}

/** Refuse before any network call an image the person sends to a model that cannot read it. */
export function assertServable(
  entry: CatalogEntry,
  ref: RuntimeModelRef,
  messages: readonly Message[],
): void {
  if (!entry.model.input.includes('image') && sendsImage(messages)) {
    throw new PreflightRejection(
      `${ref.providerId}/${ref.modelId} accepts ${entry.model.input.join('/')} input only, and this request carries an image`,
    )
  }
}

/**
 * The level this model will be asked for: a level it does not offer moves to the nearest one it
 * does (the picker's own rule). A model that does not reason, or reasons beyond the caller's
 * control, is asked for nothing — a `none` it never declared is what fails a request.
 */
export function reasoningFor(
  entry: CatalogEntry,
  requested: ReasoningEffort | undefined,
): ReasoningEffort | undefined {
  if (requested === undefined || entry.model.reasoning.length === 0) return undefined
  return clampModelReasoning(requested, entry.model.reasoning)
}

export interface OpenSessionInput {
  model: RuntimeModelRef
  credential: RuntimeCredential
  credentialStore?: RuntimeCredentialStore
  sessionId: string
  promptCacheKey?: string
  idleMs?: number
  cacheRetention?: 'short' | 'long'
  signal: AbortSignal
}

export interface ModelAccessOptions {
  catalog: ModelCatalog
  local?: LocalProviderHost
  retry?: RetryPolicy
  silence?: SilenceDeadline
}

export async function resolveEntry(
  catalog: ModelCatalog,
  ref: RuntimeModelRef,
  kind: 'chat' | 'decision' = 'chat',
): Promise<CatalogEntry> {
  const entry = await catalog.resolve(ref, kind)
  if (!entry)
    throw new Error(
      `Unknown ${kind === 'decision' ? 'decision model' : 'model'} ${ref.providerId}/${ref.modelId}`,
    )
  return entry
}

/** Request access for the host's local server: wait for the model, then its live address. */
async function localAccess(
  host: LocalProviderHost,
  modelId: string,
  signal: AbortSignal,
): Promise<ProviderAccess> {
  if (!host.isInstalled(modelId)) {
    try {
      await host.whenReady(modelId, signal)
    } catch (error) {
      if (signal.aborted) throw error
      throw new Error(
        `${MODEL_NOT_DOWNLOADED} ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  const { baseUrl, apiKey } = await host.endpoint(signal)
  return { baseURL: `${baseUrl}/v1`, apiKey }
}

/** The provider model and how a run reaches it. */
export async function bindModel(
  options: ModelAccessOptions,
  input: OpenSessionInput,
  entry: CatalogEntry,
): Promise<BoundModel> {
  const { access, subscription } = entry.provider.local
    ? {
        access: await localAccess(requireLocal(options.local), entry.model.id, input.signal),
        subscription: false,
      }
    : await accessFor(entry, input.credential, {
        signal: input.signal,
        sessionId: input.promptCacheKey ?? input.sessionId,
        ...(input.credentialStore ? { store: input.credentialStore } : {}),
      })
  return {
    ref: input.model,
    model: await languageModelFor(entry, access),
    profile: { ...profileFor(entry, access), ...wireTraits(entry) },
    origin: { api: entry.model.api, provider: entry.provider.id, model: entry.model.id },
    ...(entry.model.cost ? { cost: entry.model.cost } : {}),
    subscription,
  }
}

function requireLocal(host: LocalProviderHost | undefined): LocalProviderHost {
  if (!host) throw new Error('Local models are not available in this host')
  return host
}

/**
 * The session a run streams through, after the request is checked against the model. Each turn is
 * asked at the reasoning level this model offers nearest to the one requested.
 */
export async function openSession(
  options: ModelAccessOptions,
  input: OpenSessionInput & { messages: readonly Message[] },
): Promise<ModelSession> {
  const entry = await resolveEntry(options.catalog, input.model)
  assertServable(entry, input.model, input.messages)
  const session = createModelSession(await bindModel(options, input, entry), {
    sessionId: input.sessionId,
    ...(input.promptCacheKey ? { promptCacheKey: input.promptCacheKey } : {}),
    ...(input.idleMs !== undefined ? { idleMs: input.idleMs } : {}),
    ...(input.cacheRetention ? { cacheRetention: input.cacheRetention } : {}),
    ...(options.retry ? { retry: options.retry } : {}),
    ...(options.silence ? { silence: options.silence } : {}),
  })
  return {
    ref: session.ref,
    turn: (request) => {
      const reasoningEffort = reasoningFor(entry, request.reasoningEffort)
      const { reasoningEffort: _, ...rest } = request
      return session.turn(reasoningEffort ? { ...rest, reasoningEffort } : rest)
    },
  }
}

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

/** A request the model cannot serve. Terminal: no retry makes it servable. */
export class PreflightRejection extends Error {
  readonly code = 'unsupported_content' as const
  constructor(message: string) {
    super(message)
    this.name = 'PreflightRejection'
  }
}

function carriesImage(messages: readonly Message[]): boolean {
  return messages.some(
    (message) =>
      'content' in message &&
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === 'image'),
  )
}

/** Refuse before any network call what the model declares it cannot read. */
export function assertServable(
  entry: CatalogEntry,
  ref: RuntimeModelRef,
  messages: readonly Message[],
): void {
  if (!entry.model.input.includes('image') && carriesImage(messages)) {
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
  idleMs?: number
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
        sessionId: input.sessionId,
        ...(input.credentialStore ? { store: input.credentialStore } : {}),
      })
  return {
    ref: input.model,
    model: await languageModelFor(entry, access),
    profile: profileFor(entry),
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
    ...(input.idleMs !== undefined ? { idleMs: input.idleMs } : {}),
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

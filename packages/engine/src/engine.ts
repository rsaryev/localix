/**
 * THE ENGINE: the agent loop, model access and the script sandbox composed behind `AgentEngine`.
 *
 * The only package that sees every layer. A run opens its model session (catalog lookup,
 * credential, preflight) and hands it to the loop; everything else is the layers' own.
 */
import { createRequire } from 'node:module'

import type { AgentMessageDelta } from '@localixai/agent/agents'
import {
  withModelSteps,
  type AgentEngine,
  type AgentRuntime,
  type AgentRuntimeRunInput,
  type EngineCatalogStore,
  type LocalProviderHost,
  type ModelSession,
  type ModelTurn,
} from '@localixai/agent/runtime'
import { runAgentLoop } from '@localixai/engine-loop'
import {
  createAuth,
  createLanguageModelFactory,
  createModelCatalog,
  OAUTH_LOGINS,
  openSession,
  type ModelAccessOptions,
  type RetryPolicy,
  type SilenceDeadline,
} from '@localixai/engine-models'
import { createScriptSandbox, type ScriptSandboxOptions } from '@localixai/engine-scripts'

export interface EngineOptions {
  /** Where refreshed catalogs persist between launches. */
  catalogStore?: EngineCatalogStore
  onCatalogEntryDropped?: (providerId: string, reason: string) => void
  /** Models on this computer, served by the host: listed as the `local` provider. */
  localProvider?: LocalProviderHost
  /** A stable UUID for this installation, for sign-ins that ask for one. */
  getDeviceId?: () => string
  retry?: RetryPolicy
  silence?: SilenceDeadline
  /** Where the script sandbox finds its worker and VM when the host is bundled. */
  scripts?: ScriptSandboxOptions
  /** Events held for a slow consumer before a run waits for it. */
  maxBufferedEvents?: number
}

function version(): string {
  try {
    return (createRequire(import.meta.url)('../package.json') as { version: string }).version
  } catch {
    return '0.0.0'
  }
}

/** The promise, or the signal's abort as soon as it fires — whichever settles first. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Operation aborted')
}

/**
 * A session that opens on its first turn. `run()` must hand back a run at once, while opening a
 * session is asynchronous (an OAuth refresh, a local model's download); a failure to open becomes
 * the first turn's failure, keeping its own error (and its message on the turn) for the host to
 * classify. A stop ends the wait at once, even when the opening itself does not listen for it.
 */
export function lazySession(
  input: AgentRuntimeRunInput,
  open: (signal: AbortSignal) => Promise<ModelSession>,
): ModelSession {
  let opening: Promise<ModelSession> | undefined
  return {
    ref: input.model,
    turn(request): ModelTurn {
      let failure: Error | undefined
      let inner: ModelTurn | undefined
      opening ??= open(request.signal)
      // A rejection the race no longer waits for must not surface as unhandled.
      opening.catch(() => undefined)
      const ready = untilAborted(opening, request.signal).then(
        (session) => (inner = session.turn(request)),
        (error: unknown) => {
          failure = error instanceof Error ? error : new Error(String(error))
          return undefined
        },
      )
      return {
        message: ready.then((turn) => {
          if (turn) return turn.message
          const aborted = request.signal.aborted
          return {
            role: 'assistant' as const,
            content: [],
            provider: input.model.providerId,
            model: input.model.modelId,
            stopReason: aborted ? ('aborted' as const) : ('error' as const),
            errorMessage:
              failure?.message || (aborted ? 'Operation aborted' : 'The model could not be opened'),
            timestamp: Date.now(),
          }
        }),
        get failure() {
          return inner?.failure ?? failure
        },
        async *[Symbol.asyncIterator](): AsyncGenerator<AgentMessageDelta> {
          const turn = await ready
          if (turn) yield* turn
        },
      }
    },
  }
}

export function createEngine(options: EngineOptions = {}): AgentEngine {
  const catalog = createModelCatalog({
    ...(options.catalogStore ? { store: options.catalogStore } : {}),
    ...(options.localProvider ? { local: options.localProvider } : {}),
    ...(options.onCatalogEntryDropped ? { onDropped: options.onCatalogEntryDropped } : {}),
  })
  const access: ModelAccessOptions = {
    catalog,
    ...(options.localProvider ? { local: options.localProvider } : {}),
    ...(options.retry ? { retry: options.retry } : {}),
    ...(options.silence ? { silence: options.silence } : {}),
  }
  const adapter = { id: 'localix', version: version() }

  const runtime: AgentRuntime = {
    adapter,
    run(input) {
      const sessionOf = (model: AgentRuntimeRunInput['model']) =>
        lazySession({ ...input, model }, (signal) =>
          openSession(access, {
            model,
            credential: input.credential,
            ...(input.credentialStore ? { credentialStore: input.credentialStore } : {}),
            sessionId: input.sessionId,
            ...(input.promptCacheIdleMs !== undefined ? { idleMs: input.promptCacheIdleMs } : {}),
            ...(input.promptCacheRetention ? { cacheRetention: input.promptCacheRetention } : {}),
            messages: input.messages.filter((message) => 'content' in message) as never,
            signal,
          }),
        )
      const own = sessionOf(input.model)
      // A host's step hook may send a request on another model of the same provider connection.
      const session = input.modelStep
        ? withModelSteps(own, input.modelStep, (modelId) => sessionOf({ ...input.model, modelId }))
        : own
      return runAgentLoop(
        { ...input, session },
        options.maxBufferedEvents !== undefined
          ? { maxBufferedEvents: options.maxBufferedEvents }
          : {},
      )
    },
    // Nothing outlives a run: no sockets kept per session, no continuation state.
    disposeSession() {},
  }

  return {
    id: adapter.id,
    version: adapter.version,
    runtime,
    languageModels: createLanguageModelFactory(access),
    scripts: createScriptSandbox(options.scripts),
    createAuth: (credentialStore) =>
      createAuth({
        credentialStore,
        providers: () =>
          Object.entries(OAUTH_LOGINS).map(([id, login]) => ({ id, name: login.name })),
        ...(options.getDeviceId ? { getDeviceId: options.getDeviceId } : {}),
      }),
    listCatalog: () => catalog.list(),
    refreshCatalog: (refresh) => catalog.refresh(refresh),
    invalidateCatalog: () => catalog.invalidate(),
  }
}

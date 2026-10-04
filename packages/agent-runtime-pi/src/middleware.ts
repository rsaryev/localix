import type { StreamFn } from '@earendil-works/pi-agent-core'
import type {
  Api,
  AssistantMessageEventStream,
  Model,
  SimpleStreamOptions,
  TranscriptContext,
} from '@earendil-works/pi-ai'

/**
 * Pi's `Model` is inert catalog data — `runAgentLoop` never invokes a method on it. The one
 * call surface a run owns is the injected `StreamFn` (the `Models.streamSimple` shape): every
 * provider request of a run flows through that single function, and the loop hands it exactly
 * this triple. Middleware therefore wraps THAT surface, and the hooks are named after pi's
 * real method (`streamSimple`) rather than borrowing AI-SDK names pi has no counterpart for.
 */
export interface PiStreamParams {
  model: Model<Api>
  /**
   * The TRANSCRIPT the request is built from. pi moved the system prompt and the tool
   * roster out of the request and into the message list itself, so what a middleware
   * reshapes is a message sequence — build one with `normalizeContext` rather than a
   * bare `{systemPrompt, messages, tools}` object, which no longer reaches a provider.
   */
  context: TranscriptContext
  options?: SimpleStreamOptions
}

export interface PiModelMiddleware {
  /**
   * Reshape the request before the call. Runs before this middleware's own
   * `wrapStreamSimple` and before every middleware wrapped deeper in the chain,
   * so an outer transform's output is what inner middlewares observe.
   */
  transformParams?: (params: PiStreamParams) => PiStreamParams | Promise<PiStreamParams>
  /**
   * Wrap the stream call itself. `doStreamSimple` continues down the chain with the params
   * it is given; not calling it short-circuits the provider request entirely, in which case
   * the returned stream must uphold pi's `StreamFn` contract — failures encoded as protocol
   * events and a final `stopReason: "error"` message, never a throw or rejection.
   */
  wrapStreamSimple?: (input: {
    params: PiStreamParams
    doStreamSimple: (params: PiStreamParams) => Promise<AssistantMessageEventStream>
  }) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>
}

/** One layer: hooks omitted by the middleware fall through to `inner` untouched. */
function applyMiddleware(inner: StreamFn, middleware: PiModelMiddleware): StreamFn {
  const { transformParams, wrapStreamSimple } = middleware
  // A hook-less middleware contributes nothing; skipping the closure keeps the chain
  // exactly as deep as the hooks that exist.
  if (!transformParams && !wrapStreamSimple) return inner
  const doStreamSimple = async (params: PiStreamParams) =>
    inner(params.model, params.context, params.options)
  return async (model, context, options) => {
    const params = transformParams
      ? await transformParams({ model, context, options })
      : { model, context, options }
    return wrapStreamSimple ? wrapStreamSimple({ params, doStreamSimple }) : doStreamSimple(params)
  }
}

/**
 * Compose middlewares around pi's stream surface so `middlewares[0]` is OUTERMOST: its
 * `transformParams` sees the raw request first and its `wrapStreamSimple` encloses every
 * later entry — the same order AI SDK's `wrapLanguageModel` gives an array. reduceRight
 * realizes it: the LAST middleware wraps the bare function first, each earlier one wraps
 * the result. An empty array returns `streamSimple` itself — the same function reference,
 * so an absent seam cannot change behavior.
 */
export function wrapPiModel(
  streamSimple: StreamFn,
  middlewares: readonly PiModelMiddleware[],
): StreamFn {
  return middlewares.reduceRight(applyMiddleware, streamSimple)
}

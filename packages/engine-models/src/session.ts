/**
 * A MODEL SESSION over a provider SDK model: one `turn` per assistant response.
 *
 * A turn retries a request that failed before producing anything, holds the provider to a
 * silence deadline (long before the first part — a reasoning model may think — short between
 * parts), assembles the stream into deltas and a settled message, prices it, and never rejects:
 * every ending is a message, and a failure carries the provider's facts on `failure`.
 */
import type { LanguageModelV4, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { AssistantMessage } from '@localixai/agent'
import type { AgentMessageDelta, AgentMessageOrigin } from '@localixai/agent/agents'
import type { ModelCost } from '@localixai/agent/catalog'
import type {
  ModelSession,
  ModelTurn,
  ModelTurnRequest,
  RuntimeModelRef,
} from '@localixai/agent/runtime'

import {
  DEFAULT_RETRY_POLICY,
  describeFailure,
  isRetryable,
  retryDelayMs,
  sleep,
  type RetryPolicy,
} from './retry'
import { priceUsage } from './usage'
import { PartialUsage } from './wire/partial-usage'
import {
  ContentFilterError,
  NAMED_ENDINGS,
  ProviderFinishError,
  ProviderPrematureCloseError,
  readWithDeadline,
} from './wire/endings'
import { buildCallOptions, type WireProfile } from './wire/prompt'
import { ResponseAssembler } from './wire/stream'

export { StreamIdleTimeoutError } from './wire/endings'

/** A provider model resolved for one run, with everything a turn needs to know about it. */
export interface BoundModel {
  ref: RuntimeModelRef
  model: LanguageModelV4
  profile: WireProfile
  origin: AgentMessageOrigin
  cost?: ModelCost
  /** Billed through a subscription rather than per token. */
  subscription: boolean
}

export interface SilenceDeadline {
  /** The model may think this long before its first part. */
  firstPartMs: number
  /** Once parts flow, a gap this long is a stall. */
  betweenPartsMs: number
}

export const DEFAULT_SILENCE: SilenceDeadline = { firstPartMs: 300_000, betweenPartsMs: 120_000 }

export interface SessionOptions {
  sessionId: string
  idleMs?: number
  retry?: RetryPolicy
  silence?: SilenceDeadline
}

/** A small single-consumer queue: the producer never waits, the consumer awaits the next delta. */
function deltaQueue() {
  const items: AgentMessageDelta[] = []
  let wake: (() => void) | undefined
  let closed = false
  return {
    push(delta: AgentMessageDelta) {
      items.push(delta)
      wake?.()
    },
    close() {
      closed = true
      wake?.()
    },
    async *drain(): AsyncGenerator<AgentMessageDelta> {
      while (true) {
        const next = items.shift()
        if (next) {
          yield next
          continue
        }
        if (closed) return
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- the consumer waits for the producer's next delta
        await new Promise<void>((resolve) => (wake = resolve))
        wake = undefined
      }
    },
  }
}

export function createModelSession(bound: BoundModel, options: SessionOptions): ModelSession {
  const retry = options.retry ?? DEFAULT_RETRY_POLICY
  const silence = options.silence ?? DEFAULT_SILENCE

  return {
    ref: bound.ref,
    turn(request: ModelTurnRequest): ModelTurn {
      const queue = deltaQueue()
      let failure: Error | undefined
      const message = run(
        request,
        (delta) => queue.push(delta),
        (error) => (failure = error),
      ).finally(() => queue.close())
      return {
        message,
        get failure() {
          return failure
        },
        [Symbol.asyncIterator]: () => queue.drain(),
      }
    },
  }

  async function run(
    request: ModelTurnRequest,
    emit: (delta: AgentMessageDelta) => void,
    fail: (error: Error) => void,
  ): Promise<AssistantMessage> {
    const { signal } = request
    const call = buildCallOptions(
      request,
      bound.profile,
      {
        sessionId: options.sessionId,
        reasoningEffort: request.reasoningEffort,
        idleMs: options.idleMs,
      },
      bound.origin,
    )
    const started = performance.now()
    let assembler = new ResponseAssembler(bound.origin)
    let partial = new PartialUsage(call.prompt, call.tools)
    let firstPartAt: number | undefined
    let firstToolAt: number | undefined
    let readMs = 0

    /**
     * One request. Its own abort reaches the provider's connection however the read ends — a
     * silence deadline, an error part, the run's stop — so a stream given up on is never left
     * open, generating and billing, until the server closes it.
     */
    async function attempt(): Promise<unknown> {
      const ownAbort = new AbortController()
      let completed = false
      let reader: ReadableStreamDefaultReader<LanguageModelV4StreamPart> | undefined
      try {
        const { stream } = await bound.model.doStream({
          ...call,
          // The provider's own events, for the usage of a response cut short before `finish`.
          includeRawChunks: true,
          abortSignal: AbortSignal.any([signal, ownAbort.signal]),
        })
        reader = stream.getReader()
        while (true) {
          const waitStarted = performance.now()
          // oxlint-disable-next-line react-doctor/async-await-in-loop -- parts are read one at a time, each under the silence deadline
          const next = await readWithDeadline(
            reader,
            firstPartAt === undefined ? silence.firstPartMs : silence.betweenPartsMs,
            firstPartAt === undefined ? 'first-event' : 'mid-stream',
            signal,
          )
          readMs += performance.now() - waitStarted
          if (next.done) {
            completed = true
            break
          }
          const part: LanguageModelV4StreamPart = next.value
          if (firstPartAt === undefined && isContent(part)) firstPartAt = performance.now()
          if (firstToolAt === undefined && part.type.startsWith('tool-'))
            firstToolAt = performance.now()
          partial.observe(part)
          for (const delta of assembler.push(part)) emit(delta)
          if (part.type === 'error') break
        }
        return assembler.error
      } catch (thrown) {
        return thrown
      } finally {
        if (!completed) {
          ownAbort.abort()
          reader?.cancel().catch(() => undefined)
        }
        reader?.releaseLock()
      }
    }

    for (let attemptIndex = 0; ; attemptIndex++) {
      assembler = new ResponseAssembler(bound.origin)
      partial = new PartialUsage(call.prompt, call.tools)
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- an attempt follows the one before it
      const error = (await attempt()) ?? unfinished(assembler)
      if (signal.aborted) return settle(assembler, { aborted: true })
      if (error === undefined) break
      // Only a request that produced nothing may be sent again; a partial answer is final.
      const delay =
        !assembler.hasContent && attemptIndex < retry.maxRetries && isRetryable(error)
          ? retryDelayMs(error, attemptIndex, retry)
          : undefined
      if (delay !== undefined) {
        await sleep(delay, signal)
        if (signal.aborted) return settle(assembler, { aborted: true })
        continue
      }
      const described =
        error instanceof Error && NAMED_ENDINGS.has(error.name)
          ? error
          : describeFailure(error, bound.origin.provider ?? bound.ref.providerId)
      fail(described)
      return settle(assembler, { aborted: false, error: described })
    }
    return settle(assembler, { aborted: false })

    function settle(
      source: ResponseAssembler,
      ending: { aborted: boolean; error?: Error },
    ): AssistantMessage {
      const { message, usage, metadata } = source.settle(ending)
      // Without a `finish` the provider still billed what it read and wrote.
      const counted = usage ?? partial.settle()
      const priced = priceUsage(counted, {
        ...(bound.cost ? { cost: bound.cost } : {}),
        subscription: bound.subscription,
        ...(metadata ? { metadata } : {}),
      })
      const end = performance.now()
      return {
        ...message,
        ...(priced ? { usage: usage ? priced : { ...priced, estimated: true } } : {}),
        ...(firstPartAt !== undefined
          ? {
              genTimings: {
                providerReadMs: Math.round(readMs),
                ttftMs: Math.round(firstPartAt - started),
                toolGenMs: firstToolAt !== undefined ? Math.round(end - firstToolAt) : 0,
              },
            }
          : {}),
      }
    }
  }
}

/** Parts that are bookkeeping or the response's ending, not the response itself. */
const NOT_CONTENT: ReadonlySet<string> = new Set([
  'stream-start',
  'response-metadata',
  'raw',
  'error',
  'finish',
])

function isContent(part: LanguageModelV4StreamPart): boolean {
  return !NOT_CONTENT.has(part.type)
}

/** A stream that ended cleanly but did not finish its response, as the failure it stands for. */
function unfinished(assembler: ResponseAssembler): Error | undefined {
  const reason = assembler.finishReason
  if (!reason) return new ProviderPrematureCloseError()
  if (reason.unified === 'content-filter') return new ContentFilterError()
  if (reason.unified === 'error') return new ProviderFinishError(reason.raw)
  return undefined
}

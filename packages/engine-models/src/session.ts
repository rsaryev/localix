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
import { buildCallOptions, type WireProfile } from './wire/prompt'
import { ResponseAssembler } from './wire/stream'

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

/** Named so the host's error classifier recognises it without knowing this package. */
export class StreamIdleTimeoutError extends Error {
  constructor(waitedMs: number, phase: 'first-event' | 'mid-stream') {
    super(
      phase === 'first-event'
        ? `The provider accepted the request but sent nothing for ${Math.round(waitedMs / 1000)}s`
        : `The provider stopped sending data ${Math.round(waitedMs / 1000)}s into the response`,
    )
    this.name = 'StreamIdleTimeoutError'
  }
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

async function readWithDeadline<T>(
  reader: ReadableStreamDefaultReader<T>,
  timeoutMs: number,
  phase: 'first-event' | 'mid-stream',
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<T>['read']>>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StreamIdleTimeoutError(timeoutMs, phase)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
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
      const message = run(request, queue.push, (error) => (failure = error)).finally(queue.close)
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
    const call = buildCallOptions(request, bound.profile, {
      sessionId: options.sessionId,
      reasoningEffort: request.reasoningEffort,
      idleMs: options.idleMs,
    })
    const started = performance.now()
    let assembler = new ResponseAssembler(bound.origin)
    let firstPartAt: number | undefined
    let firstToolAt: number | undefined
    let readMs = 0

    for (let attempt = 0; ; attempt++) {
      assembler = new ResponseAssembler(bound.origin)
      let error: unknown
      try {
        const { stream } = await bound.model.doStream(call)
        const reader = stream.getReader()
        try {
          while (true) {
            const waitStarted = performance.now()
            // oxlint-disable-next-line react-doctor/async-await-in-loop -- parts are read one at a time, each under the silence deadline
            const next = await readWithDeadline(
              reader,
              firstPartAt === undefined ? silence.firstPartMs : silence.betweenPartsMs,
              firstPartAt === undefined ? 'first-event' : 'mid-stream',
            )
            readMs += performance.now() - waitStarted
            if (next.done) break
            const part: LanguageModelV4StreamPart = next.value
            if (firstPartAt === undefined && isContent(part)) firstPartAt = performance.now()
            if (firstToolAt === undefined && part.type.startsWith('tool-'))
              firstToolAt = performance.now()
            for (const delta of assembler.push(part)) emit(delta)
            if (part.type === 'error') break
          }
        } finally {
          reader.releaseLock()
        }
        error = assembler.error
      } catch (thrown) {
        error = thrown
      }
      if (signal.aborted) return settle(assembler, { aborted: true })
      if (error === undefined) break
      // Only a request that produced nothing may be sent again; a partial answer is final.
      if (!assembler.hasContent && attempt < retry.maxRetries && isRetryable(error)) {
        await sleep(retryDelayMs(error, attempt, retry), signal)
        if (signal.aborted) return settle(assembler, { aborted: true })
        continue
      }
      const described =
        error instanceof Error && error.name === 'StreamIdleTimeoutError'
          ? error
          : describeFailure(error)
      fail(described)
      return settle(assembler, { aborted: false, error: described })
    }
    return settle(assembler, { aborted: false })

    function settle(
      source: ResponseAssembler,
      ending: { aborted: boolean; error?: Error },
    ): AssistantMessage {
      const { message, usage, metadata } = source.settle(ending)
      const priced = priceUsage(usage, {
        ...(bound.cost ? { cost: bound.cost } : {}),
        subscription: bound.subscription,
        ...(metadata ? { metadata } : {}),
      })
      const end = performance.now()
      return {
        ...message,
        ...(priced ? { usage: priced } : {}),
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

function isContent(part: LanguageModelV4StreamPart): boolean {
  return part.type !== 'stream-start' && part.type !== 'response-metadata' && part.type !== 'raw'
}

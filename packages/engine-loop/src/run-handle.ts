import type { AgentEvent, AgentMessage } from '@localixai/agent/agents'
import type { AgentRuntimeResult, AgentRuntimeRun } from '@localixai/agent/runtime'

import {
  BoundedEventBuffer,
  enqueueRuntimeEvent,
  normalizeEventBufferCapacity,
} from './event-buffer'

export type EmitEvent = (event: AgentEvent) => Promise<void>

/** What a run's body works with: where events go, when to stop, and what it has produced. */
export interface RunContext {
  emit: EmitEvent
  signal: AbortSignal
  /**
   * Messages the run produced, and how many of them a settled turn has committed. A body that
   * throws leaves the result with the committed ones only: a turn cut off midway is not history.
   */
  transcript: { messages: AgentMessage[]; settled: number }
  /**
   * Resolves once the consumer has HANDLED every event emitted so far (at once when nobody
   * consumes). A host callback that reads state its own event handlers build — steering at a
   * turn boundary — waits on this, so it never runs ahead of the transcript it inspects.
   */
  handled(): Promise<void>
}

/**
 * Start a run: an ordered event stream and a result that settles exactly once.
 *
 * Events go through a bounded buffer. Once a consumer iterates, a full buffer holds the producer
 * back (progress snapshots coalesce instead); before one attaches, the oldest events give way,
 * so a run nobody watches still finishes and settles its result. Stopping the consumer early
 * aborts the run. A body that throws becomes an `error` event and a failed (or, after an abort,
 * aborted) result.
 */
export function startRun(
  options: { signal?: AbortSignal; maxBufferedEvents?: number },
  body: (run: RunContext) => Promise<AgentRuntimeResult>,
): AgentRuntimeRun {
  const controller = new AbortController()
  const external = options.signal
  const relay = () => controller.abort(external?.reason)
  if (external?.aborted) controller.abort(external.reason)
  else external?.addEventListener('abort', relay, { once: true })
  const signal = controller.signal

  const buffer = normalizeEventBufferCapacity(options.maxBufferedEvents)
  const queue = new BoundedEventBuffer<AgentEvent>(buffer.capacity)
  let consumerStarted = false
  let consumerClosed = false
  let done = false
  let terminalError: Error | undefined

  // A stop must release producers blocked on a paused consumer, and must not cost the consumer
  // the events that say how the run ended — a tool call's end above all, without which it reads
  // as running forever. So the stop lifts backpressure; the queue closes when the run settles.
  const releaseOnAbort = () => queue.unbound()
  if (signal.aborted) releaseOnAbort()
  else signal.addEventListener('abort', releaseOnAbort)

  const run: RunContext = {
    signal,
    transcript: { messages: [], settled: 0 },
    emit: async (event) => {
      if (consumerClosed) return
      await enqueueRuntimeEvent(queue, event, consumerStarted)
    },
    handled: () =>
      consumerStarted && !consumerClosed && !signal.aborted ? queue.idle() : Promise.resolve(),
  }

  const result = (async (): Promise<AgentRuntimeResult> => {
    try {
      if (buffer.error) throw buffer.error
      const settled = await body(run)
      if (settled.terminal === 'failed') terminalError = settled.error
      return settled
    } catch (thrown) {
      terminalError = thrown instanceof Error ? thrown : new Error(String(thrown))
      await run.emit({ type: 'error', error: terminalError })
      return {
        messages: run.transcript.messages.slice(0, run.transcript.settled),
        terminal: signal.aborted ? 'aborted' : 'failed',
        error: terminalError,
      }
    } finally {
      done = true
      queue.close()
      signal.removeEventListener('abort', releaseOnAbort)
      external?.removeEventListener('abort', relay)
    }
  })()

  return {
    result,
    abort(reason?: string) {
      controller.abort(reason)
    },
    async *[Symbol.asyncIterator]() {
      consumerStarted = true
      let exhausted = false
      try {
        while (!queue.closed || queue.length > 0) {
          const event = queue.shift()
          if (event) {
            yield event
            continue
          }
          await queue.waitForItem()
        }
        exhausted = true
      } finally {
        if (!exhausted) {
          consumerClosed = true
          queue.close(true)
          if (!done) controller.abort('Agent event consumer closed')
        }
      }
      if (terminalError && !signal.aborted) throw terminalError
    },
  }
}

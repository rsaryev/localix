import type { AgentEvent } from '@localixai/agent/agents'
import type { BoundedEventBuffer } from './bounded-event-buffer'

const DEFAULT_MAX_BUFFERED_EVENTS = 256

export function normalizeEventBufferCapacity(value: number | undefined): {
  capacity: number
  error?: RangeError
} {
  if (value === undefined) return { capacity: DEFAULT_MAX_BUFFERED_EVENTS }
  if (Number.isSafeInteger(value) && value >= 1) return { capacity: value }
  return {
    capacity: DEFAULT_MAX_BUFFERED_EVENTS,
    error: new RangeError('maxBufferedEvents must be a positive safe integer'),
  }
}

/** Enqueue one runtime event, coalescing only replaceable per-call progress snapshots. */
export async function enqueueRuntimeEvent(
  queue: BoundedEventBuffer<AgentEvent>,
  event: AgentEvent,
  consumerStarted: boolean,
): Promise<void> {
  // The vendored pi loop bounds each tool's update pump, while this second boundary
  // bounds snapshots from concurrent calls waiting on the shared runtime buffer.
  // Progress details are replaceable state: retain only the newest pending snapshot
  // per call while keeping lifecycle events (start/error/end) lossless and
  // backpressured.
  if (event.type === 'tool_execution_update') {
    const matchesCall = (queued: AgentEvent) =>
      queued.type === 'tool_execution_update' && queued.toolCallId === event.toolCallId
    if (consumerStarted) await queue.pushCoalescing(event, matchesCall)
    else if (!queue.coalesce(event, matchesCall)) queue.pushLatest(event)
    return
  }
  if (consumerStarted) await queue.push(event)
  else queue.pushLatest(event)
}

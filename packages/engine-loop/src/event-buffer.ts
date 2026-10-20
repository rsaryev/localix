import type { AgentEvent } from '@localixai/agent/agents'

/** Single-consumer async buffer with producer backpressure and explicit closure. */
export class BoundedEventBuffer<T> {
  private readonly items: T[] = []
  private head = 0
  private readonly consumerWaiters = new Set<() => void>()
  private readonly producerWaiters = new Set<() => void>()
  private readonly idleWaiters = new Set<() => void>()
  private readonly coalescedProducerWaiters: Array<{
    item: T
    matches: (queued: T) => boolean
    resolve: (accepted: boolean) => void
  }> = []
  private closedValue = false
  private unboundedValue = false

  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError('Event buffer capacity must be a positive safe integer')
    }
  }

  get length(): number {
    return this.items.length - this.head
  }

  get closed(): boolean {
    return this.closedValue
  }

  async push(item: T): Promise<boolean> {
    while (this.length >= this.capacity && !this.closedValue && !this.unboundedValue) {
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- awakened producers must re-check capacity because another producer may have claimed the freed slot
      await new Promise<void>((resolve) => this.producerWaiters.add(resolve))
    }
    if (this.closedValue) return false
    this.items.push(item)
    this.resolveAll(this.consumerWaiters)
    return true
  }

  /**
   * Replace an already queued snapshot and move the replacement to the tail.
   *
   * Progress events describe current state rather than an immutable lifecycle
   * transition. Coalescing them keeps an upstream fire-and-forget callback from
   * accumulating one blocked promise per update while preserving the ordering of
   * the latest snapshot relative to later start/end events. Returns false when no
   * queued item matched (or after closure), so the caller can use normal push
   * semantics instead.
   */
  coalesce(item: T, matches: (queued: T) => boolean): boolean {
    if (this.closedValue) return false
    for (let index = this.items.length - 1; index >= this.head; index -= 1) {
      const queued = this.items[index]
      if (queued === undefined || !matches(queued)) continue
      this.items.splice(index, 1)
      this.items.push(item)
      return true
    }
    return false
  }

  /**
   * Backpressured push with one mutable pending slot per matching snapshot stream.
   *
   * Unlike `coalesce()` followed by `push()`, this also stays bounded when the
   * queue is already full before the first snapshot arrives: later snapshots
   * replace that one pending producer instead of allocating more blocked pushes.
   */
  pushCoalescing(item: T, matches: (queued: T) => boolean): Promise<boolean> {
    if (this.closedValue) return Promise.resolve(false)
    if (this.coalesce(item, matches)) return Promise.resolve(true)

    const pending = this.coalescedProducerWaiters.find((waiter) => matches(waiter.item))
    if (pending) {
      pending.item = item
      return Promise.resolve(true)
    }

    if (this.length < this.capacity || this.unboundedValue) {
      this.items.push(item)
      this.resolveAll(this.consumerWaiters)
      return Promise.resolve(true)
    }

    return new Promise<boolean>((resolve) => {
      this.coalescedProducerWaiters.push({ item, matches, resolve })
    })
  }

  /**
   * Enqueue without waiting, evicting the oldest item at capacity. Used before an
   * event consumer attaches: an optional observer must never prevent the run's
   * independently exposed result from settling.
   */
  pushLatest(item: T): boolean {
    if (this.closedValue) return false
    if (this.length >= this.capacity) this.shift()
    this.items.push(item)
    this.resolveAll(this.consumerWaiters)
    return true
  }

  shift(): T | undefined {
    if (this.length === 0) return undefined
    const item = this.items[this.head]
    this.head += 1
    const coalescedProducer = this.coalescedProducerWaiters.shift()
    if (coalescedProducer) {
      this.items.push(coalescedProducer.item)
      coalescedProducer.resolve(true)
    } else {
      const nextProducer = this.producerWaiters.values().next()
      if (!nextProducer.done) {
        this.producerWaiters.delete(nextProducer.value)
        nextProducer.value()
      }
    }
    if (this.head >= 1_024 && this.head * 2 >= this.items.length) {
      this.items.splice(0, this.head)
      this.head = 0
    }
    return item
  }

  waitForItem(): Promise<void> {
    if (this.length > 0 || this.closedValue) return Promise.resolve()
    const waiting = new Promise<void>((resolve) => this.consumerWaiters.add(resolve))
    // The consumer asking for more with nothing queued has finished with everything before.
    this.resolveAll(this.idleWaiters)
    return waiting
  }

  /**
   * Resolves once the consumer has taken every queued item and come back for more — that is,
   * once it has HANDLED everything pushed so far, not merely received it. Resolves at once when
   * the buffer is closed.
   */
  idle(): Promise<void> {
    if (this.closedValue || (this.length === 0 && this.consumerWaiters.size > 0)) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => this.idleWaiters.add(resolve))
  }

  /**
   * Stop holding producers back: every waiting and later item is accepted at once, in order. A
   * stopped run still has a few events to say how it ended, and must say them without waiting
   * for a consumer that may be paused; the run ends soon after, so the buffer stays small.
   */
  unbound(): void {
    if (this.unboundedValue || this.closedValue) return
    this.unboundedValue = true
    for (const waiter of this.coalescedProducerWaiters) {
      this.items.push(waiter.item)
      waiter.resolve(true)
    }
    this.coalescedProducerWaiters.length = 0
    this.resolveAll(this.producerWaiters)
    this.resolveAll(this.consumerWaiters)
  }

  close(discard = false): void {
    if (discard) {
      this.items.length = 0
      this.head = 0
    }
    this.closedValue = true
    for (const waiter of this.coalescedProducerWaiters) waiter.resolve(false)
    this.coalescedProducerWaiters.length = 0
    this.resolveAll(this.consumerWaiters)
    this.resolveAll(this.producerWaiters)
    this.resolveAll(this.idleWaiters)
  }

  private resolveAll(waiters: Set<() => void>): void {
    for (const resolve of waiters) resolve()
    waiters.clear()
  }
}

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
  // Each running tool already keeps one pending update (`tools/progress.ts`); this second boundary
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

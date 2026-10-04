import { describe, expect, test } from 'bun:test'

import type { AssistantMessage, AssistantMessageEventStream } from '@earendil-works/pi-ai'

import { wrapPiModel } from './middleware'
import { StreamIdleTimeoutError, streamIdleWatchdog } from './stream-idle-watchdog'

const partial = { role: 'assistant', content: [] } as unknown as AssistantMessage
const startEvent = { type: 'start', partial } as never
const doneEvent = {
  type: 'done',
  reason: 'stop',
  message: partial,
} as never

/**
 * A stream a test drives by hand, standing in for a provider.
 *
 * pi exports `AssistantMessageEventStream` as a TYPE only — the class is not part of its
 * public value surface — so this reimplements the two semantics the watchdog depends on: an
 * iterator that BLOCKS while nothing is queued (which is what a silence deadline measures)
 * and a `result()` that settles on the terminal event.
 */
function fakeStream(): AssistantMessageEventStream {
  const queue: unknown[] = []
  const waiting: Array<(r: IteratorResult<unknown>) => void> = []
  let done = false
  let resolveResult: (value: unknown) => void = () => {}
  const result = new Promise<unknown>((resolve) => {
    resolveResult = resolve
  })
  const stream = {
    push(event: { type: string; message?: unknown }) {
      if (done) return
      if (event.type === 'done' || event.type === 'error') {
        done = true
        resolveResult(event.message)
      }
      const waiter = waiting.shift()
      if (waiter) waiter({ value: event, done: false })
      else queue.push(event)
    },
    result: () => result,
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (queue.length > 0) {
          yield queue.shift()
          continue
        }
        if (done) return
        const next = await new Promise<IteratorResult<unknown>>((resolve) => waiting.push(resolve))
        if (next.done) return
        yield next.value
      }
    },
  }
  return stream as unknown as AssistantMessageEventStream
}

const drain = async (stream: AssistantMessageEventStream): Promise<string[]> => {
  const seen: string[] = []
  for await (const event of stream) seen.push((event as { type: string }).type)
  return seen
}

describe('the silence deadline', () => {
  test('cancellation interrupts a stuck iterator and preserves its reason', async () => {
    const caller = new AbortController()
    const reason = new Error('user stopped this run')
    const wrapped = wrapPiModel(async () => fakeStream(), [streamIdleWatchdog()])
    const stream = await wrapped({} as never, { messages: [] } as never, { signal: caller.signal })
    const settled = drain(stream).then(
      () => undefined,
      (error: unknown) => error,
    )
    caller.abort(reason)
    expect(await settled).toBe(reason)
  })

  test('a consumer that stops early releases the provider connection', async () => {
    const upstream = fakeStream()
    let signal: AbortSignal | undefined
    const wrapped = wrapPiModel(
      async (_model, _context, options) => {
        signal = options?.signal
        return upstream
      },
      [streamIdleWatchdog()],
    )
    const stream = await wrapped({} as never, { messages: [] } as never, {})
    upstream.push(startEvent)
    for await (const _event of stream) break
    expect(signal?.aborted).toBe(true)
  })

  test('a stream that keeps producing is untouched', async () => {
    const upstream = fakeStream()
    const wrapped = wrapPiModel(
      async () => upstream,
      [streamIdleWatchdog({ firstEventTimeoutMs: 200, idleTimeoutMs: 200 })],
    )
    const stream = await Promise.resolve(wrapped({} as never, { messages: [] } as never, {}))

    // Events arrive faster than the budget, and each one rearms it — so a stream that
    // takes longer overall than the deadline still passes as long as it keeps moving.
    void (async () => {
      for (let i = 0; i < 4; i += 1) {
        await Bun.sleep(60)
        upstream.push(startEvent)
      }
      upstream.push(doneEvent)
    })()

    expect(await drain(stream)).toEqual(['start', 'start', 'start', 'start', 'done'])
  })

  test('silence before the first event fails as first-event, not mid-stream', async () => {
    const upstream = fakeStream()
    const wrapped = wrapPiModel(
      async () => upstream,
      [streamIdleWatchdog({ firstEventTimeoutMs: 60, idleTimeoutMs: 10_000 })],
    )
    const stream = await Promise.resolve(wrapped({} as never, { messages: [] } as never, {}))

    expect(drain(stream)).rejects.toThrow(StreamIdleTimeoutError)
  })

  test('a mid-stream stall fails on the tighter budget, and the events so far are delivered', async () => {
    const upstream = fakeStream()
    const wrapped = wrapPiModel(
      async () => upstream,
      // A generous first-event budget must NOT govern a gap after tokens started: the two
      // are different failures, which is why they have separate budgets.
      [streamIdleWatchdog({ firstEventTimeoutMs: 10_000, idleTimeoutMs: 60 })],
    )
    const stream = await Promise.resolve(wrapped({} as never, { messages: [] } as never, {}))

    upstream.push(startEvent)
    const seen: string[] = []
    const iterated = (async () => {
      for await (const event of stream) seen.push((event as { type: string }).type)
    })()
    expect(iterated).rejects.toThrow(/stopped sending data/)
    await iterated.catch(() => {})
    expect(seen).toEqual(['start'])
  })

  test('the provider connection is released when the deadline fires', async () => {
    const upstream = fakeStream()
    let abortedWith: AbortSignal | undefined
    const wrapped = wrapPiModel(
      async (_model, _context, options) => {
        abortedWith = options?.signal
        return upstream
      },
      [streamIdleWatchdog({ firstEventTimeoutMs: 40, idleTimeoutMs: 40 })],
    )
    const stream = await Promise.resolve(wrapped({} as never, { messages: [] } as never, {}))

    expect(drain(stream)).rejects.toThrow(StreamIdleTimeoutError)
    // Abandoning the stream without aborting would hold the socket for the whole transport
    // deadline this watchdog exists to pre-empt.
    expect(abortedWith?.aborted).toBe(true)
  })

  test("the caller's own cancellation still reaches the provider", async () => {
    const upstream = fakeStream()
    const caller = new AbortController()
    let downstream: AbortSignal | undefined
    const wrapped = wrapPiModel(
      async (_model, _context, options) => {
        downstream = options?.signal
        return upstream
      },
      [streamIdleWatchdog({ firstEventTimeoutMs: 10_000, idleTimeoutMs: 10_000 })],
    )
    await Promise.resolve(
      wrapped({} as never, { messages: [] } as never, { signal: caller.signal }),
    )

    expect(downstream?.aborted).toBe(false)
    caller.abort()
    expect(downstream?.aborted).toBe(true)
  })

  test('a caller that is already cancelled never reaches the provider unaborted', async () => {
    const caller = new AbortController()
    caller.abort()
    let downstream: AbortSignal | undefined
    const wrapped = wrapPiModel(
      async (_model, _context, options) => {
        downstream = options?.signal
        return fakeStream()
      },
      [streamIdleWatchdog()],
    )
    await Promise.resolve(
      wrapped({} as never, { messages: [] } as never, { signal: caller.signal }),
    )

    expect(downstream?.aborted).toBe(true)
  })

  test("pi's own stream object is preserved — only iteration gains the deadline", async () => {
    const upstream = fakeStream()
    const wrapped = wrapPiModel(async () => upstream, [streamIdleWatchdog()])
    const stream = await Promise.resolve(wrapped({} as never, { messages: [] } as never, {}))

    // The same object: `result()` and `push()` stay pi's, so nothing but the pace of
    // iteration is changed.
    expect(stream).toBe(upstream)
    upstream.push(doneEvent)
    expect(await stream.result()).toBe(partial)
  })

  test('the error carries the name the classifier matches on', () => {
    const error = new StreamIdleTimeoutError(1_000, 'mid-stream')
    // classifyAgentError matches by NAME to avoid importing this adapter, so the name is
    // part of the contract rather than a detail.
    expect(error.name).toBe('StreamIdleTimeoutError')
  })
})

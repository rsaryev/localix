import type { HookStream } from './chain'
import type { TraceEntry } from './trace'

/**
 * Streaming events, as Claude Code's engine runs them: a hook is an async generator that yields
 * the event's chunks and returns its result, and `next(e)` is the stream beneath (HookStream).
 *
 * A host answers a streaming event whole (Localix sends a model request and gets the message back
 * at once), so every link of the chain settles to an Outcome — its result and the chunks it
 * yielded up — and the stream a hook reads replays the chunks of the Outcome beneath.
 */

/** What one link of the chain settled to: its result and the chunks it yielded up, in order. */
export interface Outcome {
  value: unknown
  chunks: readonly unknown[]
  /** The links that ran for it, this one first (`next.trace` of the hook above). */
  trace?: readonly TraceEntry[]
}

/** How a streaming event's result and its chunks stand for each other. */
export interface StreamSite {
  /** The chunks a result the host answered whole streams as. */
  chunksOf(result: unknown): unknown[]
  /** The result a hook's own chunks make, when it yielded them without `next` and returned none. */
  resultOf(input: unknown, chunks: readonly unknown[]): unknown
}

/** A stream a hook got from `next`, with how many chunks it has handed out so far. */
export type OpenStream = HookStream & { readonly read: number }

/** The body a generator hook returns (or the stream a plain hook handed back as its answer). */
export function isHookBody(value: unknown): value is AsyncGenerator<unknown, unknown, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { next?: unknown }).next === 'function' &&
    typeof (value as Record<symbol, unknown>)[Symbol.asyncIterator] === 'function'
  )
}

/**
 * The stream over `beneath`, from chunk `start` on: thenable and with `.result` for a hook that
 * reads the result only. `.result` settles once beneath did, whether or not the chunks were read.
 */
export function openStream(beneath: Promise<Outcome>, start = 0): OpenStream {
  let read = start
  const result = beneath.then((outcome) => outcome.value)
  // A hook that never reads the result leaves no unhandled rejection behind.
  result.catch(() => {})
  async function* chunks() {
    const outcome = await beneath
    while (read < outcome.chunks.length) yield outcome.chunks[read++]
    return outcome.value
  }
  const stream = chunks() as AsyncGenerator<unknown, unknown, unknown>
  return Object.defineProperties(stream, {
    result: { value: result },
    // Thenable on purpose: a plain `async` turn.step hook awaits `next(e)` for the result, as
    // Localix's hooks did before the event streamed and as Claude Code's docs show.
    // oxlint-disable-next-line unicorn/no-thenable
    then: {
      value: (resolve?: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
        result.then(resolve, reject),
    },
    read: { get: () => read },
  }) as OpenStream
}

/** Drive a generator hook to its end: what it yields goes to `yielded`, its return value back. */
export async function drive(
  body: AsyncGenerator<unknown, unknown, unknown>,
  yielded: unknown[],
): Promise<unknown> {
  for (;;) {
    const step = await body.next()
    if (step.done) return step.value
    yielded.push(step.value)
  }
}

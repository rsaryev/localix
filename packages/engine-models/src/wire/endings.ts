/**
 * HOW A RESPONSE CAN END WITHOUT FINISHING, as named errors: the host's classifier keys on the
 * name (and on the wording, where it reads prose), so each ending reaches it as a failure it can
 * place instead of a bare stop reason with nothing attached.
 */

/** The provider went quiet: before its first part (it may have been thinking), or mid-response. */
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

/** The stream closed without its finish part: a connection cut short, not an answer. */
export class ProviderPrematureCloseError extends Error {
  constructor() {
    super('The provider ended the response without finishing it (premature close).')
    this.name = 'ProviderPrematureCloseError'
  }
}

/** The provider withheld the response under its content policy. Resending gets the same. */
export class ContentFilterError extends Error {
  constructor() {
    super('The provider filtered the response under its content policy.')
    this.name = 'ContentFilterError'
  }
}

/** The provider finished the response as an error without saying what went wrong. */
export class ProviderFinishError extends Error {
  constructor(raw: string | undefined) {
    super(`The provider ended the response with an error${raw ? ` (${raw})` : ''}.`)
    this.name = 'ProviderFinishError'
  }
}

/** Names that already say what happened: passed to the host as they are. */
export const NAMED_ENDINGS: ReadonlySet<string> = new Set([
  'StreamIdleTimeoutError',
  'ProviderPrematureCloseError',
  'ContentFilterError',
  'ProviderFinishError',
])

/**
 * The next part, or a rejection when the silence outlasts the deadline or the run is stopped — a
 * stream that ignores its abort must not hold a stop for minutes.
 */
export async function readWithDeadline<T>(
  reader: ReadableStreamDefaultReader<T>,
  timeoutMs: number,
  phase: 'first-event' | 'mid-stream',
  signal: AbortSignal,
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<T>['read']>>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StreamIdleTimeoutError(timeoutMs, phase)), timeoutMs)
        onAbort = () => reject(signal.reason)
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }),
    ])
  } finally {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

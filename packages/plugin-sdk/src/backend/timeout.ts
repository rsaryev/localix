/**
 * Deadline primitive for awaits we cannot cancel.
 *
 * Use it when the callee takes no `AbortSignal` — a third-party adapter, an
 * RPC handle, a foreign promise — so the ONLY way to bound the wait is to stop
 * waiting. When the callee DOES accept a signal, prefer an `AbortController`
 * (see `features/cc-hooks/http.ts`) so the work is actually cancelled instead
 * of merely abandoned.
 *
 * The abandoned promise keeps running; its eventual settlement is dropped (a
 * rejection handler stays attached, so it can never surface as an unhandled
 * rejection). The deadline timer is `unref`'d, so a hung callee cannot hold the
 * process open at shutdown.
 */

/**
 * Thrown when {@link withTimeout} gives up on a promise.
 *
 * WHY IT IS NOT CALLED `TimeoutError`. `'TimeoutError'` is a RESERVED name in the
 * agent-runtime error vocabulary: `classifyAgentError` (`packages/agent`) keys
 * "the PROVIDER took too long to respond" (+ `retryable: true`) off the bare string
 * `error.name === 'TimeoutError'`, and nothing type-checks that string.
 *
 * We do not own that name and cannot take it back — both real minters of it are
 * foreign:
 *   - the JS runtime: `AbortSignal.timeout()` aborts with a `DOMException` whose
 *     `name` is `'TimeoutError'` (WHATWG), and on Bun that DOMException IS an
 *     `instanceof Error`, so it lands squarely in the classifier's branch. Four
 *     provider drop-ins fetch with it.
 *   - `p-timeout`, whose exported `TimeoutError` the in-package OpenAI wire throws
 *     (inside the selected runtime adapter).
 *
 * So this class — a TOOL/host-side deadline, nothing to do with a provider — used to
 * mint the same name and was classified as a provider timeout: a search-provider or
 * hook deadline surfaced to the user as "the provider took too long", and was RETRIED
 * as if a provider had hiccuped. Verified identical on Bun.
 *
 * Naming it for what it is keeps the two vocabularies disjoint. A reserved-name rule
 * in the runtime adapter's contract tests guards it, alongside the
 * other bare-string contracts (`AbortError`, `FetchError`, `tool_use`).
 */
export class DeadlineExceededError extends Error {
  override readonly name = 'DeadlineExceededError'
  readonly timeoutMs: number

  constructor(timeoutMs: number, label?: string) {
    super(label ? `${label} timed out after ${timeoutMs}ms` : `Timed out after ${timeoutMs}ms`)
    this.timeoutMs = timeoutMs
  }
}

/**
 * Resolve/reject with `promise`, or reject with a {@link DeadlineExceededError} once
 * `ms` elapses — whichever happens first.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineExceededError(ms, label)), ms)
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      ;(timer as unknown as { unref(): void }).unref()
    }
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        // No-op once the deadline already rejected — but the handler must stay
        // attached so an abandoned promise's rejection is never "unhandled".
        reject(error)
      },
    )
  })
}

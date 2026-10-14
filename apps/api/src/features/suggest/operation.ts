/**
 * The one deadline and abort that own an inline-completion call — context reads included.
 *
 * Large repositories used to do their Git work before Model Task Runtime armed its clock, so a
 * completion could wait through a slow diff and only then time out at the model boundary. Arming
 * the operation first, and linking the caller's signal to it, also lets a superseded input stop
 * waiting for context immediately.
 */
export interface CompletionOperation {
  signal: AbortSignal
  deadlineAtMs: number
  /** True when the caller aborted (a supersede), false when the deadline passed. */
  callerAborted: () => boolean
  /**
   * Stop waiting for a dependency at the operation boundary. Settings adapters and model builders
   * do not all accept an AbortSignal, but a buggy or remote-backed one still must not hold the
   * realtime RPC open past the deadline. Synchronous throws settle to the fallback too.
   */
  within: <T>(work: () => Promise<T>, fallback: T) => Promise<T>
  dispose: () => void
}

export function startCompletionOperation(
  deadlineAtMs: number,
  callerSignal?: AbortSignal,
): CompletionOperation {
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(callerSignal?.reason)
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = setTimeout(
    () => controller.abort(new Error('inline completion deadline exceeded')),
    Math.max(0, deadlineAtMs - Date.now()),
  )
  timer.unref?.()

  const within = <T>(work: () => Promise<T>, fallback: T): Promise<T> =>
    new Promise((resolve) => {
      let settled = false
      const settle = (value: T) => {
        if (settled) return
        settled = true
        controller.signal.removeEventListener('abort', onAbort)
        resolve(value)
      }
      const onAbort = () => settle(fallback)
      if (controller.signal.aborted) return settle(fallback)
      controller.signal.addEventListener('abort', onAbort, { once: true })
      void Promise.resolve()
        .then(work)
        .then(settle, () => settle(fallback))
    })

  return {
    signal: controller.signal,
    deadlineAtMs,
    callerAborted: () => Boolean(callerSignal?.aborted),
    within,
    dispose: () => {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', abortFromCaller)
    },
  }
}

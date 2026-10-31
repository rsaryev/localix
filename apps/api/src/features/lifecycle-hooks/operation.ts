export type HookOperationResult<T> =
  | { kind: 'completed'; value: T }
  | { kind: 'timeout' }
  | { kind: 'aborted' }
  | { kind: 'failed'; error: unknown }

/** The host bounds its wait even when an injected handler fails to honor cancellation. */
export function runHookOperation<T>(options: {
  timeoutMs: number
  signal?: AbortSignal
  run: (signal: AbortSignal) => Promise<T> | T
}): Promise<HookOperationResult<T>> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('A lifecycle handler requires a positive finite timeout')
  }
  if (options.signal?.aborted) return Promise.resolve({ kind: 'aborted' })
  return new Promise((resolve) => {
    const controller = new AbortController()
    let settled = false
    const finish = (result: HookOperationResult<T>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      resolve(result)
    }
    const abort = () => {
      finish({ kind: 'aborted' })
      controller.abort(options.signal?.reason)
    }
    const timer = setTimeout(() => {
      finish({ kind: 'timeout' })
      controller.abort()
    }, options.timeoutMs)
    timer.unref?.()
    options.signal?.addEventListener('abort', abort, { once: true })
    try {
      // Attach both continuations immediately: late rejections remain observed after settlement.
      Promise.resolve(options.run(controller.signal)).then(
        (value) => finish({ kind: 'completed', value }),
        (error) => finish({ kind: 'failed', error }),
      )
    } catch (error) {
      finish({ kind: 'failed', error })
    }
  })
}

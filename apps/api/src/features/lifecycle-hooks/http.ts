export interface HookHttpOptions {
  url: string
  headers: Record<string, string>
  input: string
  timeoutMs: number
  maxOutputBytes: number
  signal?: AbortSignal
  /** A protocol may ignore bodies for particular statuses without waiting for their streams. */
  readBody?: (status: number) => boolean
}

export type HookHttpResult =
  | { kind: 'response'; status: number; body: string; truncated: boolean }
  | { kind: 'timeout' }
  | { kind: 'aborted' }
  | { kind: 'failed'; error: unknown }

/** Bounded HTTP transport; request conventions and response decisions belong to the adapter. */
export async function runHookHttp(options: HookHttpOptions): Promise<HookHttpResult> {
  if (
    !Number.isFinite(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    !Number.isSafeInteger(options.maxOutputBytes) ||
    options.maxOutputBytes < 0
  ) {
    throw new Error('Hook HTTP limits must be finite and non-negative, with a positive timeout')
  }
  if (options.signal?.aborted) return { kind: 'aborted' }
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs)
  timer.unref?.()
  try {
    const response = await fetch(options.url, {
      method: 'POST',
      headers: options.headers,
      body: options.input,
      signal: controller.signal,
    })
    if (options.readBody && !options.readBody(response.status)) {
      await response.body?.cancel()
      return { kind: 'response', status: response.status, body: '', truncated: false }
    }
    const reader = response.body?.getReader()
    let body = ''
    let bytes = 0
    let truncated = false
    if (reader) {
      const decoder = new TextDecoder()
      try {
        while (bytes < options.maxOutputBytes) {
          const { done, value } = await reader.read()
          if (done) {
            body += decoder.decode()
            break
          }
          const captured = value.subarray(0, options.maxOutputBytes - bytes)
          bytes += captured.byteLength
          body += decoder.decode(captured, { stream: true })
        }
        // Stop consuming as soon as the budget is reached, even if the endpoint never closes.
        // An incomplete UTF-8 character at this boundary is omitted rather than corrupted.
        if (bytes >= options.maxOutputBytes) {
          truncated = true
          await reader.cancel()
        }
      } finally {
        reader.releaseLock()
      }
    }
    return { kind: 'response', status: response.status, body, truncated }
  } catch (error) {
    if (timedOut) return { kind: 'timeout' }
    if (controller.signal.aborted) return { kind: 'aborted' }
    return { kind: 'failed', error }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}

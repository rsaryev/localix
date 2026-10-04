import { makeAbortError } from '@localixai/agent'
import { startupRetryDelay } from '@/shared/lib/startupRetry'
import { eventSocket } from './eventSocket'
import { ApiError } from './failure'

/** File errors need user action; a dropped transport during an API restart does not. */
export function isRecoverableReadError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    ((error.status === 0 && ['network', 'ws_closed', 'ws_timeout'].includes(error.code ?? '')) ||
      [408, 502, 503, 504].includes(error.status))
  )
}

function waitForReadRetry(delay: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      cleanup()
      resolve()
    }
    const abort = () => {
      cleanup()
      reject(makeAbortError('File read was cancelled'))
    }
    const timer = setTimeout(finish, delay)
    const unsubscribe = eventSocket.onConnected(finish)
    const cleanup = () => {
      clearTimeout(timer)
      unsubscribe()
      signal?.removeEventListener('abort', abort)
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

/**
 * A one-shot read stranded open tabs on transient backend restarts. Retry only
 * transport/unavailable responses, wake early on reconnect, and retire the whole
 * retry chain with its caller. Writes never cross this helper.
 */
export async function recoverRead<T>(
  read: () => Promise<T>,
  options: { signal?: AbortSignal; onRecovery?: () => void; recoveryMs?: number } = {},
): Promise<T> {
  let deadline: number | undefined
  let failures = 0
  for (;;) {
    options.signal?.throwIfAborted()
    try {
      return await read()
    } catch (error) {
      options.signal?.throwIfAborted()
      if (!isRecoverableReadError(error)) throw error
      deadline ??= Date.now() + (options.recoveryMs ?? 30_000)
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw error
      options.onRecovery?.()
      await waitForReadRetry(Math.min(startupRetryDelay(failures++), remaining), options.signal)
    }
  }
}

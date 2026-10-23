import { errorMessage } from '../../lib/errors'
import { DeadlineExceededError, withTimeout } from '../../lib/timeout'

/**
 * Shared hook-invocation primitive used by every mini app hook + memory-provider
 * call: run one host-supplied callback under a hard timeout with per-mini-app
 * try/catch isolation. A throwing or timed-out hook is logged and resolves to
 * `undefined` — callers treat that as "observe only" and the turn is never broken.
 */

/** Hard cap per hook invocation — a slow hook must never stall the agent loop. */
export const HOOK_TIMEOUT_MS = 5000

export interface HookRunOptions {
  sessionId: string
  logger?: { warn: (msg: string) => void }
  /** Override the per-hook timeout (tests). */
  timeoutMs?: number
}

/**
 * Run one hook with timeout + isolation. Returns the hook's result, or `undefined`
 * when the hook threw or timed out (both logged) — callers treat that as "observe only".
 */
export async function invokeHook<T>(
  app: string,
  hookName: string,
  fn: () => T | Promise<T>,
  timeoutMs: number,
  logger?: { warn: (msg: string) => void },
): Promise<T | undefined> {
  try {
    // A hook takes no AbortSignal, so the only way to bound it is to stop waiting
    // — which is exactly what `withTimeout` is for. It also owns the timer
    // hygiene (unref'd, so a hung hook cannot hold the process open at shutdown).
    return await withTimeout(Promise.resolve().then(fn), timeoutMs)
  } catch (err) {
    logger?.warn(
      err instanceof DeadlineExceededError
        ? `[mini-app:${app}] ${hookName} hook timed out after ${timeoutMs}ms — ignored`
        : `[mini-app:${app}] ${hookName} hook failed: ${errorMessage(err)}`,
    )
    return undefined
  }
}

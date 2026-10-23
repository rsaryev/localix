/**
 * Shared lifecycle owner for server -> client -> server request/reply relays.
 *
 * A request has three terminal paths (reply, timeout, close/publish failure). They
 * must all delete the correlation entry and cancel its timer exactly once. Keeping
 * that transition here prevents the mini app and preview relays from drifting apart.
 */

export interface ReplyScheduler {
  schedule: (callback: () => void, delayMs: number) => unknown
  cancel: (handle: unknown) => void
}

const systemScheduler: ReplyScheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

interface PendingReply<TOutcome, TMeta> {
  resolve: (outcome: TOutcome) => void
  meta: TMeta
  timer?: unknown
}

export interface PendingReplyRequest<TOutcome, TMeta> {
  id: string
  meta: TMeta
  timeoutMs: number
  onTimeout: () => TOutcome
  onPublishError: (error: unknown) => TOutcome
  /** Called only after the request is parked, so a same-tick reply cannot win a race. */
  publish: () => void
}

export interface PendingReplyRegistryOptions {
  /** Global safety cap across sessions for this relay instance. Default 256. */
  maxPending?: number
}

export const DEFAULT_MAX_PENDING_REPLIES = 256

function normalizedTimeoutMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid timeoutMs: ${String(value)}`)
  }
  return Math.floor(value)
}

export function createPendingReplyRegistry<TOutcome, TMeta>(
  scheduler: ReplyScheduler = systemScheduler,
  options: PendingReplyRegistryOptions = {},
) {
  const maxPending = options.maxPending ?? DEFAULT_MAX_PENDING_REPLIES
  if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
    throw new Error(`Invalid maxPending: ${String(maxPending)}`)
  }
  const pending = new Map<string, PendingReply<TOutcome, TMeta>>()

  const settle = (id: string, entry: PendingReply<TOutcome, TMeta>, outcome: TOutcome): boolean => {
    // Identity-check as well as key-check: a stale timer must never settle a future
    // request if a caller accidentally reuses a correlation id.
    if (pending.get(id) !== entry) return false
    pending.delete(id)
    if (entry.timer !== undefined) scheduler.cancel(entry.timer)
    entry.resolve(outcome)
    return true
  }

  return {
    request(input: PendingReplyRequest<TOutcome, TMeta>): Promise<TOutcome> {
      return new Promise<TOutcome>((resolve) => {
        if (pending.has(input.id)) {
          resolve(input.onPublishError(new Error(`Pending reply id already exists: ${input.id}`)))
          return
        }
        if (pending.size >= maxPending) {
          resolve(
            input.onPublishError(
              new Error(`Pending reply capacity exhausted (${maxPending}); request not published`),
            ),
          )
          return
        }
        const entry: PendingReply<TOutcome, TMeta> = { resolve, meta: input.meta }
        pending.set(input.id, entry)

        try {
          const timeoutMs = normalizedTimeoutMs(input.timeoutMs)
          const timer = scheduler.schedule(() => {
            settle(input.id, entry, input.onTimeout())
          }, timeoutMs)
          entry.timer = timer

          // A test scheduler (or a future immediate-deadline scheduler) may fire
          // synchronously. Do not publish a request that has already timed out.
          if (pending.get(input.id) !== entry) {
            scheduler.cancel(timer)
            return
          }
          input.publish()
        } catch (error) {
          // Includes invalid deadlines, scheduler failure and serialization/publish
          // failure. All are terminal and must release the parked entry immediately.
          settle(input.id, entry, input.onPublishError(error))
        }
      })
    },

    resolve(id: string, allowed: (meta: TMeta) => boolean, outcome: TOutcome): boolean {
      const entry = pending.get(id)
      if (!entry || !allowed(entry.meta)) return false
      return settle(id, entry, outcome)
    },

    closeWhere(predicate: (meta: TMeta) => boolean, outcome: TOutcome): void {
      for (const [id, entry] of pending) {
        if (predicate(entry.meta)) settle(id, entry, outcome)
      }
    },

    /** Process-local diagnostic count; requests always settle back to zero. */
    size(): number {
      return pending.size
    },
  }
}

import type { MiniAppBridgeMessage, MiniAppBridgeErrorPayload } from './bridge'

// ─── Request/reply correlation ───────────────────────────────────────────────

/**
 * Tiny correlation table for `invoke` → `result`/`error`. The caller mints a
 * request (unique id + promise), sends `invokeMessage(id, …)`, and feeds every
 * inbound bridge message to `settle` — which resolves/rejects the matching
 * pending promise and reports whether the message was consumed. Framework-free
 * so either side can use it.
 */
export interface BridgeRequests {
  /** Mint a pending request. `timeoutMs` (optional) rejects it if no reply lands. */
  create<T = unknown>(timeoutMs?: number): { id: string; promise: Promise<T> }
  /** Settle a pending request from an inbound `result`/`error`. False = not ours. */
  settle(message: MiniAppBridgeMessage): boolean
  /** Reject everything still pending (e.g. the iframe went away). */
  rejectAll(reason?: unknown): void
  /** Number of requests still awaiting a reply. */
  readonly size: number
}

export function createBridgeRequests(): BridgeRequests {
  type Pending = {
    resolve: (v: unknown) => void
    reject: (e: unknown) => void
    timer?: ReturnType<typeof setTimeout>
  }
  const pending = new Map<string, Pending>()
  let seq = 0
  const prefix = Math.random().toString(36).slice(2, 8)

  function finish(id: string): Pending | undefined {
    const entry = pending.get(id)
    if (!entry) return undefined
    pending.delete(id)
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    return entry
  }

  return {
    create<T = unknown>(timeoutMs?: number) {
      const id = `${prefix}-${++seq}`
      const promise = new Promise<T>((resolve, reject) => {
        const entry: Pending = { resolve: resolve as (v: unknown) => void, reject }
        if (timeoutMs !== undefined && timeoutMs > 0) {
          entry.timer = setTimeout(() => {
            pending.delete(id)
            reject(new Error(`Bridge request timed out after ${timeoutMs}ms`))
          }, timeoutMs)
        }
        pending.set(id, entry)
      })
      return { id, promise }
    },
    settle(message) {
      if (message.type !== 'result' && message.type !== 'error') return false
      if (typeof message.id !== 'string') return false
      const entry = finish(message.id)
      if (!entry) return false
      if (message.type === 'result') entry.resolve(message.payload)
      else {
        const payload = message.payload as MiniAppBridgeErrorPayload | undefined
        entry.reject(new Error(payload?.message ?? 'Bridge invoke failed'))
      }
      return true
    },
    rejectAll(reason) {
      // Deleting the CURRENT key mid-iteration is safe for a JS Map.
      for (const id of pending.keys()) {
        finish(id)?.reject(reason ?? new Error('Bridge closed'))
      }
    },
    get size() {
      return pending.size
    },
  }
}

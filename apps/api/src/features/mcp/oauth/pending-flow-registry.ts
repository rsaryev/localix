/** Resources retained while an interactive MCP OAuth callback is pending. */
export interface PendingOAuthResources {
  expiresAt: number
  transport: { close(): Promise<void> }
  client: { close(): Promise<void> }
}

type TimerHandle = number | { unref?(): unknown }

export interface PendingOAuthRegistryOptions {
  /** Bounds transports retained by abandoned or deliberately flooded flows. */
  maxSize?: number
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => TimerHandle
  cancel?: (handle: TimerHandle) => void
}

/**
 * Owns pending callback resources until they are claimed or expire.
 *
 * A sweep-on-access alone is insufficient: if the user abandons the final OAuth
 * flow, no later request arrives to release its HTTP transport. Every entry gets
 * an active, unref'd deadline and the registry is also size-bounded.
 */
export function createPendingOAuthRegistry<T extends PendingOAuthResources>(
  options: PendingOAuthRegistryOptions = {},
) {
  const maxSize = options.maxSize ?? 64
  if (!Number.isSafeInteger(maxSize) || maxSize <= 0) {
    throw new Error('pending OAuth registry maxSize must be a positive safe integer')
  }
  const now = options.now ?? Date.now
  const schedule =
    options.schedule ??
    ((callback: () => void, delayMs: number): TimerHandle => setTimeout(callback, delayMs))
  const cancel =
    options.cancel ??
    ((handle: TimerHandle): void => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const flows = new Map<string, T>()
  const timers = new WeakMap<T, TimerHandle>()

  const clearDeadline = (flow: T): void => {
    const timer = timers.get(flow)
    if (timer !== undefined) cancel(timer)
    timers.delete(flow)
  }

  const close = (flow: T): void => {
    clearDeadline(flow)
    void (async () => {
      await flow.transport.close().catch(() => {})
      await flow.client.close().catch(() => {})
    })()
  }

  const expire = (state: string, expected: T): void => {
    if (flows.get(state) !== expected) return
    flows.delete(state)
    close(expected)
  }

  const sweep = (nowMs = now()): void => {
    for (const [state, flow] of flows) {
      if (flow.expiresAt <= nowMs) expire(state, flow)
    }
  }

  const add = (state: string, flow: T): void => {
    sweep()
    const replaced = flows.get(state)
    if (replaced) {
      flows.delete(state)
      close(replaced)
    }
    while (flows.size >= maxSize) {
      const oldestState = flows.keys().next().value
      if (oldestState === undefined) break
      const oldest = flows.get(oldestState)
      flows.delete(oldestState)
      if (oldest) close(oldest)
    }
    flows.set(state, flow)
    const timer = schedule(() => expire(state, flow), Math.max(0, flow.expiresAt - now()))
    timers.set(flow, timer)
    if (typeof timer !== 'number') timer.unref?.()
  }

  const take = (state: string, nowMs = now()): T | undefined => {
    sweep(nowMs)
    const flow = flows.get(state)
    if (!flow) return undefined
    flows.delete(state)
    clearDeadline(flow)
    return flow
  }

  return { add, take, sweep, size: () => flows.size }
}

type ResourceStatus = 'pending' | 'ready' | { error: string }
const status = new Map<string, ResourceStatus>()
const listeners = new Set<() => void>()
const publish = () => {
  for (const listener of listeners) listener()
}

/** A destination waits for renderer-owned acceptance, independently of window first paint. */
export const workItemTransferReady = {
  arm(keys: readonly string[]) {
    for (const key of keys) status.set(key, 'pending')
  },
  armed: (key: string) => status.has(key),
  success(key: string) {
    if (status.get(key) !== 'pending') return
    status.set(key, 'ready')
    publish()
  },
  failure(key: string, message: string) {
    if (!status.has(key)) return
    status.set(key, { error: message })
    publish()
  },
  release(keys: readonly string[]) {
    for (const key of keys) status.delete(key)
  },
}

export const terminalTransferReadyKey = (id: string) => `terminal:${id}`
export const browserTransferReadyKey = (id: string) => `browser:${id}`
export const fileTransferReadyKey = (sessionId: string, path: string) =>
  `file:${JSON.stringify([sessionId, path])}`

export function waitForTransferResources(keys: readonly string[], budgetMs: number): Promise<void> {
  if (!keys.length) return Promise.resolve()
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: string) => {
      if (timer) clearTimeout(timer)
      listeners.delete(check)
      if (error) reject(new Error(error))
      else resolve()
    }
    const check = () => {
      const values = keys.map((key) => status.get(key))
      const failed = values.find((value) => typeof value === 'object')
      if (failed && typeof failed === 'object') finish(failed.error)
      else if (values.every((value) => value === 'ready')) finish()
    }
    listeners.add(check)
    timer = setTimeout(
      () => finish('The moved tab could not attach in its destination'),
      Math.max(1, budgetMs),
    )
    check()
  })
}

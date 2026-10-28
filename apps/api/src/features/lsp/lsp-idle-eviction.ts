interface IdleClient {
  client: { hasOpenDocuments(): boolean; dispose(): void } | null
  idleTimer?: ReturnType<typeof setTimeout>
}

interface IdleEvictionPorts<T extends IdleClient> {
  idleTimeoutMs: number
  isDisposed: () => boolean
  isStarting: (projectRoot: string, key: string) => boolean | undefined
  getClients: (projectRoot: string) => Map<string, T> | undefined
  deleteProject: (projectRoot: string) => void
  notifyUpdate: (projectRoot: string) => void
}

/** Idle timers follow live document/startup state and release the original client only. */
export function createIdleEviction<T extends IdleClient>({
  idleTimeoutMs,
  isDisposed,
  isStarting,
  getClients,
  deleteProject,
  notifyUpdate,
}: IdleEvictionPorts<T>) {
  function clearIdleTimer(mc: T): void {
    if (mc.idleTimer) clearTimeout(mc.idleTimer)
    mc.idleTimer = undefined
  }

  function disposeManaged(projectRoot: string, key: string, mc: T): void {
    clearIdleTimer(mc)
    try {
      mc.client?.dispose()
    } catch {
      /* idempotent */
    }
    const clients = getClients(projectRoot)
    if (clients?.get(key) === mc) clients.delete(key)
    if (clients?.size === 0) deleteProject(projectRoot)
    notifyUpdate(projectRoot)
  }

  function armIdleEviction(projectRoot: string, key: string, mc: T): void {
    clearIdleTimer(mc)
    if (isDisposed() || idleTimeoutMs <= 0 || !mc.client || mc.client.hasOpenDocuments()) return
    mc.idleTimer = setTimeout(() => {
      if (!mc.client?.hasOpenDocuments() && !isStarting(projectRoot, key))
        disposeManaged(projectRoot, key, mc)
    }, idleTimeoutMs)
    mc.idleTimer.unref?.()
  }

  return { clearIdleTimer, armIdleEviction }
}

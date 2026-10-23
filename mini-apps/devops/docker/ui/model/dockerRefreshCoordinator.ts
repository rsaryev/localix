export type DockerRefreshScope = 'containers' | 'all'

export interface DockerRefreshCoordinator {
  request: (scope: DockerRefreshScope) => Promise<void>
}

/**
 * Coalesces inventory reads by strength:
 * - equal/weaker requests join the active read;
 * - a full read requested during a container-only poll is queued exactly once;
 * - the queued full read still runs if the preceding poll rejects.
 */
export function createDockerRefreshCoordinator(
  run: (scope: DockerRefreshScope) => Promise<void>,
): DockerRefreshCoordinator {
  let active: { scope: DockerRefreshScope; promise: Promise<void> } | null = null
  let queuedAll: Promise<void> | null = null

  const start = (scope: DockerRefreshScope): Promise<void> => {
    const promise = Promise.resolve()
      .then(() => run(scope))
      .finally(() => {
        if (active?.promise === promise) active = null
      })
    active = { scope, promise }
    return promise
  }

  const request = (scope: DockerRefreshScope): Promise<void> => {
    if (!active) return start(scope)
    if (active.scope === 'all' || scope === 'containers') return active.promise
    if (queuedAll) return queuedAll

    const preceding = active.promise
    const queued = preceding.then(
      () => request('all'),
      () => request('all'),
    )
    const tracked = queued.finally(() => {
      if (queuedAll === tracked) queuedAll = null
    })
    queuedAll = tracked
    return tracked
  }

  return { request }
}

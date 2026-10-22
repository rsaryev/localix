/**
 * The session → run registry (`RuntimeState.activeRuns`), announcing every slot it gives up.
 *
 * A stop must not acknowledge until the exact run it aborted has left its slot, and that happens in
 * the run's own teardown, a continuation hand-off or a failed admission — three writers, all of
 * them `delete` on this map. Announcing from the map itself means each of them, and any future
 * one, wakes the waiting stop without having to remember to.
 */
export interface ActiveRuns extends Map<string, AbortController> {
  /**
   * Called with a session id whenever its slot is deleted, replaced or cleared. Optional so a plain
   * `Map` still satisfies the type in a fixture that never waits on a release.
   */
  onRelease?(listener: (sessionId: string) => void): () => void
}

class AnnouncingRuns extends Map<string, AbortController> implements ActiveRuns {
  private readonly listeners = new Set<(sessionId: string) => void>()

  onRelease(listener: (sessionId: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  override set(sessionId: string, run: AbortController): this {
    const previous = super.get(sessionId)
    super.set(sessionId, run)
    if (previous && previous !== run) this.announce(sessionId)
    return this
  }

  override delete(sessionId: string): boolean {
    const removed = super.delete(sessionId)
    if (removed) this.announce(sessionId)
    return removed
  }

  override clear(): void {
    const sessions = [...this.keys()]
    super.clear()
    for (const sessionId of sessions) this.announce(sessionId)
  }

  private announce(sessionId: string): void {
    for (const listener of this.listeners) listener(sessionId)
  }
}

export function createActiveRuns(): ActiveRuns {
  return new AnnouncingRuns()
}

/**
 * Resolve true once `run` no longer owns `sessionId`'s slot, or with the slot's state at
 * `timeoutMs`. A registry without `onRelease` is read once, at the bound.
 */
export function whenRunReleased(
  activeRuns: ActiveRuns,
  sessionId: string,
  run: AbortController,
  timeoutMs: number,
): Promise<boolean> {
  const released = () => activeRuns.get(sessionId) !== run
  if (released()) return Promise.resolve(true)
  return new Promise((resolve) => {
    let unsubscribe = () => {}
    const finish = () => {
      clearTimeout(timer)
      unsubscribe()
      resolve(released())
    }
    const timer = setTimeout(finish, Math.max(0, timeoutMs))
    unsubscribe =
      activeRuns.onRelease?.((id) => {
        if (id === sessionId && released()) finish()
      }) ?? unsubscribe
  })
}

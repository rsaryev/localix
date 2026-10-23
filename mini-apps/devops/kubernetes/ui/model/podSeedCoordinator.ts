interface ActiveSeed<T> {
  generation: number
  key: string
  promise: Promise<T>
}

/**
 * Coalesces repeated seed requests for one mounted pod target.
 *
 * A websocket can report several reconnects while the first REST re-seed is still
 * pending. Sharing that promise prevents both request storms and the
 * last-write-token starvation where every reconnect invalidates the response
 * before it can clear the loading state. A new target generation never joins an
 * older target's request.
 */
export class PodSeedCoordinator {
  private active: ActiveSeed<unknown> | null = null

  run<T>(generation: number, key: string, task: () => Promise<T>): Promise<T> {
    const active = this.active
    if (active?.generation === generation && active.key === key) {
      return active.promise as Promise<T>
    }

    const promise = task()
    this.active = { generation, key, promise }
    const clear = () => {
      if (this.active?.promise === promise) this.active = null
    }
    void promise.then(clear, clear)
    return promise
  }
}

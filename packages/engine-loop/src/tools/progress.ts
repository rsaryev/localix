/**
 * A tool's progress, delivered without piling up.
 *
 * A tool may report progress far faster than the event stream drains. Only two snapshots are
 * ever held — the one being delivered and the newest one waiting — so a chatty tool costs
 * memory proportional to nothing. `settle` waits for the last delivery and rethrows its failure
 * once; reports after it are dropped.
 */
export function createProgressPump(deliver: (details: unknown) => Promise<void>) {
  let accepting = true
  let pending: { details: unknown } | undefined
  let pump: Promise<void> | undefined
  let failure: { error: unknown } | undefined

  const start = (): void => {
    if (pump || failure || !pending) return
    pump = (async () => {
      while (pending) {
        const next = pending
        pending = undefined
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- one delivery at a time is the point: the next waits for the stream to take this one
        await deliver(next.details)
      }
    })().then(
      () => {
        pump = undefined
        start()
      },
      (error: unknown) => {
        pump = undefined
        pending = undefined
        failure = { error }
      },
    )
  }

  return {
    report(details: unknown): void {
      if (!accepting) return
      pending = { details }
      start()
    },
    async settle(): Promise<void> {
      accepting = false
      while (pump) await pump
      if (failure) throw failure.error
    },
  }
}

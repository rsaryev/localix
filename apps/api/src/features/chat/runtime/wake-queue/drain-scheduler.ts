import { createPartitionedEventLoop } from '../../../../lib/partitioned-event-loop'
import type { WakeQueueSharedState } from './leases'
import type { DrainOptions } from './drain-contracts'

export function createDrainScheduler(
  shared: WakeQueueSharedState,
  onError: (error: unknown) => void,
  drainImpl: (sessionId: string, options?: DrainOptions) => Promise<void>,
) {
  const drainPendingAndRun = (sessionId: string, options?: DrainOptions): Promise<void> => {
    if (shared.closed) return Promise.resolve()
    const pending = drainImpl(sessionId, options)
    shared.inFlightDrains.add(pending)
    void pending.then(
      () => shared.inFlightDrains.delete(pending),
      () => shared.inFlightDrains.delete(pending),
    )
    return pending
  }

  const scheduledOptions = new Map<string, DrainOptions>()
  const eventLoop = createPartitionedEventLoop<string>({
    dispatch: async (sessionId) => {
      const options = scheduledOptions.get(sessionId)
      scheduledOptions.delete(sessionId)
      await drainPendingAndRun(sessionId, options)
    },
    onError,
  })

  function scheduleDrain(sessionId: string, options?: DrainOptions): void {
    if (shared.closed) return
    if (options) scheduledOptions.set(sessionId, options)
    eventLoop.notify(sessionId)
  }

  return {
    drainPendingAndRun,
    scheduleDrain,
    close: () => eventLoop.close(),
    subscribe: (listener: Parameters<typeof eventLoop.subscribe>[0]) =>
      eventLoop.subscribe(listener),
  }
}

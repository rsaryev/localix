import type { SteeringBoundary } from '@localixai/agent'

/** Wait until a runtime-announced turn has actually reached the host transcript.
 * A bounded event stream may deliver its turn_end after Pi asks for the next model sample. */
export function createToolCheckpointGate(input: {
  signal: AbortSignal
  completedIndex: () => number | undefined
  timeoutMs?: number
}) {
  const waiters = new Map<number, Set<(ready: boolean) => void>>()

  function waitFor(index: number): Promise<boolean> {
    if (input.signal.aborted) return Promise.resolve(false)
    if (input.completedIndex() === index) return Promise.resolve(true)

    return new Promise((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>
      const finish = (ready: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        input.signal.removeEventListener('abort', onAbort)
        const listeners = waiters.get(index)
        listeners?.delete(finish)
        if (listeners?.size === 0) waiters.delete(index)
        resolve(ready)
      }
      const onAbort = () => finish(false)
      const listeners = waiters.get(index) ?? new Set<(ready: boolean) => void>()
      listeners.add(finish)
      waiters.set(index, listeners)
      input.signal.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => finish(false), input.timeoutMs ?? 2_000)
      if (input.signal.aborted) finish(false)
      else if (input.completedIndex() === index) finish(true)
    })
  }

  function notify(index: number): void {
    for (const finish of waiters.get(index) ?? []) finish(true)
  }

  return { waitFor, notify }
}

/** A steering split cannot race older queued events into its fresh assistant row. */
export async function takeSteeringAtCheckpoint(input: {
  boundary?: SteeringBoundary
  waitFor: (index: number) => Promise<boolean>
  take: () => Promise<string[]>
  onToolBoundary: (index: number | undefined) => void
}): Promise<string[]> {
  input.onToolBoundary(undefined)
  const index = input.boundary?.completedTurnIndex ?? input.boundary?.completedToolTurnIndex
  if (index !== undefined && !(await input.waitFor(index))) return []
  input.onToolBoundary(input.boundary?.completedToolTurnIndex)
  return input.take()
}

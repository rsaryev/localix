import type { RunCompletion, RunExecutionOutcome } from '../run-outcome'
import type { WakeQueueSharedState } from './leases'

export const createContinuationOperations = (shared: WakeQueueSharedState) => {
  const attachContinuation = (id: string, sessionId: string, completion: RunCompletion): void => {
    const entry = shared.continuationCompletions.get(id) ?? {
      sessionId,
      completions: new Set<RunCompletion>(),
    }
    entry.completions.add(completion)
    shared.continuationCompletions.set(id, entry)
  }

  const deliveryCompletion = (id: string): RunCompletion | undefined =>
    shared.continuationCompletions.get(id)?.completions.values().next().value

  const bandCompletion = (ids: readonly string[], sessionId: string): RunCompletion | undefined => {
    const completions = new Set(
      ids.flatMap((id) => [...(shared.continuationCompletions.get(id)?.completions ?? [])]),
    )
    const primary = completions.values().next().value as RunCompletion | undefined
    if (!primary) return undefined
    // Priority-band coalescing can join deliveries from distinct logical callers.
    // One completion crosses the runtime boundary; aliases mirror its terminal
    // result so every scheduler observes the same physical run honestly.
    for (const completion of completions) {
      if (completion === primary) continue
      void primary.promise.then((outcome) => completion.settle(outcome))
    }
    for (const id of ids) attachContinuation(id, sessionId, primary)
    return primary
  }

  const detachContinuations = (ids: readonly string[]): void => {
    for (const id of ids) shared.continuationCompletions.delete(id)
  }

  const settleCompletion = (ids: readonly string[], outcome: RunExecutionOutcome): void => {
    if (outcome.status === 'continued') return
    for (const id of ids) {
      for (const completion of shared.continuationCompletions.get(id)?.completions ?? []) {
        completion.settle(outcome)
      }
    }
    detachContinuations(ids)
  }

  const settleSessionCompletions = (
    sessionId: string,
    outcome: Exclude<RunExecutionOutcome, { status: 'continued' }>,
  ): void => {
    const ids = new Set<string>()
    for (const [id, entry] of shared.continuationCompletions) {
      if (entry.sessionId === sessionId) ids.add(id)
    }
    settleCompletion([...ids], outcome)
  }

  return {
    attachContinuation,
    deliveryCompletion,
    bandCompletion,
    detachContinuations,
    settleCompletion,
    settleSessionCompletions,
  }
}

export type ContinuationOperations = ReturnType<typeof createContinuationOperations>

import { agentLaneKey, type ExecutionAddress } from '../../agent-core/execution-address'
import type { ParticipantLaneSnapshotRepository } from '../participant-lane-snapshot-repository'
import type { FrozenSessionContext } from './frozen-session-context'
import type { SessionSnapshotCache } from './session-snapshot'

/** Persist before use: a process restart must not replace a prefix already sent to the model. */
export async function resolvePromptSnapshot(input: {
  cache: SessionSnapshotCache<FrozenSessionContext>
  store: ParticipantLaneSnapshotRepository
  userId: string
  address: ExecutionAddress
  boundary: string
  fresh: FrozenSessionContext
  initialize: () => Promise<void>
}): Promise<FrozenSessionContext> {
  const { cache, store, userId, address, boundary, fresh } = input
  const key = agentLaneKey(address)
  const cached = cache.enabled
    ? (cache.get(key, boundary) ?? (await store.get(userId, address, boundary)))
    : undefined
  let snapshot = fresh
  if (cached) {
    const skillsChanged = cached.skillOverridesRevision !== fresh.skillOverridesRevision
    const memoryChanged = cached.memoryScopesRevision !== fresh.memoryScopesRevision
    if (memoryChanged) await input.initialize()
    snapshot =
      skillsChanged || memoryChanged
        ? {
            ...cached,
            ...(skillsChanged
              ? {
                  skillsContext: fresh.skillsContext,
                  skillOverridesRevision: fresh.skillOverridesRevision,
                }
              : {}),
            ...(memoryChanged
              ? {
                  memoryContext: fresh.memoryContext,
                  memoryUsage: fresh.memoryUsage,
                  memoryScopesRevision: fresh.memoryScopesRevision,
                }
              : {}),
          }
        : cached
  } else {
    await input.initialize()
  }
  if (cache.enabled) {
    if (snapshot !== cached) await store.set(userId, address, boundary, snapshot)
    cache.set(key, boundary, snapshot)
  }
  return snapshot
}

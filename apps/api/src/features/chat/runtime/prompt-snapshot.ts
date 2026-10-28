import type { SessionPromptSnapshotRepository } from '../session-prompt-snapshot-repository'
import type { FrozenSessionContext } from './frozen-session-context'
import type { SessionSnapshotCache } from './session-snapshot'

/** Persist before use: a process restart must not replace a prefix already sent to the model. */
export async function resolvePromptSnapshot(input: {
  cache: SessionSnapshotCache<FrozenSessionContext>
  store: SessionPromptSnapshotRepository
  userId: string
  sessionId: string
  boundary: string
  fresh: FrozenSessionContext
  initialize: () => Promise<void>
}): Promise<FrozenSessionContext> {
  const { cache, store, userId, sessionId, boundary, fresh } = input
  const cached = cache.enabled
    ? (cache.get(sessionId, boundary) ?? (await store.get(userId, sessionId, boundary)))
    : undefined
  let snapshot = fresh
  if (cached) {
    // The retrievable catalog must agree with the tool, including newly discovered
    // repository procedures. Refresh on an actual bounded catalog change, not every run.
    const skillsChanged =
      cached.skillOverridesRevision !== fresh.skillOverridesRevision ||
      cached.skillsContext !== fresh.skillsContext
    // A new folder (the run moved to another repository) reloads memory; edits to it wait for the
    // next boundary, as Claude Code loads MEMORY.md once per session.
    const memoryChanged = cached.memoryDir !== fresh.memoryDir
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
                  memoryDir: fresh.memoryDir,
                  memoryContext: fresh.memoryContext,
                  memoryClipped: fresh.memoryClipped,
                }
              : {}),
          }
        : cached
  } else {
    await input.initialize()
  }
  if (cache.enabled) {
    if (snapshot !== cached) await store.set(userId, sessionId, boundary, snapshot)
    cache.set(sessionId, boundary, snapshot)
  }
  return snapshot
}

import { resolveCompletionReferences } from '../features/autocomplete/completion-references'
import type { ContextManager } from '../features/context-fabric/manager'
import {
  resolveContextWorkspace,
  type SessionWorkspacePorts,
} from '../features/context-fabric/session-workspace'
import type { StoreContextPort } from '../features/store/service'

/**
 * The Store's working context (`features/store/recommend.ts`), composed here because it joins two
 * features (A4): the references the client sent resolve through Context Fabric for the
 * `recommendation` destination, inside the session's workspace and under the same scope,
 * containment and secret rules as a sent message, and every automatic provider that declares the
 * destination adds what it knows. A provider is never named here: declaring the destination is
 * how one shapes what the Store suggests.
 */

/** How much admitted text a recommendation reads; the query keeps far less of it. */
const RECOMMENDATION_CONTEXT_BYTES = 32_000
/** How long the working set may take: a recommendation is never worth a slow Store. */
const RECOMMENDATION_DEADLINE_MS = 2_500
/** Automatic contributions packed beside the references. */
const AUTOMATIC_ITEMS = 8

export function createStoreWorkingContext(deps: {
  contextManager: ContextManager
  workspace: SessionWorkspacePorts
  now?: () => number
}): StoreContextPort {
  const now = deps.now ?? Date.now
  return async (userId, request) => {
    const deadlineAtMs = now() + RECOMMENDATION_DEADLINE_MS
    const signal = AbortSignal.timeout(RECOMMENDATION_DEADLINE_MS)
    const { sessionId, projectId } = request
    const workspace = sessionId
      ? await resolveContextWorkspace(deps.workspace, userId, sessionId).catch(() => undefined)
      : undefined
    const base = {
      destination: 'recommendation' as const,
      userId,
      ...(projectId ? { projectId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(workspace ? { workspace } : {}),
      deadlineAtMs,
    }
    const [explicit, automatic] = await Promise.all([
      // A reference is contained in a session's workspace; without one there is nothing to read
      // it against.
      sessionId && request.references.length
        ? resolveCompletionReferences(
            deps.contextManager,
            { ...base, sessionId, references: request.references },
            signal,
          ).catch(() => undefined)
        : undefined,
      deps.contextManager
        .collect(
          { ...base, maxBytes: RECOMMENDATION_CONTEXT_BYTES, maxItems: AUTOMATIC_ITEMS },
          [],
          signal,
        )
        .catch(() => undefined),
    ])
    return [...(explicit?.contributions ?? []), ...(automatic?.contributions ?? [])].map(
      ({ content, priority }) => ({ content, priority }),
    )
  }
}

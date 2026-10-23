import type { CapabilitySnapshot } from '@/shared/api/contracts'
import { sameEnabledNames } from './miniAppContribSnapshot'

let capabilityVersion = 0
/** The last server document published, whatever its scope (the revision is process-wide). */
let lastDocument: { projectId: string; revision: number; enabledNames: Set<string> | null } | null =
  null

/**
 * Record a document the workbench published. A scope switch is not news for documents of OTHER
 * scopes; only the server revision moving, or a scope's own enabled set moving, is.
 */
export function noteCapabilityDocument(
  document: CapabilitySnapshot,
  enabledNames: Set<string> | null,
): void {
  const projectId = document.scope.projectId
  if (
    lastDocument &&
    (document.revision !== lastDocument.revision ||
      (projectId === lastDocument.projectId &&
        !sameEnabledNames(lastDocument.enabledNames, enabledNames)))
  ) {
    capabilityVersion += 1
  }
  lastDocument = { projectId, revision: document.revision, enabledNames }
}

/**
 * The staleness key of capability DOCUMENTS (`capabilityCache.ts`). `miniAppContribVersion` also
 * advances when a plugin's UI settles or reloads, which changes nothing a document carries —
 * keying the cache on it re-read every cached scope once per settled plugin batch at startup.
 */
export function miniAppCapabilityVersion(): number {
  return capabilityVersion
}

/** Test seam. */
export function __resetCapabilityVersion(): void {
  capabilityVersion = 0
  lastDocument = null
}

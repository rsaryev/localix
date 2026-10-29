/**
 * The one way a completion request turns what the client named into context: the editor's edit
 * prediction and every text-input ghost surface both call this.
 *
 * Before it, the two did it separately — edit prediction minted Fabric references from its own
 * `{id, kind, uri}` wire shape, and chat ghost text expanded a narrower `ContextRef` through the
 * host expander with no Fabric policy at all. A completion reference is now the binding-target
 * shape everywhere, and resolution is Fabric's, so both destinations read a linked file, an open
 * tab and a mini app resource under the same scope, containment and secret rules as a sent message.
 */
import { createHash } from 'node:crypto'

import type { CompletionReference } from '../inline-completion/contracts'
import { COMPLETION_REFERENCE_LIMIT } from '../inline-completion/contracts'
import type {
  ContextDestination,
  ContextReference,
  ResolveContext,
} from '../context-fabric/contracts'
import type { ContextManager, ExplicitContextCollectionResult } from '../context-fabric/manager'
import { COMPLETION_RAW_CONTEXT_BYTES } from './completion-context'

/** How far an ambient (merely open) reference ranks below one the user linked. */
const AMBIENT_PRIORITY_PENALTY = 300

function identity(reference: CompletionReference): string {
  return JSON.stringify([reference.kind, reference.uri ?? '', reference.token])
}

/**
 * Merge references from several producers: the first occurrence wins, except that a `linked`
 * occurrence upgrades an `ambient` one — a tab the user also attached ranks as attached.
 */
export function mergeCompletionReferences(
  ...lists: ReadonlyArray<readonly CompletionReference[] | undefined>
): CompletionReference[] {
  const merged = new Map<string, CompletionReference>()
  for (const list of lists) {
    for (const reference of list ?? []) {
      const key = identity(reference)
      const previous = merged.get(key)
      if (!previous) merged.set(key, reference)
      else if (previous.origin === 'ambient' && reference.origin !== 'ambient')
        merged.set(key, { ...previous, origin: reference.origin ?? 'linked' })
    }
  }
  // Linked first, so the limit trims what is merely open before what the user chose.
  return [...merged.values()]
    .sort((a, b) => Number(a.origin === 'ambient') - Number(b.origin === 'ambient'))
    .slice(0, COMPLETION_REFERENCE_LIMIT)
}

/**
 * A stable id per reference: the same reference in two calls is the same cache key, and a caller
 * can tell which contributions it produced.
 */
export function completionReferenceId(reference: CompletionReference): string {
  return `cref:${createHash('sha256').update(identity(reference)).digest('hex').slice(0, 24)}`
}

export function mintCompletionReference(
  reference: CompletionReference,
  scope: ContextReference['scope'],
): ContextReference {
  return {
    version: 1,
    id: completionReferenceId(reference),
    kind: reference.kind,
    ...(reference.uri ? { uri: reference.uri } : {}),
    presentation: { token: reference.token, label: reference.label },
    freshness: 'resolve-at-send',
    scope,
    ...(reference.attributes ? { attributes: reference.attributes } : {}),
  }
}

export interface ResolveCompletionReferencesInput {
  destination: Extract<
    ContextDestination,
    'edit-prediction' | 'inline-completion' | 'recommendation'
  >
  userId: string
  sessionId: string
  references: readonly CompletionReference[]
  workspace?: ResolveContext['workspace']
  deadlineAtMs?: number
}

/**
 * Resolve references through Fabric and rank what comes back by where it came from. Returns the
 * raw contributions; the caller excerpts them to its prompt budget (`packCompletionContext`).
 */
export async function resolveCompletionReferences(
  manager: ContextManager,
  input: ResolveCompletionReferencesInput,
  signal: AbortSignal,
): Promise<ExplicitContextCollectionResult | undefined> {
  if (input.references.length === 0) return undefined
  const scope = { userId: input.userId, sessionId: input.sessionId }
  const minted = input.references.map((reference) => ({
    reference,
    fabric: mintCompletionReference(reference, scope),
  }))
  const result = await manager.resolveExplicit(
    {
      destination: input.destination,
      userId: input.userId,
      sessionId: input.sessionId,
      maxBytes: COMPLETION_RAW_CONTEXT_BYTES,
      maxItems: minted.length * 2,
      ...(input.workspace ? { workspace: input.workspace } : {}),
      ...(input.deadlineAtMs ? { deadlineAtMs: input.deadlineAtMs } : {}),
    },
    minted.map((item) => item.fabric),
    signal,
  )
  const ambientContributions = new Set(
    result.referenceOutcomes.flatMap((outcome) => {
      const origin = minted.find((item) => item.fabric.id === outcome.referenceId)?.reference.origin
      return origin === 'ambient' ? outcome.contributionIds : []
    }),
  )
  return {
    ...result,
    contributions: result.contributions.map((item) =>
      ambientContributions.has(item.id)
        ? { ...item, priority: item.priority - AMBIENT_PRIORITY_PENALTY }
        : item,
    ),
  }
}

/**
 * Everything one inline-completion call knows before the model runs, gathered once for every
 * surface in it.
 *
 * Two kinds of context, kept apart because they answer different questions:
 *   - a surface's OWN grounding (the chat transcript, a commit's change set) — what this field is
 *     about. Admitted through Fabric's policy, then clipped by core to one ceiling per surface.
 *   - the SHARED working set (open tabs, linked chips, automatic providers) — what the user is
 *     looking at. Resolved through Fabric once per call and excerpted later against the words
 *     actually being typed (`packCompletionContext`), so it costs one block however many
 *     surfaces ask.
 * Neither path lets a surface put text in the prompt that the admission policy has not seen.
 */
import type { CompletionReference } from '../inline-completion/contracts'
import type { ContextContribution, ResolveContext } from '@localixai/mini-app-sdk/backend'
import type { ContextManager } from '../context-fabric/manager'
import { COMPLETION_RAW_CONTEXT_BYTES } from '../autocomplete/completion-context'
import { resolveCompletionReferences } from '../autocomplete/completion-references'
import { SURFACE_CONTEXT_BYTE_CEILING, clipContextBlock } from './surfaces'

/**
 * How long a keystroke waits for the shared working set. It is a hint, not the field's own
 * grounding: a cold resource that misses this simply leaves the block out of this suggestion.
 */
export const SHARED_CONTEXT_DEADLINE_MS = 2_500

export interface SurfaceContextInput {
  userId: string
  sessionId: string
  surfaces: readonly { id: string; payload: unknown }[]
  references: readonly CompletionReference[]
  /** A surface's own grounding; already bounded by the caller's deadline and abort. */
  resolveOwn: (surface: { id: string; payload: unknown }) => Promise<readonly ContextContribution[]>
  signal: AbortSignal
  deadlineAtMs: number
}

export interface SurfaceContextDeps {
  contextManager?: ContextManager
  /** The session's trusted workspace; linked files are contained in it. */
  resolveContextWorkspace?: (
    userId: string,
    sessionId: string,
  ) => Promise<ResolveContext['workspace'] | undefined>
}

export interface GatheredSurfaceContext {
  /** Admitted, clipped own context per surface id (`''` when it has none). */
  own: Map<string, string>
  /** Admitted shared contributions, still raw: ranked against the fragments by the caller. */
  shared: ContextContribution[]
}

const SEPARATOR = '\u0000'

export async function gatherSurfaceContext(
  deps: SurfaceContextDeps,
  input: SurfaceContextInput,
): Promise<GatheredSurfaceContext> {
  const sharedDeadline = Math.min(input.deadlineAtMs, Date.now() + SHARED_CONTEXT_DEADLINE_MS)
  const workspacePromise =
    deps.contextManager && deps.resolveContextWorkspace
      ? deps.resolveContextWorkspace(input.userId, input.sessionId).catch(() => undefined)
      : Promise.resolve(undefined)
  const ownPromise = Promise.all(
    input.surfaces.map(async (surface) => ({ surface, items: await input.resolveOwn(surface) })),
  )
  const referencesPromise = workspacePromise.then((workspace) =>
    deps.contextManager
      ? resolveCompletionReferences(
          deps.contextManager,
          {
            destination: 'inline-completion',
            userId: input.userId,
            sessionId: input.sessionId,
            references: input.references,
            ...(workspace ? { workspace } : {}),
            deadlineAtMs: sharedDeadline,
          },
          input.signal,
        ).catch(() => undefined)
      : undefined,
  )

  const [owned, workspace, references] = await Promise.all([
    ownPromise,
    workspacePromise,
    referencesPromise,
  ])
  // Tag each own contribution with its surface so one admission pass can serve every surface.
  const tagged = owned.flatMap(({ surface, items }) =>
    items.map((item) => ({ ...item, id: `${surface.id}${SEPARATOR}${item.id}` })),
  )
  const admitted = deps.contextManager
    ? (
        await deps.contextManager
          .collect(
            {
              destination: 'inline-completion',
              userId: input.userId,
              sessionId: input.sessionId,
              maxBytes: COMPLETION_RAW_CONTEXT_BYTES,
              maxItems: tagged.length + 16,
              ...(workspace ? { workspace } : {}),
              deadlineAtMs: sharedDeadline,
            },
            tagged,
            input.signal,
          )
          .catch(() => undefined)
      )?.contributions
    : tagged

  const ownBySurface = new Map<string, string[]>()
  const shared: ContextContribution[] = [...(references?.contributions ?? [])]
  for (const item of admitted ?? []) {
    const cut = item.id.indexOf(SEPARATOR)
    // No tag means an automatic provider's output: part of the shared working set.
    if (cut === -1) shared.push(item)
    else {
      const surfaceId = item.id.slice(0, cut)
      ownBySurface.set(surfaceId, [...(ownBySurface.get(surfaceId) ?? []), item.content])
    }
  }
  const own = new Map(
    input.surfaces.map((surface) => [
      surface.id,
      clipContextBlock(
        (ownBySurface.get(surface.id) ?? []).join('\n\n'),
        SURFACE_CONTEXT_BYTE_CEILING,
      ),
    ]),
  )
  return { own, shared }
}

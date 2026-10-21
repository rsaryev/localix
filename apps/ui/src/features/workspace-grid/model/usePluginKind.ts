import type { WorkItemKindContribution } from '@/shared/contrib/uiContrib'
import { usePluginRegistrySlice } from '@/shared/contrib/usePluginRegistrySlice'
import { activeWorkItemContribution, isPendingContributedKind } from './capabilities'
import type { WorkItemKind } from '@/shared/lib/workItem'

/**
 * What a plugin-only kind can render right now: its live registration, or why there is none.
 *
 * A restored tab read this once, inside a memoised body, so it stayed on "Restoring…" (or
 * "Unsupported") until the SLOWEST plugin loaded or an unrelated render passed by — reopening the
 * tab was the only fix a person had. As a registry slice it re-renders exactly when this kind's
 * answer moves: its owner registers, is replaced by a rebuild, or gives up.
 */
export type PluginKindState = 'loading' | 'ready' | 'unavailable'

/** The live registration (identity changes on a rebuild), or the state standing in for one. */
export type PluginKindSlice = WorkItemKindContribution | Exclude<PluginKindState, 'ready'>

export function pluginKindSlice(kind: WorkItemKind): PluginKindSlice {
  const contributed = activeWorkItemContribution(kind)
  if (contributed) return contributed
  return isPendingContributedKind(kind) ? 'loading' : 'unavailable'
}

export function usePluginKind(kind: WorkItemKind): PluginKindSlice {
  return usePluginRegistrySlice(`kind:${kind}`, () => pluginKindSlice(kind))
}

/**
 * The live registrations of several kinds — a tab strip's icons and tints — as one slice that
 * moves only when one of THESE kinds' registrations does.
 */
export function useWorkItemKindContributions(
  kinds: readonly WorkItemKind[],
): ReadonlyArray<WorkItemKindContribution | undefined> {
  return usePluginRegistrySlice(`kinds:${kinds.join('\u0000')}`, () =>
    kinds.map((kind) => activeWorkItemContribution(kind)),
  )
}

import type { CompletionReference } from '@localixai/api/client'
import type { CompletionWorkingSetOptions } from '@/shared/api/completionWorkingSet'

import { activeTabLinks } from './activeTabLink'
import { useGridStore } from './store'

/** One path spelled relative in a tab and absolute in an editor is still one file. */
function samePath(a: string, b: string): boolean {
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`)
}

/**
 * The grid's answer to "what is the user working with": the same ranked open-tab bindings the
 * composer shows as ambient chips (`activeTabLinks`), read at request time so it is never stale
 * and costs nothing between keystrokes. A binding target already has the reference's shape.
 *
 * Every binding of the requesting editor's own tab is left out — its file, and the selection or
 * dirty buffer its view publishes — because that document is already in the prompt whole.
 */
export function workspaceCompletionWorkingSet(
  options: CompletionWorkingSetOptions = {},
): CompletionReference[] {
  const state = useGridStore.getState()
  const excluded = options.excludeFilePath
  return activeTabLinks(state)
    .filter(({ tabId }) => {
      if (!excluded) return true
      const item = state.items[tabId]
      const path = item?.payload?.path
      return !(
        (item?.kind === 'file' || item?.kind === 'diff') &&
        typeof path === 'string' &&
        samePath(path, excluded)
      )
    })
    .map(({ binding }) => ({
      kind: binding.target.kind,
      token: binding.target.token,
      label: binding.target.label,
      ...(binding.target.uri ? { uri: binding.target.uri } : {}),
      ...(binding.target.attributes ? { attributes: binding.target.attributes } : {}),
      origin: 'ambient' as const,
    }))
}

/** Hear every move of the grid: a tab opened, focused or closed may change the working set. */
export function subscribeWorkspaceWorkingSet(listener: () => void): () => void {
  return useGridStore.subscribe(() => listener())
}

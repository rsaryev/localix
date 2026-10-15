import { useMemo } from 'react'
import {
  editorViewKey,
  loadEditorViewState,
  saveEditorViewState,
} from '@/features/inspector/model/editorViewState'
import type { ViewStateBridge } from '@/shared/ui/code-editor/viewState'

/**
 * Persist + restore this file's caret + scroll across a tab reopen / reload.
 * Keyed per session+path (like the grid keys the tab), so the same path in two
 * sessions restores independently. An explicit path:line reveal opts out.
 */
export function useEditorViewStateBridge(
  sessionId: string,
  path: string,
  line: number | undefined,
): ViewStateBridge {
  return useMemo<ViewStateBridge>(() => {
    const key = editorViewKey(sessionId, path)
    return {
      load: () => loadEditorViewState(key),
      save: (snap) => saveEditorViewState(key, snap),
      skipRestore: () => Boolean(line),
    }
  }, [sessionId, path, line])
}

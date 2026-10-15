import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import { createTypeahead } from '@localixai/kit/tree-navigation'
import { revealScrollIndex, type RevealRequest } from './fileTreeReveal'
import {
  fileTreeNavigation,
  type FileTreeEntryRow,
  type FileTreeNavigationKey,
  type FileTreeRow,
} from './fileTreeRows'

interface FileTreeFocusInput {
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>
  scrollEl: HTMLDivElement | null
  rows: readonly FileTreeRow[]
  entryRows: FileTreeEntryRow[]
  layoutIndexByPath: Map<string, number>
  rovingPath: string | null
  setRememberedRovingPath: (path: string) => void
  revealRequest: RevealRequest | null
  doToggleDir: (path: string) => void
}

/**
 * Keyboard focus over the virtualized Explorer: moving focus to a model row that may
 * not be mounted yet, scrolling to settled reveal requests, and arrow/typeahead keys.
 */
export function useFileTreeFocus({
  virtualizer,
  scrollEl,
  rows,
  entryRows,
  layoutIndexByPath,
  rovingPath,
  setRememberedRovingPath,
  revealRequest,
  doToggleDir,
}: FileTreeFocusInput) {
  const pendingFocusRef = useRef<string | null>(null)
  const focusPath = useCallback(
    (path: string) => {
      const index = layoutIndexByPath.get(path)
      if (index === undefined) return
      pendingFocusRef.current = path
      setRememberedRovingPath(path)
      virtualizer.scrollToIndex(index, { align: 'auto' })
    },
    [layoutIndexByPath, setRememberedRovingPath, virtualizer],
  )

  useLayoutEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending || pending !== rovingPath || !scrollEl) return
    // `scrollToIndex` may have to widen the virtual range before the row exists in
    // the DOM, and that lands a frame later — without the retry a jump to a far-off
    // row (End, PageDown, a typeahead match) scrolled but left focus behind, so the
    // NEXT arrow key navigated from the old row.
    let frame = 0
    const tryFocus = () => {
      const path = pendingFocusRef.current
      if (!path) return
      const target = scrollEl.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(path)}"]`)
      if (!target) {
        frame = requestAnimationFrame(tryFocus)
        return
      }
      pendingFocusRef.current = null
      target.focus({ preventScroll: true })
    }
    tryFocus()
    return () => {
      if (frame) cancelAnimationFrame(frame)
    }
  }, [rovingPath, rows, scrollEl])

  // Reveal emits a semantic path only after its ancestor loads/expands settle.
  // Mapping it to a layout index works even when the target had no DOM node.
  // `revealScrollIndex` owns the once-per-intent rule — see the note there for why
  // re-serving a completed request is what made the tree jump on every expand.
  const revealedIntentRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    const index = revealScrollIndex(revealRequest, revealedIntentRef.current, (path) =>
      layoutIndexByPath.get(path),
    )
    if (index === null) {
      if (!revealRequest) revealedIntentRef.current = null
      return
    }
    revealedIntentRef.current = revealRequest?.intent ?? null
    virtualizer.scrollToIndex(index, { align: 'center' })
  }, [layoutIndexByPath, revealRequest, virtualizer])

  const [typeahead] = useState(() => createTypeahead())
  const onTreeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return
    const target = e.target
    if (!(target instanceof Element)) return
    const currentPath = target.closest<HTMLElement>('[data-tree-path]')?.dataset.treePath
    if (!currentPath) return // inline create/rename input owns its own keys
    if (
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'Home' ||
      e.key === 'End'
    ) {
      const navigation = fileTreeNavigation(entryRows, currentPath, e.key as FileTreeNavigationKey)
      if (!navigation) return
      e.preventDefault()
      if (navigation.kind === 'toggle') doToggleDir(navigation.path)
      else focusPath(navigation.path)
      return
    }
    if (e.key.length !== 1 || e.key === ' ' || e.ctrlKey || e.metaKey || e.altKey) return
    const match = typeahead.handleChar(e.key, entryRows, currentPath)
    if (!match) return
    e.preventDefault()
    focusPath(match)
  }

  return { onTreeKeyDown }
}

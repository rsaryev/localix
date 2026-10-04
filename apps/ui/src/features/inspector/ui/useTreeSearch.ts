import { useEffect, useMemo, useRef, useState } from 'react'
import type { DirEntry } from '@/shared/api/contracts'
import { subscribeTreeSearch, type TreeSearchMode } from '@/shared/lib/explorerBus'
import { filterFileTree } from './fileTreeFilter'
import { useContentSearch } from './search/useContentSearch'

/**
 * The file tree's search model: ONE field, TWO modes.
 *
 *  - `content` (the DEFAULT) — find-in-files, served by the backend through
 *    `useContentSearch`. Opening tree search lands you ready to search INSIDE files,
 *    which is what people actually want; the tree is then replaced by the results view.
 *  - `names` — a filter of the ALREADY-LOADED tree (pure `filterFileTree`),
 *    which is why it needs no request and why it can only ever match what is expanded.
 *
 * The knowledge this owns is the visibility rule and the reset rule: the field is showing
 * whenever it was opened OR still holds a query (so a typed query cannot be orphaned by a
 * stray toggle), and closing it clears the query, hides the field AND returns the mode to
 * `content` — so the next open is never surprised by a mode the user set minutes ago.
 */
export function useTreeSearch(
  sessionId: string | null,
  root: string | null,
  childrenByPath: Record<string, DirEntry[]>,
) {
  const [mode, setMode] = useState<TreeSearchMode>('content')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  // Showing whenever explicitly opened OR still carrying a query.
  const visible = open || query.length > 0
  const contentMode = mode === 'content' && visible

  const rowRef = useRef<HTMLDivElement>(null)
  const focusField = () => rowRef.current?.querySelector('input')?.focus()

  /** Filename-filter result (null unless `names` mode is showing). */
  const filter = useMemo(
    () => (mode === 'names' && visible ? filterFileTree(root, childrenByPath, query) : null),
    [mode, visible, root, childrenByPath, query],
  )

  const content = useContentSearch({ sessionId, query, enabled: contentMode })

  const openSearch = (next: TreeSearchMode = mode) => {
    setMode(next)
    setOpen(true)
    requestAnimationFrame(focusField)
  }
  const close = () => {
    setQuery('')
    setOpen(false)
    setMode('content')
    content.clear()
  }

  // "Show Search" / find-in-files from the command palette: open + focus in the
  // requested mode. Deliberately not dependent on `openSearch` (which changes every
  // render) — the bus subscription must be established exactly once.
  useEffect(
    () =>
      subscribeTreeSearch((next) => {
        setMode(next)
        setOpen(true)
        requestAnimationFrame(focusField)
      }),
    [],
  )

  return {
    mode,
    setMode,
    visible,
    contentMode,
    query,
    setQuery,
    filter,
    content,
    rowRef,
    openSearch,
    close,
  }
}

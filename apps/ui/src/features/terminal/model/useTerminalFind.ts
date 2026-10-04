/**
 * The terminal's find state machine: the widget's own state, the search it runs against
 * xterm's search addon, and the two openers the key handler and context menu share.
 *
 * It lives beside the pane rather than inside it because the pane is a socket + xterm
 * lifecycle, and find is none of that: it owns four pieces of state, reads one addon ref,
 * and never touches the transport. Splitting it out is what keeps the pane's own effects
 * readable — see `TerminalPane.tsx`.
 */
import { useCallback, useRef, useState } from 'react'
import type { ISearchOptions, SearchAddon } from '@xterm/addon-search'

import { searchDecorations } from './terminalTheme'
import type { FindState } from '../ui/TerminalFindWidget'

export interface TerminalFind {
  find: FindState
  setFind: React.Dispatch<React.SetStateAction<FindState>>
  /** The widget's input, selected when the widget opens so a second ⌘F retypes. */
  inputRef: React.RefObject<HTMLInputElement | null>
  open: () => void
  close: () => void
  run: (query: string, opts: { caseSensitive: boolean; forward: boolean }) => void
}

export function useTerminalFind(searchRef: { current: SearchAddon | null }): TerminalFind {
  const inputRef = useRef<HTMLInputElement>(null)
  const [find, setFind] = useState<FindState>({
    open: false,
    term: '',
    caseSensitive: false,
    count: 0,
    index: -1,
  })

  const open = useCallback(() => {
    setFind((f) => ({ ...f, open: true }))
    requestAnimationFrame(() => inputRef.current?.select())
  }, [])

  const close = useCallback(() => {
    setFind((f) => ({ ...f, open: false }))
    searchRef.current?.clearDecorations()
  }, [searchRef])

  const run = useCallback(
    (query: string, opts: { caseSensitive: boolean; forward: boolean }) => {
      const search = searchRef.current
      if (!search) return
      if (!query) {
        search.clearDecorations()
        return
      }
      const options: ISearchOptions = {
        caseSensitive: opts.caseSensitive,
        decorations: searchDecorations(),
      }
      if (opts.forward) search.findNext(query, options)
      else search.findPrevious(query, options)
    },
    [searchRef],
  )

  return { find, setFind, inputRef, open, close, run }
}
